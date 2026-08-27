/**
 * The stylesheets, checked as text.
 *
 * Nothing else in the suite reads CSS, which is how a stylesheet split across
 * files once shipped with an `@media print` block whose closing brace had been
 * left in the other file. An unbalanced brace does not fail loudly - it eats
 * every rule after it, so the screen simply loses its styling and the tests all
 * still pass.
 *
 * These are cheap structural checks, not a parser. They catch the failure mode
 * that actually happened: a rule cut in half, an import in the wrong place, a
 * selector that vanished when a file was split.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

const read = (file) =>
    readFileSync(resolvePath(process.cwd(), file), 'utf8');

const SHEETS = [
    'src/shared/theme.css',
    'src/shared/modal.css',
    'src/render/report.css',
    'src/designer/styles.css',
    'src/preview/styles.css'
];

/** braces inside comments and strings would skew the count */
function stripNoise(css) {
    return css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

const count = (text, ch) => (text.match(new RegExp(`\\${ch}`, 'g')) || []).length;


describe.each(SHEETS)('%s', (file) => {
    const css = read(file);
    const bare = stripNoise(css);

    it('balances its braces', () => {
        expect(count(bare, '{')).toBe(count(bare, '}'));
    });

    it('never nests a rule two deep outside a media block', () => {
        /**
         * A stray closing brace shows up as the depth going negative long
         * before the totals stop matching, so this catches it at the line.
         */
        let depth = 0;

        for (const ch of bare) {
            if (ch === '{') depth++;
            else if (ch === '}') depth--;

            expect(depth).toBeGreaterThanOrEqual(0);
            expect(depth).toBeLessThanOrEqual(2);
        }
    });

    it('puts every @import before the first rule', () => {
        /** CSS drops an @import that follows a rule, silently */
        const firstRule = bare.indexOf('{');
        const lastImport = bare.lastIndexOf('@import');

        if (lastImport === -1 || firstRule === -1) return;
        expect(lastImport).toBeLessThan(firstRule);
    });

    it('closes every block it opens by the end of the file', () => {
        expect(bare.trim().endsWith('}')).toBe(true);
    });
});


describe('what each sheet is responsible for', () => {
    it('keeps the palette in the shared theme, not in a screen', () => {
        expect(read('src/shared/theme.css')).toContain('--surface:');

        for (const file of ['src/designer/styles.css', 'src/preview/styles.css']) {
            expect(read(file)).not.toContain('--surface:');
        }
    });

    it('scopes the report rules under .page, so a rail is not restyled', () => {
        /**
         * The bare `p`/`table`/`th` selectors this replaced were safe while the
         * whole window was the report. The designer has a properties rail full
         * of its own paragraphs and would have had them absolutely positioned.
         */
        const report = stripNoise(read('src/render/report.css'));

        for (const rule of report.split('}')) {
            const selector = rule.split('{')[0].trim();
            if (!selector) continue;

            for (const part of selector.split(',')) {
                expect(part.trim()).toMatch(/^\.(page|band)\b/);
            }
        }
    });

    it('gives the dialog shell to both screens and the cards to neither', () => {
        expect(read('src/shared/modal.css')).toContain('.modal-card');
        /** the export format cards are the preview's business alone */
        expect(read('src/shared/modal.css')).not.toContain('.format-note');
        expect(read('src/preview/styles.css')).toContain('.format-note');
    });

    it('has both screens import every layer they draw with', () => {
        for (const file of ['src/designer/styles.css', 'src/preview/styles.css']) {
            const css = read(file);

            expect(css).toContain('shared/theme.css');
            expect(css).toContain('render/report.css');
            expect(css).toContain('shared/modal.css');
        }
    });
});


describe('rules that reach further than they mean to', () => {
    const designer = stripNoise(read('src/designer/styles.css'));

    /** the declarations of the first rule whose selector matches exactly */
    function ruleFor(selector) {
        for (const chunk of designer.split('}')) {
            const [head, body] = chunk.split('{');
            if (!body) continue;

            if (head.trim() === selector) return body;
        }
        return null;
    }

    it('does not size every dialog field for the narrowest one', () => {
        /**
         * `.modal-card .dz-field` was `auto 90px`, written for a column count
         * and then silently squeezing everything that arrived later - the
         * report picker and the save dialog's name box were both 90px wide
         * because of it, and 714 specs passed while they were.
         *
         * A base rule inside a component scope sets the general case; the
         * narrow one asks for itself.
         */
        const base = ruleFor('.modal-card .dz-field');

        expect(base, 'the modal field base rule has gone').not.toBeNull();
        expect(base).not.toMatch(/grid-template-columns:[^;]*\d+px/);
    });

    it('keeps the narrow dialog field opt-in, by its own class', () => {
        const narrow = ruleFor('.modal-card .dz-field-count');

        expect(narrow).not.toBeNull();
        expect(narrow).toMatch(/grid-template-columns:.*px/);
    });

    it('gives the report picker a rule that outranks the field base', () => {
        /**
         * Both are class selectors, so a `.dz-field-picker` rule loses to a
         * `.modal-card .dz-field` one however far down the file it sits. The
         * picker's rules carry the same scope for that reason.
         */
        for (const line of designer.split('\n')) {
            const head = line.trim();
            if (!head.startsWith('.dz-field-picker')) continue;

            expect(head, 'a picker rule that cannot win').toBe('unreachable');
        }
    });
});


describe('the stylesheet a consumer links', () => {
    const report = read('src/render/report.css');

    it('carries a fallback for every colour it uses', () => {
        /**
         * An application that links this and nothing else has none of the
         * designer's variables. Without a fallback `border: 1px solid
         * var(--border)` resolves to nothing, the table looks borderless, and
         * the report looks broken rather than unthemed.
         */
        const bare = stripNoise(report).match(/var\(--[a-z-]+\s*\)/g) ?? [];
        expect(bare, 'a variable with no fallback').toEqual([]);
    });

    it('keeps the two rules that are not decoration', () => {
        /**
         * These are why a report drawn without this sheet is wrong rather than
         * merely plain: column widths are ignored without the first, and every
         * text item is pushed off its position by the browser's default
         * paragraph margin without the second.
         */
        expect(report).toMatch(/table-layout:\s*fixed/);
        expect(report).toMatch(/\.page p\s*\{[^}]*margin:\s*0/s);
    });

    it('is reachable by the name the README gives it', () => {
        const pkg = JSON.parse(read('package.json'));

        expect(pkg.exports['./report.css']).toBe('./src/render/report.css');
    });
});

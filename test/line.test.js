/**
 * The line item, through the engine and out to the markup.
 *
 * A line carries no data, so there is nothing here about resolving or grouping
 * it - what there is to get right is its box, its pen, and the fact that the
 * two are not the same thing. The rule is drawn down the middle of the box
 * rather than being the box, so that a hairline is still something a designer
 * can get hold of; every test below is really about that distinction.
 *
 * The designer's side of it - the tool, and the fields the rail offers - is in
 * editing.test.js and fields.test.js.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateLayout } from '../src/engine/validate.js';
import { measure } from '../src/engine/measure.js';
import { resolve } from '../src/engine/resolve.js';
import { render } from '../src/render/render.js';
import { items } from '../src/render/items.js';
import { layout, line, text, table, band, rows, run } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());


const withLine = (item) => layout({
    bands: [band('detail', [item]), band('pageFooter', [], { height: 40 })]
});

const measured = (item) => {
    const json = measure(resolve(withLine(item), { items: [] }));
    return json.bands.find(b => b.type === 'detail').items[0].measuredHeight;
};


describe('a line is a layout the engine accepts', () => {
    it('validates', () => {
        expect(validateLayout(withLine(line('l1')))).toEqual([]);
    });

    /** thickness and dashes are refinements; a bare line is a hairline rule */
    it('validates with nothing but a type and an id', () => {
        expect(validateLayout(withLine({ id: 'l1', type: 'line' }))).toEqual([]);
    });

    it('refuses a direction that is not one', () => {
        const issues = validateLayout(withLine(line('l1', { orientation: 'sideways' })));

        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatch(/orientation "sideways"/);
        expect(issues[0]).toMatch(/horizontal, vertical/);
    });

    it('refuses a dash pattern the browser cannot draw', () => {
        const issues = validateLayout(withLine(line('l1', { lineStyle: 'squiggly' })));

        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatch(/lineStyle "squiggly"/);
        expect(issues[0]).toMatch(/solid, dashed, dotted, double/);
    });

    it('refuses a thickness that is not a positive number', () => {
        for (const thickness of [0, -2, 'thick']) {
            const issues = validateLayout(withLine(line('l1', { thickness })));

            expect(issues, String(thickness)).toHaveLength(1);
            expect(issues[0]).toMatch(/thickness must be a positive number/);
        }
    });

    it('still names the item it is complaining about', () => {
        const issues = validateLayout(withLine(line('l1', { orientation: 'up' })));

        expect(issues[0]).toMatch(/bands\[0\]\.items\[0\]/);
    });

    it('names line among the types it will take', () => {
        const issues = validateLayout(withLine({ id: 'x', type: 'squiggle' }));

        expect(issues[0]).toMatch(/text, table, line/);
    });
});


describe('measuring a line', () => {
    /** the box is what it occupies; the rule inside it is not */
    it('takes the height of its box, not of its rule', () => {
        expect(measured(line('l1', { h: 12, thickness: 1 }))).toBe(12);
    });

    it('grows for a rule too thick for its box, rather than clipping it', () => {
        expect(measured(line('l1', { h: 4, thickness: 10 }))).toBe(10);
    });

    /** running down the page, the thickness is a width and cannot be a height */
    it('ignores the thickness of a vertical line', () => {
        expect(measured(line('l1', {
            orientation: 'vertical', w: 12, h: 80, thickness: 20
        }))).toBe(80);
    });

    it('is zero for a line with no box at all', () => {
        expect(measured({ id: 'l1', type: 'line' })).toBe(0);
    });

    it('counts towards the band it is on', () => {
        const json = measure(resolve(layout({
            bands: [band('detail', [
                text('t', { y: 0, h: 20 }),
                line('l1', { y: 60, h: 12 })
            ])]
        }), { items: [] }));

        /** the band reaches the lowest edge anything on it reaches */
        expect(json.bands[0].measuredHeight).toBe(72);
    });
});


describe('drawing a line', () => {
    const drawn = (item) => render(run(withLine(item), { items: rows(1) }));

    it('draws the rule as a border on a span inside the box', () => {
        const html = drawn(line('l1', { w: 300, h: 12, thickness: 2 }));

        expect(html).toContain('data-item-type="line"');
        expect(html).toContain('width:300px');
        expect(html).toContain('height:12px');
        expect(html).toContain('border-top:2px solid #000000');
    });

    it('draws every pen it is given', () => {
        for (const lineStyle of ['solid', 'dashed', 'dotted', 'double']) {
            expect(drawn(line('l1', { lineStyle, thickness: 3 })))
                .toContain(`border-top:3px ${lineStyle} #000000`);
        }
    });

    it('turns the border on its side for a vertical line', () => {
        const html = drawn(line('l1', {
            orientation: 'vertical', w: 12, h: 80, thickness: 2, lineStyle: 'dashed'
        }));

        expect(html).toContain('is-vertical');
        expect(html).toContain('border-left:2px dashed #000000');
        expect(html).not.toContain('border-top:2px');
    });

    /** a hand-written layout may say nothing about the pen at all */
    it('falls back to a black hairline', () => {
        const html = drawn({ id: 'l1', type: 'line', x: 0, y: 0, w: 200, h: 12 });

        expect(html).toContain('border-top:1px solid #000000');
    });

    /**
     * The validator turns a thickness of nothing away, but the designer canvas
     * draws straight from the layout without asking it - so the drawing has to
     * survive a figure that would otherwise paint no line at all.
     */
    it('draws a hairline rather than nothing for a thickness of zero', () => {
        expect(items([line('l1', { thickness: 0 })])).toContain('border-top:1px');
        expect(items([line('l1', { thickness: -3 })])).toContain('border-top:1px');
    });

    it('carries the id the designer selects it by', () => {
        expect(drawn(line('rule-1'))).toContain('data-item-id="rule-1"');
    });

    it('escapes an id out of a hand-written file', () => {
        const html = drawn(line('a"><script>alert(1)</script>'));

        expect(html).not.toContain('<script>');
    });

    it('is drawn beside the other items of its band', () => {
        const html = render(run(layout({
            bands: [band('detail', [table({ id: 'tbl' }), line('l1', { y: 200 })])]
        }), { items: rows(2) }));

        expect(html).toContain('data-item-type="line"');
        expect(html).toContain('data-item-type="table"');
    });
});

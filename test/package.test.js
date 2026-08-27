/**
 * What actually ships.
 *
 * This exists because the package once passed 824 specs while being broken on
 * install: `files` listed the CLI and the server but none of the files the CLI
 * *serves*, so `npx report-studio design` started, answered its four routes,
 * and returned 404 for the entire designer. Nothing in a suite that runs from
 * the working tree can see that - every import resolves there.
 *
 * So this asks npm what the tarball would contain and checks the answer covers
 * what the package promises.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

/** every path npm would put in the tarball, with forward slashes */
let shipped;

beforeAll(() => {
    /**
     * `--json` rather than parsing the notice lines: the human output is not a
     * format, and it has changed shape between npm versions before.
     */
    /**
     * Through a shell on Windows: Node refuses to spawn a .cmd directly since
     * the 22.x hardening, and npm is a .cmd there.
     */
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: process.platform === 'win32'
    });

    shipped = new Set(JSON.parse(out)[0].files.map(f => f.path.split(sep).join('/')));
}, 120_000);


/** every file under a directory in the working tree, as package-relative paths */
function treeUnder(dir) {
    const out = [];

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);

        if (entry.isDirectory()) out.push(...treeUnder(path));
        else out.push(relative('.', path).split(sep).join('/'));
    }

    return out;
}


describe('the entry points it advertises', () => {
    it('ships every file the exports map points at', () => {
        for (const target of Object.values(pkg.exports)) {
            const path = target.replace(/^\.\//, '');
            expect(shipped.has(path), `${path} is exported but not shipped`).toBe(true);
        }
    });

    it('ships the command it registers', () => {
        for (const target of Object.values(pkg.bin ?? {})) {
            const path = target.replace(/^\.\//, '');
            expect(shipped.has(path), `${path} is the bin but not shipped`).toBe(true);
        }
    });

    it('advertises no entry point that is not there', () => {
        /** `main` once pointed at an index.js that had never existed */
        if (!pkg.main) return;

        expect(shipped.has(pkg.main.replace(/^\.\//, ''))).toBe(true);
    });
});


describe('what the CLI serves', () => {
    /**
     * serve.js serves the directory above itself - src - so everything the
     * designer and preview pages load has to be in the tarball. This is the
     * failure that shipped: the routes worked and the screen was empty.
     */
    it('ships every source file under src/', () => {
        const missing = treeUnder('src').filter(path => !shipped.has(path));

        expect(missing, 'served by the CLI but absent from the package')
            .toEqual([]);
    });

    it('ships the stylesheets, which are not modules and are easy to forget', () => {
        const sheets = treeUnder('src').filter(p => p.endsWith('.css'));

        expect(sheets.length).toBeGreaterThan(0);
        for (const sheet of sheets) {
            expect(shipped.has(sheet), sheet).toBe(true);
        }
    });

    it('ships the pages themselves', () => {
        for (const page of ['src/designer/index.html', 'src/preview/index.html']) {
            expect(shipped.has(page), page).toBe(true);
        }
    });
});


describe('what it leaves out', () => {
    it('ships no tests', () => {
        expect([...shipped].filter(p => p.startsWith('test/'))).toEqual([]);
    });

    it('ships no fixtures', () => {
        /** development data; the pages must not import it statically */
        expect([...shipped].filter(p => p.startsWith('fixtures/'))).toEqual([]);
    });

    it('ships no build or test configuration', () => {
        for (const path of ['vite.config.js', 'vitest.config.js']) {
            expect(shipped.has(path), path).toBe(false);
        }
    });

    it('ships no reports somebody happened to save', () => {
        expect([...shipped].filter(p => p.startsWith('reports/'))).toEqual([]);
    });

    it('carries a licence and a readme', () => {
        expect(shipped.has('LICENSE')).toBe(true);
        expect(shipped.has('README.md')).toBe(true);
    });
});


describe('the pages reach nothing outside the package', () => {
    it('has no static import of the fixtures anywhere in src/', () => {
        /**
         * A static one made the preview page work under `npm run dev` and fail
         * at load under the CLI, where the fixtures do not exist - so the screen
         * was simply blank. Dynamic is fine: the failure is survivable and both
         * pages treat it as optional.
         */
        for (const path of treeUnder('src').filter(p => p.endsWith('.js'))) {
            const source = readFileSync(path, 'utf8');
            const statics = source.match(/^\s*import\s[^\n]*fixtures/gm) ?? [];

            expect(statics, path).toEqual([]);
        }
    });

    it('has no source file importing above the package root', () => {
        for (const path of treeUnder('src').filter(p => p.endsWith('.js'))) {
            const source = readFileSync(path, 'utf8');
            const escapes = source.match(/from\s+'\.\.\/\.\.\/(?!fixtures)/g) ?? [];

            expect(escapes, path).toEqual([]);
        }
    });
});


describe('the browser half stays free of Node', () => {
    it('keeps node: imports out of everything the browser loads', () => {
        /**
         * Spec 2.1 and the export split: src/server, src/cli and src/vite are
         * Node and reachable only from vite.config.js or the command. Anything
         * a page can import must not be.
         */
        const browser = treeUnder('src')
            .filter(p => p.endsWith('.js'))
            .filter(p => !p.startsWith('src/server/')
                && !p.startsWith('src/cli/')
                && !p.startsWith('src/vite/'));

        for (const path of browser) {
            expect(readFileSync(path, 'utf8'), path).not.toMatch(/from\s+'node:/);
        }
    });

    it('keeps the Node half out of the browser entry points', () => {
        for (const entry of ['src/index.js', 'src/designer/designer.js']) {
            const source = readFileSync(entry, 'utf8');

            expect(source, entry).not.toMatch(/server\/routes|cli\/|vite\//);
        }
    });
});

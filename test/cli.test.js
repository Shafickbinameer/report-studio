/**
 * The CLI and the static server it wraps around the report routes.
 *
 * Driven as a real process and a real server, because the failures worth
 * catching here were all environmental: an entry guard that never matched on
 * Windows, a flag parseArgs would not accept, and stdout dropped by an early
 * exit. None of those reproduce against a mock.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve } from '../src/cli/serve.js';
import { browserLaunch, runAsScript } from '../src/cli/index.js';

const run = promisify(execFile);
const CLI = resolve(process.cwd(), 'src/cli/index.js');

/**
 * These start a real Node process each, which is the point - the failures they
 * catch were an entry guard, a flag and a flush, none of which reproduce
 * against a mock. Spawning is slow, and slower again while the rest of the
 * suite has the CPU, so the default five seconds is not enough of a margin.
 */
vi.setConfig({ testTimeout: 30_000 });

const cli = (...args) => run(process.execPath, [CLI, ...args])
    .catch(error => error);


describe('the command', () => {
    it('prints its usage', async () => {
        /**
         * It printed nothing at all for a while: process.exit() drops whatever
         * has not flushed to a piped stdout.
         */
        const { stdout } = await cli('--help');

        expect(stdout).toContain('report-studio');
        expect(stdout).toContain('--dir');
    });

    it('runs at all when invoked as a script', async () => {
        /**
         * The entry guard compared import.meta.url against a hand-built
         * `file://` URL, which never matches a Windows drive path - so the
         * command loaded, did nothing, and exited zero.
         */
        const { stdout } = await cli('help');
        expect(stdout.length).toBeGreaterThan(0);
    });

    it('refuses a port that is not one', async () => {
        const result = await cli('design', '--port', 'abc');

        expect(result.code).toBe(1);
        expect(result.stderr).toContain('--port');
    });

    it('refuses a command it does not have', async () => {
        const result = await cli('frobnicate');

        expect(result.code).toBe(1);
        expect(result.stderr).toContain('frobnicate');
    });

    it('runs when it is reached through a symlink, which is how npm installs it', async () => {
        /**
         * `node_modules/.bin/report-studio` is a *symlink* to this file on
         * macOS and Linux, and that link is the path `npx report-studio` runs.
         * Node resolves import.meta.url through it and argv[1] does not, so an
         * entry guard that compares the two without realpath never matches:
         * the command loaded, did nothing and exited zero, on every platform
         * except the one it was written on - npm writes a shim holding the real
         * path on Windows.
         */
        const dir = await mkdtemp(join(tmpdir(), 'report-studio-bin-'));
        const link = join(dir, 'report-studio');

        try {
            await symlink(CLI, link, 'file');
        } catch (error) {
            /** an unprivileged Windows box cannot make one; the unit test below still runs */
            await rm(dir, { recursive: true, force: true });
            return;
        }

        try {
            const { stdout } = await run(process.execPath, [link, '--help']);
            expect(stdout).toContain('report-studio');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('knows it is the script whatever path was used to reach it', () => {
        /** the same guard without a filesystem, so it is checked everywhere */
        const url = pathToFileURL(CLI).href;

        expect(runAsScript(CLI, url)).toBe(true);
        expect(runAsScript(undefined, url)).toBe(false);
        expect(runAsScript(resolve('src/cli/serve.js'), url)).toBe(false);

        /** a path that is not there resolves to nothing, and is not this module */
        expect(runAsScript(resolve('src/cli/nope.js'), url)).toBe(false);
    });

    it('accepts --no-open', async () => {
        /**
         * parseArgs only learned to negate a boolean in Node 22.4, and this
         * package says it runs on 18.3 - so the flag is declared outright.
         * Without it the command refused to start at all.
         */
        const result = await cli('design', '--no-open', '--port', 'abc');

        expect(result.stderr).not.toContain('--no-open');
        expect(result.stderr).toContain('--port');
    });
});


describe('the server it starts', () => {
    let dir;
    let started;

    beforeAll(async () => {
        dir = await mkdtemp(join(tmpdir(), 'report-studio-cli-'));
        started = await serve({ dir, port: 0 });
    });

    afterAll(async () => {
        await started.close();
        await rm(dir, { recursive: true, force: true });
    });

    const get = (path) => fetch(`http://127.0.0.1:${started.port}${path}`);

    it('serves the designer page', async () => {
        const response = await get('/designer/');

        expect(response.status).toBe(200);
        expect(await response.text()).toContain('report-designer');
    });

    it('serves the modules that page imports', async () => {
        for (const file of ['designer.js', 'canvas.js', 'panel.js', 'styles.css']) {
            expect((await get(`/designer/${file}`)).status, file).toBe(200);
        }
    });

    it('serves the layers under the designer, not only the designer', async () => {
        /**
         * The page reaches sideways into shared/, render/ and engine/, and a
         * published package that shipped only src/designer served the shell of
         * a designer and 404 for everything it imports.
         */
        for (const file of [
            'shared/store.js', 'shared/dropdown.js', 'shared/prefix.js',
            'shared/theme.css', 'shared/modal.css', 'shared/dropdown.css',
            'render/items.js', 'render/render.js', 'render/report.css',
            'engine/index.js', 'engine/validate.js'
        ]) {
            expect((await get(`/${file}`)).status, file).toBe(200);
        }
    });

    it('serves the preview too', async () => {
        expect((await get('/preview/')).status).toBe(200);
    });

    it('answers the report routes alongside the files', async () => {
        const response = await get('/__reports');

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ reports: [] });
    });

    it('round-trips a report to disk', async () => {
        const layout = { version: 1, name: 'From the CLI', bands: [] };

        await fetch(`http://127.0.0.1:${started.port}/__reports/cli-report`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(layout)
        });

        const onDisk = JSON.parse(
            await readFile(join(dir, 'cli-report.json'), 'utf8'));

        expect(onDisk).toEqual(layout);
        expect(await get('/__reports/cli-report').then(r => r.json())).toEqual(layout);
    });

    it('gives the right content type, so a module is treated as one', async () => {
        const response = await get('/designer/designer.js');
        expect(response.headers.get('content-type')).toContain('javascript');
    });

    it('is a 404 for a file that is not there', async () => {
        expect((await get('/designer/nope.js')).status).toBe(404);
    });

    it('will not be walked out of with ..', async () => {
        /**
         * A static server that can be climbed out of hands over every file the
         * process can read.
         */
        for (const path of [
            '/../package.json',
            '/..%2Fpackage.json',
            '/designer/../../package.json',
            '/%2e%2e/package.json'
        ]) {
            const response = await get(path);
            expect([403, 404], path).toContain(response.status);
        }
    });

    it('does not reach the fixtures, which sit outside what it serves', async () => {
        /**
         * The designer page must therefore not import them statically - it
         * would work under `npm run dev` and break under the CLI, which is the
         * shipped path of the two.
         */
        expect((await get('/fixtures/test-data.js')).status).toBe(404);

        const entry = await get('/designer/main.js').then(r => r.text());
        expect(entry).not.toMatch(/^import .*fixtures/m);
    });

    it('binds to loopback, because it serves a write endpoint', async () => {
        expect(started.url).toContain('127.0.0.1');
    });
});

describe('how it opens the designer', () => {
    /**
     * The designer is a whole screen with its own bar, tool strip and rail. A
     * tab strip and an address bar above it are chrome about a page that has
     * none of its own, so where a Chromium-based browser can be found it is
     * opened as an app window instead - measured at 36px of browser chrome
     * against 94px for a tab.
     */
    const url = 'http://127.0.0.1:5177/designer/';

    it('always has something to try', () => {
        expect(browserLaunch(url).length).toBeGreaterThan(0);
    });

    it('asks for a window of its own before settling for a tab', () => {
        const tried = browserLaunch(url);
        const appWindows = tried.slice(0, -1);

        for (const one of appWindows) {
            expect(one.args).toContain(`--app=${url}`);
        }
    });

    it('sizes the window for a page and the chrome round it', () => {
        for (const one of browserLaunch(url).slice(0, -1)) {
            expect(one.args.some(a => a.startsWith('--window-size='))).toBe(true);
        }
    });

    /** whatever the platform registered for a URL, and never an app window */
    it('falls back to opening it however the system would', () => {
        const last = browserLaunch(url).at(-1);

        expect(last.args.join(' ')).toContain(url);
        expect(last.args.join(' ')).not.toContain('--app=');
    });

    it('goes straight to a tab when asked for one', () => {
        const tried = browserLaunch(url, { tab: true });

        expect(tried).toHaveLength(1);
        expect(tried[0].args.join(' ')).not.toContain('--app=');
    });

    it('carries the url into every way it might be opened', () => {
        for (const one of browserLaunch(url)) {
            expect(one.args.join(' ')).toContain(url);
        }
    });

    it('accepts --tab', async () => {
        const result = await cli('design', '--tab', '--no-open', '--port', 'abc');

        /** it got as far as the port check, so the flag itself was understood */
        expect(result.stderr).toContain('--port');
        expect(result.stderr).not.toContain('--tab');
    });
});

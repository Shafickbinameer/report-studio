/**
 * The report routes, driven through a real http server on a real temporary
 * directory. Node environment: this is the half of the project that is Node,
 * and mocking the filesystem here would test the mock rather than the guard
 * that keeps writes inside one folder.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createReportRoutes, reportPath, isValidId } from '../src/server/routes.js';

let dir;
let server;
let base;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'report-studio-'));

    const handle = createReportRoutes({ dir });

    server = createServer((req, res) => {
        handle(req, res, () => {
            res.statusCode = 404;
            res.end('fell through');
        });
    });

    await new Promise(ok => server.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
    await new Promise(ok => server.close(ok));
    await rm(dir, { recursive: true, force: true });
});


const api = (path, init) => fetch(`${base}${path}`, init);

const put = (id, layout) => api(`/__reports/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(layout)
});

const sample = (name = 'Invoice') => ({ version: 1, name, bands: [] });


describe('isValidId', () => {
    it('accepts a slug', () => {
        for (const id of ['invoice', 'sales-2026', 'a', 'A_b-9']) {
            expect(isValidId(id), id).toBe(true);
        }
    });

    it('refuses anything that could climb out of the directory', () => {
        for (const id of ['..', '../etc', 'a/b', 'a\\b', '.env', 'a.json', '']) {
            expect(isValidId(id), id).toBe(false);
        }
    });

    it('refuses an id long enough to be a payload', () => {
        expect(isValidId('a'.repeat(65))).toBe(false);
    });
});


describe('reportPath', () => {
    it('maps an id to a file inside the directory', () => {
        expect(reportPath('/reports', 'invoice'))
            .toBe(resolve('/reports/invoice.json'));
    });

    it('is null for anything that is not an id', () => {
        for (const id of ['../secret', 'a/b', '..']) {
            expect(reportPath('/reports', id), id).toBeNull();
        }
    });
});


describe('listing', () => {
    it('is empty for a directory nobody has saved into yet', async () => {
        const missing = createReportRoutes({ dir: join(dir, 'not-made-yet') });
        const local = createServer((req, res) => missing(req, res, () => res.end()));

        await new Promise(ok => local.listen(0, '127.0.0.1', ok));
        const response = await fetch(
            `http://127.0.0.1:${local.address().port}/__reports`);

        expect(await response.json()).toEqual({ reports: [] });
        await new Promise(ok => local.close(ok));
    });

    it('lists what has been saved', async () => {
        await put('invoice', sample('Invoice'));
        await put('sales', sample('Sales summary'));

        const { reports } = await api('/__reports').then(r => r.json());

        expect(reports.map(r => r.id).sort()).toEqual(['invoice', 'sales']);
    });

    it('carries the report name, not just the filename', async () => {
        await put('inv-01', sample('Invoice for June'));

        const { reports } = await api('/__reports').then(r => r.json());
        expect(reports[0].name).toBe('Invoice for June');
    });

    it('falls back to the id when the layout has no name', async () => {
        await put('unnamed', { version: 1, bands: [] });

        const { reports } = await api('/__reports').then(r => r.json());
        expect(reports[0].name).toBe('unnamed');
    });

    it('says when it changed, from the file rather than the layout', async () => {
        await put('invoice', sample());

        const { reports } = await api('/__reports').then(r => r.json());
        expect(Date.parse(reports[0].updatedAt)).not.toBeNaN();
    });

    it('still lists a report that will not parse, since that is the one to fix', async () => {
        await writeFile(join(dir, 'broken.json'), '{ not json', 'utf8');

        const { reports } = await api('/__reports').then(r => r.json());
        const broken = reports.find(r => r.id === 'broken');

        expect(broken).toBeDefined();
        expect(broken.readable).toBe(false);
    });

    it('ignores files that are not reports', async () => {
        await writeFile(join(dir, 'notes.txt'), 'hello', 'utf8');
        await mkdir(join(dir, 'nested'), { recursive: true });
        await put('invoice', sample());

        const { reports } = await api('/__reports').then(r => r.json());
        expect(reports.map(r => r.id)).toEqual(['invoice']);
    });

    it('refuses to be written to as a whole', async () => {
        const response = await api('/__reports', { method: 'PUT', body: '{}' });
        expect(response.status).toBe(405);
    });
});


describe('writing', () => {
    it('writes the layout to <id>.json', async () => {
        await put('invoice', sample());

        const written = JSON.parse(await readFile(join(dir, 'invoice.json'), 'utf8'));
        expect(written.name).toBe('Invoice');
    });

    it('formats the file so it diffs like source', async () => {
        await put('invoice', sample());
        const text = await readFile(join(dir, 'invoice.json'), 'utf8');

        expect(text).toContain('\n  "version": 1');
        expect(text.endsWith('\n')).toBe(true);
    });

    it('creates the directory when it is the one that was asked for', async () => {
        const fresh = join(dir, 'made-on-demand');
        const handle = createReportRoutes({ dir: fresh });
        const local = createServer((req, res) => handle(req, res, () => res.end()));

        await new Promise(ok => local.listen(0, '127.0.0.1', ok));
        await fetch(`http://127.0.0.1:${local.address().port}/__reports/x`, {
            method: 'PUT', body: JSON.stringify(sample())
        });

        expect(JSON.parse(await readFile(join(fresh, 'x.json'), 'utf8')).name)
            .toBe('Invoice');
        await new Promise(ok => local.close(ok));
    });

    it('overwrites an existing report', async () => {
        await put('invoice', sample('First'));
        await put('invoice', sample('Second'));

        const written = JSON.parse(await readFile(join(dir, 'invoice.json'), 'utf8'));
        expect(written.name).toBe('Second');
    });

    it('answers with what the listing will now show', async () => {
        const body = await put('invoice', sample('Invoice')).then(r => r.json());

        expect(body).toMatchObject({ id: 'invoice', name: 'Invoice' });
        expect(Date.parse(body.updatedAt)).not.toBeNaN();
    });

    it('saves a report that is not finished yet', async () => {
        /**
         * A layout half-way through being designed is legitimately invalid -
         * groupBy set before the group band is added is one keystroke of it.
         * Refusing to save somebody's work in progress is not a safety feature.
         */
        const wip = { version: 1, name: 'WIP', groupBy: 'region', bands: [] };

        expect((await put('wip', wip)).status).toBe(200);
    });

    it('refuses a body that is not JSON', async () => {
        const response = await api('/__reports/x', { method: 'PUT', body: 'nope' });
        expect(response.status).toBe(400);
    });

    it('refuses a body that is not an object', async () => {
        for (const body of ['[]', '"text"', '42', 'null']) {
            const response = await api('/__reports/x', { method: 'PUT', body });
            expect(response.status, body).toBe(400);
        }
    });
});


describe('reading', () => {
    it('reads back exactly what was written', async () => {
        const layout = sample('Round trip');
        await put('invoice', layout);

        expect(await api('/__reports/invoice').then(r => r.json())).toEqual(layout);
    });

    it('is a 404 for a report that is not there', async () => {
        const response = await api('/__reports/nothing');

        expect(response.status).toBe(404);
        expect((await response.json()).error).toContain('nothing');
    });

    it('says so plainly when the file will not parse', async () => {
        await writeFile(join(dir, 'broken.json'), '{ not json', 'utf8');
        const response = await api('/__reports/broken');

        expect(response.status).toBe(422);
        expect((await response.json()).error).toMatch(/not valid JSON/);
    });
});


describe('deleting', () => {
    it('removes the file', async () => {
        await put('invoice', sample());
        const response = await api('/__reports/invoice', { method: 'DELETE' });

        expect(response.status).toBe(200);
        expect((await api('/__reports/invoice')).status).toBe(404);
    });

    it('is a 404 for a report that is not there', async () => {
        expect((await api('/__reports/gone', { method: 'DELETE' })).status).toBe(404);
    });
});


describe('staying inside the directory', () => {
    /**
     * This is the whole security surface of the server. A traversal here writes
     * to somebody's disk outside the folder they pointed at.
     */
    const escapes = [
        '../escaped',
        '..%2Fescaped',
        '..%252Fescaped',
        '%2e%2e%2fescaped',
        '....//escaped',
        'sub/escaped',
        'sub%5Cescaped',
        '.env',
        'package.json'
    ];

    it.each(escapes)('refuses to read "%s"', async (id) => {
        const response = await api(`/__reports/${id}`);
        expect([400, 404]).toContain(response.status);
    });

    it.each(escapes)('refuses to write "%s"', async (id) => {
        const response = await api(`/__reports/${id}`, {
            method: 'PUT', body: JSON.stringify({ owned: true })
        });

        expect([400, 404, 405]).toContain(response.status);
    });

    it('leaves nothing outside the directory afterwards', async () => {
        for (const id of escapes) {
            await api(`/__reports/${id}`, {
                method: 'PUT', body: JSON.stringify({ owned: true })
            }).catch(() => { });
        }

        const outside = resolve(dir, '..', 'escaped.json');
        await expect(readFile(outside, 'utf8')).rejects.toThrow();
    });
});


describe('everything else', () => {
    it('passes a URL outside the prefix straight through', async () => {
        const response = await api('/something-else');

        expect(response.status).toBe(404);
        expect(await response.text()).toBe('fell through');
    });

    it('does not treat a lookalike prefix as its own', async () => {
        const response = await api('/__reports-other/x');
        expect(await response.text()).toBe('fell through');
    });

    it('ignores the query string when routing', async () => {
        await put('invoice', sample());
        const response = await api('/__reports/invoice?t=1');

        expect(response.status).toBe(200);
    });

    it('refuses a method it has no answer for', async () => {
        const response = await api('/__reports/invoice', { method: 'PATCH' });
        expect(response.status).toBe(405);
    });
});


describe('the data file beside a report', () => {
    const putData = (id, data) => api(`/__reports/${id}/data`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });

    it('is 404 until there is one, which is an ordinary state', async () => {
        await put('invoice', sample());
        expect((await api('/__reports/invoice/data')).status).toBe(404);
    });

    it('writes to <id>.data.json, beside the layout', async () => {
        await putData('invoice', { items: [{ name: 'Cable' }] });

        const written = JSON.parse(
            await readFile(join(dir, 'invoice.data.json'), 'utf8'));

        expect(written.items[0].name).toBe('Cable');
    });

    it('reads back what was written', async () => {
        const data = { report: { period: 'June' }, items: [{ qty: 2 }] };
        await putData('invoice', data);

        expect(await api('/__reports/invoice/data').then(r => r.json()))
            .toEqual(data);
    });

    it('does not leave the layout and the data in the same file', async () => {
        await put('invoice', sample('Invoice'));
        await putData('invoice', { items: [] });

        expect(JSON.parse(await readFile(join(dir, 'invoice.json'), 'utf8')).name)
            .toBe('Invoice');
    });

    it('is not offered in the listing as if it were a report', async () => {
        await put('invoice', sample());
        await putData('invoice', { items: [] });

        const { reports } = await api('/__reports').then(r => r.json());
        expect(reports.map(r => r.id)).toEqual(['invoice']);
    });

    it('refuses a payload that is not an object', async () => {
        const response = await api('/__reports/invoice/data', {
            method: 'PUT', body: '[1,2,3]'
        });

        expect(response.status).toBe(400);
        expect((await response.json()).error).toContain('dataset');
    });

    it('goes when the report goes', async () => {
        /**
         * Left behind, the next report saved under the same name would silently
         * inherit the last one's data.
         */
        await put('invoice', sample());
        await putData('invoice', { items: [] });

        await api('/__reports/invoice', { method: 'DELETE' });

        await expect(readFile(join(dir, 'invoice.data.json'), 'utf8'))
            .rejects.toThrow();
    });

    it('cannot be deleted on its own', async () => {
        await putData('invoice', { items: [] });
        expect((await api('/__reports/invoice/data', { method: 'DELETE' })).status)
            .toBe(405);
    });

    it('stays inside the directory like everything else', async () => {
        for (const id of ['../escaped', '..%2Fescaped', '.env']) {
            const response = await api(`/__reports/${id}/data`, {
                method: 'PUT', body: JSON.stringify({ owned: true })
            });

            expect([400, 404], id).toContain(response.status);
        }
    });

    it('is a 404 for any other sub-path', async () => {
        const response = await api('/__reports/invoice/secrets');

        expect(response.status).toBe(404);
        expect((await response.json()).error).toContain('secrets');
    });
});

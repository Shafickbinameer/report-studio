/**
 * The browser's half of report file access: four fetches and the errors they
 * turn into. fetch is injected, so this needs no server - the routes behind it
 * have their own suite against a real one.
 */

import { describe, it, expect, vi } from 'vitest';
import { createStore, StoreError, toId } from '../src/shared/store.js';
import { DEFAULT_PREFIX } from '../src/shared/prefix.js';

/** a fetch that answers with the given status and body */
const answering = (status, body) => vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
}));

const store = (doFetch) => createStore({ fetch: doFetch });


describe('the URLs it calls', () => {
    it('lists from the prefix itself', async () => {
        const doFetch = answering(200, { reports: [] });
        await store(doFetch).list();

        expect(doFetch).toHaveBeenCalledWith(DEFAULT_PREFIX, { method: 'GET' });
    });

    it('reads from the prefix and the id', async () => {
        const doFetch = answering(200, {});
        await store(doFetch).load('invoice');

        expect(doFetch.mock.calls[0][0]).toBe(`${DEFAULT_PREFIX}/invoice`);
    });

    it('escapes an id on its way into the URL', async () => {
        const doFetch = answering(200, {});
        await store(doFetch).load('a b');

        expect(doFetch.mock.calls[0][0]).toBe(`${DEFAULT_PREFIX}/a%20b`);
    });

    it('puts the layout as JSON', async () => {
        const doFetch = answering(200, {});
        await store(doFetch).save('invoice', { name: 'Invoice' });

        const [, init] = doFetch.mock.calls[0];

        expect(init.method).toBe('PUT');
        expect(JSON.parse(init.body)).toEqual({ name: 'Invoice' });
    });

    it('deletes with DELETE', async () => {
        const doFetch = answering(200, { deleted: true });
        await store(doFetch).remove('invoice');

        expect(doFetch.mock.calls[0][1].method).toBe('DELETE');
    });

    it('takes a different prefix, since the host chooses where to mount', async () => {
        const doFetch = answering(200, { reports: [] });
        await createStore({ prefix: '/api/reports', fetch: doFetch }).list();

        expect(doFetch.mock.calls[0][0]).toBe('/api/reports');
    });
});


describe('what it hands back', () => {
    it('unwraps the report list', async () => {
        const reports = [{ id: 'invoice', name: 'Invoice' }];
        expect(await store(answering(200, { reports })).list()).toEqual(reports);
    });

    it('copes with a list that is not one', async () => {
        expect(await store(answering(200, {})).list()).toEqual([]);
    });

    it('returns the layout as it came', async () => {
        const layout = { version: 1, name: 'Invoice', bands: [] };
        expect(await store(answering(200, layout)).load('invoice')).toEqual(layout);
    });
});


describe('what it does with a failure', () => {
    it('carries the words the server chose', async () => {
        const doFetch = answering(404, { error: 'there is no report called "gone"' });

        await expect(store(doFetch).load('gone'))
            .rejects.toThrow('there is no report called "gone"');
    });

    it('keeps the status, so a caller can tell 404 from 500', async () => {
        const doFetch = answering(422, { error: 'not valid JSON' });

        await expect(store(doFetch).load('broken'))
            .rejects.toMatchObject({ status: 422, name: 'StoreError' });
    });

    it('says something useful when the answer carries no message', async () => {
        const doFetch = answering(500, null);
        await expect(store(doFetch).load('x')).rejects.toThrow('500');
    });

    it('says how to start the server when there is not one', async () => {
        /**
         * The routes only exist while a dev server runs. "Failed to fetch" is
         * how someone concludes the tool is broken when the answer was that it
         * had not been started.
         */
        const doFetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));

        await expect(store(doFetch).list())
            .rejects.toThrow(/npx report-studio design/);
    });

    it('marks that failure as offline, not as a bad request', async () => {
        const doFetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));

        await expect(store(doFetch).list())
            .rejects.toMatchObject({ offline: true, status: null });
    });

    it('is a StoreError either way', async () => {
        const offline = vi.fn(() => Promise.reject(new TypeError('nope')));

        await expect(store(offline).list()).rejects.toBeInstanceOf(StoreError);
        await expect(store(answering(400, { error: 'bad' })).load('x'))
            .rejects.toBeInstanceOf(StoreError);
    });
});


describe('toId', () => {
    it('makes an id routes.js will accept', () => {
        const ok = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

        for (const name of [
            'Sales Summary', 'Invoice #2041', '  spaced  out  ',
            'Ünïcödé', 'a'.repeat(200), '2026 report'
        ]) {
            const id = toId(name);
            if (id) expect(ok.test(id), `${name} -> ${id}`).toBe(true);
        }
    });

    it('is empty rather than invalid when nothing usable is left', () => {
        for (const name of ['', '   ', '///', '###', null, undefined]) {
            expect(toId(name)).toBe('');
        }
    });

    it('never ends in a dash', () => {
        expect(toId('Sales -- ')).toBe('sales');
        expect(toId('a'.repeat(63) + ' tail')).not.toMatch(/-$/);
    });
});

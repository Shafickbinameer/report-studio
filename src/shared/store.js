/**
 * store.js is the browser's half of reading and writing report files.
 *
 * Four fetches against the four routes in src/server/routes.js. It knows
 * nothing about who answers them - the CLI's http server during
 * `npx report-studio design`, or the Vite plugin for a project already running
 * Vite. That is the whole point of the seam: the designer talks to URLs, and
 * swapping what serves them changes nothing here.
 *
 * Every failure is turned into an Error carrying what the server actually said,
 * because "failed to fetch" in a toast is how a user concludes the tool is
 * broken when the real answer was "there is no report called invoice".
 */

import { DEFAULT_PREFIX } from './prefix.js';


/**
 * @param {object} [options]
 * @param {string} [options.prefix] where the routes are mounted
 * @param {typeof fetch} [options.fetch] injectable, so the specs need no server
 * @returns {object} list, load, save, remove
 */
export function createStore({
    prefix = DEFAULT_PREFIX,
    fetch: doFetch = (...args) => globalThis.fetch(...args)
} = {}) {

    async function call(path, init) {
        let response;

        try {
            response = await doFetch(`${prefix}${path}`, init);
        } catch (cause) {
            /**
             * The routes only exist while a dev server is running. Someone who
             * opened the designer as a plain file, or built it into their own
             * page, gets this - and it should say what to do about it.
             */
            throw new StoreError(
                'Cannot reach the report server. Start it with ' +
                '`npx report-studio design`.',
                { cause, offline: true }
            );
        }

        const body = await response.json().catch(() => null);

        if (!response.ok) {
            throw new StoreError(
                body?.error ?? `the server answered ${response.status}`,
                { status: response.status }
            );
        }

        return body;
    }

    return {
        /** @returns {Promise<object[]>} `{ id, name, updatedAt, readable }` */
        async list() {
            const body = await call('', { method: 'GET' });
            return Array.isArray(body?.reports) ? body.reports : [];
        },

        /** @returns {Promise<object>} the layout */
        load(id) {
            return call(`/${encodeURIComponent(id)}`, { method: 'GET' });
        },

        /** @returns {Promise<object>} `{ id, name, updatedAt }` */
        save(id, layout) {
            return call(`/${encodeURIComponent(id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(layout)
            });
        },

        remove(id) {
            return call(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
        },

        /**
         * The report's data payload, kept beside it as `<id>.data.json`.
         *
         * @returns {Promise<object|null>} null when there is not one yet, which
         *   is an ordinary state for a report nobody has supplied data for -
         *   not a failure to report to the user
         */
        async loadData(id) {
            try {
                return await call(`/${encodeURIComponent(id)}/data`, { method: 'GET' });
            } catch (error) {
                if (error.status === 404) return null;
                throw error;
            }
        },

        saveData(id, data) {
            return call(`/${encodeURIComponent(id)}/data`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data, null, 2)
            });
        }
    };
}


/** carries the server's own words, and whether there was a server at all */
export class StoreError extends Error {
    constructor(message, { cause, status = null, offline = false } = {}) {
        super(message, { cause });

        this.name = 'StoreError';
        this.status = status;
        this.offline = offline;
    }
}


/**
 * The id a report name would be saved as.
 *
 * The filename is the id (see routes.js), and routes.js accepts letters,
 * digits, dashes and underscores - so a name has to be reduced to that before
 * it can become one. Done here rather than on the server so the designer can
 * show what the file will be called before anything is written.
 *
 * @param {string} name
 * @returns {string} a usable id, or '' when nothing usable is left
 */
export function toId(name) {
    const slug = String(name ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64)
        .replace(/-+$/, '');

    /** routes.js requires the first character to be a letter or digit */
    return /^[a-z0-9]/.test(slug) ? slug : '';
}

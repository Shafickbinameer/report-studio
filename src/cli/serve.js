/**
 * serve.js starts the designer on a local http server.
 *
 * This is the primary way into the designer, and the reason it is a CLI rather
 * than only a Vite plugin: it depends on nothing in the host project, so a
 * plain-JS site, a webpack app, or a folder with no build tooling at all can
 * run `npx report-studio design` and get the same thing.
 *
 * Node's own http server takes the same `(req, res, next)` middleware shape
 * Vite's does, so the routes are shared verbatim - only the mounting differs.
 * Everything here is dev tooling; none of it ships to a browser.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReportRoutes, DEFAULT_PREFIX } from '../server/routes.js';


const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    /* the tab icon, and anything else the pages point at in src/asset */
    '.png': 'image/png',
    '.ico': 'image/x-icon'
};

/** where the designer's own files are, relative to this module */
const HERE = fileURLToPath(new URL('.', import.meta.url));


/**
 * Starts the server.
 *
 * @param {object} options
 * @param {string} options.dir the report directory
 * @param {number} [options.port]
 * @param {string} [options.host]
 * @param {string} [options.root] the directory the designer's files are served from
 * @returns {Promise<{url: string, port: number, close: () => Promise<void>}>}
 */
export function serve({
    dir,
    port = 5177,
    host = '127.0.0.1',
    root = resolve(HERE, '..')
} = {}) {
    const reports = createReportRoutes({ dir, prefix: DEFAULT_PREFIX });
    const base = resolve(root);

    const server = createServer((req, res) => {
        reports(req, res, () => {
            serveStatic(req, res, base)
                .catch(() => plain(res, 500, 'internal error'));
        });
    });

    return new Promise((ok, fail) => {
        server.on('error', fail);

        /**
         * Bound to the loopback address by default. This serves a write
         * endpoint, so it should not be reachable from the network unless
         * somebody deliberately asks for that.
         */
        server.listen(port, host, () => {
            const actual = server.address().port;

            ok({
                port: actual,
                url: `http://${host}:${actual}/designer/`,
                close: () => new Promise(done => server.close(done))
            });
        });
    });
}


async function serveStatic(req, res, base) {
    const url = decodeSafely((req.url || '/').split('?')[0]);
    const path = filePath(url, base);

    if (!path) return plain(res, 403, 'forbidden');

    let body;

    try {
        body = await readFile(path);
    } catch {
        return plain(res, 404, 'not found');
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', TYPES[extname(path)] ?? 'application/octet-stream');
    /** dev tooling: never let a stale designer sit in the browser cache */
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
}


/**
 * The file a URL maps to, or null when it escapes the served directory.
 *
 * The same discipline as the report routes: resolve, then confirm the result is
 * still underneath. A static server that can be walked out of with `..` gives
 * away every file the process can read.
 */
function filePath(url, base) {
    const clean = url.endsWith('/') ? `${url}index.html` : url;
    const path = resolve(join(base, clean));

    if (path !== base && !path.startsWith(base + sep)) return null;

    return path;
}


function decodeSafely(text) {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}


function plain(res, status, text) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(text);
}

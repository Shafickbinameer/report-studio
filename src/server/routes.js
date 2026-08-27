/**
 * routes.js reads and writes report files, and is the only code in the project
 * that touches a disk.
 *
 * A browser cannot list a directory or write to one, and cannot be constrained
 * to a folder even where it can - showDirectoryPicker takes no such argument
 * and the user may navigate anywhere from it. A local dev server can do both,
 * because it is Node and it knows where the project is. So the split is not a
 * preference: it is the only place each half of the job can be done.
 *
 * Written as a Connect-style `(req, res, next)` handler and nothing else, so
 * the same function serves both mounts - Vite's middleware stack and the CLI's
 * bare http server take the same signature. The scoping, the guards and the
 * error shapes are therefore written once.
 *
 *   GET     <prefix>            list the reports
 *   GET     <prefix>/:id        read one
 *   PUT     <prefix>/:id        write one
 *   DELETE  <prefix>/:id        remove one
 *   GET     <prefix>/:id/data   read its data payload
 *   PUT     <prefix>/:id/data   write its data payload
 *
 * The data payload lives beside the layout as `<id>.data.json`, the pairing the
 * fixtures already use. A layout is a set of questions - which fields, which
 * dataset, what to group by - and the data file is where the host application's
 * answers go. Two files rather than one means real data can be swapped in
 * without the designer ever rewriting it.
 *
 * There is no id or timestamp in the layout file. The *filename* is the id and
 * the file's mtime is when it changed - one source of truth each, and no field
 * for the engine to ignore and a later reader to believe.
 */

import { readFile, writeFile, readdir, mkdir, stat, unlink } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { DEFAULT_PREFIX } from '../shared/prefix.js';

export { DEFAULT_PREFIX };

/**
 * An id is a slug and nothing else - no dots, no separators, no percent
 * escapes. `..` is then impossible to express rather than merely rejected,
 * which is a stronger thing to rely on than a blocklist someone has to keep up
 * with. The extension is added here, never sent by the client.
 */
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** a layout is a page of JSON, not a payload; this is already generous */
const MAX_BODY = 4 * 1024 * 1024;


export function isValidId(id) {
    return typeof id === 'string' && ID.test(id);
}


/**
 * The path a report id maps to, or null if it does not map to one.
 *
 * Two guards, both cheap, and both kept: the pattern makes traversal
 * inexpressible, and the resolve check confirms the result really did stay
 * inside the directory. The second catches anything the first has not thought
 * of - a decoding quirk, a future change to the pattern - and this is the one
 * place in the project where being wrong writes to somebody's disk.
 */
export function reportPath(dir, id, kind = 'layout') {
    if (!isValidId(id)) return null;

    const name = kind === 'data' ? `${id}.data.json` : `${id}.json`;
    const root = resolve(dir);
    const file = resolve(join(root, name));

    if (file !== join(root, name)) return null;
    if (!file.startsWith(root + sep)) return null;

    return file;
}



/**
 * Builds the request handler.
 *
 * @param {object} options
 * @param {string} options.dir the one directory reports are read from and written to
 * @param {string} [options.prefix] the URL the routes live under
 * @returns {(req, res, next) => void}
 */
export function createReportRoutes({ dir, prefix = DEFAULT_PREFIX }) {
    const root = resolve(dir);

    return function handle(req, res, next) {
        const url = (req.url || '').split('?')[0];

        if (url !== prefix && !url.startsWith(`${prefix}/`)) {
            return next?.();
        }

        const rest = url.slice(prefix.length).replace(/^\//, '');

        const [id, kind] = rest.split('/').map(decodeSafely);

        route(req, res, root, id, kind)
            .catch(error => send(res, 500, { error: String(error?.message ?? error) }));
    };
}


/**
 * A malformed escape throws out of decodeURIComponent, which would otherwise
 * surface as a 500 for what is really a bad request.
 */
function decodeSafely(text) {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}


async function route(req, res, root, id, kind) {
    const method = (req.method || 'GET').toUpperCase();

    if (!id) {
        if (method !== 'GET') return send(res, 405, { error: `cannot ${method} the list` });
        return send(res, 200, { reports: await list(root) });
    }

    /** the only sub-path there is; anything else is a URL nobody meant to write */
    if (kind !== undefined && kind !== 'data') {
        return send(res, 404, { error: `there is no "${kind}" under a report` });
    }

    const isData = kind === 'data';
    const file = reportPath(root, id, isData ? 'data' : 'layout');

    if (!file) {
        return send(res, 400, {
            error: `"${id}" is not a usable report name - letters, digits, ` +
                `dashes and underscores only`
        });
    }

    switch (method) {
        case 'GET': return read(res, file, id, isData);
        case 'PUT': return write(req, res, root, file, id, isData);

        case 'DELETE':
            if (isData) return send(res, 405, { error: 'cannot DELETE a data file' });
            return remove(res, file, id);

        default: return send(res, 405, { error: `cannot ${method} a report` });
    }
}


/**
 * Every report in the directory, newest first.
 *
 * The layout is opened to read its `name`, because a list of filenames is not
 * how anyone thinks of their reports. One that will not parse is still listed -
 * it is the one you most need to be able to open and fix.
 */
async function list(root) {
    let names;

    try {
        names = await readdir(root);
    } catch (error) {
        /** a directory nobody has saved into yet holds no reports, and is fine */
        if (error.code === 'ENOENT') return [];
        throw error;
    }

    const reports = await Promise.all(names
        .filter(file => file.endsWith('.json') && !file.endsWith('.data.json'))
        .map(async file => {
            const id = file.slice(0, -'.json'.length);
            if (!isValidId(id)) return null;

            const path = join(root, file);
            const [info, layout] = await Promise.all([
                stat(path).catch(() => null),
                readFile(path, 'utf8').then(JSON.parse).catch(() => null)
            ]);

            return {
                id,
                name: typeof layout?.name === 'string' && layout.name ? layout.name : id,
                updatedAt: info ? info.mtime.toISOString() : null,
                readable: layout != null
            };
        }));

    return reports
        .filter(Boolean)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}


async function read(res, file, id, isData = false) {
    const what = isData ? `${id}.data.json` : `${id}.json`;
    let text;

    try {
        text = await readFile(file, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') {
            return send(res, 404, {
                error: isData
                    ? `"${id}" has no data file yet`
                    : `there is no report called "${id}"`
            });
        }
        throw error;
    }

    try {
        return send(res, 200, JSON.parse(text));
    } catch {
        return send(res, 422, {
            error: `"${what}" is not valid JSON, so it cannot be opened`
        });
    }
}


/**
 * Writes the report.
 *
 * The layout is checked as JSON and as an object, and no further: a report
 * half-way through being designed is legitimately invalid - groupBy set before
 * the group band is added is one keystroke of it - and refusing to save
 * somebody's work in progress is not a safety feature. The designer shows what
 * is wrong; the disk keeps what was asked for.
 */
async function write(req, res, root, file, id, isData = false) {
    let body;

    try {
        body = await readBody(req);
    } catch (error) {
        return send(res, 413, { error: error.message });
    }

    let layout;

    try {
        layout = JSON.parse(body);
    } catch {
        return send(res, 400, { error: 'the request body is not valid JSON' });
    }

    if (layout == null || typeof layout !== 'object' || Array.isArray(layout)) {
        return send(res, 400, {
            error: isData
                ? 'a data payload must be a JSON object keyed by dataset name'
                : 'a report must be a JSON object'
        });
    }

    /** created on demand: the user asked for this directory by naming it */
    await mkdir(root, { recursive: true });

    /** two spaces and a trailing newline, so the file diffs like source */
    await writeFile(file, `${JSON.stringify(layout, null, 2)}\n`, 'utf8');

    const info = await stat(file);

    return send(res, 200, {
        id,
        kind: isData ? 'data' : 'layout',
        name: typeof layout.name === 'string' ? layout.name : id,
        updatedAt: info.mtime.toISOString()
    });
}


async function remove(res, file, id) {
    try {
        await unlink(file);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return send(res, 404, { error: `there is no report called "${id}"` });
        }
        throw error;
    }

    /**
     * The data file goes with it. Left behind, the next report saved under the
     * same name would silently inherit the last one's data.
     */
    await unlink(file.replace(/\.json$/, '.data.json')).catch(() => { });

    return send(res, 200, { id, deleted: true });
}


function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;

        req.on('data', chunk => {
            size += chunk.length;

            if (size > MAX_BODY) {
                reject(new Error(`a report may not be larger than ${MAX_BODY} bytes`));
                req.destroy();
                return;
            }

            chunks.push(chunk);
        });

        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}


function send(res, status, body) {
    const text = JSON.stringify(body);

    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    /** a report read a second ago is not the one on disk now */
    res.setHeader('Cache-Control', 'no-store');
    res.end(text);
}

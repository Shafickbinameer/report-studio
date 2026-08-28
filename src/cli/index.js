#!/usr/bin/env node
/**
 * The `report-studio` command.
 *
 *     npx report-studio design --dir ./reports
 *
 * Argument parsing is node:util's parseArgs, which has been built in since
 * 18.3 - the package has no runtime dependencies and a flag parser is not the
 * thing to break that for. Opening the browser is spawned rather than taken
 * from a package for the same reason, and it fails quietly: the URL is printed
 * either way, which is the part that matters.
 */

import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve } from './serve.js';


const USAGE = `
  report-studio - design reports in the browser

  Usage
    report-studio design [options]

  Options
    --dir <path>    where report files live          (default: ./reports)
    --port <n>      port to listen on                (default: 5177)
    --host <addr>   address to bind                  (default: 127.0.0.1)
    --tab           open in a browser tab rather than a window of its own
    --no-open       do not open a browser
    --help          show this

  The server reads and writes JSON files in --dir and nothing outside it. It is
  a design-time tool: bind it to localhost, and do not run it in production.
`;


export async function main(argv = process.argv.slice(2)) {
    let parsed;

    try {
        parsed = parseArgs({
            args: argv,
            allowPositionals: true,
            options: {
                dir: { type: 'string', default: 'reports' },
                port: { type: 'string', default: '5177' },
                host: { type: 'string', default: '127.0.0.1' },
                open: { type: 'boolean', default: true },
                /**
                 * Declared rather than relying on parseArgs negating `open`:
                 * `allowNegative` only arrived in Node 22.4, and this package
                 * says it runs on 18.3. Without it, `--no-open` is an unknown
                 * option and the command refuses to start at all.
                 */
                'no-open': { type: 'boolean', default: false },
                tab: { type: 'boolean', default: false },
                help: { type: 'boolean', default: false }
            }
        });
    } catch (error) {
        process.stderr.write(`${error.message}\n${USAGE}`);
        return 1;
    }

    const { values, positionals } = parsed;
    const command = positionals[0] ?? 'design';

    if (values.help || command === 'help') {
        process.stdout.write(USAGE);
        return 0;
    }

    if (command !== 'design') {
        process.stderr.write(`unknown command "${command}"\n${USAGE}`);
        return 1;
    }

    const port = Number(values.port);

    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        process.stderr.write(`--port must be a port number, not "${values.port}"\n`);
        return 1;
    }

    let started;

    try {
        started = await serve({ dir: values.dir, port, host: values.host });
    } catch (error) {
        const hint = error.code === 'EADDRINUSE'
            ? `port ${port} is already in use - try --port ${port + 1}`
            : error.message;

        process.stderr.write(`could not start: ${hint}\n`);
        return 1;
    }

    process.stdout.write(
        `\n  report-studio\n` +
        `  designer   ${started.url}\n` +
        `  reports    ${values.dir}\n\n` +
        `  Ctrl+C to stop.\n\n`
    );

    if (values.open && !values['no-open']) {
        openBrowser(started.url, { tab: values.tab });
    }

    return new Promise(resolve => {
        const stop = () => started.close().then(() => resolve(0));

        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
    });
}


/** what an A4 page and the designer's chrome need, on a laptop screen */
const WINDOW_SIZE = '1400,900';


/**
 * Where a Chromium-based browser is likely to be, per platform.
 *
 * Looked for by path rather than asked of the shell: `start chrome` succeeds
 * whether or not Chrome is there - it hands off to the shell and returns - so
 * there would be no way to tell that the app window never opened and fall back.
 *
 * @returns {Array<{command: string, args: string[]}>} candidates, best first
 */
function appWindowCandidates(url) {
    const flags = [`--app=${url}`, `--window-size=${WINDOW_SIZE}`];

    if (process.platform === 'darwin') {
        return [
            { command: 'open', args: ['-na', 'Google Chrome', '--args', ...flags] },
            { command: 'open', args: ['-na', 'Microsoft Edge', '--args', ...flags] }
        ];
    }

    if (process.platform === 'win32') {
        const roots = [
            process.env['PROGRAMFILES'],
            process.env['PROGRAMFILES(X86)'],
            process.env['LOCALAPPDATA']
        ].filter(Boolean);

        const exes = [
            ['Google', 'Chrome', 'Application', 'chrome.exe'],
            ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
            ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe']
        ];

        return roots
            .flatMap(root => exes.map(parts => join(root, ...parts)))
            .filter(existsSync)
            .map(command => ({ command, args: flags }));
    }

    return ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']
        .map(command => ({ command, args: flags }));
}


/**
 * Opens the designer.
 *
 * In a window of its own where a Chromium-based browser can be found: the
 * designer is a full screen with its own bar and rail, and a tab strip and an
 * address bar above it are chrome about a page that has none of its own. Any
 * browser at all is better than none, though, so a tab is the fallback rather
 * than a failure - and the URL has been printed either way.
 *
 * Best effort throughout, and silent: a browser that will not open is not a
 * reason to fail the command.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {boolean} [options.tab] ask for a tab rather than a window
 */
function openBrowser(url, { tab = false } = {}) {
    launch(browserLaunch(url, { tab }));
}


/**
 * Every way of opening the designer that is worth trying, best first.
 *
 * Separated from the spawning so that what is tried, and in what order, can be
 * specified without launching a browser at every assertion.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {boolean} [options.tab] skip the app windows and go straight to a tab
 * @returns {Array<{command: string, args: string[]}>} always at least the fallback
 */
export function browserLaunch(url, { tab = false } = {}) {
    /** the plain "open this with whatever is registered" of each platform */
    const fallback = process.platform === 'win32'
        ? { command: 'cmd', args: ['/c', 'start', '', url] }
        : process.platform === 'darwin'
            ? { command: 'open', args: [url] }
            : { command: 'xdg-open', args: [url] };

    return tab ? [fallback] : [...appWindowCandidates(url), fallback];
}


/**
 * Tries each way of opening a browser until one does not fail immediately.
 *
 * A missing binary shows up as an `error` event rather than a throw, so the
 * next candidate is tried from there. Nothing waits on the browser itself:
 * it is detached and unref'd so the command's own exit does not depend on it.
 *
 * @param {Array<{command: string, args: string[]}>} candidates
 */
function launch([next, ...rest]) {
    if (!next) return;

    let child;

    try {
        child = spawn(next.command, next.args, { stdio: 'ignore', detached: true });
    } catch {
        launch(rest);
        return;
    }

    child.once('error', () => launch(rest));
    child.unref();
}


/**
 * Only when run as a command, so the module stays importable by the specs.
 *
 * pathToFileURL rather than building the URL by hand: a Windows path becomes
 * `file:///D:/...` - three slashes and a drive letter - so a hand-rolled
 * `file://${path}` never matches and the command silently does nothing at all.
 */
const invoked = process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invoked) {
    /**
     * `process.exitCode`, not `process.exit()`. Writes to a piped stdout are
     * asynchronous, and exiting outright drops whatever has not flushed. The
     * `design` command keeps the loop alive through its server until stopped.
     */
    main().then(code => { process.exitCode = code; });
}

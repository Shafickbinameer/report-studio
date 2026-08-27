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

    if (values.open && !values['no-open']) openBrowser(started.url);

    return new Promise(resolve => {
        const stop = () => started.close().then(() => resolve(0));

        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
    });
}


/**
 * Best effort, and silent when it fails - a browser that will not open is not a
 * reason to fail the command, because the URL has already been printed.
 */
function openBrowser(url) {
    const [command, args] = process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin'
            ? ['open', [url]]
            : ['xdg-open', [url]];

    try {
        spawn(command, args, { stdio: 'ignore', detached: true }).unref();
    } catch {
        /* the URL is on stdout; that is enough */
    }
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

/**
 * window.js opens a screen in a window of its own.
 *
 * A designer or a viewer normally takes over an element on the host's page.
 * Sometimes the host would rather it were somewhere else entirely - a second
 * monitor, beside the application rather than inside it - and a report is a
 * page-shaped thing that a browser tab suits better than a panel.
 *
 * Opened blank and built here rather than navigated to a URL: the package is
 * usable with no server at all, and a report being designed has not been saved
 * anywhere a URL could reach. What the new window needs is the host's own
 * stylesheets, which are copied across - so the screen looks the same in its
 * own window as it did in the page, without the host linking anything twice.
 */


/** big enough for an A4 page and the chrome round it, on a laptop screen */
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 900;


/**
 * Copies the opener's stylesheets into a new document.
 *
 * Both kinds, because a host may do either: a `<link>` to a file, or a `<style>`
 * a bundler inlined. Links are copied by href rather than cloned wholesale, so
 * the new document fetches them itself and the browser's cache does the work.
 *
 * A cross-origin sheet cannot be read, only linked - which is exactly what
 * happens here, so nothing is lost to it.
 *
 * @param {Document} from
 * @param {Document} to
 */
function copyStyles(from, to) {
    for (const node of from.querySelectorAll('link[rel="stylesheet"], style')) {
        if (node.tagName === 'LINK') {
            const link = to.createElement('link');

            link.rel = 'stylesheet';
            link.href = node.href;
            to.head.appendChild(link);
            continue;
        }

        const style = to.createElement('style');

        style.textContent = node.textContent;
        to.head.appendChild(style);
    }
}


/**
 * Opens a blank window and prepares it to be mounted into.
 *
 * Must be called from something the user did - a click, a key - or the browser
 * treats it as a popup and blocks it. A blocked window is null rather than an
 * exception, because a host that cannot open one usually wants to fall back to
 * mounting in the page rather than to fail.
 *
 * @param {object} [options]
 * @param {string} [options.title] the window's title, and its taskbar name
 * @param {number} [options.width]
 * @param {number} [options.height]
 * @param {string} [options.features] passed to window.open as given, for a host
 *   that wants something other than a plain resizable window
 * @param {Window} [options.opener] whose stylesheets to copy; this one by default
 * @returns {{window: Window, document: Document, mount: Element, close: Function}|null}
 *   null when the browser refused to open it
 */
export function openWindow({
    title = 'Report Studio',
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    features,
    opener = globalThis
} = {}) {
    const spec = features
        ?? `width=${width},height=${height},resizable=yes,scrollbars=yes`;

    const win = opener.open?.('', '_blank', spec);

    /** blocked, or opened into something that is not a window we can build in */
    if (!win || !win.document) return null;

    const doc = win.document;

    doc.open();
    doc.write('<!doctype html><html><head><meta charset="utf-8">' +
        '</head><body></body></html>');
    doc.close();

    doc.title = title;
    copyStyles(opener.document, doc);

    /**
     * The screens take over an element and build the rest inside it, so what
     * they are given is one empty div - the same contract as mounting in a page.
     */
    const mount = doc.createElement('div');

    mount.id = 'report-studio';
    mount.style.height = '100vh';
    doc.body.style.margin = '0';
    doc.body.appendChild(mount);

    return {
        window: win,
        document: doc,
        mount,
        close: () => win.close()
    };
}


/**
 * Closes the window when the page that opened it goes.
 *
 * A window left behind by a navigated-away opener is one nobody can reach the
 * report data for: what it is showing was passed in memory, and the page that
 * held it has gone. Better to take it with us than to leave a dead screen open.
 *
 * @param {Window} opener
 * @param {Window} win
 * @param {Function} [detach] the screen's own teardown
 * @returns {Function} stops watching, without closing anything
 */
export function closeWithOpener(opener, win, detach = () => { }) {
    const onUnload = () => {
        detach();
        win.close();
    };

    opener.addEventListener('pagehide', onUnload);

    return () => opener.removeEventListener('pagehide', onUnload);
}

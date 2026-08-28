/**
 * @vitest-environment jsdom
 *
 * Opening a screen in a window of its own.
 *
 * jsdom has no real pop-ups, so window.open is stood in for - which is enough,
 * because what this module does is build a document and copy stylesheets into
 * it, and both are ordinary DOM. What it cannot check is whether a browser
 * would have blocked the window; that path is specified by handing it a null.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openWindow, closeWithOpener } from '../src/shared/window.js';
import { openViewerWindow } from '../src/preview/viewer.js';
import { openDesignerWindow } from '../src/designer/designer.js';
import { layout, table, band, rows, run } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    document.body.innerHTML = '';
});
afterEach(() => vi.restoreAllMocks());


/** a window object with a real document behind it, and a record of what it was asked */
function stubWindow() {
    const doc = document.implementation.createHTMLDocument('');
    const listeners = {};

    return {
        document: doc,
        closed: false,
        close() { this.closed = true; },
        addEventListener(type, fn) { listeners[type] = fn; },
        removeEventListener(type) { delete listeners[type]; },
        listeners
    };
}

/** an opener whose stylesheets and window.open are ours to control */
function stubOpener(win = stubWindow()) {
    const doc = document.implementation.createHTMLDocument('');
    const calls = [];

    return {
        win,
        calls,
        doc,
        opener: {
            document: doc,
            open(url, target, features) {
                calls.push({ url, target, features });
                return win;
            }
        }
    };
}


describe('openWindow', () => {
    it('opens a blank window, not a URL', () => {
        const { opener, calls } = stubOpener();
        openWindow({ opener });

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('');
        expect(calls[0].target).toBe('_blank');
    });

    it('asks for a window that can be resized and scrolled', () => {
        const { opener, calls } = stubOpener();
        openWindow({ opener, width: 1000, height: 700 });

        expect(calls[0].features)
            .toBe('width=1000,height=700,resizable=yes,scrollbars=yes');
    });

    it('takes the features verbatim when the host has its own idea', () => {
        const { opener, calls } = stubOpener();
        openWindow({ opener, features: 'popup=yes,width=400' });

        expect(calls[0].features).toBe('popup=yes,width=400');
    });

    it('hands back one empty element to mount into', () => {
        const { opener } = stubOpener();
        const opened = openWindow({ opener });

        expect(opened.mount.tagName).toBe('DIV');
        expect(opened.mount.children).toHaveLength(0);
        expect(opened.mount.ownerDocument).toBe(opened.document);
        expect(opened.document.body.contains(opened.mount)).toBe(true);
    });

    it('names the window, so it can be found in a taskbar', () => {
        const { opener } = stubOpener();

        expect(openWindow({ opener, title: 'Invoice' }).document.title)
            .toBe('Invoice');
    });

    /**
     * The screen would otherwise be unstyled: the host linked the stylesheets
     * into its own page, and a new window starts with none.
     */
    it('copies the opener\'s inline styles across', () => {
        const { opener, doc } = stubOpener();
        const style = doc.createElement('style');

        style.textContent = '.dz-bar { color: red }';
        doc.head.appendChild(style);

        const opened = openWindow({ opener });
        const copied = [...opened.document.querySelectorAll('style')]
            .map(n => n.textContent);

        expect(copied).toContain('.dz-bar { color: red }');
    });

    it('relinks the opener\'s stylesheet files rather than inlining them', () => {
        const { opener, doc } = stubOpener();
        const link = doc.createElement('link');

        link.rel = 'stylesheet';
        link.href = 'https://example.test/report.css';
        doc.head.appendChild(link);

        const opened = openWindow({ opener });
        const links = [...opened.document.querySelectorAll('link[rel="stylesheet"]')];

        expect(links).toHaveLength(1);
        expect(links[0].href).toBe('https://example.test/report.css');
    });

    it('ignores anything that is not a stylesheet', () => {
        const { opener, doc } = stubOpener();
        const icon = doc.createElement('link');

        icon.rel = 'icon';
        icon.href = 'https://example.test/favicon.ico';
        doc.head.appendChild(icon);

        expect(openWindow({ opener }).document.querySelectorAll('link')).toHaveLength(0);
    });

    /** a host that cannot open a window usually wants to fall back, not to fail */
    it('answers null when the browser blocks it', () => {
        expect(openWindow({ opener: { document, open: () => null } })).toBeNull();
    });

    it('answers null when what came back is not a window it can build in', () => {
        expect(openWindow({ opener: { document, open: () => ({}) } })).toBeNull();
    });

    it('closes the window it opened', () => {
        const { opener, win } = stubOpener();
        openWindow({ opener }).close();

        expect(win.closed).toBe(true);
    });
});


describe('closeWithOpener', () => {
    it('takes the window with the page that opened it', () => {
        const win = stubWindow();
        const opener = stubWindow();
        const detach = vi.fn();

        closeWithOpener(opener, win, detach);
        opener.listeners.pagehide();

        expect(detach).toHaveBeenCalled();
        expect(win.closed).toBe(true);
    });

    it('can be called off without closing anything', () => {
        const win = stubWindow();
        const opener = stubWindow();

        closeWithOpener(opener, win)();

        expect(opener.listeners.pagehide).toBeUndefined();
        expect(win.closed).toBe(false);
    });
});


describe('openViewerWindow', () => {
    const paginated = () => run(
        layout({ bands: [band('detail', [table()])] }), { items: rows(3) });

    function withOpen(win, fn) {
        const original = window.open;
        window.open = () => win;
        try { return fn(); } finally { window.open = original; }
    }

    it('mounts the viewer in a window of its own', () => {
        const win = stubWindow();
        const viewer = withOpen(win, () => openViewerWindow({ paginated: paginated() }));

        expect(viewer.window).toBe(win);
        expect(win.document.querySelector('.page')).not.toBeNull();
    });

    it('gives the window the report\'s name', () => {
        const win = stubWindow();
        withOpen(win, () => openViewerWindow({ paginated: paginated(), title: 'Invoice' }));

        expect(win.document.title).toBe('Invoice');
    });

    it('answers null when the window is blocked', () => {
        expect(withOpen(null, () => openViewerWindow({ paginated: paginated() })))
            .toBeNull();
    });

    it('closes the window when the viewer is destroyed', () => {
        const win = stubWindow();
        const viewer = withOpen(win, () => openViewerWindow({ paginated: paginated() }));

        viewer.destroy();

        expect(win.closed).toBe(true);
    });

    /**
     * The listeners have to be on the window's own document: one left on the
     * opener's would never hear a key pressed in the window it belongs to.
     */
    it('puts its print stylesheet in its own document, not the opener\'s', () => {
        const win = stubWindow();
        const viewer = withOpen(win, () => openViewerWindow({ paginated: paginated() }));

        viewer.print?.();

        expect(win.document.getElementById('report-page-size')).not.toBeNull();
        expect(document.getElementById('report-page-size')).toBeNull();
    });
});


describe('openDesignerWindow', () => {
    function withOpen(win, fn) {
        const original = window.open;
        window.open = () => win;
        try { return fn(); } finally { window.open = original; }
    }

    it('mounts the designer in a window of its own', () => {
        const win = stubWindow();
        const designer = withOpen(win, () => openDesignerWindow({
            layout: layout({ bands: [band('detail', [table()])] })
        }));

        expect(designer.window).toBe(win);
        expect(win.document.querySelector('.dz-bar')).not.toBeNull();
        expect(win.document.querySelector('.dz-canvas')).not.toBeNull();

        designer.destroy();
    });

    it('names the window after the report being edited', () => {
        const win = stubWindow();
        const l = layout({ bands: [band('detail', [table()])] });

        l.name = 'Sales Summary';

        const designer = withOpen(win, () => openDesignerWindow({ layout: l }));

        expect(win.document.title).toBe('Sales Summary - Designer');

        designer.destroy();
    });

    it('answers null when the window is blocked', () => {
        expect(withOpen(null, () => openDesignerWindow({}))).toBeNull();
    });

    it('closes the window when the designer is destroyed', () => {
        const win = stubWindow();
        const designer = withOpen(win, () => openDesignerWindow({}));

        designer.destroy();

        expect(win.closed).toBe(true);
    });

    /**
     * The whole point of scoping the document: a designer in its own window
     * listens to that window, so Delete and the arrow keys work in it.
     */
    it('listens to its own window, so its keys work there', () => {
        const win = stubWindow();
        const l = layout({ bands: [band('detail', [table({ id: 'tbl' })])] });
        const designer = withOpen(win, () => openDesignerWindow({ layout: l }));

        const drawn = win.document.querySelector('[data-item-id="tbl"]');
        const down = new window.MouseEvent('pointerdown', {
            bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0
        });
        down.pointerId = 1;
        drawn.dispatchEvent(down);

        win.document.dispatchEvent(new window.KeyboardEvent('keydown', {
            key: 'Delete', bubbles: true, cancelable: true
        }));

        expect(designer.layout.bands[0].items).toHaveLength(0);

        designer.destroy();
    });
});

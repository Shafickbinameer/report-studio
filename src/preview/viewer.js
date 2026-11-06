/**
 * viewer.js turns a page list into a page-at-a-time viewer: navigation, zoom,
 * search, print, CSV and Excel.
 *
 * It takes one empty element and builds everything inside it - the chrome is
 * chrome.js and the report is render.js - so an application mounts it the same
 * way it mounts the designer, with a div and nothing else.
 *
 * All it knows about the report is the page list, which it hands to the
 * engine's search. That is the seam in spec 2.2: a viewer for another framework
 * reuses the same search, the same CSV and the same rendering, and replaces
 * only the event handlers in this file.
 */

import { search, searchPages } from '../engine/search.js';
import { toReportCSV, reportFilename } from '../engine/csv.js';
import { reportTables } from '../engine/rows.js';
import { toXLSX, toXLSXAsync, reportImageSources, XLSX_MIME } from '../engine/xlsx.js';
import { openWindow, closeWithOpener } from '../shared/window.js';
import { createDropdown } from '../shared/dropdown.js';
import { render } from '../render/render.js';
import { chrome } from './chrome.js';


/**
 * The zoom levels the -/+ buttons step through, matching the menu beside them.
 *
 * Exported because the designer steps through the same ones. A report zoomed to
 * 125% while it is being arranged and to 130% while it is being read would be
 * two tools rather than two views of one.
 */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];


/**
 * Mounts the viewer.
 *
 * @param {object} options
 * @param {Element|string} options.mount the element to take over, or a selector
 * @param {object} options.paginated the buildPages result
 * @param {string} [options.title] what the brand corner reads
 * @returns {object} a handle: paging, zoom, search, print, export and destroy
 */
/**
 * Opens a report in a window of its own.
 *
 * The same viewer, mounted in a window this opens rather than in an element the
 * host supplies - for an application that would rather the report were beside
 * it than inside it. The host's stylesheets are carried across, so it looks the
 * same either way.
 *
 * Call it from a click or a keystroke: a browser blocks a window opened from
 * anything else, and a blocked one comes back as null rather than as a throw,
 * so the caller can fall back to mounting in the page.
 *
 * @param {object} options what createViewer takes, less `mount`
 * @param {object} options.paginated the buildPages result
 * @param {string} [options.title] the window's title and the brand corner
 * @param {number} [options.width]
 * @param {number} [options.height]
 * @param {string} [options.features] passed to window.open as given
 * @returns {object|null} the viewer handle, with `window`; null if blocked
 */
export function openViewerWindow({
    paginated, title, width, height, features, ...rest
} = {}) {
    const opened = openWindow({
        title: title ?? 'Report', width, height, features
    });

    if (!opened) return null;

    const viewer = createViewer({
        ...rest, mount: opened.mount, paginated, title
    });

    /** the report was passed in memory, so the window outliving its opener shows nothing */
    const unwatch = closeWithOpener(globalThis, opened.window, viewer.destroy);

    return {
        ...viewer,
        window: opened.window,

        destroy() {
            unwatch();
            viewer.destroy();
            opened.close();
        }
    };
}


export function createViewer({ mount, paginated, title } = {}) {
    const root = typeof mount === 'string' ? document.querySelector(mount) : mount;

    if (!root) {
        throw new Error(
            `createViewer: no element for mount ${JSON.stringify(mount)}. ` +
            `Add <div id="report"></div> to the page first.`
        );
    }

    /**
     * The document the viewer is mounted in, which is not always this one: a
     * report opened in its own window lives in that window's document, and a
     * listener - or a print stylesheet - left on the opener's would never reach
     * the report it belongs to.
     */
    const doc = root.ownerDocument;

    /**
     * And the window it belongs to, which is the same point one step out.
     *
     * `window` in this module is whichever page loaded the script - the host's
     * tab. A report opened in a window of its own is mounted from that tab, so
     * every bare `window` here reached back into it: print() printed the
     * application behind the report instead of the report, the print dialog
     * appeared over the wrong window, and afterprint fired somewhere the
     * highlights were not.
     *
     * A viewer mounted in the page resolves this to the same `window` it always
     * was, so nothing changes there.
     */
    const view = doc.defaultView ?? globalThis;

    if (!paginated?.pages) {
        throw new Error(
            'createViewer: paginated must be a buildPages(layout, data) result.'
        );
    }

    root.classList.add('report-viewer');
    root.innerHTML = chrome({ title });

    const viewport = root.querySelector('[data-role="viewport"]');
    viewport.innerHTML = render(paginated);

    const pages = [...viewport.querySelectorAll('.page')];
    const total = pages.length;

    const stack = viewport.querySelector('#main-page');

    /** the report itself is what scrolls and what the highlighting sits in */
    const mountEl = viewport;

    /**
     * One search root now that the viewer owns all of its chrome. A control is
     * still found by its role rather than by which container holds it, so
     * moving one between the toolbar and the pager stays a change to chrome.js
     * alone.
     */
    const find = (role) => root.querySelector(`[data-role="${role}"]`);

    const ui = {
        prev: find('prev'),
        next: find('next'),
        current: find('current'),
        total: find('total'),
        /** a listbox with the two bits of the <select> API this file used */
        zoom: createDropdown(find('zoom-dropdown')),
        zoomIn: find('zoom-in'),
        zoomOut: find('zoom-out'),
        print: find('print'),
        exportOpen: find('export'),
        query: find('query'),
        hits: find('hits'),
        hitPrev: find('hit-prev'),
        hitNext: find('hit-next')
    };

    /** the export menu: the list under the Export button, and its formats */
    const menu = find('export-menu');
    const menuItems = menu ? [...menu.querySelectorAll('[data-format]')] : [];

    let index = 0;          // zero-based page index
    let matches = [];       // engine search results
    let hitIndex = -1;      // which match is focused
    let zoom = 1;           // the scale actually applied
    let fitWidth = false;   // recompute zoom from the viewport on resize

    const afterPrintSupported = typeof view.onafterprint !== 'undefined';

    ui.total.textContent = String(total);
    ui.current.max = String(total);

    /* ---------------- paging ---------------- */

    function show(next) {
        index = Math.min(Math.max(next, 0), total - 1);

        pages.forEach((page, i) => page.classList.toggle('is-current', i === index));

        ui.current.value = String(index + 1);
        ui.prev.disabled = index === 0;
        ui.next.disabled = index === total - 1;

        paint();
        /** absent in jsdom, so a consumer testing there is not stopped by it */
        mountEl.scrollTo?.({ top: 0 });
    }

    /* ---------------- zoom ---------------- */

    /**
     * A CSS transform is what keeps the report faithful - scaling font sizes
     * instead would re-wrap text and stop matching the paginated layout, which
     * is the whole point of a print preview.
     *
     * transform does not affect layout, so the stack is given the scaled
     * footprint explicitly, otherwise there is nothing to scroll at 200%.
     * Its size comes from the layout file rather than the DOM, so it is right
     * before first paint and does not depend on a live layout engine.
     */
    function applyZoom() {
        mountEl.style.setProperty('--zoom', String(zoom));

        if (stack) {
            stack.style.width = `${paginated.page.width * zoom}px`;
            stack.style.height = `${paginated.page.height * zoom}px`;
        }

        if (!fitWidth) {
            const exact = ZOOM_STEPS.find(step => Math.abs(step - zoom) < 1e-9);
            ui.zoom.value = exact !== undefined ? String(exact) : 'fit';
        }

        ui.zoomOut.disabled = !fitWidth && zoom <= MIN_ZOOM;
        ui.zoomIn.disabled = !fitWidth && zoom >= MAX_ZOOM;
    }

    function setZoom(next) {
        fitWidth = false;
        zoom = Math.min(Math.max(next, MIN_ZOOM), MAX_ZOOM);
        applyZoom();
    }

    /** the widest scale that still fits the viewport, ignoring the scrollbar */
    function setFitWidth() {
        fitWidth = true;
        ui.zoom.value = 'fit';

        const available = mountEl.clientWidth - 48;
        if (available > 0) {
            zoom = Math.min(Math.max(available / paginated.page.width, MIN_ZOOM), MAX_ZOOM);
        }

        applyZoom();
    }

    /** steps to the neighbouring preset rather than a blind multiply */
    function stepZoom(direction) {
        const from = zoom;
        const next = direction > 0
            ? ZOOM_STEPS.find(step => step > from + 1e-9)
            : [...ZOOM_STEPS].reverse().find(step => step < from - 1e-9);

        setZoom(next ?? from);
    }

    /* ---------------- exporting ---------------- */

    /**
     * One entry per offered format. Adding another means a line here and an
     * entry in chrome.js's export list; nothing else in the flow needs to know.
     */
    const FORMATS = {
        pdf: {
            available: () => true,
            summary: () => `${total} page${total === 1 ? '' : 's'}, ` +
                `${paginated.page.width}×${paginated.page.height}px each.`,
            run: () => printReport()
        },
        csv: {
            available: () => toReportCSV(paginated.pages) !== '',
            summary: () => FORMATS.csv.available()
                ? `Downloads ${reportFilename(paginated, 'csv')}.`
                : 'This report has nothing to write out.',
            run: () => downloadCSV()
        },
        xlsx: {
            /** a report with any text line or any table has a sheet to give */
            available: () => FORMATS.csv.available() || reportTables(paginated.pages).length > 0,
            summary: () => FORMATS.xlsx.available()
                ? `Downloads ${reportFilename(paginated, 'xlsx')}.`
                : 'This report has nothing to write out.',
            run: () => downloadXLSX()
        }
    };

    /**
     * Spec 6: PDF is window.print(). It costs nothing, and it matches the
     * preview exactly because it *is* the preview - the print stylesheet just
     * reveals every page and drops the chrome.
     *
     * Search highlights are cleared first so they do not end up in the file.
     */
    function printReport() {
        /**
         * A picture still loading prints as a blank frame, and the print dialog
         * snapshots the page the moment it opens. So a report with pictures on
         * the way waits for them - loaded or failed, either way settled - and a
         * report with none, which is most, prints at once as it always has.
         */
        const pending = [...viewport.querySelectorAll('img')].filter(img => !img.complete);

        if (pending.length > 0) {
            Promise.all(pending.map(img => img.decode().catch(() => { })))
                .then(printNow);
            return;
        }

        printNow();
    }

    function printNow() {
        clearMarks();

        /** the window the report is in, which is not always the one this ran from */
        view.print();

        /**
         * Firefox and Safari return from print() before the dialog has taken
         * its snapshot, so restoring the highlights on the next line would put
         * them back too early and print them. afterprint is the reliable point;
         * the immediate call below covers browsers that never fire it.
         */
        if (!afterPrintSupported) restoreAfterPrint();
    }

    function restoreAfterPrint() {
        if (ui.query.value.trim() !== '') paint();
    }


    /**
     * The report already carries its own margins, so the sheet must add none -
     * without this the browser's default print margin is added on top, the
     * page no longer fits the paper, and every page spills a sliver onto a
     * second sheet. The size comes from the layout, so a Letter or custom page
     * prints as designed rather than as whatever A4 assumption was baked in.
     */
    function applyPrintPageSize() {
        const { width, height } = paginated.page;

        /**
         * Into the viewer's own document: a report opened in its own window
         * prints from that window, and an @page rule left in the opener would
         * size the wrong sheet - or none.
         */
        let style = doc.getElementById('report-page-size');
        if (!style) {
            style = doc.createElement('style');
            style.id = 'report-page-size';
            doc.head.appendChild(style);
        }

        style.textContent = `@page { size: ${width}px ${height}px; margin: 0; }`;
    }

    /**
     * The report as text: every line and every table row, in the order the
     * pages draw them. Boxes and rules are the only things left behind, having
     * nothing to write.
     */
    function downloadCSV() {
        const csv = toReportCSV(paginated.pages);
        if (csv === '') return false;

        /** the BOM is what makes Excel read the file as UTF-8 rather than latin-1 */
        download(
            new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }),
            reportFilename(paginated, 'csv')
        );

        return true;
    }

    /**
     * The report as an Excel workbook: a sheet that reads like the report, and
     * a sheet per table with typed, sortable cells.
     *
     * A report whose pictures come from URLs has to fetch them before they can
     * be embedded, so its download starts a moment later; true still means a
     * file is on its way. Should building with the fetched pictures fail, the
     * workbook goes without them rather than not at all.
     */
    function downloadXLSX() {
        if (!FORMATS.xlsx.available()) return false;

        const save = (bytes) => {
            if (bytes.length > 0) {
                download(new Blob([bytes], { type: XLSX_MIME }), reportFilename(paginated, 'xlsx'));
            }
        };

        if (reportImageSources(paginated.pages).length > 0) {
            toXLSXAsync(paginated.pages).then(save, () => save(toXLSX(paginated.pages)));
            return true;
        }

        const bytes = toXLSX(paginated.pages);
        if (bytes.length === 0) return false;

        save(bytes);
        return true;
    }

    function download(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = doc.createElement('a');

        link.href = url;
        link.download = filename;
        doc.body.appendChild(link);
        link.click();
        link.remove();

        /** give the browser a tick to start the download before dropping the url */
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    /* ---------------- the export menu ---------------- */

    /**
     * Each item's note, and whether it can be chosen at all - worked out as
     * the menu opens, since a report with nothing tabular has no CSV to give.
     * An item that cannot be chosen says why, in the note it would otherwise
     * use for the file it makes.
     */
    function refreshMenu() {
        for (const item of menuItems) {
            const format = FORMATS[item.dataset.format];
            const available = Boolean(format?.available());

            item.disabled = !available;
            item.setAttribute('aria-disabled', String(!available));
            item.classList.toggle('is-unavailable', !available);

            const note = item.querySelector('.format-note');
            if (note) note.textContent = format ? format.summary() : '';
        }
    }

    const enabledItems = () => menuItems.filter(item => !item.disabled);

    function openExport() {
        if (!menu || !menu.hidden) return;

        refreshMenu();
        menu.hidden = false;
        ui.exportOpen.setAttribute('aria-expanded', 'true');

        enabledItems()[0]?.focus();

        /**
         * On the next tick, or the press that opened the menu would reach this
         * listener on its way up and close it again.
         */
        view.setTimeout(() => {
            if (!menu.hidden) doc.addEventListener('pointerdown', onOutside, true);
        }, 0);
    }

    /**
     * @param {object} [options]
     * @param {boolean} [options.refocus] put the focus back on the Export
     *   button - not when the menu closed because something else was clicked
     */
    function closeExport({ refocus = true } = {}) {
        if (!menu || menu.hidden) return;

        menu.hidden = true;
        ui.exportOpen.setAttribute('aria-expanded', 'false');
        doc.removeEventListener('pointerdown', onOutside, true);

        if (refocus && menu.contains(doc.activeElement)) ui.exportOpen.focus();
        else if (refocus && doc.activeElement === doc.body) ui.exportOpen.focus();
    }

    /**
     * Exports in a format: the one asked for, or the item the keys are on, or
     * PDF - the first in the list and the one every report can give.
     *
     * @param {'pdf'|'csv'|'xlsx'} [asked]
     */
    function confirmExport(asked) {
        const focused = menuItems.find(item => item === doc.activeElement);
        const value = typeof asked === 'string' ? asked : focused?.dataset.format ?? 'pdf';

        const format = FORMATS[value];
        if (!format?.available()) return;

        /**
         * Close first. The print dialog is modal and blocking, so leaving the
         * menu open would put it in the printed page and in the way.
         */
        closeExport();
        format.run();
    }

    function onOutside(event) {
        if (menu.contains(event.target) || ui.exportOpen.contains(event.target)) return;
        closeExport({ refocus: false });
    }

    /**
     * The menu's keys: up and down through what can be chosen, Home and End,
     * Escape back to the button, Tab on past it. Enter and Space are the
     * items' own, being buttons. Every key it handles stops here, so the
     * report does not page behind an open menu.
     */
    function onMenuKey(event) {
        const items = enabledItems();
        const at = items.indexOf(doc.activeElement);

        const handled = {
            ArrowDown: () => items[(at + 1) % items.length]?.focus(),
            ArrowUp: () => items[(at - 1 + items.length) % items.length]?.focus(),
            Home: () => items[0]?.focus(),
            End: () => items.at(-1)?.focus(),
            Escape: () => closeExport(),
            Tab: () => closeExport({ refocus: false })
        }[event.key];

        if (!handled) return;

        if (event.key !== 'Tab') event.preventDefault();
        event.stopPropagation();
        handled();
    }

    /* ---------------- search ---------------- */

    function runSearch() {
        const query = ui.query.value.trim();

        clearMarks();

        if (query === '') {
            matches = [];
            hitIndex = -1;
            ui.hits.textContent = '';
            ui.hits.dataset.state = 'idle';
            setHitButtons();
            return;
        }

        matches = search(paginated.pages, query);
        hitIndex = matches.length ? 0 : -1;

        ui.hits.dataset.state = matches.length ? 'found' : 'empty';
        setHitButtons();

        if (!matches.length) {
            ui.hits.textContent = 'no matches';
            return;
        }

        /**
         * Jump straight to the first hit. Reporting how many pages carry it is
         * more useful than a raw count when the viewer shows one page at a time.
         */
        const onPages = searchPages(paginated.pages, query).length;
        ui.hits.textContent =
            `${matches.length} on ${onPages} page${onPages === 1 ? '' : 's'}`;

        goToHit(0);
    }

    function goToHit(next) {
        if (!matches.length) return;

        hitIndex = (next + matches.length) % matches.length;
        const target = matches[hitIndex].pageNO - 1;

        if (target !== index) show(target);
        else paint();

        ui.hits.textContent = `${hitIndex + 1} of ${matches.length}`;
        focusMark();
    }

    function setHitButtons() {
        ui.hitPrev.disabled = matches.length === 0;
        ui.hitNext.disabled = matches.length === 0;
    }

    /* ---------------- highlighting ---------------- */

    function clearMarks() {
        for (const mark of mountEl.querySelectorAll('mark.hit')) {
            const parent = mark.parentNode;
            parent.replaceChild(doc.createTextNode(mark.textContent), mark);
            parent.normalize();
        }

        /** and the runs that held a cell's marks together go back to plain text */
        for (const run of mountEl.querySelectorAll('span.hit-run')) {
            const parent = run.parentNode;
            parent.replaceChild(doc.createTextNode(run.textContent), run);
            parent.normalize();
        }
    }

    /** marks every occurrence on the page currently on screen */
    function paint() {
        clearMarks();

        const query = ui.query.value.trim();
        if (query === '') return;

        const page = pages[index];
        if (!page) return;

        const needle = query.toLowerCase();
        const walker = doc.createTreeWalker(page, NodeFilter.SHOW_TEXT);
        const targets = [];

        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (node.nodeValue.toLowerCase().includes(needle)) targets.push(node);
        }

        for (const node of targets) markNode(node, needle);
    }

    function markNode(node, needle) {
        const text = node.nodeValue;
        const fragment = doc.createDocumentFragment();

        let from = 0;

        for (; ;) {
            const at = text.toLowerCase().indexOf(needle, from);
            if (at === -1) break;

            if (at > from) fragment.appendChild(doc.createTextNode(text.slice(from, at)));

            const mark = doc.createElement('mark');
            mark.className = 'hit';
            mark.textContent = text.slice(at, at + needle.length);
            fragment.appendChild(mark);

            from = at + needle.length;
        }

        if (from < text.length) fragment.appendChild(doc.createTextNode(text.slice(from)));

        /**
         * A table cell lays its text out as a flex column, to centre it
         * whatever it wraps to - and every child of a flex box is a block of
         * its own. Split into text, mark, text, a cell reading "Northgate
         * Stores" stacked "North" over "gate Stores" on lines the row had no
         * room for. Kept together in one inline run, it reads as it did.
         */
        const parent = node.parentNode;

        if (parent.classList?.contains('cell')) {
            const run = doc.createElement('span');
            run.className = 'hit-run';
            run.appendChild(fragment);
            parent.replaceChild(run, node);
            return;
        }

        parent.replaceChild(fragment, node);
    }

    /** the focused hit gets a stronger colour and is scrolled into view */
    function focusMark() {
        const marks = [...mountEl.querySelectorAll('mark.hit')];
        if (!marks.length) return;

        /** how many of the run of matches fall on this page before the focused one */
        const onThisPage = matches.filter(m => m.pageNO === index + 1);
        const offset = onThisPage.indexOf(matches[hitIndex]);
        const mark = marks[Math.max(offset, 0)] ?? marks[0];

        marks.forEach(m => m.classList.remove('is-focused'));
        mark.classList.add('is-focused');
        mark.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }

    /* ---------------- wiring ---------------- */

    ui.prev.addEventListener('click', () => show(index - 1));
    ui.next.addEventListener('click', () => show(index + 1));

    ui.current.addEventListener('change', () => {
        const asked = Number(ui.current.value);
        if (Number.isFinite(asked)) show(asked - 1);
        else ui.current.value = String(index + 1);
    });

    ui.print?.addEventListener('click', printReport);
    ui.exportOpen.addEventListener('click', () => {
        if (menu && !menu.hidden) closeExport();
        else openExport();
    });

    /** the arrows open the menu from its button, as they would a select */
    ui.exportOpen.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

        event.preventDefault();
        event.stopPropagation();
        openExport();
    });

    if (menu) {
        menu.addEventListener('keydown', onMenuKey);

        for (const item of menuItems) {
            item.addEventListener('click', () => confirmExport(item.dataset.format));
        }
    }

    ui.zoomIn.addEventListener('click', () => stepZoom(1));
    ui.zoomOut.addEventListener('click', () => stepZoom(-1));

    ui.zoom.addEventListener('change', () => {
        if (ui.zoom.value === 'fit') setFitWidth();
        else setZoom(Number(ui.zoom.value));
    });

    const onResize = () => { if (fitWidth) setFitWidth(); };
    view.addEventListener('resize', onResize);

    ui.hitPrev.addEventListener('click', () => goToHit(hitIndex - 1));
    ui.hitNext.addEventListener('click', () => goToHit(hitIndex + 1));

    let debounce;
    ui.query.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(runSearch, 150);
    });

    ui.query.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (matches.length) goToHit(hitIndex + (event.shiftKey ? -1 : 1));
        else runSearch();
    });

    /** paging keys, as long as the user is not typing in the search box */
    const onKeyDown = (event) => {
        /** while the export menu is open it owns the keyboard, bar Escape */
        if (menu && !menu.hidden) {
            if (event.key === 'Escape') { event.preventDefault(); closeExport(); }
            return;
        }

        /**
         * ctrl+K reaches the search from anywhere, including from inside another
         * field, so it sits above the guard that hands typing back to the inputs.
         * ctrl+F comes along because it is what a browser's own find uses, and
         * the report's search is more useful than searching the one page on screen.
         */
        if ((event.ctrlKey || event.metaKey) && ['k', 'f'].includes(event.key.toLowerCase())) {
            event.preventDefault();
            ui.query.focus();
            ui.query.select();
            return;
        }

        /**
         * ctrl+P is taken from the browser deliberately: printing through
         * printReport clears the search highlights first, so they do not end up
         * in the PDF the way the browser's own shortcut would leave them.
         */
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
            event.preventDefault();
            printReport();
            return;
        }

        /**
         * Everything below is held back while a field has focus, which is what
         * keeps ctrl+X available for cutting text out of the search box.
         */
        if (event.target === ui.query || event.target === ui.current) return;

        /** ctrl+X opens the export menu; ctrl+S too, since the browser's save is no use here */
        if ((event.ctrlKey || event.metaKey) && ['x', 's'].includes(event.key.toLowerCase())) {
            event.preventDefault();
            openExport();
            return;
        }

        if (event.key === 'ArrowRight' || event.key === 'PageDown') show(index + 1);
        if (event.key === 'ArrowLeft' || event.key === 'PageUp') show(index - 1);
        if (event.key === 'Home') show(0);
        if (event.key === 'End') show(total - 1);

        /** ctrl +/-/0 zooms the report, the way the browser would zoom a page */
        if (event.ctrlKey || event.metaKey) {
            if (event.key === '+' || event.key === '=') { event.preventDefault(); stepZoom(1); }
            if (event.key === '-') { event.preventDefault(); stepZoom(-1); }
            if (event.key === '0') { event.preventDefault(); setZoom(1); }
        }
    };

    doc.addEventListener('keydown', onKeyDown);

    if (afterPrintSupported) {
        view.addEventListener('afterprint', restoreAfterPrint);
    }

    /**
     * The listeners above are on the viewer's own document and window, which
     * outlive this mount. Without a way to take them off, a second viewer on
     * the same page - or a React <Preview /> remounting - leaves the first one
     * still handling keys.
     */
    function destroy() {
        ui.zoom.destroy();
        doc.removeEventListener('pointerdown', onOutside, true);
        doc.removeEventListener('keydown', onKeyDown);
        view.removeEventListener('resize', onResize);
        view.removeEventListener('afterprint', restoreAfterPrint);

        /** the viewer built everything in here, so it takes it all away again */
        root.innerHTML = '';
        root.classList.remove('report-viewer');
    }

    applyPrintPageSize();
    applyZoom();
    show(0);
    setHitButtons();

    return {
        show,
        next: () => show(index + 1),
        prev: () => show(index - 1),
        find: (q) => { ui.query.value = q; runSearch(); },
        print: printReport,
        downloadCSV,
        downloadXLSX,
        openExport,
        closeExport,
        confirmExport,
        destroy,
        get exportOpen() { return menu ? !menu.hidden : false; },
        setZoom,
        zoomIn: () => stepZoom(1),
        zoomOut: () => stepZoom(-1),
        fitWidth: setFitWidth,
        get zoom() { return zoom; },
        get page() { return index + 1; },
        get pageCount() { return total; }
    };
}

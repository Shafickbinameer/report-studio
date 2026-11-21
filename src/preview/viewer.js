/**
 * viewer.js turns a page list into a page-at-a-time viewer: navigation, zoom,
 * search, print, PDF, CSV and Excel.
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
import { render, renderPage } from '../render/render.js';
import { reportToVectorPDF } from '../render/pdf.js';
import { PDF_MIME } from '../engine/pdf.js';
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


/** how long Print waits for the report's PDF to load before printing the page instead */
const PRINT_LOAD_TIMEOUT = 15000;

/**
 * Whether Print can hand the report's PDF to the browser's print dialog:
 * a desktop Chromium - Chrome, Edge, Brave, Opera - with its PDF viewer on.
 *
 * Those print a PDF in a frame of the page as they print any PDF. Firefox
 * prints one by redrawing every page itself, Safari is unreliable at it, and
 * a phone's browser does not show a PDF in a page at all, so they print the
 * page as before. A browser this cannot tell apart is left printing the
 * page too, which works everywhere.
 *
 * @param {Window} view the window the viewer is in
 * @returns {boolean}
 */
function canPrintPDF(view) {
    const nav = view?.navigator;
    const ua = nav?.userAgentData;

    if (!ua || ua.mobile) return false;
    if (nav.pdfViewerEnabled === false) return false;
    if (typeof globalThis.CompressionStream === 'undefined') return false;

    return (ua.brands ?? []).some(entry => entry?.brand === 'Chromium');
}


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

    /**
     * The stack starts empty and holds the page on screen, drawn as it is
     * shown. The viewer shows one page at a time, and drawing all of them up
     * front - half a million elements for a 500-page statement - took seconds
     * before the first page appeared, to build pages nobody was looking at.
     *
     * Printing is the one time every page is wanted, so they are all drawn
     * for it and let go of again afterwards (drawAll, dropAll).
     */
    viewport.innerHTML = render({ ...paginated, pages: [] });

    const total = paginated.pages.length;
    const stack = viewport.querySelector('#main-page');

    /** the page element on screen */
    let current = null;

    /** every page's element, while they are all drawn for printing */
    let drawn = null;

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

        place();

        ui.current.value = String(index + 1);
        ui.prev.disabled = index === 0;
        ui.next.disabled = index === total - 1;

        paint();
        /** absent in jsdom, so a consumer testing there is not stopped by it */
        mountEl.scrollTo?.({ top: 0 });
    }

    /** puts the page at `index` on screen: drawn now, or picked out of `drawn` */
    function place() {
        if (total === 0) {
            stack.replaceChildren();
            current = null;
            return;
        }

        if (drawn) {
            drawn.forEach((page, i) => page.classList.toggle('is-current', i === index));
            current = drawn[index];
            return;
        }

        const holder = doc.createElement('div');
        holder.innerHTML = renderPage(paginated.pages[index], paginated.page);

        current = holder.querySelector('.page');
        current.classList.add('is-current');
        stack.replaceChildren(current);
    }

    /**
     * Every page in the stack, for the print dialog - which snapshots the
     * document as it stands and prints what the print stylesheet reveals. The
     * page on screen is kept as it is, pictures already loaded and all, and
     * the others are drawn either side of it.
     */
    function drawAll() {
        if (drawn || !current) return;

        const markup = (from, to) => paginated.pages.slice(from, to)
            .map(page => renderPage(page, paginated.page)).join('');

        current.insertAdjacentHTML('beforebegin', markup(0, index));
        current.insertAdjacentHTML('afterend', markup(index + 1));

        drawn = [...stack.querySelectorAll(':scope > .page')];
    }

    /** back to the one page on screen, as it is, once printing is over */
    function dropAll() {
        if (!drawn) return;

        drawn = null;
        stack.replaceChildren(current);
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
     * The report as CSV text, written when first asked for and kept: the
     * export menu asks whether there is any as it opens, and the download
     * wants the same text. Unkept, a long report wrote it out four times
     * over just to open the menu.
     */
    let csvText = null;
    const reportCSV = () => (csvText ??= toReportCSV(paginated.pages));

    /**
     * One entry per offered format. Adding another means a line here and an
     * entry in chrome.js's export list; nothing else in the flow needs to know.
     */
    const FORMATS = {
        pdf: {
            available: () => true,
            summary: () => `Downloads ${reportFilename(paginated, 'pdf')}, ` +
                `${total} page${total === 1 ? '' : 's'}.`,
            run: () => downloadPDF()
        },
        csv: {
            available: () => reportCSV() !== '',
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

    /* ---------------- work that takes a while ---------------- */

    /** the jobs under way, by name, and how many of them each button is showing */
    const jobs = new Map();
    const busyOn = new Map();

    /**
     * Set by destroy(). A job still under way then stops where it is rather
     * than print, download or add a frame for a viewer that has gone.
     */
    let destroyed = false;

    /**
     * Runs `work` - writing a file, readying a print - with `button` showing
     * a spinner until it is done, and gives back the job.
     *
     * The work starts once the spinner has been painted. An Excel workbook of
     * a long report is seconds of work that holds the page while it runs, and
     * a spinner set just before it would only appear once it was over.
     *
     * Asking for a job already under way gets that one rather than a second,
     * so a press repeated while a file is written writes it once.
     *
     * @param {string} name
     * @param {HTMLElement} button
     * @param {() => any} work
     * @returns {Promise<void>}
     */
    function busyWith(name, button, work) {
        if (jobs.has(name)) return jobs.get(name);

        setBusy(button, 1);

        const job = afterPaint()
            .then(() => (destroyed ? undefined : work()))
            .catch(error => console.warn(`report-studio: ${name} did not finish.`, error))
            .finally(() => {
                jobs.delete(name);
                setBusy(button, -1);
            });

        jobs.set(name, job);
        return job;
    }

    /** a button shows busy while any of its jobs is under way - Export has three */
    function setBusy(button, step) {
        if (!button) return;

        const count = (busyOn.get(button) ?? 0) + step;

        if (count > 0) {
            busyOn.set(button, count);
            button.setAttribute('aria-busy', 'true');
        } else {
            busyOn.delete(button);
            button.removeAttribute('aria-busy');
        }
    }

    /** settles once the browser has painted what was changed before it was asked */
    function afterPaint() {
        return new Promise((resolve) => {
            const next = () => view.setTimeout(resolve, 0);

            /** a hidden tab paints nothing, and its animation frames never come */
            if (typeof view.requestAnimationFrame === 'function' && doc.visibilityState !== 'hidden') {
                view.requestAnimationFrame(next);
            } else {
                next();
            }
        });
    }

    /* ---------------- files ---------------- */

    /**
     * The report as a PDF file, written here rather than by the browser's
     * print: the print path lays out every page of the report at once (the
     * screen only ever lays out the one in view) and Chrome then builds the
     * file twice, once for its preview and again to save it - minutes, for a
     * long report. reportToVectorPDF draws the pages the engine already built
     * straight into PDF.
     *
     * Search highlights are not part of the drawing, so they never reach it.
     * Should the writer fail, the print dialog is still a way to a PDF.
     *
     * @returns {boolean} true: a file is on its way
     */
    function downloadPDF() {
        busyWith('pdf', ui.exportOpen, () => pdfBytes().then(
            (bytes) => {
                if (!destroyed) download(new Blob([bytes], { type: PDF_MIME }), reportFilename(paginated, 'pdf'));
            },
            (error) => {
                if (destroyed) return;
                console.warn('report-studio: the PDF could not be written; opening the print dialog instead.', error);
                busyWith('print', ui.print, printPage);
            }));

        return true;
    }

    /**
     * The report's PDF, written once for this viewer and shared by Download
     * and Print - the pages do not change while it is open. A write that
     * failed is not kept, so the next ask tries again.
     */
    let pdfWritten = null;

    function pdfBytes() {
        if (!pdfWritten) {
            pdfWritten = reportToVectorPDF(paginated, { title: paginated.name || undefined });
            pdfWritten.catch(() => { pdfWritten = null; });
        }

        return pdfWritten;
    }

    /**
     * The report as text: every line and every table row, in the order the
     * pages draw them. Boxes and rules are the only things left behind, having
     * nothing to write.
     *
     * @returns {boolean} true: a file is on its way; false: there is nothing to write
     */
    function downloadCSV() {
        if (!FORMATS.csv.available()) return false;

        busyWith('csv', ui.exportOpen, () => {
            /** the BOM is what makes Excel read the file as UTF-8 rather than latin-1 */
            download(
                new Blob(['﻿', reportCSV()], { type: 'text/csv;charset=utf-8' }),
                reportFilename(paginated, 'csv')
            );
        });

        return true;
    }

    /**
     * The report as an Excel workbook: a sheet that reads like the report, and
     * a sheet per table with typed, sortable cells.
     *
     * A report whose pictures come from URLs fetches them first, to embed
     * them. Should building with the fetched pictures fail, the workbook goes
     * without them rather than not at all.
     *
     * @returns {boolean} true: a file is on its way; false: there is nothing to write
     */
    function downloadXLSX() {
        if (!FORMATS.xlsx.available()) return false;

        const save = (bytes) => {
            if (bytes.length > 0 && !destroyed) {
                download(new Blob([bytes], { type: XLSX_MIME }), reportFilename(paginated, 'xlsx'));
            }
        };

        busyWith('xlsx', ui.exportOpen, () => {
            if (reportImageSources(paginated.pages).length > 0) {
                return toXLSXAsync(paginated.pages).then(save, () => save(toXLSX(paginated.pages)))
                    .then(() => undefined);
            }

            save(toXLSX(paginated.pages));
        });

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

    /* ---------------- printing ---------------- */

    /**
     * Print. Where the browser can print a PDF from the page, the report's
     * own PDF goes to the print dialog; anywhere else the page itself does.
     *
     * Printing the page makes the browser lay out every page of the report
     * as a web page before its dialog can show the first - seconds for a
     * short report, minutes for a long one - only to arrive at what the PDF
     * already is. Handed the PDF, the dialog has nothing left to prepare, and
     * what is left is the dialog: which printer, how many copies.
     *
     * @returns {Promise<void>} settles once the print dialog has been asked for
     */
    function printReport() {
        return busyWith('print', ui.print, () => (canPrintPDF(view) ? printPDF() : printPage()));
    }

    /** the frame the last PDF was printed from, kept until the next print: taking it away sooner can cancel the job */
    let printFrame = null;

    /** the report's PDF into a frame out of sight, and the frame's print; the page prints should any of it fail */
    function printPDF() {
        const instead = (error) => {
            console.warn('report-studio: the PDF could not be printed; printing the page instead.', error);
            removePrintFrame();
            return printPage();
        };

        return pdfBytes().then(bytes => new Promise((resolve) => {
            if (destroyed) return resolve();

            removePrintFrame();

            const url = URL.createObjectURL(new Blob([bytes], { type: PDF_MIME }));
            const frame = doc.createElement('iframe');

            /**
             * Out of sight but not display: none, or the browser does not
             * load the PDF into it at all.
             */
            frame.setAttribute('aria-hidden', 'true');
            frame.tabIndex = -1;
            frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';

            printFrame = { frame, url };

            /** a PDF that never shows up (its viewer turned off by policy) should not leave Print doing nothing */
            const stalled = view.setTimeout(
                () => resolve(destroyed ? undefined : instead(new Error('the PDF did not load'))),
                PRINT_LOAD_TIMEOUT);

            frame.addEventListener('load', () => {
                view.clearTimeout(stalled);

                try {
                    frame.contentWindow.focus();
                    frame.contentWindow.print();
                    resolve();
                } catch (error) {
                    resolve(instead(error));
                }
            }, { once: true });

            frame.src = url;
            doc.body.appendChild(frame);
        }), instead);
    }

    function removePrintFrame() {
        if (!printFrame) return;

        printFrame.frame.remove();
        URL.revokeObjectURL(printFrame.url);
        printFrame = null;
    }

    /**
     * Printing the page itself: what every browser can do, and the preview
     * exactly, because it *is* the preview - every page is drawn for it, and
     * the print stylesheet reveals them all and drops the chrome.
     *
     * Search highlights are cleared first so they do not end up on paper.
     */
    function printPage() {
        if (destroyed) return Promise.resolve();

        drawAll();

        /**
         * A picture still loading prints as a blank frame, and the print dialog
         * snapshots the page the moment it opens. So a report with pictures on
         * the way waits for them - loaded or failed, either way settled.
         */
        const pending = [...viewport.querySelectorAll('img')].filter(img => !img.complete);

        return Promise.all(pending.map(img => img.decode().catch(() => { }))).then(printNow);
    }

    function printNow() {
        if (destroyed) return;

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
     * afterprint is also when the pages drawn for printing go again. A
     * browser without it keeps them - hidden, as every page but the current
     * one used to be - since there is no telling when its dialog is done.
     */
    function onAfterPrint() {
        dropAll();
        restoreAfterPrint();
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

        /** close first: a download, or the print dialog it can fall back to, should not have the menu over it */
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

        const page = current;
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
         * ctrl+P is taken from the browser deliberately: printReport prints
         * the report's PDF where it can, which is far quicker for a long
         * report, and clears the search highlights where it prints the page,
         * so they do not end up on paper the way the browser's own shortcut
         * would leave them.
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
        view.addEventListener('afterprint', onAfterPrint);
    }

    /**
     * The browser's own print - its menu, or a print started by the host
     * rather than through printReport - finds only the page on screen in
     * the document, so it gets every page drawn the moment it starts.
     */
    view.addEventListener('beforeprint', drawAll);

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
        view.removeEventListener('afterprint', onAfterPrint);
        view.removeEventListener('beforeprint', drawAll);
        destroyed = true;
        removePrintFrame();

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
        downloadPDF,
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

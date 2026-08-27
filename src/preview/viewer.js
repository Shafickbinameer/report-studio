/**
 * viewer.js turns a page list into a page-at-a-time viewer: navigation, zoom,
 * search, print and CSV.
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
import { toCSV, reportFilename } from '../engine/csv.js';
import { createDropdown } from '../shared/dropdown.js';
import { render } from '../render/render.js';
import { chrome } from './chrome.js';


/** the zoom levels the -/+ buttons step through, matching the select */
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

const MIN_ZOOM = ZOOM_STEPS[0];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];


/**
 * Mounts the viewer.
 *
 * @param {object} options
 * @param {Element|string} options.mount the element to take over, or a selector
 * @param {object} options.paginated the buildPages result
 * @param {string} [options.title] what the brand corner reads
 * @returns {object} a handle: paging, zoom, search, print, export and destroy
 */
export function createViewer({ mount, paginated, title } = {}) {
    const root = typeof mount === 'string' ? document.querySelector(mount) : mount;

    if (!root) {
        throw new Error(
            `createViewer: no element for mount ${JSON.stringify(mount)}. ` +
            `Add <div id="report"></div> to the page first.`
        );
    }

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

    const modal = root.querySelector('[data-role="export-modal"]');

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

    const dialog = modal ? {
        root: modal,
        card: modal.querySelector('.modal-card'),
        backdrop: modal.querySelector('[data-role="export-backdrop"]'),
        summary: modal.querySelector('[data-role="export-summary"]'),
        cancel: modal.querySelector('[data-role="export-cancel"]'),
        confirm: modal.querySelector('[data-role="export-confirm"]'),
        formats: [...modal.querySelectorAll('input[name="export-format"]')]
    } : null;

    let index = 0;          // zero-based page index
    let matches = [];       // engine search results
    let hitIndex = -1;      // which match is focused
    let zoom = 1;           // the scale actually applied
    let fitWidth = false;   // recompute zoom from the viewport on resize
    let returnFocusTo = null;   // what had focus before the dialog opened

    const afterPrintSupported = typeof window.onafterprint !== 'undefined';

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
     * One entry per offered format. Adding a third means a line here and a radio
     * in the dialog; nothing else in the flow needs to know about it.
     */
    const FORMATS = {
        pdf: {
            available: () => true,
            summary: () => `${total} page${total === 1 ? '' : 's'}, ` +
                `${paginated.page.width}×${paginated.page.height}px each.`,
            run: () => printReport()
        },
        csv: {
            available: () => toCSV(paginated.pages) !== '',
            summary: () => FORMATS.csv.available()
                ? `Downloads ${reportFilename(paginated, 'csv')}.`
                : 'This report has no table to export.',
            run: () => downloadCSV()
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
        clearMarks();
        window.print();

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

        let style = document.getElementById('report-page-size');
        if (!style) {
            style = document.createElement('style');
            style.id = 'report-page-size';
            document.head.appendChild(style);
        }

        style.textContent = `@page { size: ${width}px ${height}px; margin: 0; }`;
    }

    /** the table rows behind the report, as a spreadsheet would want them */
    function downloadCSV() {
        const csv = toCSV(paginated.pages);
        if (csv === '') return false;

        /** the BOM is what makes Excel read the file as UTF-8 rather than latin-1 */
        download(
            new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }),
            reportFilename(paginated, 'csv')
        );

        return true;
    }

    function download(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();

        /** give the browser a tick to start the download before dropping the url */
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    /* ---------------- the export dialog ---------------- */

    function chosenFormat() {
        return dialog?.formats.find(input => input.checked)?.value ?? 'pdf';
    }

    /** the note under the radios, plus whether Export can proceed at all */
    function refreshDialog() {
        if (!dialog) return;

        for (const input of dialog.formats) {
            const format = FORMATS[input.value];
            input.disabled = format ? !format.available() : true;
            input.closest('.format')?.classList.toggle('is-unavailable', input.disabled);
        }

        /** never leave a disabled option selected */
        const current = dialog.formats.find(i => i.checked);
        if (current?.disabled) {
            const fallback = dialog.formats.find(i => !i.disabled);
            if (fallback) fallback.checked = true;
        }

        const format = FORMATS[chosenFormat()];
        dialog.summary.textContent = format ? format.summary() : '';
        dialog.confirm.disabled = !format || !format.available();
    }

    function openExport() {
        if (!dialog) return;

        returnFocusTo = document.activeElement;
        dialog.root.hidden = false;
        refreshDialog();

        const focusOn = dialog.formats.find(i => i.checked && !i.disabled)
            ?? dialog.formats.find(i => !i.disabled)
            ?? dialog.cancel;
        focusOn.focus();
    }

    function closeExport() {
        if (!dialog || dialog.root.hidden) return;

        dialog.root.hidden = true;
        returnFocusTo?.focus?.();
        returnFocusTo = null;
    }

    function confirmExport() {
        const format = FORMATS[chosenFormat()];
        if (!format?.available()) return;

        /**
         * Close first. The print dialog is modal and blocking, so leaving our
         * own overlay up would put it in the printed page and in the way.
         */
        closeExport();
        format.run();
    }

    /** keeps Tab inside the card while the dialog is up */
    function trapFocus(event) {
        const focusable = [...dialog.card.querySelectorAll('button, input')]
            .filter(node => !node.disabled);
        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
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
            parent.replaceChild(document.createTextNode(mark.textContent), mark);
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
        const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
        const targets = [];

        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (node.nodeValue.toLowerCase().includes(needle)) targets.push(node);
        }

        for (const node of targets) markNode(node, needle);
    }

    function markNode(node, needle) {
        const text = node.nodeValue;
        const fragment = document.createDocumentFragment();

        let from = 0;

        for (; ;) {
            const at = text.toLowerCase().indexOf(needle, from);
            if (at === -1) break;

            if (at > from) fragment.appendChild(document.createTextNode(text.slice(from, at)));

            const mark = document.createElement('mark');
            mark.className = 'hit';
            mark.textContent = text.slice(at, at + needle.length);
            fragment.appendChild(mark);

            from = at + needle.length;
        }

        if (from < text.length) fragment.appendChild(document.createTextNode(text.slice(from)));

        node.parentNode.replaceChild(fragment, node);
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
    ui.exportOpen.addEventListener('click', openExport);

    if (dialog) {
        dialog.cancel.addEventListener('click', closeExport);
        dialog.backdrop.addEventListener('click', closeExport);
        dialog.confirm.addEventListener('click', confirmExport);

        for (const input of dialog.formats) {
            input.addEventListener('change', refreshDialog);
        }

        dialog.root.addEventListener('keydown', (event) => {
            if (event.key === 'Tab') trapFocus(event);
            if (event.key === 'Enter') { event.preventDefault(); confirmExport(); }
        });
    }

    ui.zoomIn.addEventListener('click', () => stepZoom(1));
    ui.zoomOut.addEventListener('click', () => stepZoom(-1));

    ui.zoom.addEventListener('change', () => {
        if (ui.zoom.value === 'fit') setFitWidth();
        else setZoom(Number(ui.zoom.value));
    });

    const onResize = () => { if (fitWidth) setFitWidth(); };
    window.addEventListener('resize', onResize);

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
        /** while the dialog is up it owns the keyboard, bar Escape */
        if (dialog && !dialog.root.hidden) {
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

        /** ctrl+X opens the export; ctrl+S too, since the browser's save is no use here */
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

    document.addEventListener('keydown', onKeyDown);

    if (afterPrintSupported) {
        window.addEventListener('afterprint', restoreAfterPrint);
    }

    /**
     * The listeners above are on document and window, which outlive this mount.
     * Without a way to take them off, a second viewer on the same page - or a
     * React <Preview /> remounting - leaves the first one still handling keys.
     */
    function destroy() {
        ui.zoom.destroy();
        document.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('afterprint', restoreAfterPrint);

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
        openExport,
        closeExport,
        confirmExport,
        destroy,
        get exportOpen() { return dialog ? !dialog.root.hidden : false; },
        setZoom,
        zoomIn: () => stepZoom(1),
        zoomOut: () => stepZoom(-1),
        fitWidth: setFitWidth,
        get zoom() { return zoom; },
        get page() { return index + 1; },
        get pageCount() { return total; }
    };
}

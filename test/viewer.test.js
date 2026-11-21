/**
 * @vitest-environment jsdom
 *
 * The viewer is the only part of the project that owns the DOM, so it is the
 * only suite that needs a document. Everything under engine/ stays in the plain
 * node environment, which is what keeps the spec 2.1 boundary honest.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { createViewer } from '../src/preview/viewer.js';
import { render } from '../src/render/render.js';
import { layout, text, line, box, image, table, band, rows, groupedRows, run } from './helpers/layout.js';

/**
 * The preview page's own body, minus its module script, so the specs drive the
 * real toolbar, pager and dialog rather than a copy that can drift from them.
 *
 * The viewer builds those itself now, so there is no page to slice up: the host
 * supplies one empty element, which is the whole of what an application does.
 */

/**
 * The viewer listens on document and window, so each mount is torn down before
 * the next one. Without that, every earlier viewer keeps handling keystrokes
 * and a shortcut fires once per test that has run so far.
 */
let mounted = null;

function mountReport(data, json) {
    mounted?.destroy();
    document.body.innerHTML = '<div id="report"></div>';

    const paginated = run(json ?? layout({
        bands: [
            band('reportHeader', [text('rh', { value: 'INVOICE for {customer.name}' })]),
            band('detail', [table()]),
            band('pageFooter', [text('pf', { value: 'Page {page} of {totalPages}' })])
        ]
    }), data);

    const viewer = createViewer({ mount: '#report', paginated });

    mounted = viewer;

    return {
        viewer,
        paginated,
        mount: document.querySelector('[data-role="viewport"]'),
        bar: document.querySelector('[data-role="bar"]')
    };
}

const visible = () => [...document.querySelectorAll('.page.is-current')];
const el = (role) => document.querySelector(`[data-role="${role}"]`);

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    /** jsdom has no layout engine, so these are no-ops it does not implement */
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.scrollTo = vi.fn();
    /**
     * jsdom has no canvas either. Returning null is exactly what text-metrics
     * expects off a browser, so this exercises its fallback rather than letting
     * jsdom log an unimplemented warning on every measurement.
     */
    HTMLCanvasElement.prototype.getContext = () => null;
});
afterEach(() => {
    mounted?.destroy();
    mounted = null;
    vi.restoreAllMocks();
});

describe('viewer - control layout', () => {
    it('keeps paging in the floating pager, not the top bar', () => {
        mountReport({ items: rows(120), customer: { name: 'Anand' } });

        const pager = document.querySelector('[data-role="pager"]');
        const bar = document.querySelector('[data-role="bar"]');

        for (const role of ['prev', 'next', 'current', 'total']) {
            expect(pager.querySelector(`[data-role="${role}"]`), role).not.toBeNull();
            expect(bar.querySelector(`[data-role="${role}"]`), role).toBeNull();
        }
    });

    it('keeps zoom, export and search in the top bar', () => {
        mountReport({ items: rows(120), customer: { name: 'Anand' } });

        const bar = document.querySelector('[data-role="bar"]');
        for (const role of ['zoom', 'zoom-in', 'zoom-out', 'export', 'query', 'hit-next']) {
            expect(bar.querySelector(`[data-role="${role}"]`), role).not.toBeNull();
        }
    });

    it('names the product on the left of the header', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        const brand = document.querySelector('.toolbar-brand');
        expect(brand).not.toBeNull();
        expect(brand.textContent.trim()).toBe('Report Studio');
        expect(brand.previousElementSibling).toBeNull();
    });

    it('puts zoom immediately to the right of the search', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        const centre = document.querySelector('.toolbar-centre');
        const groups = [...centre.children];

        expect(groups).toHaveLength(2);
        expect(groups[0].classList.contains('toolbar-search')).toBe(true);
        expect(groups[1].classList.contains('toolbar-zoom')).toBe(true);
    });

    it('keeps the count and match arrows inside the search field', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        const field = document.querySelector('.search-field');
        expect(field).not.toBeNull();

        for (const role of ['query', 'hits', 'hit-prev', 'hit-next']) {
            expect(field.querySelector(`[data-role="${role}"]`), role).not.toBeNull();
        }

        /** the input comes first, the arrows after the count */
        expect([...field.children].map(n => n.dataset.role))
            .toEqual(['query', 'hits', 'hit-prev', 'hit-next']);
    });

    it('leaves Export alone on the right', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        const bar = document.querySelector('[data-role="bar"]');
        expect(bar.lastElementChild.classList.contains('toolbar-save')).toBe(true);
        expect(bar.lastElementChild.querySelector('[data-role="export"]')).not.toBeNull();
    });

    it('wires controls wherever they sit, so markup can move them', () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        /** the pager's buttons drive the same viewer the top bar does */
        document.querySelector('[data-role="pager"] [data-role="next"]').click();
        expect(visible()[0].id).toBe('page-2');
        expect(viewer.page).toBe(2);
    });

    it('stops handling keys once destroyed', () => {
        /**
         * The page itself is gone by then - the viewer built everything inside
         * the host element and takes it all away again - so what is checked is
         * that the keystroke reached nothing, not where it left the report.
         */
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.next();
        expect(visible()[0].id).toBe('page-2');

        viewer.destroy();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

        expect(viewer.page).toBe(2);
    });

    it('leaves the host element as it found it', () => {
        const { viewer } = mountReport({ items: rows(3), customer: { name: 'Anand' } });
        const host = document.getElementById('report');

        expect(host.querySelector('[data-role="bar"]')).not.toBeNull();

        viewer.destroy();

        expect(host.innerHTML).toBe('');
        expect(host.className).toBe('');
    });

    it('renders each control exactly once', () => {
        mountReport({ items: rows(120), customer: { name: 'Anand' } });

        for (const role of ['prev', 'next', 'current', 'export', 'query', 'export-menu']) {
            expect(document.querySelectorAll(`[data-role="${role}"]`), role).toHaveLength(1);
        }
        expect(document.querySelectorAll('[data-role="export-menu"] [data-format]')).toHaveLength(3);
    });
});

describe('viewer - paging', () => {
    it('shows exactly one page at a time', () => {
        const { paginated } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        expect(paginated.pages.length).toBeGreaterThan(2);
        expect(visible()).toHaveLength(1);
        expect(visible()[0].id).toBe('page-1');
    });

    it('advances and goes back', () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.next();
        expect(visible()[0].id).toBe('page-2');

        viewer.prev();
        expect(visible()[0].id).toBe('page-1');
    });

    it('moves on a next button click', () => {
        mountReport({ items: rows(120), customer: { name: 'Anand' } });

        el('next').click();
        expect(visible()[0].id).toBe('page-2');
    });

    it('keeps the page counter in step', () => {
        const { viewer, paginated } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        expect(el('total').textContent).toBe(String(paginated.pages.length));
        expect(el('current').value).toBe('1');

        viewer.next();
        expect(el('current').value).toBe('2');
    });

    it('jumps to a page typed into the box', () => {
        mountReport({ items: rows(120), customer: { name: 'Anand' } });

        el('current').value = '3';
        el('current').dispatchEvent(new Event('change'));

        expect(visible()[0].id).toBe('page-3');
    });

    it('clamps out of range requests instead of blanking the view', () => {
        const { viewer, paginated } = mountReport({ items: rows(120), customer: { name: 'Anand' } });
        const last = paginated.pages.length;

        viewer.show(99);
        expect(visible()[0].id).toBe(`page-${last}`);

        viewer.show(-5);
        expect(visible()[0].id).toBe('page-1');
    });

    it('disables the buttons at each end', () => {
        const { viewer, paginated } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        expect(el('prev').disabled).toBe(true);
        expect(el('next').disabled).toBe(false);

        viewer.show(paginated.pages.length - 1);
        expect(el('prev').disabled).toBe(false);
        expect(el('next').disabled).toBe(true);
    });

    it('disables both buttons on a single page report', () => {
        mountReport({ items: rows(3), customer: { name: 'Anand' } });

        expect(visible()).toHaveLength(1);
        expect(el('prev').disabled).toBe(true);
        expect(el('next').disabled).toBe(true);
    });

    it('pages with the arrow keys', () => {
        mountReport({ items: rows(120), customer: { name: 'Anand' } });

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(visible()[0].id).toBe('page-2');

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(visible()[0].id).toBe('page-1');
    });
});

describe('viewer - export menu', () => {
    let clicked;

    const menu = () => el('export-menu');
    const item = (format) => menu().querySelector(`[data-format="${format}"]`);
    const note = (format) => el(`export-note-${format}`).textContent;

    /** a key pressed where the focus is, as a browser delivers it */
    const press = (key, extra = {}) => {
        const target = document.activeElement ?? document.body;
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
        target.dispatchEvent(event);
        return event;
    };

    beforeEach(() => {
        clicked = [];
        window.print = vi.fn();
        URL.createObjectURL = vi.fn(() => 'blob:fake');
        URL.revokeObjectURL = vi.fn();

        /** jsdom will not follow a download, so record the anchor instead */
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
            clicked.push({ href: this.href, download: this.download });
        });
    });

    it('stays closed until asked', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        expect(viewer.exportOpen).toBe(false);
        expect(menu().hidden).toBe(true);
        expect(el('export').getAttribute('aria-expanded')).toBe('false');
    });

    it('opens under the Export button, as a menu', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();

        expect(viewer.exportOpen).toBe(true);
        expect(menu().hidden).toBe(false);
        expect(menu().getAttribute('role')).toBe('menu');
        expect(el('export').getAttribute('aria-haspopup')).toBe('menu');
        expect(el('export').getAttribute('aria-expanded')).toBe('true');
        expect(el('export').closest('.export-menu').contains(menu())).toBe(true);
    });

    it('closes again on a second click of the button', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        el('export').click();

        expect(viewer.exportOpen).toBe(false);
    });

    it('exports nothing merely by opening', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        expect(window.print).not.toHaveBeenCalled();
        expect(clicked).toHaveLength(0);
    });

    it('offers PDF, CSV and Excel, in that order', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });
        el('export').click();

        const items = [...menu().querySelectorAll('[role="menuitem"]')];
        expect(items.map(i => i.dataset.format)).toEqual(['pdf', 'csv', 'xlsx']);
        expect(items.map(i => i.querySelector('.format-name').textContent)).toEqual(['PDF', 'CSV', 'Excel']);
    });

    it('puts the focus on PDF, the first in the list', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });
        el('export').click();

        expect(document.activeElement).toBe(item('pdf'));
    });

    it('says what each format will make', () => {
        const { paginated } = mountReport({ items: rows(120), customer: { name: 'Anand' } });
        el('export').click();

        expect(note('pdf')).toContain(`${paginated.pages.length} pages`);
        expect(note('csv')).toContain('spec.csv');
        expect(note('xlsx')).toContain('spec.xlsx');
    });

    it('writes and downloads a PDF file when PDF is chosen, without the print dialog', async () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        item('pdf').click();

        /** the export button says it is busy while the file is written */
        expect(el('export').getAttribute('aria-busy')).toBe('true');

        await vi.waitFor(() => expect(clicked).toHaveLength(1));

        expect(clicked[0].download).toBe('spec.pdf');
        expect(window.print).not.toHaveBeenCalled();
        expect(el('export').hasAttribute('aria-busy')).toBe(false);

        const blob = URL.createObjectURL.mock.calls[0][0];
        expect(blob.type).toBe('application/pdf');
        expect(blob.size).toBeGreaterThan(0);
    });

    it('writes one PDF however often it is asked for while it is being written', async () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        expect(viewer.downloadPDF()).toBe(true);
        expect(viewer.downloadPDF()).toBe(true);

        await vi.waitFor(() => expect(el('export').hasAttribute('aria-busy')).toBe(false));
        expect(clicked).toHaveLength(1);
    });

    it('falls back to the print dialog when the PDF cannot be written', async () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        vi.stubGlobal('CompressionStream', undefined);

        try {
            viewer.downloadPDF();
            await vi.waitFor(() => expect(window.print).toHaveBeenCalledOnce());
            expect(clicked).toHaveLength(0);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('downloads when CSV is chosen', async () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        item('csv').click();

        await vi.waitFor(() => expect(clicked).toHaveLength(1));
        expect(clicked[0].download).toBe('spec.csv');
        expect(window.print).not.toHaveBeenCalled();
    });

    it('downloads a workbook when Excel is chosen', async () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        item('xlsx').click();

        await vi.waitFor(() => expect(clicked).toHaveLength(1));
        expect(clicked[0].download).toBe('spec.xlsx');
        expect(window.print).not.toHaveBeenCalled();

        const blob = URL.createObjectURL.mock.calls[0][0];
        expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        expect(blob.size).toBeGreaterThan(0);
    });

    it('downloads a workbook from code', async () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        expect(viewer.downloadXLSX()).toBe(true);
        await vi.waitFor(() => expect(clicked).toHaveLength(1));
        expect(clicked[0].download).toBe('spec.xlsx');
    });

    it('fetches URL pictures before downloading a workbook', async () => {
        const png = new Uint8Array(33);
        png.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
        new DataView(png.buffer).setUint32(16, 10);
        new DataView(png.buffer).setUint32(20, 10);

        const fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => png.buffer }));
        vi.stubGlobal('fetch', fetch);

        try {
            const { viewer } = mountReport({ items: rows(3), customer: { name: 'Anand' } }, layout({
                bands: [
                    band('reportHeader', [image('logo', { src: 'https://example.test/logo.png' })]),
                    band('detail', [table()])
                ]
            }));

            expect(viewer.downloadXLSX()).toBe(true);
            await vi.waitFor(() => expect(clicked).toHaveLength(1));

            expect(fetch).toHaveBeenCalledWith('https://example.test/logo.png');
            expect(clicked[0].download).toBe('spec.xlsx');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('closes after exporting, and gives the focus back to the button', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        item('csv').click();

        expect(viewer.exportOpen).toBe(false);
        expect(document.activeElement).toBe(el('export'));
    });

    it('closes before the PDF is written', async () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        viewer.openExport();
        item('pdf').click();
        expect(menu().hidden).toBe(true);

        await vi.waitFor(() => expect(clicked).toHaveLength(1));
    });

    it('exports from code: the format asked for, or PDF', async () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        viewer.confirmExport('csv');
        await vi.waitFor(() => expect(clicked).toHaveLength(1));
        expect(clicked[0].download).toBe('spec.csv');

        viewer.confirmExport();
        await vi.waitFor(() => expect(clicked).toHaveLength(2));
        expect(clicked[1].download).toBe('spec.pdf');
    });

    it('closes on a press anywhere else, exporting nothing', async () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        /** the outside listener is added on the next tick */
        await new Promise(resolve => setTimeout(resolve, 0));

        el('viewport').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));

        expect(viewer.exportOpen).toBe(false);
        expect(window.print).not.toHaveBeenCalled();
        expect(clicked).toHaveLength(0);
    });

    it('closes on Escape, back to the button', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        press('Escape');

        expect(viewer.exportOpen).toBe(false);
        expect(document.activeElement).toBe(el('export'));
        expect(window.print).not.toHaveBeenCalled();
    });

    it('moves through the formats with the arrow keys, round from the end', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        press('ArrowDown');
        expect(document.activeElement).toBe(item('csv'));

        press('ArrowDown');
        expect(document.activeElement).toBe(item('xlsx'));

        press('ArrowDown');
        expect(document.activeElement).toBe(item('pdf'));

        press('ArrowUp');
        expect(document.activeElement).toBe(item('xlsx'));

        press('Home');
        expect(document.activeElement).toBe(item('pdf'));
    });

    it('opens from the button on the down arrow', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').focus();
        press('ArrowDown');

        expect(viewer.exportOpen).toBe(true);
        expect(document.activeElement).toBe(item('pdf'));
    });

    it('prints on the Print button', async () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('print').click();
        await vi.waitFor(() => expect(window.print).toHaveBeenCalledOnce());
    });

    it('prints on ctrl+P rather than letting the browser do it', async () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }));

        await vi.waitFor(() => expect(window.print).toHaveBeenCalledOnce());
        expect(viewer.exportOpen).toBe(false);
    });

    it('clears highlights on a ctrl+P print, same as the button', async () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.find('row-2');
        expect(document.querySelectorAll('mark.hit').length).toBeGreaterThan(0);

        let marksAtPrint;
        window.print = vi.fn(() => { marksAtPrint = document.querySelectorAll('mark.hit').length; });

        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }));

        await vi.waitFor(() => expect(window.print).toHaveBeenCalledOnce());
        expect(marksAtPrint).toBe(0);
    });

    it('opens the export menu on ctrl+X', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'x', ctrlKey: true, bubbles: true }));

        expect(viewer.exportOpen).toBe(true);
        expect(window.print).not.toHaveBeenCalled();
    });

    it('leaves ctrl+X alone while the search box has focus, so cut still works', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('query').focus();
        el('query').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'x', ctrlKey: true, bubbles: true }));

        expect(viewer.exportOpen).toBe(false);
    });

    it('opens on ctrl+S rather than saving the browser page', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));

        expect(viewer.exportOpen).toBe(true);
    });

    it('keeps the arrow keys from paging the report while it is open', () => {
        mountReport({ items: rows(120), customer: { name: 'Anand' } });

        el('export').click();
        press('ArrowRight');
        press('ArrowDown');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

        expect(visible()[0].id).toBe('page-1');
    });

    it('releases the object url it created', async () => {
        vi.useFakeTimers();
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        item('csv').click();
        await vi.runAllTimersAsync();

        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
        vi.useRealTimers();
    });

    /**
     * A file being written shows on the Export button as a spinner, and the
     * writing waits for the spinner to be painted: an Excel workbook of a long
     * report holds the page for seconds, and a spinner set just before it
     * would only have shown once it was over.
     */
    it('spins Export while a file is written, painted before the writing starts', async () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        item('xlsx').click();

        expect(el('export').getAttribute('aria-busy')).toBe('true');
        expect(clicked).toHaveLength(0);

        await vi.waitFor(() => expect(clicked).toHaveLength(1));
        await vi.waitFor(() => expect(el('export').hasAttribute('aria-busy')).toBe(false));
    });

    it('spins Print until the print dialog is asked for', async () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        let busyAtPrint;
        window.print = vi.fn(() => { busyAtPrint = el('print').getAttribute('aria-busy'); });

        const printed = viewer.print();
        expect(el('print').getAttribute('aria-busy')).toBe('true');
        expect(window.print).not.toHaveBeenCalled();

        await printed;
        expect(busyAtPrint).toBe('true');
        expect(el('print').hasAttribute('aria-busy')).toBe(false);
    });

    it('writes a file once however often it is asked for while it is being written', async () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        expect(viewer.downloadCSV()).toBe(true);
        expect(viewer.downloadCSV()).toBe(true);
        expect(viewer.downloadXLSX()).toBe(true);
        expect(viewer.downloadXLSX()).toBe(true);

        await vi.waitFor(() => expect(el('export').hasAttribute('aria-busy')).toBe(false));
        expect(clicked.map(c => c.download).sort()).toEqual(['spec.csv', 'spec.xlsx']);
    });

    it('keeps Export spinning until the last of its files is written', async () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        viewer.downloadCSV();
        viewer.downloadPDF();

        await vi.waitFor(() => expect(clicked.map(c => c.download)).toContain('spec.csv'));
        if (clicked.length < 2) expect(el('export').getAttribute('aria-busy')).toBe('true');

        await vi.waitFor(() => expect(clicked).toHaveLength(2));
        await vi.waitFor(() => expect(el('export').hasAttribute('aria-busy')).toBe(false));
    });

    it('drops work a destroyed viewer had asked for', async () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        viewer.downloadCSV();
        const printed = viewer.print();
        viewer.destroy();
        mounted = null;

        await printed;
        await new Promise(done => setTimeout(done, 50));

        expect(clicked).toHaveLength(0);
        expect(window.print).not.toHaveBeenCalled();
    });

    it('leaves no stray anchor behind', async () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        item('csv').click();

        await vi.waitFor(() => expect(clicked).toHaveLength(1));
        expect(document.querySelectorAll('a[download]')).toHaveLength(0);
    });

    it('sets the print page size from the layout, with no sheet margin', () => {
        const { paginated } = mountReport({ items: rows(12), customer: { name: 'Anand' } });
        const { width, height } = paginated.page;

        const style = document.getElementById('report-page-size');
        expect(style).not.toBeNull();
        expect(style.textContent)
            .toBe(`@page { size: ${width}px ${height}px; margin: 0; }`);
    });

    it('restores highlights on afterprint rather than straight after print()', async () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.find('row-2');
        const before = document.querySelectorAll('mark.hit').length;
        expect(before).toBeGreaterThan(0);

        /** jsdom supports onafterprint, so print() must leave the marks cleared */
        await viewer.print();
        expect(document.querySelectorAll('mark.hit')).toHaveLength(0);

        window.dispatchEvent(new Event('afterprint'));
        expect(document.querySelectorAll('mark.hit')).toHaveLength(before);
    });

    it('clears search highlights before printing and restores them after', async () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.find('row-2');
        const before = document.querySelectorAll('mark.hit').length;
        expect(before).toBeGreaterThan(0);

        window.print = vi.fn(() => {
            expect(document.querySelectorAll('mark.hit')).toHaveLength(0);
        });

        el('print').click();

        await vi.waitFor(() => expect(window.print).toHaveBeenCalledOnce());

        window.dispatchEvent(new Event('afterprint'));
        expect(document.querySelectorAll('mark.hit')).toHaveLength(before);
    });
});

/**
 * The viewer shows one page at a time and draws one at a time. A 500-page
 * statement used to be written out whole before its first page appeared -
 * seconds of building pages that were hidden - so only the page on screen is
 * in the document, until printing wants them all.
 */
/**
 * Print hands the report's own PDF to the print dialog where the browser can
 * print one from the page - a desktop Chromium - so the dialog has no pages
 * to lay out first. Everywhere else the page prints, as it always has.
 */
describe('viewer - printing the PDF', () => {
    const CHROME = { brands: [{ brand: 'Chromium', version: '130' }, { brand: 'Google Chrome', version: '130' }], mobile: false };

    let blobs;

    function browser(userAgentData, pdfViewerEnabled = true) {
        Object.defineProperty(window.navigator, 'userAgentData', { value: userAgentData, configurable: true });
        Object.defineProperty(window.navigator, 'pdfViewerEnabled', { value: pdfViewerEnabled, configurable: true });
    }

    beforeEach(() => {
        window.print = vi.fn();
        blobs = [];
        URL.createObjectURL = vi.fn((blob) => { blobs.push(blob); return `blob:fake-${blobs.length}`; });
        URL.revokeObjectURL = vi.fn();
        browser(CHROME);
    });

    afterEach(() => {
        delete window.navigator.userAgentData;
        delete window.navigator.pdfViewerEnabled;
        vi.useRealTimers();
    });

    const frames = () => [...document.querySelectorAll('iframe')];

    /** the frame the PDF went into, loaded, with a print() to watch */
    async function loadedFrame() {
        await vi.waitFor(() => expect(frames()).toHaveLength(1));
        const [frame] = frames();
        const print = vi.fn();
        frame.contentWindow.print = print;
        frame.contentWindow.focus = vi.fn();
        frame.dispatchEvent(new Event('load'));
        return { frame, print };
    }

    it('prints the PDF in desktop Chrome, not the page', async () => {
        mountReport({ items: rows(120), customer: { name: 'Anand' } });

        el('print').click();
        expect(el('print').getAttribute('aria-busy')).toBe('true');

        const { frame, print } = await loadedFrame();

        expect(print).toHaveBeenCalledOnce();
        expect(window.print).not.toHaveBeenCalled();
        expect(blobs[0].type).toBe('application/pdf');
        expect(frame.src).toBe('blob:fake-1');
        await vi.waitFor(() => expect(el('print').hasAttribute('aria-busy')).toBe(false));

        /** none of the report's pages had to be drawn for it */
        expect(document.querySelectorAll('#main-page > .page')).toHaveLength(1);
    });

    it('keeps the frame out of sight, but loaded', async () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });
        el('print').click();

        const { frame } = await loadedFrame();

        expect(frame.style.visibility).toBe('hidden');
        expect(frame.style.display).not.toBe('none');
        expect(frame.getAttribute('aria-hidden')).toBe('true');
    });

    it('prints the PDF on ctrl+P too', async () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }));

        const { print } = await loadedFrame();
        expect(print).toHaveBeenCalledOnce();
        expect(window.print).not.toHaveBeenCalled();
    });

    it('prints once however often Print is pressed while the PDF is on its way', async () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        viewer.print();
        viewer.print();

        const { print } = await loadedFrame();
        expect(print).toHaveBeenCalledOnce();
        expect(frames()).toHaveLength(1);
    });

    it('replaces the last print frame with the next, and takes it away on destroy', async () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        const first = viewer.print();
        await loadedFrame();
        await first;

        viewer.print();
        await vi.waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-1'));
        expect(frames()).toHaveLength(1);
        expect(frames()[0].src).toBe('blob:fake-2');

        viewer.destroy();
        mounted = null;
        expect(frames()).toHaveLength(0);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-2');
    });

    it('prints the page instead when the PDF does not load', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('print').click();
        await vi.waitFor(() => expect(frames()).toHaveLength(1));

        vi.advanceTimersByTime(15000);

        await vi.waitFor(() => expect(window.print).toHaveBeenCalledOnce());
        expect(frames()).toHaveLength(0);
        await vi.waitFor(() => expect(el('print').hasAttribute('aria-busy')).toBe(false));
    });

    it('prints the page instead when the PDF cannot be written', async () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        /** the PDF viewer is on but the writer's compression is missing */
        vi.stubGlobal('CompressionStream', undefined);
        try {
            await viewer.print();
            expect(window.print).toHaveBeenCalledOnce();
            expect(frames()).toHaveLength(0);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it.each([
        ['Firefox and Safari, which have no userAgentData', undefined, true],
        ['a phone', { ...CHROME, mobile: true }, true],
        ['a Chrome with its PDF viewer turned off', CHROME, false],
        ['a browser that is not Chromium', { brands: [{ brand: 'Other', version: '1' }], mobile: false }, true]
    ])('prints the page in %s', async (_, userAgentData, pdfViewerEnabled) => {
        browser(userAgentData, pdfViewerEnabled);
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('print').click();

        await vi.waitFor(() => expect(window.print).toHaveBeenCalledOnce());
        expect(frames()).toHaveLength(0);
    });

    it('writes the PDF once for Print and Download alike', async () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { });

        viewer.print();
        await loadedFrame();

        viewer.downloadPDF();
        await vi.waitFor(() => expect(blobs).toHaveLength(2));

        /** the same bytes in both */
        const [printed, downloaded] = await Promise.all(blobs.map(b => b.arrayBuffer()));
        expect(new Uint8Array(downloaded)).toEqual(new Uint8Array(printed));
    });
});

describe('viewer - drawing the page on screen only', () => {
    const pagesInDocument = () => [...document.querySelectorAll('#main-page > .page')];

    it('has only the page on screen in the document', () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        expect(viewer.pageCount).toBeGreaterThan(2);
        expect(pagesInDocument().map(p => p.id)).toEqual(['page-1']);
        expect(visible().map(p => p.id)).toEqual(['page-1']);
    });

    it('draws a page as it is turned to, and lets the last one go', () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.next();
        expect(pagesInDocument().map(p => p.id)).toEqual(['page-2']);

        viewer.show(viewer.pageCount - 1);
        expect(pagesInDocument().map(p => p.id)).toEqual([`page-${viewer.pageCount}`]);
        expect(pagesInDocument()[0].textContent)
            .toContain(`Page ${viewer.pageCount} of ${viewer.pageCount}`);
    });

    it('draws what the full render drew, page for page', () => {
        const { viewer, paginated } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        const whole = document.createElement('div');
        whole.innerHTML = render(paginated);
        const expected = [...whole.querySelectorAll('.page')];

        for (let n = 0; n < viewer.pageCount; n++) {
            viewer.show(n);
            const shown = pagesInDocument()[0].cloneNode(true);
            shown.classList.remove('is-current');
            expect(shown.outerHTML).toBe(expected[n].outerHTML);
        }
    });

    it('draws every page in order for printing, the one on screen kept as it was', async () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.show(1);
        const onScreen = pagesInDocument()[0];

        let atPrint;
        window.print = vi.fn(() => { atPrint = pagesInDocument(); });
        await viewer.print();

        expect(atPrint.map(p => p.id))
            .toEqual(Array.from({ length: viewer.pageCount }, (_, n) => `page-${n + 1}`));
        expect(atPrint[1]).toBe(onScreen);
        expect(visible()).toEqual([onScreen]);
    });

    it('lets the other pages go after printing, and pages on as before', async () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.show(1);
        const onScreen = pagesInDocument()[0];

        await viewer.print();
        expect(pagesInDocument()).toHaveLength(viewer.pageCount);
        window.dispatchEvent(new Event('afterprint'));

        expect(pagesInDocument()).toEqual([onScreen]);

        viewer.next();
        expect(pagesInDocument().map(p => p.id)).toEqual(['page-3']);
    });

    it('pages through the printed pages while they are all drawn', async () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        await viewer.print();
        viewer.show(2);

        expect(pagesInDocument()).toHaveLength(viewer.pageCount);
        expect(visible().map(p => p.id)).toEqual(['page-3']);
    });

    /** the browser's own Print menu does not go through viewer.print() */
    it('draws every page when the browser prints on its own', () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        window.dispatchEvent(new Event('beforeprint'));
        expect(pagesInDocument()).toHaveLength(viewer.pageCount);

        window.dispatchEvent(new Event('afterprint'));
        expect(pagesInDocument()).toHaveLength(1);
    });

    it('stops listening for printing once destroyed', () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });
        viewer.destroy();
        mounted = null;

        expect(() => window.dispatchEvent(new Event('beforeprint'))).not.toThrow();
        expect(document.querySelectorAll('.page')).toHaveLength(0);
    });

    it('highlights a search hit on a page that had not been drawn yet', () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.find('row-110');

        expect(viewer.page).toBeGreaterThan(1);
        const marks = [...document.querySelectorAll('mark.hit')];
        expect(marks.length).toBeGreaterThan(0);
        expect(marks.every(m => m.closest('.page') === pagesInDocument()[0])).toBe(true);
    });
});

describe('viewer - export menu with nothing to export', () => {
    /**
     * A rule and a panel and nothing else. A report with no table but with text
     * still exports - the CSV is the report's lines now, not only its rows - so
     * the only report left with nothing to write is one that writes nothing.
     */
    const noTableLayout = () => layout({
        bands: [band('detail', [line('rule'), box('panel', { y: 30 })])]
    });

    const item = (format) => el('export-menu').querySelector(`[data-format="${format}"]`);

    beforeEach(() => {
        window.print = vi.fn();
        URL.createObjectURL = vi.fn(() => 'blob:fake');
        URL.revokeObjectURL = vi.fn();
    });

    it('disables CSV and Excel for a report that writes nothing', () => {
        mountReport({}, noTableLayout());
        el('export').click();

        for (const format of ['csv', 'xlsx']) {
            expect(item(format).disabled, format).toBe(true);
            expect(item(format).getAttribute('aria-disabled'), format).toBe('true');
            expect(item(format).classList.contains('is-unavailable'), format).toBe(true);
        }
    });

    it('says why, where the file name would be', () => {
        mountReport({}, noTableLayout());
        el('export').click();

        expect(el('export-note-csv').textContent).toContain('nothing to write');
    });

    it('offers CSV for a report with text but no table', () => {
        mountReport({}, layout({
            bands: [band('detail', [text('only', { value: 'nothing tabular here' })])]
        }));
        el('export').click();

        expect(item('csv').disabled).toBe(false);
    });

    it('leaves PDF available', () => {
        mountReport({}, noTableLayout());
        el('export').click();

        expect(item('pdf').disabled).toBe(false);
        expect(document.activeElement).toBe(item('pdf'));
    });

    it('steps over what it cannot export', () => {
        const { viewer } = mountReport({}, noTableLayout());
        el('export').click();

        document.activeElement.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        expect(document.activeElement).toBe(item('pdf'));

        /** and asked for from code, a format with nothing to write does nothing */
        viewer.confirmExport('csv');
        expect(URL.createObjectURL).not.toHaveBeenCalled();
    });
});

describe('viewer - zoom', () => {
    const stack = () => document.querySelector('#main-page');
    const scale = () => document.querySelector('[data-role="viewport"]').style.getPropertyValue('--zoom');

    /** the listbox has no .value - what the user reads is the trigger's label */
    const zoomLabel = () => document.querySelector('.dropdown-value').textContent.trim();
    const zoomItem = (value) =>
        document.querySelector(`.dropdown-item[data-value="${value}"]`);

    it('starts at 100 percent', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        expect(viewer.zoom).toBe(1);
        expect(scale()).toBe('1');
        expect(zoomLabel()).toBe('100%');
    });

    it('steps up and down through the presets', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        viewer.zoomIn();
        expect(viewer.zoom).toBe(1.25);

        viewer.zoomIn();
        expect(viewer.zoom).toBe(1.5);

        viewer.zoomOut();
        expect(viewer.zoom).toBe(1.25);
    });

    it('zooms on a button click', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('zoom-in').click();
        expect(viewer.zoom).toBe(1.25);

        el('zoom-out').click();
        expect(viewer.zoom).toBe(1);
    });

    it('applies the scale as a CSS custom property', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        viewer.setZoom(2);
        expect(scale()).toBe('2');
    });

    it('grows the scrollable footprint with the zoom', () => {
        const { viewer, paginated } = mountReport({ items: rows(12), customer: { name: 'Anand' } });
        const { width, height } = paginated.page;

        expect(stack().style.width).toBe(`${width}px`);

        viewer.setZoom(2);
        expect(stack().style.width).toBe(`${width * 2}px`);
        expect(stack().style.height).toBe(`${height * 2}px`);
    });

    it('clamps to the smallest and largest preset', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        viewer.setZoom(0.01);
        expect(viewer.zoom).toBe(0.5);

        viewer.setZoom(99);
        expect(viewer.zoom).toBe(3);
    });

    it('disables each button at its limit', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        viewer.setZoom(0.5);
        expect(el('zoom-out').disabled).toBe(true);
        expect(el('zoom-in').disabled).toBe(false);

        viewer.setZoom(3);
        expect(el('zoom-out').disabled).toBe(false);
        expect(el('zoom-in').disabled).toBe(true);
    });

    it('does not step past a limit it is already at', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        viewer.setZoom(3);
        viewer.zoomIn();
        expect(viewer.zoom).toBe(3);

        viewer.setZoom(0.5);
        viewer.zoomOut();
        expect(viewer.zoom).toBe(0.5);
    });

    it('follows the listbox', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('zoom').click();
        zoomItem('1.5').click();
        expect(viewer.zoom).toBe(1.5);
    });

    it('keeps the listbox in step with the buttons', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        viewer.zoomIn();
        expect(zoomLabel()).toBe('125%');
    });

    it('fits the width to the viewport', () => {
        const { viewer, paginated } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        /** jsdom reports zero, so give the viewport a width to fit against */
        Object.defineProperty(document.querySelector('[data-role="viewport"]'), 'clientWidth', {
            value: paginated.page.width + 48,
            configurable: true
        });

        viewer.fitWidth();
        expect(viewer.zoom).toBeCloseTo(1, 5);
        expect(zoomLabel()).toBe('Fit width');
    });

    it('leaves the zoom alone when the viewport has no width yet', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        viewer.setZoom(1.5);
        viewer.fitWidth();
        expect(viewer.zoom).toBe(1.5);
    });

    it('zooms with ctrl plus and minus', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        document.dispatchEvent(new KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true }));
        expect(viewer.zoom).toBe(1.25);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true }));
        expect(viewer.zoom).toBe(1);
    });

    it('resets to 100 percent with ctrl zero', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        viewer.setZoom(2);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true }));
        expect(viewer.zoom).toBe(1);
    });

    it('survives paging without losing the zoom', () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.setZoom(1.5);
        viewer.next();

        expect(viewer.zoom).toBe(1.5);
        expect(scale()).toBe('1.5');
    });
});

describe('viewer - search', () => {
    it('reports how many matches and on how many pages', () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.find('row-1');
        expect(el('hits').textContent).toMatch(/\d+ of \d+/);
        expect(el('hits').dataset.state).toBe('found');
    });

    it('says so when there is nothing to find', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        viewer.find('nothing-matches-this');
        expect(el('hits').textContent).toBe('no matches');
        expect(el('hits').dataset.state).toBe('empty');
    });

    it('jumps to the page holding the first match', () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.find('row-90');
        expect(visible()[0].id).not.toBe('page-1');
    });

    it('highlights matches on the visible page only', () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.find('row-2');
        const marks = [...document.querySelectorAll('mark.hit')];

        expect(marks.length).toBeGreaterThan(0);
        for (const mark of marks) {
            expect(mark.closest('.page').classList.contains('is-current')).toBe(true);
        }
    });

    it('marks one hit as focused', () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.find('row-2');
        expect(document.querySelectorAll('mark.hit.is-focused')).toHaveLength(1);
    });

    it('steps through matches with the next button', () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.find('row-1');
        const first = el('hits').textContent;

        el('hit-next').click();
        expect(el('hits').textContent).not.toBe(first);
    });

    it('wraps around at the last match', () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.find('Anand');
        expect(el('hits').textContent).toBe('1 of 1');

        el('hit-next').click();
        expect(el('hits').textContent).toBe('1 of 1');
    });

    it('clears highlights when the query is emptied', () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.find('row-2');
        expect(document.querySelectorAll('mark.hit').length).toBeGreaterThan(0);

        viewer.find('');
        expect(document.querySelectorAll('mark.hit')).toHaveLength(0);
        expect(el('hits').textContent).toBe('');
    });

    it('leaves the report text intact after highlighting and clearing', () => {
        const { viewer, mount } = mountReport({ items: rows(120), customer: { name: 'Anand' } });
        const before = mount.textContent;

        viewer.find('row-2');
        viewer.find('');

        expect(mount.textContent).toBe(before);
    });

    it('keeps a table cell its one line of text while a match in it is marked', () => {
        /**
         * A cell is a flex column, and every child of one is a block - so a
         * cell split into text, mark, text stacked the three on separate
         * lines. Its text stays in a single inline run instead.
         */
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.find('row-2');
        const inCells = [...document.querySelectorAll('.cell mark.hit')];
        expect(inCells.length).toBeGreaterThan(0);

        for (const mark of inCells) {
            const cell = mark.closest('.cell');
            expect(mark.parentElement.classList.contains('hit-run')).toBe(true);
            expect(cell.childNodes).toHaveLength(1);
        }

        viewer.find('');
        expect(document.querySelectorAll('.hit-run')).toHaveLength(0);
    });

    it('disables the match buttons when there is no query', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        expect(el('hit-prev').disabled).toBe(true);
        expect(el('hit-next').disabled).toBe(true);
    });

    it('focuses the search on ctrl+K', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));

        expect(document.activeElement).toBe(el('query'));
    });

    it('focuses the search on ctrl+F too', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true }));

        expect(document.activeElement).toBe(el('query'));
    });

    it('reaches the search from inside another field', () => {
        mountReport({ items: rows(120), customer: { name: 'Anand' } });

        el('current').focus();
        el('current').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));

        expect(document.activeElement).toBe(el('query'));
    });

    it('does not page when ctrl+K is pressed', () => {
        mountReport({ items: rows(120), customer: { name: 'Anand' } });

        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));

        expect(visible()[0].id).toBe('page-1');
    });

    it('finds text inside a grouped report', () => {
        const grouped = layout({
            groupBy: 'name',
            bands: [
                band('groupHeader', [text('gh', { value: 'Region: {name}', h: 22 })], { height: 22 }),
                band('detail', [table()]),
                band('groupFooter', [text('gf', { value: 'Subtotal: {sum(price)}', h: 20 })], { height: 20 })
            ]
        });
        const { viewer } = mountReport({ items: groupedRows(['North', 'South'], 20) }, grouped);

        viewer.find('Region: South');
        expect(el('hits').dataset.state).toBe('found');
        expect(document.querySelectorAll('mark.hit').length).toBeGreaterThan(0);
    });
});


describe('a viewer mounted in a window of its own', () => {
    /**
     * `window` inside viewer.js is whichever page loaded the script - the host's
     * tab. A report opened in a window of its own is mounted *from* that tab, so
     * every bare `window` reached back into it: Print printed the application
     * behind the report, the dialog opened over the wrong window, and afterprint
     * fired somewhere the highlights were not.
     *
     * An iframe stands in for the pop-up. It is the only thing jsdom has with a
     * document and a window that are genuinely not this one, and it is the same
     * distinction: root.ownerDocument.defaultView is not `window`.
     */
    let frame = null;
    let viewer = null;

    beforeEach(() => {
        document.body.innerHTML = '';

        /** an earlier mount in this document left its @page rule in the head */
        document.getElementById('report-page-size')?.remove();

        frame = document.createElement('iframe');
        document.body.appendChild(frame);

        const inner = frame.contentDocument;
        inner.body.innerHTML = '<div id="report"></div>';
    });

    afterEach(() => {
        viewer?.destroy();
        viewer = null;
        frame?.remove();
        frame = null;
    });

    const mountThere = () => {
        const paginated = run(layout({ bands: [band('detail', [table()])] }), {
            items: rows(3)
        });

        viewer = createViewer({
            mount: frame.contentDocument.getElementById('report'), paginated
        });

        return viewer;
    };

    it('prints the window it is in, not the one it was mounted from', async () => {
        const there = vi.fn();
        const here = vi.fn();

        frame.contentWindow.print = there;
        window.print = here;

        await mountThere().print();

        expect(there).toHaveBeenCalledOnce();
        expect(here, 'the host tab was printed instead').not.toHaveBeenCalled();
    });

    it('prints that window from its own Print button too', async () => {
        const there = vi.fn();
        frame.contentWindow.print = there;
        window.print = vi.fn();

        mountThere();
        frame.contentDocument
            .querySelector('[data-role="print"]').click();

        await vi.waitFor(() => expect(there).toHaveBeenCalledOnce());
        expect(window.print).not.toHaveBeenCalled();
    });

    it("puts the page size into its own document, not the host's", () => {
        mountThere();

        expect(frame.contentDocument.getElementById('report-page-size'))
            .not.toBeNull();
        expect(document.getElementById('report-page-size')).toBeNull();
    });

    it('builds its chrome inside that document', () => {
        mountThere();

        expect(frame.contentDocument.querySelector('.report-viewer')).not.toBeNull();
        expect(document.querySelector('.report-viewer')).toBeNull();
    });

    it('takes its listeners off that window when it is destroyed', () => {
        const off = vi.spyOn(frame.contentWindow, 'removeEventListener');

        mountThere().destroy();
        viewer = null;

        const kinds = off.mock.calls.map(([type]) => type);

        expect(kinds).toContain('resize');
        expect(kinds).toContain('afterprint');
    });
});

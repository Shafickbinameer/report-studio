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
import { layout, text, line, box, table, band, rows, groupedRows, run } from './helpers/layout.js';

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

        for (const role of ['prev', 'next', 'current', 'export', 'query', 'export-confirm']) {
            expect(document.querySelectorAll(`[data-role="${role}"]`), role).toHaveLength(1);
        }
        expect(document.querySelectorAll('input[name="export-format"]')).toHaveLength(2);
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

describe('viewer - export dialog', () => {
    let clicked;

    const pick = (format) => {
        const input = [...document.querySelectorAll('input[name="export-format"]')]
            .find(i => i.value === format);
        input.checked = true;
        input.dispatchEvent(new Event('change'));
        return input;
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
        expect(el('export-modal').hidden).toBe(true);
    });

    it('opens on the Export button', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        expect(viewer.exportOpen).toBe(true);
        expect(el('export-modal').hidden).toBe(false);
    });

    it('exports nothing merely by opening', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        expect(window.print).not.toHaveBeenCalled();
        expect(clicked).toHaveLength(0);
    });

    it('offers PDF and CSV', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });
        el('export').click();

        const values = [...document.querySelectorAll('input[name="export-format"]')]
            .map(i => i.value);
        expect(values).toEqual(['pdf', 'csv']);
    });

    it('starts on PDF', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });
        el('export').click();

        const checked = [...document.querySelectorAll('input[name="export-format"]')]
            .find(i => i.checked);
        expect(checked.value).toBe('pdf');
    });

    it('describes the chosen format', () => {
        const { paginated } = mountReport({ items: rows(120), customer: { name: 'Anand' } });
        el('export').click();

        expect(el('export-summary').textContent)
            .toContain(`${paginated.pages.length} pages`);

        pick('csv');
        expect(el('export-summary').textContent).toContain('spec.csv');
    });

    it('prints when PDF is confirmed', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        pick('pdf');
        el('export-confirm').click();

        expect(window.print).toHaveBeenCalledOnce();
        expect(clicked).toHaveLength(0);
    });

    it('downloads when CSV is confirmed', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        pick('csv');
        el('export-confirm').click();

        expect(clicked).toHaveLength(1);
        expect(clicked[0].download).toBe('spec.csv');
        expect(window.print).not.toHaveBeenCalled();
    });

    it('closes after exporting', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        el('export-confirm').click();

        expect(viewer.exportOpen).toBe(false);
    });

    it('closes before the print dialog opens, so the overlay is not printed', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        window.print = vi.fn(() => {
            expect(el('export-modal').hidden).toBe(true);
        });

        viewer.openExport();
        el('export-confirm').click();
        expect(window.print).toHaveBeenCalledOnce();
    });

    it('cancels without exporting', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        el('export-cancel').click();

        expect(viewer.exportOpen).toBe(false);
        expect(window.print).not.toHaveBeenCalled();
        expect(clicked).toHaveLength(0);
    });

    it('closes on the backdrop', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        el('export-backdrop').click();

        expect(viewer.exportOpen).toBe(false);
    });

    it('closes on Escape', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(viewer.exportOpen).toBe(false);
        expect(window.print).not.toHaveBeenCalled();
    });

    it('confirms on Enter', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        el('export-modal').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(window.print).toHaveBeenCalledOnce();
    });

    it('prints on the Print button', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('print').click();
        expect(window.print).toHaveBeenCalledOnce();
    });

    it('prints on ctrl+P rather than letting the browser do it', () => {
        const { viewer } = mountReport({ items: rows(12), customer: { name: 'Anand' } });

        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }));

        expect(window.print).toHaveBeenCalledOnce();
        expect(viewer.exportOpen).toBe(false);
    });

    it('clears highlights on a ctrl+P print, same as the button', () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.find('row-2');
        expect(document.querySelectorAll('mark.hit').length).toBeGreaterThan(0);

        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }));

        expect(document.querySelectorAll('mark.hit')).toHaveLength(0);
    });

    it('opens the export on ctrl+X', () => {
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

    it('swallows paging keys while it is open', () => {
        mountReport({ items: rows(120), customer: { name: 'Anand' } });

        el('export').click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

        expect(visible()[0].id).toBe('page-1');
    });

    it('moves focus into the dialog and back out again', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });
        const opener = el('export');

        opener.focus();
        opener.click();
        expect(el('export-modal').contains(document.activeElement)).toBe(true);

        el('export-cancel').click();
        expect(document.activeElement).toBe(opener);
    });

    it('keeps Tab inside the dialog', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });
        el('export').click();

        const focusable = [...el('export-modal').querySelectorAll('button, input')]
            .filter(n => !n.disabled);

        focusable.at(-1).focus();
        el('export-modal').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        expect(document.activeElement).toBe(focusable[0]);

        el('export-modal').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
        expect(document.activeElement).toBe(focusable.at(-1));
    });

    it('releases the object url it created', () => {
        vi.useFakeTimers();
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        pick('csv');
        el('export-confirm').click();
        vi.runAllTimers();

        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
        vi.useRealTimers();
    });

    it('leaves no stray anchor behind', () => {
        mountReport({ items: rows(12), customer: { name: 'Anand' } });

        el('export').click();
        pick('csv');
        el('export-confirm').click();

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

    it('restores highlights on afterprint rather than straight after print()', () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.find('row-2');
        const before = document.querySelectorAll('mark.hit').length;
        expect(before).toBeGreaterThan(0);

        /** jsdom supports onafterprint, so print() must leave the marks cleared */
        viewer.print();
        expect(document.querySelectorAll('mark.hit')).toHaveLength(0);

        window.dispatchEvent(new Event('afterprint'));
        expect(document.querySelectorAll('mark.hit')).toHaveLength(before);
    });

    it('clears search highlights before printing and restores them after', () => {
        const { viewer } = mountReport({ items: rows(120), customer: { name: 'Anand' } });

        viewer.find('row-2');
        const before = document.querySelectorAll('mark.hit').length;
        expect(before).toBeGreaterThan(0);

        window.print = vi.fn(() => {
            expect(document.querySelectorAll('mark.hit')).toHaveLength(0);
        });

        viewer.openExport();
        el('export-confirm').click();

        expect(window.print).toHaveBeenCalledOnce();

        window.dispatchEvent(new Event('afterprint'));
        expect(document.querySelectorAll('mark.hit')).toHaveLength(before);
    });
});

describe('viewer - export dialog with nothing to export', () => {
    /**
     * A rule and a panel and nothing else. A report with no table but with text
     * still exports - the CSV is the report's lines now, not only its rows - so
     * the only report left with nothing to write is one that writes nothing.
     */
    const noTableLayout = () => layout({
        bands: [band('detail', [line('rule'), box('panel', { y: 30 })])]
    });

    beforeEach(() => {
        window.print = vi.fn();
        URL.createObjectURL = vi.fn(() => 'blob:fake');
        URL.revokeObjectURL = vi.fn();
    });

    it('disables the CSV option for a report with no table', () => {
        mountReport({}, noTableLayout());
        el('export').click();

        const csv = [...document.querySelectorAll('input[name="export-format"]')]
            .find(i => i.value === 'csv');

        expect(csv.disabled).toBe(true);
        expect(csv.closest('.format').classList.contains('is-unavailable')).toBe(true);
    });

    it('offers CSV for a report with text but no table', () => {
        mountReport({}, layout({
            bands: [band('detail', [text('only', { value: 'nothing tabular here' })])]
        }));
        el('export').click();

        const csv = [...document.querySelectorAll('input[name="export-format"]')]
            .find(i => i.value === 'csv');

        expect(csv.disabled).toBe(false);
    });

    it('leaves PDF available', () => {
        mountReport({}, noTableLayout());
        el('export').click();

        const pdf = [...document.querySelectorAll('input[name="export-format"]')]
            .find(i => i.value === 'pdf');

        expect(pdf.disabled).toBe(false);
        expect(el('export-confirm').disabled).toBe(false);
    });

    it('explains why CSV is unavailable', () => {
        mountReport({}, noTableLayout());
        el('export').click();

        const csv = [...document.querySelectorAll('input[name="export-format"]')]
            .find(i => i.value === 'csv');
        csv.checked = true;
        csv.dispatchEvent(new Event('change'));

        /** the selection falls back rather than sitting on a disabled option */
        expect(csv.checked).toBe(false);
        expect(el('export-summary').textContent).toContain('page');
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

    it('prints the window it is in, not the one it was mounted from', () => {
        const there = vi.fn();
        const here = vi.fn();

        frame.contentWindow.print = there;
        window.print = here;

        mountThere().print();

        expect(there).toHaveBeenCalledOnce();
        expect(here, 'the host tab was printed instead').not.toHaveBeenCalled();
    });

    it('prints that window from its own Print button too', () => {
        const there = vi.fn();
        frame.contentWindow.print = there;
        window.print = vi.fn();

        mountThere();
        frame.contentDocument
            .querySelector('[data-role="print"]').click();

        expect(there).toHaveBeenCalledOnce();
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

/**
 * @vitest-environment jsdom
 *
 * Running the report from inside the designer.
 *
 * The claim worth specifying is the seam (spec 2.2): the canvas and the
 * preview draw the same items with the same code, so the design cannot look one
 * way while arranging and another way once it has run.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDesigner } from '../src/designer/designer.js';
import { drawPreview, PAGE_LIMIT } from '../src/designer/preview.js';
import { StoreError } from '../src/shared/store.js';
import { sampleData } from '../src/designer/sample-data.js';
import { layout, text, table, band, rows } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    document.body.innerHTML = '<div id="report-designer"></div>';
});

let designer = null;
afterEach(() => {
    designer?.destroy();
    designer = null;
    vi.restoreAllMocks();
});

const json = () => layout({
    groupBy: 'region',
    bands: [
        band('reportHeader', [
            text('title', { value: 'SALES for {report.period}' })
        ], { height: 50 }),
        band('groupHeader', [
            text('gh', { value: 'Region: {region}' })
        ], { height: 28 }),
        band('detail', [table({ id: 'tbl' })]),
        band('pageFooter', [
            text('pf', { value: 'Page {page} of {totalPages}' })
        ], { height: 24 })
    ]
});

function fakeStore(data = {}) {
    return {
        list: async () => [],
        load: async () => { throw new StoreError('no'); },
        save: async (id) => ({ id }),
        remove: async () => ({}),
        loadData: async (id) => data[id] ?? null,
        saveData: async (id, payload) => { data[id] = payload; return { id }; }
    };
}

function mount({ l = json(), id = null, store = fakeStore() } = {}) {
    designer = createDesigner({ mount: '#report-designer', layout: l, id, store });
    return designer;
}

const root = () => document.getElementById('report-designer');
const canvas = () => root().querySelector('.dz-canvas');
const toggle = () => root().querySelector('[data-action="toggle-preview"]');
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function click(node) {
    node?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

async function run(d) {
    click(toggle());
    await settle();
    return d;
}


describe('drawPreview', () => {
    it('paginates and renders', () => {
        const json2 = layout({ bands: [band('detail', [table()])] });
        const out = drawPreview(json2, { items: rows(3) });

        expect(out.error).toBeNull();
        expect(out.pageCount).toBe(1);
        expect(out.markup).toContain('class="page"');
    });

    it('counts every page even when it draws fewer', () => {
        /**
         * Pagination is the cheap half and the page count is one of the things
         * worth previewing - so it runs in full and only the drawing is capped.
         */
        const json2 = layout({ bands: [band('detail', [table()])] });
        const out = drawPreview(json2, { items: rows(2000) }, { limit: 2 });

        expect(out.pageCount).toBeGreaterThan(2);
        expect((out.markup.match(/class="page"/g) || [])).toHaveLength(2);
    });

    it('says it drew fewer, rather than looking like the report ends early', () => {
        const json2 = layout({ bands: [band('detail', [table()])] });
        const out = drawPreview(json2, { items: rows(2000) }, { limit: 2 });

        expect(out.markup).toContain('Showing the first 2');
    });

    it('has a ceiling by default', () => {
        expect(PAGE_LIMIT).toBeGreaterThan(0);
    });

    it('reports a layout the engine refuses, in the words it used', () => {
        const out = drawPreview({ version: 1, page: {}, bands: [] }, {});

        expect(out.error).not.toBeNull();
        expect(out.markup).toMatch(/page\.width/);
        expect(out.pageCount).toBe(0);
    });

    it('survives being given no data at all', () => {
        const json2 = layout({ bands: [band('detail', [table()])] });
        expect(() => drawPreview(json2, null)).not.toThrow();
    });
});


describe('the toggle', () => {
    it('starts in design', () => {
        const d = mount();

        expect(d.mode).toBe('design');
        expect(root().dataset.mode).toBe('design');
    });

    it('runs the report', async () => {
        const d = await run(mount());

        expect(d.mode).toBe('preview');
        expect(canvas().querySelector('.page')).not.toBeNull();
    });

    it('goes back again', async () => {
        const d = await run(mount());
        click(toggle());

        expect(d.mode).toBe('design');
        expect(canvas().querySelector('.dz-sheet')).not.toBeNull();
    });

    it('runs on ctrl+E', async () => {
        const d = mount();

        root().dispatchEvent(new KeyboardEvent('keydown', {
            key: 'e', ctrlKey: true, bubbles: true, cancelable: true
        }));
        await settle();

        expect(d.mode).toBe('preview');
    });

    it('says how many pages there are', async () => {
        await run(mount());

        expect(root().querySelector('[data-role="pages"]').textContent)
            .toMatch(/\d+ page/);
    });

    it('clears the count on the way back', async () => {
        await run(mount());
        click(toggle());

        expect(root().querySelector('[data-role="pages"]').textContent).toBe('');
    });

    it('shows which mode it is in', async () => {
        const d = mount();
        expect(toggle().getAttribute('aria-pressed')).toBe('false');

        await run(d);
        expect(toggle().getAttribute('aria-pressed')).toBe('true');
    });
});


describe('what the preview is run with', () => {
    it('derives data for a report that has none', async () => {
        await run(mount());

        /** the sample fills the placeholders, so none survive onto the page */
        expect(canvas().innerHTML).not.toMatch(/\{[a-zA-Z][^}<]*\}/);
    });

    it('uses the real data when the report has some', async () => {
        const store = fakeStore({
            sales: {
                report: { period: 'June 2026' },
                items: [{ name: 'Real row', qty: 1, price: 10, region: 'West' }]
            }
        });

        await run(mount({ id: 'sales', store }));

        expect(canvas().textContent).toContain('June 2026');
        expect(canvas().textContent).toContain('Real row');
    });

    it('re-reads the data each time, so an edit to it shows', async () => {
        const data = {};
        const store = fakeStore(data);
        const d = mount({ id: 'sales', store });

        await run(d);
        click(toggle());

        data.sales = {
            report: { period: 'Edited' },
            items: [{ name: 'x', qty: 1, price: 1, region: 'A' }]
        };

        await run(d);
        expect(canvas().textContent).toContain('Edited');
    });

    it('falls back to the sample when the data cannot be fetched', async () => {
        const store = fakeStore();
        store.loadData = () => Promise.reject(new StoreError('server is gone'));

        const d = await run(mount({ id: 'sales', store }));

        /** a preview on sample data beats no preview at all */
        expect(d.mode).toBe('preview');
        expect(canvas().querySelector('.page')).not.toBeNull();
    });

    it('fills the aggregates and the page numbers the canvas cannot', async () => {
        /** the whole reason to run it: things only pagination and grouping know */
        const l = json();
        l.bands.push(band('groupFooter', [
            text('gf', { value: '{count()} sales' })
        ], { height: 26 }));

        await run(mount({ l }));

        expect(canvas().textContent).toMatch(/\d+ sales/);
        expect(canvas().textContent).toMatch(/Page 1 of \d+/);
    });
});


describe('the design cannot be edited while it is running', () => {
    it('drops the selection on the way in', async () => {
        const d = mount();
        d.select({ band: 'detail', id: 'tbl' });

        await run(d);
        expect(d.selection).toBeNull();
    });

    it('does not select the item behind a click on a rendered page', async () => {
        /**
         * render.js emits the same data-item-id attributes items.js gives the
         * canvas - one drawing path - so without a guard a click here would
         * select and drag the item underneath.
         */
        const d = await run(mount());
        const drawn = canvas().querySelector('[data-item-id]');

        expect(drawn).not.toBeNull();

        const event = new MouseEvent('pointerdown', {
            bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0
        });
        event.pointerId = 1;
        drawn.dispatchEvent(event);

        expect(d.selection).toBeNull();
    });

    it('does not nudge anything with the arrow keys', async () => {
        const d = mount();
        d.select({ band: 'detail', id: 'tbl' });
        const before = d.layout.bands.find(b => b.type === 'detail').items[0].x;

        await run(d);
        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowRight', bubbles: true, cancelable: true
        }));

        expect(d.layout.bands.find(b => b.type === 'detail').items[0].x)
            .toBe(before);
    });

    it('hides the rail and the tools', async () => {
        await run(mount());
        expect(root().dataset.mode).toBe('preview');
    });
});


describe('opening another report', () => {
    it('lands back in the design rather than in a stale preview', async () => {
        const d = await run(mount());

        d.open(json());
        expect(d.mode).toBe('design');
        expect(canvas().querySelector('.dz-sheet')).not.toBeNull();
    });
});


describe('one drawing path', () => {
    it('draws the same item ids either side of the toggle', async () => {
        /**
         * Spec 5.2: the canvas is the preview's drawing plus selection chrome.
         * If these two sets ever diverge, the design has stopped predicting the
         * print and the whole seam has failed.
         */
        const l = layout({
            bands: [
                band('reportHeader', [text('title', { value: 'Title' })], { height: 40 }),
                band('detail', [table({ id: 'tbl' })])
            ]
        });

        const d = mount({ l });
        const designed = [...canvas().querySelectorAll('[data-item-id]')]
            .map(n => n.dataset.itemId).sort();

        await run(d);
        const rendered = [...new Set([...canvas().querySelectorAll('[data-item-id]')]
            .map(n => n.dataset.itemId))].sort();

        expect(rendered).toEqual(designed);
    });

    it('draws a table with the same columns in both', async () => {
        /**
         * Distinct headers, because a grouped report repeats the column row
         * once per group fragment - which is the run showing something the
         * canvas cannot, not the two drawings disagreeing.
         */
        const d = mount();
        const heads = () => [...new Set([...canvas().querySelectorAll('th')]
            .map(n => n.textContent.trim()))];

        const designed = heads();
        await run(d);

        expect(heads()).toEqual(designed);
    });

    it('repeats the column header per group, which only the run knows', async () => {
        const d = await run(mount());
        const all = [...canvas().querySelectorAll('th')].map(n => n.textContent.trim());

        expect(all.length).toBeGreaterThan(new Set(all).size);
    });
});

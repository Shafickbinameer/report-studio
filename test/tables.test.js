/**
 * Several tables in one report, through the whole engine.
 *
 * Each table reads a dataset of its own and splits across pages on its own.
 * What makes that more than several copies of one table is what they share:
 * a band, so the lower one has to start wherever the upper one really ended;
 * the report's totals, so an aggregate has to say which dataset it means; and
 * one pair of group bands, so only one of them may be grouped.
 *
 * The validator's side is in validate.test.js.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { group } from '../src/engine/group.js';
import { resolve } from '../src/engine/resolve.js';
import { tablesOf, datasetOf, groupingOf } from '../src/engine/tables.js';
import { toCSV, toReportCSV, reportTables } from '../src/engine/csv.js';
import { render } from '../src/render/render.js';
import { sampleData } from '../src/designer/sample-data.js';
import {
    layout, table, text, band, rows, run, drawnBottom, footerTop, AVAILABLE_HEIGHT
} from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());


/** a table on a dataset of its own; table() is 116px tall as designed */
const on = (dataset, extra = {}) => ({ ...table(extra), dataset });

const twoTables = ({ firstY = 0, secondY = 140, footer = false, groupBands = [] } = {}) => layout({
    bands: [
        band('detail', [
            on('orders', { id: 'orders', y: firstY }),
            on('refunds', { id: 'refunds', y: secondY })
        ]),
        ...groupBands,
        ...(footer ? [band('pageFooter', [text('pf', { value: 'Page {page}' })], { height: 40 })] : [])
    ]
});

/** every slice of one table the engine placed, in page order */
function slices(built, id) {
    return built.pages.flatMap((page, index) => page.bands
        .flatMap(b => b.items)
        .filter(item => item.id === id)
        .map(item => ({ page: index + 1, item })));
}

const rowsOf = (built, id) => slices(built, id).flatMap(({ item }) =>
    item.row ?? item.groups.flatMap(g => g.rows));


describe('which tables a report has', () => {
    const json = layout({
        dataset: 'items',
        bands: [
            band('reportHeader', [table({ id: 'a' })], { height: 200 }),
            band('detail', [text('t'), { ...table({ id: 'b', y: 40 }), dataset: 'other' }])
        ]
    });

    it('lists them in band order', () => {
        expect(tablesOf(json).map(t => t.id)).toEqual(['a', 'b']);
    });

    it("reads a table's own dataset, and the report's when it names none", () => {
        const [a, b] = tablesOf(json);

        expect(datasetOf(b, json)).toBe('other');
        expect(datasetOf({ ...a, dataset: null }, json)).toBe('items');
        expect(datasetOf({ ...a, dataset: '' }, json)).toBe('items');
    });

    it('groups nothing when nothing asks to be grouped', () => {
        expect(groupingOf(json)).toBeNull();
    });

    /** every layout from before there could be two tables says it this way */
    it('reads a report-wide groupBy as the first table', () => {
        expect(groupingOf({ ...json, groupBy: 'name' }))
            .toEqual({ table: tablesOf(json)[0], by: 'name' });
    });

    it("prefers a table's own groupBy to the report's", () => {
        const own = structuredClone(json);
        own.bands[1].items[1].groupBy = 'qty';
        own.groupBy = 'name';

        expect(groupingOf(own)).toMatchObject({ by: 'qty', table: { id: 'b' } });
    });
});


describe('binding each table to its own rows', () => {
    it('gives each table the rows of its own dataset', () => {
        const built = run(twoTables(), { orders: rows(3, 'o'), refunds: rows(2, 'r') });

        expect(rowsOf(built, 'orders').map(r => r.name)).toEqual(['o-0', 'o-1', 'o-2']);
        expect(rowsOf(built, 'refunds').map(r => r.name)).toEqual(['r-0', 'r-1']);
    });

    it("falls back to the report's dataset for a table that names none", () => {
        const json = layout({
            bands: [band('detail', [
                { ...table({ id: 'a' }), dataset: null },
                on('extra', { id: 'b', y: 140 })
            ])]
        });

        const built = run(json, { items: rows(2), extra: rows(1, 'x') });

        expect(rowsOf(built, 'a')).toHaveLength(2);
        expect(rowsOf(built, 'b').map(r => r.name)).toEqual(['x-0']);
    });

    it('lets two tables read the same dataset', () => {
        const json = layout({
            bands: [band('detail', [table({ id: 'a' }), table({ id: 'b', y: 140 })])]
        });

        const built = run(json, { items: rows(2) });

        expect(rowsOf(built, 'a')).toEqual(rowsOf(built, 'b'));
    });

    it('names the table whose dataset is missing', () => {
        expect(() => run(twoTables(), { orders: rows(1) }))
            .toThrow(/table "refunds" is bound to dataset "refunds"/);
    });

    it('draws an empty table for an empty dataset, rather than refusing', () => {
        const built = run(twoTables(), { orders: rows(2), refunds: [] });

        expect(rowsOf(built, 'refunds')).toEqual([]);
        expect(slices(built, 'refunds')).toHaveLength(1);
    });
});


describe('stacking tables down the page', () => {
    /**
     * Designed 140px down, 24px under the upper table's designed bottom. That
     * gap is kept whatever the upper one's rows turn out to be.
     */
    const GAP = 140 - 116;

    it('moves the lower table down by however far the upper one grew', () => {
        const built = run(twoTables(), { orders: rows(10), refunds: rows(2) });
        const [upper] = slices(built, 'orders');
        const [lower] = slices(built, 'refunds');

        const upperBottom = upper.item.y + upper.item.measuredHeight;
        expect(lower.item.y).toBe(upperBottom + GAP);
    });

    it('moves it up when the upper table came out shorter than designed', () => {
        const built = run(twoTables(), { orders: rows(1), refunds: rows(2) });
        const [upper] = slices(built, 'orders');
        const [lower] = slices(built, 'refunds');

        expect(lower.item.y).toBe(upper.item.y + upper.item.measuredHeight + GAP);
    });

    /** the fault that stacking exists to prevent: rows printed over rows */
    it('never lets two tables overlap on a page', () => {
        const built = run(twoTables({ footer: true }),
            { orders: rows(45), refunds: rows(45) });

        for (const page of built.pages) {
            const placed = page.bands.flatMap(b => b.items)
                .filter(i => i.type === 'table')
                .sort((a, b) => a.y - b.y);

            for (let i = 1; i < placed.length; i++) {
                expect(placed[i].y).toBeGreaterThanOrEqual(
                    placed[i - 1].y + placed[i - 1].measuredHeight);
            }
        }
    });

    it('starts the lower table on the page the upper one ended on', () => {
        const built = run(twoTables({ footer: true }),
            { orders: rows(45), refunds: rows(3) });

        const lastOfUpper = slices(built, 'orders').at(-1).page;
        const firstOfLower = slices(built, 'refunds')[0].page;

        expect(lastOfUpper).toBeGreaterThan(1);
        expect(firstOfLower).toBe(lastOfUpper);
    });

    it('splits the lower table across pages too, placing every row once', () => {
        const built = run(twoTables({ footer: true }),
            { orders: rows(20), refunds: rows(60, 'r') });

        expect(slices(built, 'refunds').length).toBeGreaterThan(1);
        expect(rowsOf(built, 'refunds').map(r => r.name))
            .toEqual(rows(60, 'r').map(r => r.name));
    });

    it('keeps both tables clear of the page footer', () => {
        const built = run(twoTables({ footer: true }),
            { orders: rows(45), refunds: rows(45) });

        for (const page of built.pages) {
            for (const detail of page.bands.filter(b => b.type === 'detail')) {
                expect(detail.top + drawnBottom(detail)).toBeLessThanOrEqual(footerTop(page));
            }
        }
    });

    it('fills no more than the printable height with a lower table that just fits', () => {
        const built = run(twoTables(), { orders: rows(2), refunds: rows(20) });

        for (const detail of built.pages[0].bands.filter(b => b.type === 'detail')) {
            expect(drawnBottom(detail)).toBeLessThanOrEqual(AVAILABLE_HEIGHT);
        }
    });

    it('moves a text under both tables down with them', () => {
        const json = twoTables();
        json.bands[0].items.push(text('total', { y: 280, value: 'end' }));

        const built = run(json, { orders: rows(10), refunds: rows(10) });
        const lower = slices(built, 'refunds').at(-1).item;
        const total = built.pages.flatMap(p => p.bands).flatMap(b => b.items)
            .find(i => i.id === 'total');

        expect(total.y).toBeGreaterThanOrEqual(lower.y + lower.measuredHeight);
    });
});


describe('grouping one of several tables', () => {
    const groupBands = [
        band('groupHeader', [text('gh', { value: '{name}' })], { height: 20 }),
        band('groupFooter', [text('gf', { value: 'Subtotal {sum(qty)}' })], { height: 20 })
    ];

    const data = () => ({
        orders: rows(3, 'o'),
        refunds: [
            { name: 'North', qty: 1, price: 5 },
            { name: 'North', qty: 2, price: 5 },
            { name: 'South', qty: 4, price: 5 }
        ]
    });

    it('groups the table that asks, and leaves the other flat', () => {
        const json = twoTables({ groupBands });
        json.bands[0].items[1].groupBy = 'name';

        const bound = group(resolve(json, data()), data());
        const [orders, refunds] = tablesOf(bound);

        expect(orders.row).toHaveLength(3);
        expect(orders.groups).toBeUndefined();
        expect(refunds.groups.map(g => g.key)).toEqual(['North', 'South']);
    });

    it("totals each group of the grouped table over that group's rows", () => {
        const json = twoTables({ groupBands });
        json.bands[0].items[1].groupBy = 'name';

        const html = render(run(json, data()));

        expect(html).toContain('Subtotal 3');
        expect(html).toContain('Subtotal 4');
    });

    /** the grouped dataset named in full means the same group's rows */
    it('takes a group total that names the grouped dataset', () => {
        const json = twoTables({
            groupBands: [band('groupFooter', [text('gf', { value: 'Sub {sum(refunds.qty)}' })], { height: 20 })]
        });
        json.bands[0].items[1].groupBy = 'name';

        const html = render(run(json, data()));

        expect(html).toContain('Sub 3');
        expect(html).toContain('Sub 4');
    });

    it('still groups the first table from a report-wide groupBy', () => {
        const json = { ...twoTables({ groupBands }), groupBy: 'name' };

        const bound = group(resolve(json, data()), data());
        const [orders, refunds] = tablesOf(bound);

        expect(orders.groups).toHaveLength(3);
        expect(refunds.row).toHaveLength(3);
    });

    it('draws both on the page, the grouped one in fragments', () => {
        const json = twoTables({ groupBands, footer: true });
        json.bands[0].items[1].groupBy = 'name';

        const built = run(json, data());

        expect(rowsOf(built, 'orders')).toHaveLength(3);
        expect(rowsOf(built, 'refunds')).toHaveLength(3);
    });
});


describe('totals that name their dataset', () => {
    const withTotals = (value) => layout({
        bands: [
            band('detail', [
                on('orders', { id: 'orders' }),
                on('refunds', { id: 'refunds', y: 140 })
            ]),
            band('reportFooter', [text('sum', { value })], { height: 40 })
        ]
    });

    const data = {
        orders: [{ qty: 1 }, { qty: 2 }, { qty: 3 }],
        refunds: [{ qty: 10 }, { qty: 20 }],
        payments: [{ amount: 7 }, { amount: 8 }]
    };

    const printed = (value) => {
        const built = run(withTotals(value), data);
        return built.pages.flatMap(p => p.bands).flatMap(b => b.items)
            .find(i => i.id === 'sum').text;
    };

    it('sums the dataset it names', () => {
        expect(printed('{sum(orders.qty)} / {sum(refunds.qty)}')).toBe('6 / 30');
    });

    it('counts the dataset it names', () => {
        expect(printed('{count(orders)} and {count(refunds)}')).toBe('3 and 2');
    });

    /** what every expression written before there could be two tables meant */
    it('reads an unscoped total as the first table', () => {
        expect(printed('{sum(qty)} of {count()}')).toBe('6 of 3');
    });

    it('takes every aggregate, scoped', () => {
        expect(printed('{avg(refunds.qty)} {min(refunds.qty)} {max(refunds.qty)}'))
            .toBe('15 10 20');
    });

    /** a total of payments under an invoice that draws no table of them */
    it('totals a dataset no table draws', () => {
        expect(printed('{sum(payments.amount)}')).toBe('15');
    });

    it('does not read a dot as a dataset when the data has no such array', () => {
        expect(printed('{sum(nothing.qty)}')).toBe('');
    });
});


describe('exporting several tables', () => {
    const built = () => run(twoTables({ footer: true }),
        { orders: rows(40, 'o'), refunds: rows(3, 'r') });

    it('lists each table once, however many pages it ran over', () => {
        expect(reportTables(built().pages)).toEqual([
            { id: 'orders', columns: ['Item', 'Qty', 'Price'] },
            { id: 'refunds', columns: ['Item', 'Qty', 'Price'] }
        ]);
    });

    it('writes the first table when not told which', () => {
        const lines = toCSV(built().pages).split('\r\n');

        expect(lines).toHaveLength(41);
        expect(lines[1]).toMatch(/^o-0,/);
    });

    it('writes the table it is asked for', () => {
        const lines = toCSV(built().pages, { table: 'refunds' }).split('\r\n');

        expect(lines).toEqual(['Item,Qty,Price', 'r-0,0,0', 'r-1,1,10', 'r-2,2,20']);
    });

    it('writes nothing for a table the report does not have', () => {
        expect(toCSV(built().pages, { table: 'nope' })).toBe('');
    });

    it('writes both into the whole-report CSV, in the order they print', () => {
        const csv = toReportCSV(built().pages);

        expect(csv.indexOf('o-39')).toBeGreaterThan(-1);
        expect(csv.indexOf('r-0')).toBeGreaterThan(csv.indexOf('o-39'));
    });
});


describe('drawing several tables', () => {
    it('draws every table it placed', () => {
        const html = render(run(twoTables(), { orders: rows(2, 'o'), refunds: rows(2, 'r') }));

        expect(html).toContain('id="orders"');
        expect(html).toContain('id="refunds"');
        expect(html).toContain('o-1');
        expect(html).toContain('r-1');
    });
});


describe('sample data for several tables', () => {
    it('writes rows for each dataset', () => {
        const data = sampleData(twoTables());

        expect(data.orders).toHaveLength(6);
        expect(data.refunds).toHaveLength(6);
        expect(Object.keys(data.refunds[0])).toEqual(['name', 'qty', 'price']);
    });

    it('repeats the group field of the grouped table only', () => {
        const json = twoTables({ groupBands: [band('groupHeader', [], { height: 20 })] });
        json.bands[0].items[1].groupBy = 'name';

        const data = sampleData(json);

        expect(new Set(data.refunds.map(r => r.name)).size).toBe(2);
        expect(new Set(data.orders.map(r => r.name)).size).toBe(6);
    });

    it('writes rows for a dataset only a total names', () => {
        const json = twoTables();
        json.bands.push(band('reportFooter', [text('t', { value: '{sum(payments.amount)}' })]));

        const data = sampleData(json);

        expect(data.payments[0]).toHaveProperty('amount');
        expect(typeof data.payments[0].amount).toBe('number');
    });

    it('builds a report from its own sample data', () => {
        const json = twoTables({ footer: true });
        expect(() => run(json, sampleData(json))).not.toThrow();
    });
});

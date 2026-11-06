/**
 * More than one grouped table in a report.
 *
 * A table is grouped by a `grouping` of its own, which carries the field and
 * the bands its groups are drawn with:
 *
 *   { type: 'table', ..., grouping: [{ by: 'region', header: {...}, footer: {...} }] }
 *
 * The older form - `layout.groupBy` or `table.groupBy`, drawn with the report's
 * own groupHeader and groupFooter bands - still works, and is turned into the
 * new one before any stage past resolve.js sees it. What these specs hold the
 * engine to is that two grouped tables do not leak into each other: each is
 * split by its own field, drawn with its own bands, and totalled over its own
 * rows, on the page and across page breaks.
 *
 * The single-table cases are in group.test.js and paginate.test.js; tables that
 * are not grouped are in tables.test.js.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { group } from '../src/engine/group.js';
import { resolve } from '../src/engine/resolve.js';
import { measure } from '../src/engine/measure.js';
import { validateLayout } from '../src/engine/validate.js';
import {
    tablesOf, groupingsOf, groupingOf, groupBandsOf, isGrouped, normalizeGrouping
} from '../src/engine/tables.js';
import { toCSV, reportTables } from '../src/engine/csv.js';
import { toXLSX } from '../src/engine/xlsx.js';
import { render } from '../src/render/render.js';
import {
    layout, table, text, box, band, rows, run, drawnBottom, footerTop
} from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());


/** a group band as a table carries it: no type, which normalizeGrouping adds */
const groupBand = (items, height = 20) => ({ height, items });

/** a table on a dataset of its own */
const on = (dataset, extra = {}) => ({ ...table(extra), dataset });

/** orders by region, refunds by reason - two fields, two designs, two totals */
const ordersGrouping = (extra = {}) => [{
    by: 'region',
    header: groupBand([text('oh', { value: 'Region {region}' })]),
    footer: groupBand([text('of', { value: 'Orders {sum(qty)}' })]),
    ...extra
}];

const refundsGrouping = (extra = {}) => [{
    by: 'reason',
    header: groupBand([text('rh', { value: 'Reason {reason}' })]),
    footer: groupBand([text('rf', { value: 'Refunds {sum(price)}' })]),
    ...extra
}];

const twoGrouped = ({ orders = ordersGrouping(), refunds = refundsGrouping(), footer = false } = {}) =>
    layout({
        bands: [
            band('detail', [
                { ...on('orders', { id: 'orders', y: 0 }), grouping: orders },
                { ...on('refunds', { id: 'refunds', y: 140 }), grouping: refunds }
            ]),
            ...(footer ? [band('pageFooter', [text('pf', { value: 'Page {page}' })], { height: 40 })] : [])
        ]
    });

const data = () => ({
    orders: [
        { name: 'o1', qty: 1, price: 10, region: 'North' },
        { name: 'o2', qty: 2, price: 20, region: 'North' },
        { name: 'o3', qty: 5, price: 30, region: 'South' }
    ],
    refunds: [
        { name: 'r1', qty: 1, price: 7, reason: 'Damaged' },
        { name: 'r2', qty: 1, price: 4, reason: 'Late' },
        { name: 'r3', qty: 1, price: 9, reason: 'Damaged' }
    ]
});

/** many rows, cycling through the given group keys on `field` */
const many = (n, prefix, field, keys) => rows(n, prefix)
    .map((row, i) => ({ ...row, [field]: keys[i % keys.length] }));

/** every slice of one table the engine placed, in page order */
const slices = (built, id) => built.pages.flatMap(page => page.bands
    .flatMap(b => b.items)
    .filter(item => item.id === id));

const fragmentsOf = (built, id) => slices(built, id).flatMap(item => item.groups);

const textOf = (band) => band?.items.map(i => i.text).join(' ');

/** the bound tables, after resolve and group */
const bound = (json, payload = data()) => {
    const [orders, refunds] = tablesOf(group(resolve(json, payload), payload));
    return { orders, refunds };
};


describe('normalizeGrouping - one shape for every stage after it', () => {
    const legacy = () => layout({
        groupBy: 'name',
        bands: [
            band('groupHeader', [text('gh', { value: '{name}' })], { height: 22 }),
            band('detail', [table()]),
            band('groupFooter', [text('gf', { value: '{sum(price)}' })], { height: 18 })
        ]
    });

    it("moves a report-wide groupBy and the report's group bands onto the first table", () => {
        const out = normalizeGrouping(legacy());
        const [tbl] = tablesOf(out);

        expect(tbl.grouping).toHaveLength(1);
        expect(tbl.grouping[0].by).toBe('name');
        expect(tbl.grouping[0].header).toMatchObject({ type: 'groupHeader', height: 22 });
        expect(tbl.grouping[0].footer).toMatchObject({ type: 'groupFooter', height: 18 });
    });

    it('leaves no groupBy and no report-level group band behind', () => {
        const out = normalizeGrouping(legacy());

        expect(out).not.toHaveProperty('groupBy');
        expect(out.bands.map(b => b.type)).toEqual(['detail']);
        expect(tablesOf(out)[0]).not.toHaveProperty('groupBy');
    });

    it("turns a table's own groupBy into its grouping", () => {
        const json = layout({
            bands: [
                band('detail', [table({ id: 'a' }), { ...table({ id: 'b', y: 140 }), groupBy: 'qty' }]),
                band('groupFooter', [text('gf', { value: '{sum(price)}' })])
            ]
        });

        const [a, b] = tablesOf(normalizeGrouping(json));

        expect(a.grouping).toBeUndefined();
        expect(b.grouping[0].by).toBe('qty');
        expect(b.grouping[0].header).toBeNull();
        expect(b.grouping[0].footer.type).toBe('groupFooter');
    });

    it("keeps a table's own grouping, only stamping its bands' types", () => {
        const [orders, refunds] = tablesOf(normalizeGrouping(twoGrouped()));

        expect(orders.grouping[0].by).toBe('region');
        expect(orders.grouping[0].header.type).toBe('groupHeader');
        expect(orders.grouping[0].footer.type).toBe('groupFooter');
        expect(refunds.grouping[0].by).toBe('reason');
    });

    it('drops a group band nothing is grouped by, which nothing ever drew', () => {
        const json = layout({
            bands: [band('detail', [table()]), band('groupHeader', [], { height: 20 })]
        });

        expect(normalizeGrouping(json).bands.map(b => b.type)).toEqual(['detail']);
    });

    it('is idempotent', () => {
        const once = normalizeGrouping(legacy());
        expect(normalizeGrouping(once)).toEqual(once);
    });

    it('leaves the layout it was given alone', () => {
        const json = legacy();
        const before = structuredClone(json);

        normalizeGrouping(json);

        expect(json).toEqual(before);
    });
});


describe('which tables are grouped', () => {
    it('lists every grouped table, in table order', () => {
        const found = groupingsOf(twoGrouped());

        expect(found.map(g => [g.table.id, g.by])).toEqual([['orders', 'region'], ['refunds', 'reason']]);
        expect(groupingOf(twoGrouped()).table.id).toBe('orders');
    });

    it('reads a table grouped the older way beside one grouped the new way', () => {
        const json = layout({
            bands: [
                band('detail', [
                    { ...on('orders', { id: 'orders' }), groupBy: 'region' },
                    { ...on('refunds', { id: 'refunds', y: 140 }), grouping: refundsGrouping() }
                ]),
                band('groupHeader', [text('gh', { value: '{region}' })])
            ]
        });

        const found = groupingsOf(json);

        expect(found.map(g => [g.table.id, g.by])).toEqual([['orders', 'region'], ['refunds', 'reason']]);
        expect(found[0].header.type).toBe('groupHeader');
        expect(found[1].header.items[0].id).toBe('rh');
    });

    it('tells a grouped table either way, and an ungrouped one', () => {
        expect(isGrouped({ groupBy: 'x' })).toBe(true);
        expect(isGrouped({ grouping: [{ by: 'x' }] })).toBe(true);
        expect(isGrouped({ grouping: [] })).toBe(false);
        expect(isGrouped({})).toBe(false);
    });

    it("gives a table's first level's bands, and nulls for an ungrouped table", () => {
        const [orders] = tablesOf(twoGrouped());

        expect(groupBandsOf(orders).header.items[0].id).toBe('oh');
        expect(groupBandsOf({})).toEqual({ header: null, footer: null });
    });
});


describe('grouping several tables', () => {
    it('splits each table by its own field', () => {
        const { orders, refunds } = bound(twoGrouped());

        expect(orders.groups.map(g => g.key)).toEqual(['North', 'South']);
        expect(refunds.groups.map(g => g.key)).toEqual(['Damaged', 'Late']);
    });

    it("totals each table's groups over that table's own rows", () => {
        const { orders, refunds } = bound(twoGrouped());

        expect(orders.groups.map(g => g.aggregates.qty.sum)).toEqual([3, 5]);
        expect(refunds.groups.map(g => g.aggregates.price.sum)).toEqual([16, 4]);
    });

    it("works out only what a table's own bands ask for", () => {
        const { orders, refunds } = bound(twoGrouped());

        /** {sum(price)} is in the refunds footer, not the orders one */
        expect(orders.groups[0].aggregates).not.toHaveProperty('price');
        expect(refunds.groups[0].aggregates).not.toHaveProperty('qty');
    });

    it("draws each table's groups with its own header and footer", () => {
        const html = render(run(twoGrouped(), data()));

        for (const expected of [
            'Region North', 'Region South', 'Orders 3', 'Orders 5',
            'Reason Damaged', 'Reason Late', 'Refunds 16', 'Refunds 4'
        ]) {
            expect(html).toContain(expected);
        }

        expect(html).not.toContain('Region Damaged');
        expect(html).not.toContain('Reason North');
    });

    it('lets one table have only a header and another only a footer', () => {
        const json = twoGrouped({
            orders: ordersGrouping({ footer: null }),
            refunds: refundsGrouping({ header: null })
        });

        const built = run(json, data());
        const orders = fragmentsOf(built, 'orders');
        const refunds = fragmentsOf(built, 'refunds');

        expect(orders.every(f => f.headerBand && !f.footerBand)).toBe(true);
        expect(refunds.every(f => !f.headerBand && f.footerBand)).toBe(true);
        expect(textOf(refunds[0].footerBand)).toBe('Refunds 16');
    });

    it('takes a group total that names its own dataset', () => {
        const json = twoGrouped({
            refunds: refundsGrouping({
                footer: groupBand([text('rf', { value: 'Sub {sum(refunds.price)}' })])
            })
        });

        const html = render(run(json, data()));

        expect(html).toContain('Sub 16');
        expect(html).toContain('Sub 4');
    });

    it('resolves root data in a table group band, as in any other band', () => {
        const json = twoGrouped({
            orders: ordersGrouping({
                header: groupBand([text('oh', { value: '{region} for {customer}' })])
            })
        });

        const html = render(run(json, { ...data(), customer: 'ACME' }));

        expect(html).toContain('North for ACME');
    });
});


describe('sizing several grouped tables', () => {
    it("reserves each table's own group band heights", () => {
        const json = twoGrouped({
            orders: ordersGrouping({
                header: groupBand([text('oh', { h: 20, value: '{region}' })], 20),
                footer: groupBand([text('of', { h: 20, value: '{sum(qty)}' })], 20)
            }),
            refunds: refundsGrouping({
                header: groupBand([text('rh', { h: 50, value: '{reason}' })], 50),
                footer: null
            })
        });

        const payload = data();
        const measured = measure(group(resolve(json, payload), payload));
        const [orders, refunds] = tablesOf(measured);

        /** per group: table header 32 + group bands + rows x 28 */
        expect(orders.measuredHeight).toBe((32 + 20 + 2 * 28 + 20) + (32 + 20 + 1 * 28 + 20));
        expect(refunds.measuredHeight).toBe((32 + 50 + 2 * 28) + (32 + 50 + 1 * 28));
    });

    it('counts a group band item that is taller than its text', () => {
        const json = twoGrouped({
            orders: ordersGrouping({
                header: groupBand([box('frame', { h: 44 })], 20),
                footer: null
            })
        });

        const payload = data();
        const [orders] = tablesOf(measure(group(resolve(json, payload), payload)));

        expect(orders.measuredHeight).toBe((32 + 44 + 2 * 28) + (32 + 44 + 1 * 28));
    });
});


describe('several grouped tables across page breaks', () => {
    const big = () => ({
        orders: many(70, 'o', 'region', ['North', 'South', 'East']),
        refunds: many(70, 'r', 'reason', ['Damaged', 'Late'])
    });

    const built = () => run(twoGrouped({ footer: true }), big());

    it('places every row of each table once, in order within its group', () => {
        const out = built();

        for (const [id, field] of [['orders', 'region'], ['refunds', 'reason']]) {
            const placed = fragmentsOf(out, id).flatMap(f => f.rows);
            /** first-seen group order, rows in data order within each */
            const keys = [...new Set(big()[id].map(r => r[field]))];
            const expected = keys.flatMap(key => big()[id].filter(r => r[field] === key));

            expect(placed.map(r => r.name)).toEqual(expected.map(r => r.name));
        }
    });

    it('splits both tables over more than one page', () => {
        const out = built();

        expect(new Set(out.pages.filter(p => p.bands.some(b =>
            b.items.some(i => i.id === 'refunds'))).map(p => p.pageNO)).size).toBeGreaterThan(1);
        expect(slices(out, 'orders').length).toBeGreaterThan(1);
    });

    it("draws every fragment with its own table's bands", () => {
        const out = built();

        for (const f of fragmentsOf(out, 'orders')) {
            expect(textOf(f.headerBand)).toBe(`Region ${f.key}`);
        }

        for (const f of fragmentsOf(out, 'refunds')) {
            expect(textOf(f.headerBand)).toBe(`Reason ${f.key}`);
        }
    });

    it('prints each group footer once, on the fragment that ends the group', () => {
        const out = built();

        for (const [id, groups] of [['orders', 3], ['refunds', 2]]) {
            const footers = fragmentsOf(out, id).filter(f => f.showFooter);

            expect(footers).toHaveLength(groups);
            expect(footers.every(f => f.footerBand)).toBe(true);
        }
    });

    it('keeps both tables clear of the page footer', () => {
        const out = built();

        for (const page of out.pages) {
            for (const detail of page.bands.filter(b => b.type === 'detail')) {
                expect(detail.top + drawnBottom(detail)).toBeLessThanOrEqual(footerTop(page));
            }
        }
    });
});


describe('the older form still builds the same report', () => {
    it('gives the same pages as the same report written the new way', () => {
        const header = [text('gh', { value: 'Group {name}' })];
        const footer = [text('gf', { value: 'Sub {sum(price)}' })];

        const older = layout({
            groupBy: 'name',
            bands: [
                band('groupHeader', header, { height: 24 }),
                band('detail', [table()]),
                band('groupFooter', footer, { height: 20 }),
                band('pageFooter', [text('pf', { value: 'Page {page} of {totalPages}' })], { height: 40 })
            ]
        });

        const newer = layout({
            bands: [
                band('detail', [{
                    ...table(),
                    grouping: [{
                        by: 'name',
                        header: band('groupHeader', structuredClone(header), { height: 24 }),
                        footer: band('groupFooter', structuredClone(footer), { height: 20 })
                    }]
                }]),
                band('pageFooter', [text('pf', { value: 'Page {page} of {totalPages}' })], { height: 40 })
            ]
        });

        const payload = { items: many(90, 'row', 'name', ['A', 'B', 'C', 'D']) };

        expect(run(newer, payload)).toEqual(run(older, payload));
    });
});


describe('exporting several grouped tables', () => {
    it('lists both tables once each', () => {
        expect(reportTables(run(twoGrouped(), data()).pages).map(t => t.id))
            .toEqual(['orders', 'refunds']);
    });

    it("writes each table's own group key in the group column", () => {
        const pages = run(twoGrouped(), data()).pages;

        const refunds = toCSV(pages, { table: 'refunds' }).split('\r\n');
        const orders = toCSV(pages, { table: 'orders' }).split('\r\n');

        expect(refunds[0].startsWith('Group,')).toBe(true);
        expect(refunds.slice(1).map(line => line.split(',')[0]))
            .toEqual(['Damaged', 'Damaged', 'Late']);
        expect(orders.slice(1).map(line => line.split(',')[0]))
            .toEqual(['North', 'North', 'South']);
    });

    it('writes a workbook', () => {
        expect(() => toXLSX(run(twoGrouped(), data()).pages)).not.toThrow();
    });
});


describe('validating grouping on a table', () => {
    const withGrouping = (grouping, extra = {}) => layout({
        bands: [band('detail', [{ ...table({ id: 't' }), grouping, ...extra }])]
    });

    it('accepts two tables, each grouped by a grouping of its own', () => {
        expect(validateLayout(twoGrouped())).toEqual([]);
    });

    it('accepts one table grouped the older way beside one grouped the new way', () => {
        const json = layout({
            bands: [
                band('detail', [
                    { ...on('orders', { id: 'orders' }), groupBy: 'region' },
                    { ...on('refunds', { id: 'refunds', y: 140 }), grouping: refundsGrouping() }
                ]),
                band('groupHeader', [text('gh', { value: '{region}' })])
            ]
        });

        expect(validateLayout(json)).toEqual([]);
    });

    it('accepts an empty grouping as not grouped', () => {
        expect(validateLayout(withGrouping([]))).toEqual([]);
    });

    it('refuses a grouping that is not a list', () => {
        expect(validateLayout(withGrouping({ by: 'name' })))
            .toEqual(['table "t".grouping must be a list of group levels, or null']);
    });

    it('accepts a second level, grouping within the groups of the first', () => {
        expect(validateLayout(withGrouping([...ordersGrouping(), ...refundsGrouping()])))
            .toEqual([]);
    });

    it('refuses two levels grouped by the same field', () => {
        expect(validateLayout(withGrouping([...ordersGrouping(), ...ordersGrouping()])))
            .toEqual(['table "t".grouping[1] groups by "region" again, as table "t".grouping[0] ' +
                'already does; group each level by a different field']);
    });

    it('refuses a level with no field to group by', () => {
        expect(validateLayout(withGrouping(ordersGrouping({ by: '' }))))
            .toEqual(['table "t".grouping[0].by must be the name of the field to group by']);
    });

    it('refuses a level with neither a header nor a footer', () => {
        expect(validateLayout(withGrouping([{ by: 'region', header: null, footer: null }])))
            .toEqual(['table "t".grouping[0] has neither a header nor a footer to show its groups']);
    });

    it('refuses a group band without items', () => {
        expect(validateLayout(withGrouping(ordersGrouping({ header: { height: 20 } }))))
            .toEqual(['table "t".grouping[0].header.items must be an array']);
    });

    it('refuses a group band height that is not a number of pixels', () => {
        expect(validateLayout(withGrouping(ordersGrouping({ footer: groupBand([], '10%') }))))
            .toEqual(['table "t".grouping[0].footer.height must be a number of pixels']);
    });

    it('checks the items of a group band, naming where they are', () => {
        const issues = validateLayout(withGrouping(ordersGrouping({
            header: groupBand([{ id: 'bad', type: 'text' }])
        })));

        expect(issues).toEqual(['table "t".grouping[0].header.items[0].value must be a string']);
    });

    it('refuses a table inside a group band', () => {
        const issues = validateLayout(withGrouping(ordersGrouping({
            header: groupBand([table({ id: 'inner' })])
        })));

        expect(issues).toEqual(['table "t".grouping[0].header.items[0] is a table; a group band cannot hold one']);
    });

    it('refuses a table grouped both by groupBy and by grouping', () => {
        const issues = validateLayout(withGrouping(ordersGrouping(), { groupBy: 'name' }));

        expect(issues.some(i => /grouped both by groupBy and by grouping/.test(i))).toBe(true);
    });

    it('refuses a report-wide groupBy aimed at a first table that has a grouping', () => {
        const json = { ...withGrouping(ordersGrouping()), groupBy: 'name' };
        json.bands.push(band('groupHeader', []));

        const issues = validateLayout(json);

        expect(issues).toEqual([
            'layout.groupBy groups the first table, "t", which already has a grouping of its own; remove one of the two'
        ]);
    });
});

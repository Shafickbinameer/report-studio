/**
 * Working out what data a report is asking for.
 *
 * The point of this file is a single claim, specified at the bottom: a payload
 * derived from a layout runs through the whole engine and leaves no placeholder
 * unresolved. Everything above it is the reasoning that gets there.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    requiredKeys, datasets, sampleData, summedFields
} from '../src/designer/sample-data.js';
import { buildPages } from '../src/engine/index.js';
import { render } from '../src/render/render.js';
import { blankLayout } from '../src/designer/blank.js';
import { layout, text, table, band } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());

const keys = (l) => requiredKeys(l);
const sets = (l) => Object.fromEntries(
    [...datasets(l)].map(([name, fields]) => [name, [...fields].sort()]));


describe('which placeholders come from the data', () => {
    const withValue = (value, type = 'reportHeader') =>
        layout({ bands: [band(type, [text('t', { value })])] });

    it('asks for a plain key in a page band', () => {
        expect(keys(withValue('Hello {title}')).root).toEqual(['title']);
    });

    it('asks for a nested path', () => {
        expect(keys(withValue('{customer.name}')).root).toEqual(['customer.name']);
    });

    it('finds several in one string', () => {
        expect(keys(withValue('{a} and {b}')).root.sort()).toEqual(['a', 'b']);
    });

    it('does not ask for what the engine answers itself', () => {
        /**
         * Page numbers are paginate.js's, aggregates are group.js's, and today
         * is the clock's. Asking the user for them is how such a file becomes
         * worse than none.
         */
        const l = withValue('Page {page} of {totalPages}, {today}, {sum(amount)}, {count()}');

        expect(keys(l).root).toEqual([]);
        expect(keys(l).row).toEqual([]);
    });

    it('de-duplicates a key used twice', () => {
        const l = layout({
            bands: [
                band('reportHeader', [text('a', { value: '{title}' })]),
                band('pageHeader', [text('b', { value: '{title}' })])
            ]
        });

        expect(keys(l).root).toEqual(['title']);
    });

    it('ignores a table, which has columns rather than placeholders', () => {
        expect(keys(layout({ bands: [band('detail', [table()])] })).root).toEqual([]);
    });
});


describe('root keys against row fields', () => {
    it('reads a bare key in a detail band as a root key', () => {
        /**
         * Not what spec 3.4's table says - it calls a bare `{field}` "the
         * current row, else root data" in any band - but it is what resolve.js
         * does: only the group bands defer, and every other band looks its keys
         * up in the root payload.
         *
         * The engine is the thing that runs. Saying otherwise put `{name}` from
         * a detail band into the rows of a sample data file, where the engine
         * never looked for it, and the report printed "Name:" and nothing after.
         */
        const l = layout({ bands: [band('detail', [text('t', { value: '{region}' })])] });

        expect(keys(l).root).toEqual(['region']);
        expect(keys(l).row).toEqual([]);
    });

    it('reads one in a group band the same way', () => {
        const l = layout({
            bands: [band('groupHeader', [text('t', { value: '{region}' })])]
        });

        expect(keys(l).row).toEqual(['region']);
    });

    it('reads a dotted path as the root wherever it appears', () => {
        /**
         * `{customer.name}` in a detail band is still the customer, not a
         * column called "customer.name".
         */
        const l = layout({
            bands: [band('detail', [text('t', { value: '{customer.name}' })])]
        });

        expect(keys(l).root).toEqual(['customer.name']);
        expect(keys(l).row).toEqual([]);
    });

    it('reads a bare key in a page band as the root', () => {
        const l = layout({
            bands: [band('pageFooter', [text('t', { value: '{title}' })])]
        });

        expect(keys(l).root).toEqual(['title']);
    });
});


describe('datasets', () => {
    it('names the dataset the report drives rows from', () => {
        expect(Object.keys(sets(layout({ bands: [band('detail', [table()])] }))))
            .toEqual(['items']);
    });

    it('takes the fields from the table columns', () => {
        expect(sets(layout({ bands: [band('detail', [table()])] })).items)
            .toEqual(['name', 'price', 'qty']);
    });

    it('includes the field the report groups by', () => {
        const l = layout({ groupBy: 'region', bands: [band('detail', [table()])] });
        expect(sets(l).items).toContain('region');
    });

    it('includes a row placeholder no column covers', () => {
        const l = layout({
            bands: [
                band('detail', [table()]),
                band('groupFooter', [text('t', { value: '{rep}' })])
            ]
        });

        expect(sets(l).items).toContain('rep');
    });

    it('keeps two tables over two datasets apart', () => {
        /** a table names its own dataset and falls back to the report's */
        const other = table({ id: 'tbl2' });
        other.dataset = 'payments';
        other.columns = [{ field: 'paid', label: 'Paid', width: 100, align: 'right' }];

        const l = layout({ bands: [band('detail', [table(), other])] });

        expect(sets(l)).toEqual({
            items: ['name', 'price', 'qty'],
            payments: ['paid']
        });
    });

    it('has no dataset for a report that never asks for a row', () => {
        const l = layout({
            bands: [band('reportHeader', [text('t', { value: '{title}' })])]
        });

        expect(sets(l)).toEqual({});
    });
});


describe('the payload', () => {
    const l = () => layout({
        groupBy: 'region',
        bands: [
            band('reportHeader', [text('h', { value: '{report.period}' })]),
            band('detail', [table()])
        ]
    });

    it('builds the nested shape a dotted path needs', () => {
        expect(sampleData(l()).report).toEqual({ period: expect.any(String) });
    });

    it('gives the dataset an array of rows', () => {
        expect(Array.isArray(sampleData(l()).items)).toBe(true);
        expect(sampleData(l()).items.length).toBeGreaterThan(1);
    });

    it('gives every row every field', () => {
        for (const row of sampleData(l()).items) {
            expect(Object.keys(row).sort())
                .toEqual(['name', 'price', 'qty', 'region']);
        }
    });

    it('repeats the grouping value, so a group break is visible', () => {
        /** every row its own group shows nothing about how grouping looks */
        const regions = new Set(sampleData(l()).items.map(r => r.region));

        expect(regions.size).toBeGreaterThan(1);
        expect(regions.size).toBeLessThan(sampleData(l()).items.length);
    });

    it('gives a numeric-sounding field a number', () => {
        /**
         * A payload of "string" everywhere shows the shape but not whether the
         * right column was picked, and a report full of the word "string" is
         * not worth previewing.
         */
        for (const row of sampleData(l()).items) {
            expect(typeof row.price).toBe('number');
            expect(typeof row.name).toBe('string');
        }
    });

    it('gives a date field a date', () => {
        const dated = layout({
            bands: [band('detail', [table()])]
        });
        dated.bands[0].items[0].columns = [
            { field: 'date', label: 'Date', width: 100, align: 'left' }
        ];

        expect(sampleData(dated).items[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('does not move with the clock, so the file diffs quietly', () => {
        expect(JSON.stringify(sampleData(l())))
            .toBe(JSON.stringify(sampleData(l())));
    });

    it('is empty for a report that asks for nothing', () => {
        expect(sampleData(blankLayout())).toEqual({});
    });

    it('survives a layout that is not valid yet', () => {
        expect(() => sampleData({ bands: 'nope' })).not.toThrow();
        expect(() => sampleData({})).not.toThrow();
    });
});


describe('the whole point', () => {
    const full = () => layout({
        groupBy: 'region',
        bands: [
            band('reportHeader', [
                text('title', { value: 'SALES for {report.period}' }),
                text('cur', { value: 'in {report.currency}, run {today}' })
            ], { height: 60 }),
            band('pageHeader', [text('ph', { value: '{report.period}' })], { height: 24 }),
            band('groupHeader', [text('gh', { value: 'Region: {region}' })], { height: 30 }),
            band('detail', [table()]),
            band('groupFooter', [
                text('gf', { value: '{count()} rows, {sum(price)}' })
            ], { height: 30 }),
            band('pageFooter', [
                text('pf', { value: 'Page {page} of {totalPages}' })
            ], { height: 24 })
        ]
    });

    it('produces a payload the engine resolves completely', () => {
        /**
         * The claim the whole file exists for. If a placeholder survives into
         * the rendered page, the data file did not answer the question the
         * layout was asking - and the user would have found that out by reading
         * console warnings, which is what this replaces.
         */
        const warnings = [];
        vi.spyOn(console, 'warn').mockImplementation(m => warnings.push(String(m)));

        const json = full();
        const html = render(buildPages(json, sampleData(json)));

        expect(warnings.filter(w => /Unresolved placeholder/.test(w))).toEqual([]);
        expect(html.match(/\{[a-zA-Z][^}<]*\}/g)).toBeNull();
    });

    it('fills the aggregates the engine owns, from the rows it supplied', () => {
        const json = full();
        const html = render(buildPages(json, sampleData(json)));

        expect(html).toMatch(/\d+ rows/);
    });

    it('shows a group break on the page', () => {
        const json = full();
        const html = render(buildPages(json, sampleData(json)));

        expect(html).toContain('Region: North');
        expect(html).toContain('Region: South');
    });
});


describe('a field the report takes a sum of is a number', () => {
    /**
     * `amt` is not a name the heuristic recognises, so it used to get the word
     * "Amt 1" - and {sum(amt)} over six words is not a number, so the total the
     * whole report was designed around previewed blank. The layout has already
     * said what the field is: you do not sum a word.
     */
    const withTotal = (value) => layout({
        bands: [
            band('detail', [
                {
                    id: 'tbl', type: 'table', x: 0, y: 0, w: 714,
                    dataset: 'items', rowHeight: 24, headerHeight: 28,
                    showHeader: true,
                    columns: [{ field: 'charge', label: 'Charge', width: 200, align: 'right' }],
                    style: { fontSize: 12, color: '#000000', borderColor: '#ccc' }
                },
                text('total', { y: 200, value })
            ])
        ]
    });

    it('finds the fields an aggregate is taken over', () => {
        expect([...summedFields(withTotal('Total: {sum(charge)} of {max(charge)}'))])
            .toEqual(['charge']);
    });

    it('ignores count(), which names no field', () => {
        expect([...summedFields(withTotal('{count()} rows'))]).toEqual([]);
    });

    it('has nothing to find in a layout with no bands', () => {
        expect([...summedFields({})]).toEqual([]);
        expect([...summedFields(null)]).toEqual([]);
    });

    it('gives that field numbers, whatever it is called', () => {
        const json = withTotal('Total: {sum(charge)}');

        for (const row of sampleData(json).items) {
            expect(typeof row.charge).toBe('number');
        }
    });

    it('prints a total rather than a blank', () => {
        const json = withTotal('Total: {sum(charge)}');
        const html = render(buildPages(json, sampleData(json)));

        expect(html).toMatch(/Total: \d+/);
    });

    it('leaves a field nobody sums as its own name', () => {
        const json = withTotal('{count()} rows');

        expect(typeof sampleData(json).items[0].charge).toBe('string');
    });

    it('still reads a number off a name that plainly is one', () => {
        /** the heuristic is not replaced by the aggregate rule, only added to */
        const json = layout({
            bands: [band('detail', [text('t', { value: '{amt} {price}' })])]
        });

        expect(typeof sampleData(json).amt).toBe('number');
    });
});

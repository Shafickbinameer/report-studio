import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { group } from '../src/engine/group.js';
import { resolve } from '../src/engine/resolve.js';
import { layout, text, table, band, rows, groupedRows } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());

const grouped = (footerItems, data, groupBy = 'name') => {
    const json = layout({
        groupBy,
        bands: [band('detail', [table()]), band('groupFooter', footerItems)]
    });
    const out = group(resolve(json, data), data);
    return {
        table: out.bands.find(b => b.type === 'detail').items[0],
        footer: out.bands.find(b => b.type === 'groupFooter')
    };
};

describe('group - partitioning', () => {
    it('splits rows by the groupBy field', () => {
        const data = { items: groupedRows(['A', 'B', 'C'], 4) };
        const { table: tbl } = grouped([text('gf', { value: '{sum(price)}' })], data);

        expect(tbl.groups.map(g => g.key)).toEqual(['A', 'B', 'C']);
        expect(tbl.groups.map(g => g.rows.length)).toEqual([4, 4, 4]);
    });

    it('assigns rows to the ungrouped table when groupBy is null', () => {
        const json = layout({ bands: [band('detail', [table()])] });
        const data = { items: rows(5) };
        const out = group(resolve(json, data), data);

        expect(out.bands[0].items[0].row).toHaveLength(5);
        expect(out.bands[0].items[0].groups).toBeUndefined();
    });
});

describe('group - aggregates', () => {
    it('keeps each group separate', () => {
        const data = {
            items: [
                { name: 'A', qty: 1, price: 10 },
                { name: 'A', qty: 1, price: 10 },
                { name: 'B', qty: 1, price: 100 }
            ]
        };
        const { table: tbl } = grouped([text('gf', { value: '{sum(price)}' })], data);

        expect(tbl.groups[0].aggregates.price.sum).toBe(20);
        expect(tbl.groups[1].aggregates.price.sum).toBe(100);
    });

    it('keeps each field separate within a group', () => {
        const data = { items: [{ name: 'A', qty: 7, price: 10 }] };
        const { table: tbl } = grouped([
            text('gf_price', { value: '{sum(price)}' }),
            text('gf_qty', { value: '{sum(qty)}' })
        ], data);

        expect(tbl.groups[0].aggregates.price.sum).toBe(10);
        expect(tbl.groups[0].aggregates.qty.sum).toBe(7);
    });

    it('keeps each function separate within a field', () => {
        const data = {
            items: [
                { name: 'A', qty: 1, price: 10 },
                { name: 'A', qty: 1, price: 30 }
            ]
        };
        const { table: tbl } = grouped([
            text('gf_sum', { value: '{sum(price)}' }),
            text('gf_max', { value: '{max(price)}' }),
            text('gf_min', { value: '{min(price)}' }),
            text('gf_avg', { value: '{avg(price)}' })
        ], data);

        expect(tbl.groups[0].aggregates.price).toMatchObject({
            sum: 40, max: 30, min: 10, avg: 20
        });
    });

    it('gives a group with no matching expression an empty slot, not undefined', () => {
        const data = { items: groupedRows(['A', 'B'], 2) };
        const { table: tbl } = grouped([text('gf', { value: 'Subtotal' })], data);

        for (const g of tbl.groups) expect(g.aggregates).toEqual({});
    });

    it('tolerates a plain label alongside an aggregate in the group footer', () => {
        const data = { items: groupedRows(['A'], 2) };

        expect(() => grouped([
            text('gf_label', { value: 'Subtotal' }),
            text('gf_sum', { value: '{sum(price)}' })
        ], data)).not.toThrow();
    });

    it('does not overwrite group footers with report-wide totals', () => {
        const data = {
            items: [
                { name: 'A', qty: 1, price: 10 },
                { name: 'B', qty: 1, price: 990 }
            ]
        };
        const { table: tbl } = grouped([text('gf', { value: '{sum(price)}' })], data);

        expect(tbl.groups[0].aggregates.price.sum).toBe(10);
        expect(tbl.groups[1].aggregates.price.sum).toBe(990);
    });
});

describe('group - layouts without a table', () => {
    it('passes a text-only report through', () => {
        const json = layout({ bands: [band('detail', [text('only')])] });
        const out = group(resolve(json, { items: [] }), { items: [] });

        expect(out.bands[0].items[0].text).toBe('only');
    });

    it('refuses to group when there is no table', () => {
        const json = layout({
            groupBy: 'name',
            bands: [band('detail', [text('only')]), band('groupFooter', [text('gf')])]
        });
        expect(() => group(resolve(json, { items: [] }), { items: [] }))
            .toThrow(/no band contains a table/);
    });

    it('names a dataset that is missing from the data', () => {
        const json = layout({ bands: [band('detail', [table()])] });
        expect(() => group(resolve(json, {}), {}))
            .toThrow(/bound to dataset "items", which is not present/);
    });
});

describe('group - report footer aggregates', () => {
    const reportFooter = (value, data) => {
        const json = layout({
            bands: [band('detail', [table()]), band('reportFooter', [text('rf', { value })])]
        });
        const out = group(resolve(json, data), data);
        return out.bands[1].items[0].text;
    };

    it('keeps the literal text around the placeholder', () => {
        const data = { items: [{ name: 'a', qty: 1, price: 10 }, { name: 'b', qty: 1, price: 5 }] };
        expect(reportFooter('Total: {sum(price)} across {count()} items', data))
            .toBe('Total: 15 across 2 items');
    });

    it('resolves several aggregates in one value', () => {
        const data = { items: [{ name: 'a', qty: 2, price: 10 }, { name: 'b', qty: 4, price: 20 }] };
        expect(reportFooter('{min(price)}-{max(price)} avg {avg(qty)}', data))
            .toBe('10-20 avg 3');
    });

    it('does not print floating point artefacts', () => {
        const data = { items: [{ name: 'a', price: 0.1 }, { name: 'b', price: 0.2 }] };
        expect(reportFooter('{sum(price)}', data)).toBe('0.3');
    });

    it('renders an aggregate over no rows as empty, not NaN or Infinity', () => {
        const data = { items: [] };
        expect(reportFooter('[{sum(price)}][{avg(price)}][{min(price)}][{max(price)}]', data))
            .toBe('[][][][]');
        expect(reportFooter('{count()}', data)).toBe('0');
    });

    it('skips non-numeric cells rather than counting them as zero', () => {
        const data = { items: [{ name: 'a', price: 10 }, { name: 'b', price: '' }, { name: 'c', price: 20 }] };
        expect(reportFooter('{avg(price)}', data)).toBe('15');
    });

    it('keeps data placeholders resolved alongside aggregates', () => {
        const data = { items: [{ name: 'a', price: 10 }], authorizer: 'R. Menon' };
        expect(reportFooter('{authorizer}', data)).toBe('R. Menon');
        expect(reportFooter('{authorizer} approved {count()} rows', data))
            .toBe('R. Menon approved 1 rows');
    });

    it('does not clobber a footer item that has no aggregate at all', () => {
        const data = { items: [{ name: 'a', price: 10 }], authorizer: 'R. Menon' };
        expect(reportFooter('APPROVED BY', data)).toBe('APPROVED BY');
        expect(reportFooter('{customer.name}', { ...data, customer: { name: 'Anand' } }))
            .toBe('Anand');
    });

    it('leaves a placeholder that is not an aggregate standing', () => {
        const data = { items: [{ name: 'a', price: 10 }] };
        const json = layout({
            bands: [
                band('reportHeader', [text('rh', { value: 'Page {page}' })]),
                band('detail', [table()])
            ]
        });
        const out = group(resolve(json, data), data);

        /** paginate.js owns that one; group.js must not consume it */
        expect(out.bands[0].items[0].text).toBe('Page {page}');
    });
});


describe('group - an aggregate resolves in whatever band it is put in', () => {
    /**
     * It used to be reportFooter and nothing else, so a total written under the
     * rows - the place a total is most often wanted - printed the raw
     * `{sum(price)}` back at you. There is no set of rows a detail band or a
     * page footer could mean other than the whole report, so there was never a
     * reason to refuse them one.
     */
    const data = {
        items: [
            { name: 'a', qty: 2, price: 10 },
            { name: 'b', qty: 4, price: 20 }
        ]
    };

    const inBand = (type, value, extra = {}) => {
        const json = layout({
            bands: [
                band('detail', [table(), text('here', { value, y: 200 })]),
                band(type, [text('there', { value })])
            ].filter((b, i) => i === 0 || type !== 'detail'),
            ...extra
        });

        const out = group(resolve(json, data), data);
        const found = out.bands.find(b => b.type === type);

        return found.items.find(i => i.id === (type === 'detail' ? 'here' : 'there')).text;
    };

    it.each(['detail', 'pageHeader', 'pageFooter', 'reportHeader', 'reportFooter'])(
        'works in the %s band', (type) => {
            expect(inBand(type, 'Total: {sum(price)}')).toBe('Total: 30');
        });

    it('works over the whole report, not over one page of it', () => {
        expect(inBand('detail', '{count()} rows, {avg(qty)} each')).toBe('2 rows, 3 each');
    });

    it('still leaves a group band for paginate.js to fill in per group', () => {
        /**
         * The one band that must not be touched here. Filling it in with the
         * report's total would not merely be the wrong number - it would
         * consume the placeholder, and the group's own answer would have
         * nowhere left to go.
         */
        const json = layout({
            groupBy: 'name',
            bands: [
                band('detail', [table()]),
                band('groupFooter', [text('gf', { value: 'Sub: {sum(price)}' })])
            ]
        });

        const out = group(resolve(json, data), data);
        const footer = out.bands.find(b => b.type === 'groupFooter');

        expect(footer.items[0].text ?? footer.items[0].value).toBe('Sub: {sum(price)}');
    });

    it("works out a group header's aggregates too, not only a footer's", () => {
        /**
         * "Region A - 12 orders" is a heading. A count that worked in the
         * footer and printed blank in the header is the same fault.
         */
        const json = layout({
            groupBy: 'name',
            bands: [
                band('detail', [table()]),
                band('groupHeader', [text('gh', { value: '{count()} rows' })])
            ]
        });

        const out = group(resolve(json, data), data);
        const table_ = out.bands.find(b => b.type === 'detail').items[0];

        expect(table_.groups[0].aggregates['']).toMatchObject({ count: 1 });
    });
});

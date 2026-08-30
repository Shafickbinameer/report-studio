import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toCSV, toReportCSV, reportFilename } from '../src/engine/csv.js';
import { layout, text, line, box, table, band, rows, groupedRows, run } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());

const flat = (data) => run(layout({
    bands: [
        band('reportHeader', [text('rh', { value: 'INVOICE' })]),
        band('detail', [table()])
    ]
}), data);

const grouped = (data) => run(layout({
    groupBy: 'name',
    bands: [
        band('groupHeader', [text('gh', { value: '{name}', h: 22 })], { height: 22 }),
        band('detail', [table()]),
        band('groupFooter', [text('gf', { value: '{sum(price)}', h: 20 })], { height: 20 })
    ]
}), data);

const lines = (csv) => csv.split('\r\n');

describe('toCSV - shape', () => {
    it('starts with the column labels', () => {
        const csv = toCSV(flat({ items: rows(2) }).pages);
        expect(lines(csv)[0]).toBe('Item,Qty,Price');
    });

    it('writes one line per row', () => {
        const csv = toCSV(flat({ items: rows(5) }).pages);
        expect(lines(csv)).toHaveLength(6);
    });

    it('writes the cells in column order', () => {
        const csv = toCSV(flat({ items: [{ name: 'Cable', qty: 4, price: 120 }] }).pages);
        expect(lines(csv)[1]).toBe('Cable,4,120');
    });

    it('can omit the header', () => {
        const csv = toCSV(flat({ items: rows(2) }).pages, { header: false });
        expect(lines(csv)).toHaveLength(2);
    });

    it('uses RFC 4180 line endings', () => {
        expect(toCSV(flat({ items: rows(2) }).pages)).toContain('\r\n');
    });

    it('honours a different delimiter', () => {
        const csv = toCSV(flat({ items: [{ name: 'Cable', qty: 4, price: 120 }] }).pages,
            { delimiter: ';' });
        expect(lines(csv)[0]).toBe('Item;Qty;Price');
        expect(lines(csv)[1]).toBe('Cable;4;120');
    });

    it('returns empty text for a report with no table', () => {
        const out = run(layout({ bands: [band('detail', [text('only')])] }), {});
        expect(toCSV(out.pages)).toBe('');
    });

    it('tolerates an empty page list', () => {
        expect(toCSV([])).toBe('');
        expect(toCSV(undefined)).toBe('');
    });
});

describe('toCSV - across pages', () => {
    it('gathers every row of a table split over pages, exactly once', () => {
        const data = { items: rows(120) };
        const out = flat(data);

        expect(out.pages.length).toBeGreaterThan(1);

        const body = lines(toCSV(out.pages)).slice(1);
        expect(body).toHaveLength(120);
        expect(body[0]).toMatch(/^row-0,/);
        expect(body.at(-1)).toMatch(/^row-119,/);
    });

    it('keeps the rows in report order', () => {
        const body = lines(toCSV(flat({ items: rows(120) }).pages)).slice(1);
        const numbers = body.map(l => Number(l.split(',')[0].replace('row-', '')));

        expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    });
});

describe('toCSV - grouped reports', () => {
    it('prepends the group key as a column', () => {
        const csv = toCSV(grouped({ items: groupedRows(['North', 'South'], 2) }).pages);

        expect(lines(csv)[0]).toBe('Group,Item,Qty,Price');
        expect(lines(csv)[1]).toMatch(/^North,/);
    });

    it('names the group column', () => {
        const csv = toCSV(grouped({ items: groupedRows(['North'], 1) }).pages,
            { groupLabel: 'Region' });
        expect(lines(csv)[0]).toBe('Region,Item,Qty,Price');
    });

    it('can leave the group column out', () => {
        const csv = toCSV(grouped({ items: groupedRows(['North'], 1) }).pages,
            { groupColumn: false });
        expect(lines(csv)[0]).toBe('Item,Qty,Price');
    });

    it('exports every row of a group split across pages, exactly once', () => {
        const out = grouped({ items: groupedRows(['North', 'South'], 40) });
        expect(out.pages.length).toBeGreaterThan(1);

        const body = lines(toCSV(out.pages)).slice(1);
        expect(body).toHaveLength(80);
        expect(body.filter(l => l.startsWith('North,'))).toHaveLength(40);
        expect(body.filter(l => l.startsWith('South,'))).toHaveLength(40);
    });
});

describe('toCSV - escaping', () => {
    const cell = (name) => lines(toCSV(flat({ items: [{ name, qty: 1, price: 1 }] }).pages))[1];

    it('quotes a value holding the delimiter', () => {
        expect(cell('Smith, John')).toBe('"Smith, John",1,1');
    });

    it('doubles and quotes an embedded quote', () => {
        expect(cell('12" cable')).toBe('"12"" cable",1,1');
    });

    it('quotes a value holding a newline', () => {
        expect(cell('two\nlines')).toBe('"two\nlines",1,1');
    });

    it('leaves an ordinary value unquoted', () => {
        expect(cell('Cable 2m')).toBe('Cable 2m,1,1');
    });

    it('writes a missing cell as empty', () => {
        const out = flat({ items: [{ name: 'Cable' }] });
        expect(lines(toCSV(out.pages))[1]).toBe('Cable,,');
    });
});

describe('toCSV - spreadsheet formula safety', () => {
    const cell = (name) => lines(toCSV(flat({ items: [{ name, qty: 1, price: 1 }] }).pages))[1];

    for (const lead of ['=', '+', '-', '@']) {
        it(`neutralises a cell starting with ${lead}`, () => {
            /** a leading tab is what stops the spreadsheet evaluating the cell */
            expect(cell(`${lead}SUM(A1)`)).toBe(`\t${lead}SUM(A1),1,1`);
        });
    }

    it('keeps the original text after the guard', () => {
        expect(cell('=1+1')).toContain('=1+1');
    });

    it('can be turned off for a byte exact export', () => {
        const out = flat({ items: [{ name: '=1+1', qty: 1, price: 1 }] });
        const csv = toCSV(out.pages, { neutraliseFormulas: false });
        expect(lines(csv)[1]).toBe('=1+1,1,1');
    });

    it('leaves a normal value untouched', () => {
        expect(cell('Cable')).toBe('Cable,1,1');
    });
});

/**
 * The other shape: the report as it reads, rather than the table on its own.
 * A box and a rule are drawn rather than written, so those two are what cannot
 * come along - everything else arrives in the order the page draws it.
 */
describe('toReportCSV - report order', () => {
    const report = (data) => run(layout({
        bands: [
            band('pageHeader', [text('ph', { value: 'Acme Ltd' })]),
            band('reportHeader', [
                text('title', { value: 'INVOICE' }),
                text('date', { value: 'June 2026', x: 420, y: 2, h: 16 })
            ]),
            band('detail', [table()]),
            band('reportFooter', [
                text('lbl', { value: 'Total' }),
                text('sum', { value: '1240', x: 420 })
            ])
        ]
    }), data);

    it('writes what is above the table before the table', () => {
        const out = lines(toReportCSV(report({ items: rows(1) }).pages));

        expect(out[0]).toBe('Acme Ltd');
        expect(out[1]).toBe('INVOICE,June 2026');
        expect(out[2]).toBe('Item,Qty,Price');
        expect(out[3]).toBe('row-0,0,0');
    });

    it('writes what is below the table after it', () => {
        expect(lines(toReportCSV(report({ items: rows(1) }).pages)).at(-1))
            .toBe('Total,1240');
    });

    /** the bands arrive built rather than stacked: only `top` knows the order */
    it('reads a page footer last, wherever the band list holds it', () => {
        const out = run(layout({
            bands: [
                band('pageFooter', [text('pf', { value: 'foot' })]),
                band('detail', [table()]),
                band('pageHeader', [text('ph', { value: 'head' })])
            ]
        }), { items: rows(1) });

        const csv = lines(toReportCSV(out.pages));

        expect(csv[0]).toBe('head');
        expect(csv.at(-1)).toBe('foot');
    });

    it('puts items that share a line in one row, left to right', () => {
        const out = run(layout({
            bands: [band('reportHeader', [
                text('right', { value: 'second', x: 400, y: 4, h: 16 }),
                text('left', { value: 'first', y: 0, h: 20 })
            ])]
        }), {});

        expect(lines(toReportCSV(out.pages))[0]).toBe('first,second');
    });

    it('starts a new row for a line that clears the one above', () => {
        const out = run(layout({
            bands: [band('reportHeader', [
                text('a', { value: 'one', y: 0, h: 20 }),
                text('b', { value: 'two', y: 40, h: 20 })
            ])]
        }), {});

        expect(lines(toReportCSV(out.pages))).toEqual(['one', 'two']);
    });

    it('leaves out the boxes and the rules', () => {
        const out = run(layout({
            bands: [band('reportHeader', [
                box('panel', { y: 0, h: 60 }),
                text('t', { value: 'kept', y: 10 }),
                line('rule', { y: 70 })
            ])]
        }), {});

        expect(lines(toReportCSV(out.pages))).toEqual(['kept']);
    });

    /** the two shapes of the same report, side by side */
    it('keeps the text the table export drops', () => {
        const out = run(layout({
            bands: [
                band('reportHeader', [text('t', { value: 'note' })]),
                band('detail', [table({ showHeader: false })])
            ]
        }), { items: [] });

        /* the rectangle: column labels, and nothing the bands said */
        expect(toCSV(out.pages)).toBe('Item,Qty,Price');

        /* the report: what it says, and no header the table was told to hide */
        expect(toReportCSV(out.pages)).toBe('note');
    });

    it('is empty when the report draws nothing that can be written', () => {
        const out = run(layout({
            bands: [band('detail', [table({ showHeader: false })])]
        }), { items: [] });

        expect(toReportCSV(out.pages)).toBe('');
        expect(toReportCSV([])).toBe('');
        expect(toReportCSV(undefined)).toBe('');
    });

    it('repeats a page header once per page, as the report does', () => {
        const out = report({ items: rows(120) });
        expect(out.pages.length).toBeGreaterThan(1);

        expect(lines(toReportCSV(out.pages)).filter(l => l === 'Acme Ltd'))
            .toHaveLength(out.pages.length);
    });

    it('writes every table row exactly once, in order', () => {
        const body = lines(toReportCSV(report({ items: rows(120) }).pages))
            .filter(l => /^row-\d+,/.test(l));

        expect(body).toHaveLength(120);
        expect(body[0]).toMatch(/^row-0,/);
        expect(body.at(-1)).toMatch(/^row-119,/);
    });

    it('escapes and neutralises exactly as the table export does', () => {
        const out = run(layout({
            bands: [band('reportHeader', [text('t', { value: '=SUM(A1)' })])]
        }), {});

        expect(lines(toReportCSV(out.pages))[0]).toBe('\t=SUM(A1)');
        expect(lines(toReportCSV(out.pages, { neutraliseFormulas: false }))[0])
            .toBe('=SUM(A1)');
    });

    it('honours a different delimiter', () => {
        const out = run(layout({
            bands: [band('reportHeader', [
                text('a', { value: 'one', y: 0, h: 20 }),
                text('b', { value: 'two', x: 400, y: 0, h: 20 })
            ])]
        }), {});

        expect(lines(toReportCSV(out.pages, { delimiter: ';' }))[0]).toBe('one;two');
    });
});


describe('toReportCSV - grouped reports', () => {
    const grouped = (data) => run(layout({
        groupBy: 'name',
        bands: [
            band('groupHeader', [text('gh', { value: '{name}', h: 22 })], { height: 22 }),
            band('detail', [table()]),
            band('groupFooter', [text('gf', { value: '{sum(price)}', h: 20 })], { height: 20 })
        ]
    }), data);

    it("wraps a group's rows in that group's own bands", () => {
        const out = lines(toReportCSV(grouped({ items: groupedRows(['North'], 2) }).pages));

        expect(out[0]).toBe('Item,Qty,Price');
        expect(out[1]).toBe('North');
        expect(out[2]).toBe('North,0,10');
        expect(out[3]).toBe('North,1,10');
        expect(out[4]).toBe('20');
    });

    it('keeps the groups in report order', () => {
        const out = lines(toReportCSV(grouped({ items: groupedRows(['North', 'South'], 1) }).pages));

        expect(out.indexOf('North')).toBeLessThan(out.indexOf('South'));
    });
});


describe('reportFilename', () => {
    it('uses the layout name', () => {
        expect(reportFilename({ name: 'Sale Invoice A4' })).toBe('Sale Invoice A4.csv');
    });

    it('strips characters a filesystem will not take', () => {
        expect(reportFilename({ name: 'Q1/Q2: sales*' })).toBe('Q1-Q2- sales-.csv');
    });

    it('falls back when there is no name', () => {
        expect(reportFilename({})).toBe('report.csv');
        expect(reportFilename(undefined)).toBe('report.csv');
    });

    it('takes a different extension', () => {
        expect(reportFilename({ name: 'Invoice' }, 'pdf')).toBe('Invoice.pdf');
    });
});

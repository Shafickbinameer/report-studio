import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toCSV, reportFilename } from '../src/engine/csv.js';
import { layout, text, table, band, rows, groupedRows, run } from './helpers/layout.js';

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

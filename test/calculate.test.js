/**
 * Calculated columns: a column whose value is worked out from its row.
 *
 *   { "field": "amount", "expression": "{qty} * {price}" }
 *
 * The result is written onto a copy of each row under the column's field
 * before anything else reads the rows, so from then on it is a field like any
 * other - formatted, highlighted, totalled, grouped by and exported.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseExpression, calculatedRows, expressionFields } from '../src/engine/calculate.js';
import { validateLayout } from '../src/engine/validate.js';
import { toCSV } from '../src/engine/csv.js';
import { render } from '../src/render/render.js';
import { sampleData } from '../src/designer/sample-data.js';
import { layout, text, table, band, run } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());


/** work out one calculation over some rows, and give back its column */
const calc = (expression, rows, grouping) =>
    calculatedRows({ columns: [{ field: 'x', expression }], grouping }, rows).map(r => r.x);

const rows = () => [
    { item: 'A', region: 'N', qty: 2, price: 10 },
    { item: 'B', region: 'N', qty: 3, price: 20 },
    { item: 'C', region: 'S', qty: 1, price: 40 }
];


describe('working out a calculation', () => {
    it('does arithmetic on fields and numbers, * before +', () => {
        expect(calc('{qty} * {price}', rows())).toEqual([20, 60, 40]);
        expect(calc('{qty} + {price} * 2', rows())).toEqual([22, 43, 81]);
        expect(calc('({qty} + {price}) * 2', rows())).toEqual([24, 46, 82]);
        expect(calc('-{qty} + 10 % 4', rows())).toEqual([0, -1, 1]);
        expect(calc('{price} / 4', rows())).toEqual([2.5, 5, 10]);
    });

    it('adds up without floating-point noise', () => {
        expect(calc('{a} + {b}', [{ a: 0.1, b: 0.2 }])).toEqual([0.3]);
    });

    it('rounds, and takes absolute values, the smaller and the larger', () => {
        expect(calc('round({price} / 3, 2)', rows())).toEqual([3.33, 6.67, 13.33]);
        expect(calc('round(2.5)', [{}])).toEqual([3]);
        expect(calc('abs({qty} - 3)', rows())).toEqual([1, 0, 2]);
        expect(calc('max({qty}, 2)', rows())).toEqual([2, 3, 2]);
        expect(calc('min({qty}, 2, {price})', rows())).toEqual([2, 2, 1]);
    });

    it('totals over every row of the table', () => {
        expect(calc('sum({qty})', rows())).toEqual([6, 6, 6]);
        expect(calc('{qty} - avg({qty})', rows())).toEqual([0, 1, -1]);
        expect(calc('count()', rows())).toEqual([3, 3, 3]);
        expect(calc('max({price}) - {price}', rows())).toEqual([30, 20, 0]);
        expect(calc('sum({qty} * {price})', rows())).toEqual([120, 120, 120]);
    });

    it("gives each row's share of the table, or of its own group", () => {
        expect(calc('percentage({qty} * {price})', rows())).toEqual([0.166666666667, 0.5, 0.333333333333]);
        expect(calc('percentage({qty} * {price}, group)', rows(), [{ by: 'region' }])).toEqual([0.25, 0.75, 1]);
        expect(calc('percentage({qty}, 4)', rows())).toEqual([0.5, 0.75, 0.25]);
    });

    it('is blank where an input is not a number, or a division is by zero', () => {
        expect(calc('{qty} * {price}', [{ qty: '', price: 5 }, { qty: 'two', price: 5 }, { price: 5 }]))
            .toEqual([null, null, null]);
        expect(calc('{qty} / 0', rows())).toEqual([null, null, null]);
        expect(calc('percentage({qty})', [{ qty: 0 }])).toEqual([null]);
    });

    it('reads numbers written as text, and fields along a path', () => {
        expect(calc('{qty} * {price}', [{ qty: '2', price: '7.5' }])).toEqual([15]);
        expect(calc('{deal.rate} * 100', [{ deal: { rate: 0.2 } }])).toEqual([20]);
    });

    it('lets a column use the one before it', () => {
        const out = calculatedRows({
            columns: [
                { field: 'amount', expression: '{qty} * {price}' },
                { field: 'tax', expression: 'round({amount} * 0.18, 2)' },
                { field: 'gross', expression: '{amount} + {tax}' }
            ]
        }, rows());

        expect(out.map(r => [r.amount, r.tax, r.gross])).toEqual([[20, 3.6, 23.6], [60, 10.8, 70.8], [40, 7.2, 47.2]]);
    });

    it('leaves the rows it was given alone, and hands back the same rows with nothing to work out', () => {
        const given = rows();
        calculatedRows({ columns: [{ field: 'x', expression: '{qty} * 2' }] }, given);

        expect(given[0]).not.toHaveProperty('x');
        expect(calculatedRows({ columns: [{ field: 'qty' }] }, given)).toBe(given);
    });

    it('names the fields a calculation reads', () => {
        expect(expressionFields('round({qty} * { price }, 2) + {qty}')).toEqual(['qty', 'price']);
    });
});


describe('reading a calculation', () => {
    const error = (source) => parseExpression(source).error;

    it('says what is wrong, and where', () => {
        expect(error('{qty} *')).toBe('ends where a value is expected');
        expect(error('{qty} ** 2')).toBe('does not expect "*" at 8');
        expect(error('{qty')).toBe('has a { at 1 that is never closed');
        expect(error('1 2')).toBe('has "2" left over at 3');
        expect(error('(1 + 2')).toBe('expects a ) at the end');
        expect(error('{a} & {b}')).toBe('cannot read "&" at 5');
        expect(error('')).toBe('is empty');
    });

    it('knows its functions, and how many values each takes', () => {
        expect(error('foo({a})')).toMatch(/^has no function called "foo"/);
        expect(error('sum()')).toBe('gives sum() one value at 1');
        expect(error('count({a})')).toBe('gives count() nothing - it counts rows at 1');
        expect(error('abs(1, 2)')).toBe('gives abs() one value at 1');
        expect(error('group')).toMatch(/only means anything in percentage\(x, group\)/);
        expect(error('percentage({a}, group)')).toBeUndefined();
    });
});


/* ---------------- through the engine ---------------- */


const invoice = (columns, items = []) => layout({
    bands: [
        band('detail', [{ ...table({ id: 'lines' }), dataset: 'lines', columns }]),
        band('reportFooter', items, { height: 60 })
    ]
});

const lines = () => ({
    lines: [
        { item: 'Cable', qty: 2, price: 1500 },
        { item: 'Switch', qty: 10, price: 89.5 },
        { item: 'Fan', qty: 1, price: 2799 }
    ]
});

const amountColumns = (extra = {}) => [
    { field: 'item', label: 'Item', width: 300 },
    { field: 'qty', label: 'Qty', width: 100 },
    { field: 'amount', label: 'Amount', width: 314, expression: '{qty} * {price}', ...extra }
];

const placed = (built, id) => built.pages.flatMap(p => p.bands).flatMap(b => b.items).find(i => i.id === id);


describe('a calculated column in a report', () => {
    it('prints the calculated value in its own format', () => {
        const json = { ...invoice(amountColumns({ format: { type: 'currency' } })), format: { grouping: 'indian', symbol: '₹' } };
        const html = render(run(json, lines()));

        expect(html).toContain('₹3,000.00');
        expect(html).toContain('₹895.00');
    });

    it('is totalled by a placeholder like any field', () => {
        const json = invoice(amountColumns(), [text('t', { value: 'Total {sum(amount)}' })]);

        expect(placed(run(json, lines()), 't').text).toBe('Total 6694');
    });

    it('prints a share as a percentage when the column has no format', () => {
        const json = invoice([...amountColumns(), { field: 'share', label: 'Share', width: 100, expression: 'percentage({qty} * {price})' }]);
        const doc = new JSDOM(render(run(json, lines()))).window.document;
        const shares = [...doc.querySelectorAll('[data-item-id="lines"] tbody tr')].map(tr => tr.children[3].textContent);

        expect(shares).toEqual(['44.82%', '13.37%', '41.81%']);
    });

    it('can be highlighted and grouped by', () => {
        const json = invoice(amountColumns({
            highlight: [{ when: { op: '>=', value: 2000 }, style: { color: '#b3261e' } }]
        }));
        json.bands[0].items[0].columns.push({ field: 'size', label: 'Size', width: 1, expression: 'round({qty} * {price} / 1000)' });
        json.bands[0].items[0].grouping = [{ by: 'size', header: { height: 20, items: [text('h', { value: 'Size {size}' })] }, footer: null }];

        const built = run(json, lines());
        const tbl = placed(built, 'lines');

        expect(tbl.groups.map(g => g.key)).toEqual(['3', '1']);
        expect(render(built)).toContain('color:#b3261e');
    });

    it('goes to CSV as the value it worked out', () => {
        const csv = toCSV(run(invoice(amountColumns()), lines()).pages).split('\r\n');

        expect(csv).toEqual(['Item,Qty,Amount', 'Cable,2,3000', 'Switch,10,895', 'Fan,1,2799']);
    });

    it('is a layout validate.js accepts, and names a calculation it cannot read', () => {
        expect(validateLayout(invoice(amountColumns()))).toEqual([]);
        expect(validateLayout(invoice(amountColumns({ expression: '{qty} *' }))))
            .toEqual(['bands[0].items[0].columns[2].expression ends where a value is expected']);
    });
});


describe('sample data for a calculated column', () => {
    it('asks for the fields the calculation reads, not the one it writes', () => {
        const [row] = sampleData(invoice(amountColumns())).lines;

        expect(row).toHaveProperty('qty');
        expect(row).toHaveProperty('price');
        expect(row).not.toHaveProperty('amount');
    });
});

/**
 * {percentage(part)} and {percentage(part, of)}: a value as a share of another.
 *
 *   {percentage(sum(total))}           this group's sum ÷ the whole table's
 *   {percentage(sum(total), parent)}   this group's sum ÷ the group outside it
 *   {percentage(sum(total), 50000)}    ÷ a target
 *   {percentage(1000)}                 1000 ÷ the table's money column total
 *
 * Printed as a percentage, 57.08%; held in the workbook as the fraction, 0.5708,
 * shown with a percent format. A share of nothing is blank.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { group } from '../src/engine/group.js';
import { resolve } from '../src/engine/resolve.js';
import { tablesOf } from '../src/engine/tables.js';
import { toXLSX } from '../src/engine/xlsx.js';
import { findToken, tokenValue } from '../src/designer/tokens.js';
import { layout, text, table, band, run } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());


/** North sells 300 over 2 rows, South 100 over 2: 75% and 25% */
const data = () => ({
    sales: [
        { name: 'a', region: 'North', city: 'Oslo', qty: 1, total: 100 },
        { name: 'b', region: 'North', city: 'Bergen', qty: 3, total: 200 },
        { name: 'c', region: 'South', city: 'Rome', qty: 2, total: 60 },
        { name: 'd', region: 'South', city: 'Rome', qty: 2, total: 40 }
    ]
});

const columns = [
    { field: 'name', label: 'Item', width: 400 },
    { field: 'qty', label: 'Qty', width: 100 },
    { field: 'total', label: 'Total', width: 214, format: { type: 'currency' } }
];

const footer = (...values) => ({
    height: 20,
    items: values.map((value, n) => ({ ...text(`f${n}`, { value }), ...(typeof value === 'object' ? value : {}) }))
});

const report = ({ levels, items = [] }) => layout({
    bands: [
        band('detail', [{ ...table({ id: 'sales' }), dataset: 'sales', columns, grouping: levels }]),
        band('reportFooter', items, { height: 60 })
    ]
});

/** the text each group footer printed, by group path */
function footers(json, payload = data()) {
    const built = run(json, payload);
    const out = {};

    for (const page of built.pages) {
        for (const item of page.bands.flatMap(b => b.items)) {
            for (const f of (item.groups ?? [])) {
                for (const b of (f.footerBands ?? [])) {
                    out[`${f.path.slice(0, b.level + 1).join('/')}`] = b.items.map(i => i.text);
                }
            }
        }
    }

    return out;
}

const placed = (built, id) => built.pages.flatMap(p => p.bands).flatMap(b => b.items).find(i => i.id === id);


describe('a group as a share of the whole', () => {
    const byRegion = (...values) => report({ levels: [{ by: 'region', header: null, footer: footer(...values) }] });

    it("gives each group's sum as a share of the table's", () => {
        expect(footers(byRegion('{percentage(sum(total))}'))).toEqual({
            North: ['75.00%'], South: ['25.00%']
        });
    });

    it('works for any aggregate: counts, quantities', () => {
        expect(footers(byRegion('{percentage(count())}', '{percentage(sum(qty))}'))).toEqual({
            North: ['50.00%', '50.00%'], South: ['50.00%', '50.00%']
        });
    });

    it('takes a target to divide by instead', () => {
        expect(footers(byRegion('{percentage(sum(total), 600)}'))).toEqual({
            North: ['50.00%'], South: ['16.67%']
        });
    });

    it('takes another aggregate over the whole table to divide by', () => {
        expect(footers(byRegion('{percentage(sum(total), max(total))}'))).toEqual({
            North: ['150.00%'], South: ['50.00%']
        });
    });

    it('prints in the words around it, and keeps a text item to its own percent format', () => {
        const json = byRegion(
            'Share: {percentage(sum(total))} of sales',
            { value: '{percentage(sum(total))}', format: { type: 'percent', decimals: 0 } }
        );

        expect(footers(json).North).toEqual(['Share: 75.00% of sales', '75%']);
    });

    it('prints as a percentage even in a currency item', () => {
        const json = byRegion({ value: '{percentage(sum(total))}', format: { type: 'currency', symbol: '₹' } });

        expect(footers(json).North).toEqual(['75.00%']);
    });

    it('is blank for a share of zero or of nothing, never Infinity', () => {
        expect(footers(byRegion('[{percentage(sum(total), 0)}]', '[{percentage(sum(missing))}]')).North)
            .toEqual(['[]', '[]']);
    });
});


describe('a group as a share of the group outside it', () => {
    const nested = report({
        levels: [
            { by: 'region', header: null, footer: footer('{percentage(sum(total))}') },
            { by: 'city', header: null, footer: footer('{percentage(sum(total), parent)}', '{percentage(sum(total))}') }
        ]
    });

    it('divides by the outer group with parent, and by the whole without', () => {
        expect(footers(nested)).toEqual({
            North: ['75.00%'],
            'North/Oslo': ['33.33%', '25.00%'],
            'North/Bergen': ['66.67%', '50.00%'],
            South: ['25.00%'],
            'South/Rome': ['100.00%', '25.00%']
        });
    });

    it('treats parent at the outermost level as the whole table', () => {
        const json = report({ levels: [{ by: 'region', header: null, footer: footer('{percentage(sum(total), parent)}') }] });

        expect(footers(json).North).toEqual(['75.00%']);
    });

    it('works in a group header as well as a footer', () => {
        const json = report({ levels: [{ by: 'region', header: footer('{region}: {percentage(sum(total))}'), footer: null }] });
        const built = run(json, data());
        const headers = placed(built, 'sales').groups.map(f => f.headerBand.items[0].text);

        expect(headers).toEqual(['North: 75.00%', 'South: 25.00%']);
    });
});


describe('a share outside a group', () => {
    const footed = (...items) => report({ levels: undefined, items });

    it('is of the whole in a report band, so a sum is all of itself', () => {
        const built = run(footed(text('w', { value: '{percentage(sum(total))}' })), data());

        expect(placed(built, 'w').text).toBe('100.00%');
    });

    it("divides a plain number by the table's money column", () => {
        const built = run(footed(text('n', { value: '{percentage(100)}' })), data());

        expect(placed(built, 'n').text).toBe('25.00%');
    });

    it('divides a total by a target', () => {
        const built = run(footed(text('t', { value: 'Target met: {percentage(sum(total), 500)}' })), data());

        expect(placed(built, 't').text).toBe('Target met: 80.00%');
    });

    it('is highlighted by the percentage a reader sees', () => {
        const rule = { when: { op: '>=', value: 80 }, style: { color: '#1d6b3a' } };
        const built = run(footed({ ...text('t', { value: '{percentage(sum(total), 500)}' }), highlight: [rule] }), data());

        expect(placed(built, 't').highlighted).toEqual({ color: '#1d6b3a' });
    });

    it('leaves the data untouched, and the other aggregates as they were', () => {
        const json = footed(text('s', { value: '{sum(total)} / {count()}' }));
        const bound = tablesOf(group(resolve(json, data()), data()))[0];

        expect(bound.row).toEqual(data().sales);
        expect(placed(run(json, data()), 's').text).toBe('400 / 4');
    });
});


describe('a share in the workbook', () => {
    it('is the fraction, shown as a percentage', () => {
        const json = report({ levels: undefined, items: [text('t', { value: '{percentage(sum(total), 500)}' })] });
        const bytes = toXLSX(run(json, data()).pages, { tables: false });

        const files = unzip(bytes);
        const { DOMParser } = new JSDOM('').window;
        const doc = (source) => new DOMParser().parseFromString(source, 'application/xml');
        const sheet = doc(files.get('xl/worksheets/sheet1.xml'));
        const styles = doc(files.get('xl/styles.xml'));

        const cell = [...sheet.getElementsByTagName('c')].find(c => c.getElementsByTagName('v')[0]?.textContent === '0.8');
        expect(cell).toBeDefined();

        const xf = [...styles.getElementsByTagName('cellXfs')[0].getElementsByTagName('xf')][Number(cell.getAttribute('s'))];
        const code = [...styles.getElementsByTagName('numFmt')]
            .find(f => f.getAttribute('numFmtId') === xf.getAttribute('numFmtId'))?.getAttribute('formatCode');

        expect(code).toContain('0.00%');
    });

    function unzip(bytes) {
        const decoder = new TextDecoder();
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const eocd = bytes.length - 22;
        const count = view.getUint16(eocd + 10, true);
        let at = view.getUint32(eocd + 16, true);
        const files = new Map();

        for (let i = 0; i < count; i++) {
            const size = view.getUint32(at + 24, true);
            const nameLength = view.getUint16(at + 28, true);
            const offset = view.getUint32(at + 42, true);
            const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
            const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
            files.set(name, decoder.decode(bytes.subarray(start, start + size)));
            at += 46 + nameLength;
        }

        return files;
    }
});


describe('the placeholder tool', () => {
    it('offers Percentage of total, over a field', () => {
        const token = findToken('percentage');

        expect(token.label).toBe('Percentage of total');
        expect(tokenValue(token, 'total')).toBe('{percentage(sum(total))}');
    });
});

/**
 * Conditional formatting: rules that style a value by what it is.
 *
 * A table column's `highlight` styles its cells, a table's `rowHighlight` its
 * whole rows, a text item's `highlight` the item. The first rule that holds is
 * the one used. What the specs hold the package to is that the page, its row
 * heights and the workbook all agree about which cells are styled, and how.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
    highlightFor, cellHighlight, describeHighlight, describeCondition
} from '../src/engine/highlight.js';
import { validateLayout } from '../src/engine/validate.js';
import { toXLSX } from '../src/engine/xlsx.js';
import { render } from '../src/render/render.js';
import { layout, text, table, band, run } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());


const red = { color: '#b3261e' };
const shade = { background: '#fdecec' };
const rule = (when, style = red) => ({ when, style });


describe('which rule holds', () => {
    const test = (when, value, row) => highlightFor([rule(when)], value, row) !== null;

    it('compares numbers as numbers, text that is a number included', () => {
        expect(test({ op: '<', value: 0 }, -5)).toBe(true);
        expect(test({ op: '<', value: 0 }, 5)).toBe(false);
        expect(test({ op: '>=', value: '1000' }, '1200')).toBe(true);
        expect(test({ op: '>', value: 9 }, 10)).toBe(true);
        expect(test({ op: '=', value: 100 }, '100.0')).toBe(true);
        expect(test({ op: '!=', value: 100 }, 99)).toBe(true);
    });

    it('takes between as inclusive at both ends', () => {
        const when = { op: 'between', value: 0, to: 1000 };

        expect([0, 500, 1000, 1001, -1].map(v => test(when, v))).toEqual([true, true, true, false, false]);
    });

    it('compares dates by their day', () => {
        expect(test({ op: '<', value: '2026-06-01' }, '2026-05-31')).toBe(true);
        expect(test({ op: '>', value: '2026-06-01' }, '2026-06-01T09:00')).toBe(true);
        expect(test({ op: '=', value: '2026-06-17' }, '2026-06-17')).toBe(true);
    });

    it('compares text without regard to case', () => {
        expect(test({ op: '=', value: 'overdue' }, 'Overdue')).toBe(true);
        expect(test({ op: 'contains', value: 'DUE' }, 'Overdue')).toBe(true);
        expect(test({ op: 'startsWith', value: 'over' }, 'Overdue')).toBe(true);
        expect(test({ op: 'startsWith', value: 'due' }, 'Overdue')).toBe(false);
    });

    it('never orders a word against a number or a date', () => {
        expect(test({ op: '>=', value: 100000 }, 'amount')).toBe(false);
        expect(test({ op: '<', value: 100000 }, 'amount')).toBe(false);
        expect(test({ op: '<', value: '2026-06-01' }, 'soon')).toBe(false);
        expect(test({ op: '=', value: 5 }, 'five')).toBe(false);
        expect(test({ op: '!=', value: 5 }, 'five')).toBe(true);
    });

    it('tells empty from not', () => {
        expect(['', '  ', null, undefined, 0].map(v => test({ op: 'empty' }, v)))
            .toEqual([true, true, true, true, false]);
        expect(test({ op: 'notEmpty' }, 'x')).toBe(true);
    });

    it('never says a blank is less than, more than or equal to anything', () => {
        expect(test({ op: '<', value: 0 }, '')).toBe(false);
        expect(test({ op: '=', value: 0 }, null)).toBe(false);
        expect(test({ op: '!=', value: 0 }, null)).toBe(true);
    });

    it('tests another field of the row when the rule names one', () => {
        const when = { field: 'status', op: '=', value: 'Overdue' };

        expect(test(when, 500, { status: 'Overdue' })).toBe(true);
        expect(test(when, 500, { status: 'Paid' })).toBe(false);
        expect(test({ field: 'customer.tier', op: '=', value: 'gold' }, null, { customer: { tier: 'Gold' } }))
            .toBe(true);
    });

    it('uses the first rule that holds, and only what it styles', () => {
        const rules = [
            rule({ op: '<', value: 0 }, { color: '#f00', fontWeight: 'bold', bogus: 'x' }),
            rule({ op: '<', value: 100 }, shade)
        ];

        expect(highlightFor(rules, -1)).toEqual({ color: '#f00', fontWeight: 'bold' });
        expect(highlightFor(rules, 50)).toEqual(shade);
        expect(highlightFor(rules, 500)).toBeNull();
        expect(highlightFor(null, 5)).toBeNull();
    });

    it("lays a cell's own style over its row's", () => {
        const tbl = { rowHighlight: [rule({ field: 'status', op: '=', value: 'late' }, { ...shade, color: '#000' })] };
        const column = { field: 'amount', highlight: [rule({ op: '<', value: 0 })] };

        expect(cellHighlight(tbl, column, { status: 'late', amount: -1 })).toEqual({ ...shade, color: '#b3261e' });
        expect(cellHighlight(tbl, column, { status: 'late', amount: 1 })).toEqual({ ...shade, color: '#000' });
        expect(cellHighlight(tbl, column, { status: 'ok', amount: 1 })).toBeNull();
    });

    it('describes itself in words', () => {
        expect(describeHighlight([])).toBe('None');
        expect(describeHighlight([rule({ op: '<', value: 0 })])).toBe('1 rule');
        expect(describeCondition({ op: '<', value: 0 })).toBe('is less than 0');
        expect(describeCondition({ field: 'status', op: '=', value: 'Overdue' })).toBe('status equals Overdue');
        expect(describeCondition({ op: 'between', value: 1, to: 9 })).toBe('is between 1 and 9');
        expect(describeCondition({ op: 'empty' })).toBe('is empty');
    });
});


/* ---------------- through the engine ---------------- */


const report = ({ columns, rowHighlight, items = [] } = {}) => layout({
    bands: [
        band('detail', [{
            ...table({ id: 'sales' }),
            dataset: 'sales',
            ...(rowHighlight ? { rowHighlight } : {}),
            columns: columns ?? [
                { field: 'name', label: 'Item', width: 334 },
                { field: 'status', label: 'Status', width: 160 },
                { field: 'amount', label: 'Amount', width: 220, highlight: [rule({ op: '<', value: 0 })] }
            ]
        }]),
        band('reportFooter', items, { height: 60 })
    ]
});

const data = () => ({
    sales: [
        { name: 'Cable', status: 'Paid', amount: 100 },
        { name: 'Plug', status: 'Overdue', amount: -40 }
    ],
    balance: -250
});

const placed = (built, id) => built.pages.flatMap(p => p.bands).flatMap(b => b.items).find(i => i.id === id);


describe('a highlighted report', () => {
    const rowsOf = (html) => new JSDOM(html).window.document.querySelectorAll('[data-item-id="sales"] tbody tr');

    it('styles the cells whose rules hold, and only those', () => {
        const [paid, overdue] = rowsOf(render(run(report(), data())));

        expect(overdue.children[2].querySelector('.cell').getAttribute('style')).toContain('color:#b3261e');
        expect(paid.children[2].querySelector('.cell').getAttribute('style')).not.toContain('color:');
    });

    it('shades every cell of a row whose rule holds', () => {
        const json = report({ rowHighlight: [rule({ field: 'status', op: '=', value: 'Overdue' }, shade)] });
        const [paid, overdue] = rowsOf(render(run(json, data())));

        expect([...overdue.children].every(td => td.getAttribute('style').includes('background:#fdecec')))
            .toBe(true);
        expect(paid.children[0].getAttribute('style')).not.toContain('background');
    });

    it('styles a text item by the value it prints', () => {
        const built = run(report({
            items: [{ ...text('bal', { value: '{balance}' }), highlight: [rule({ op: '<', value: 0 }, { ...red, fontWeight: 'bold' })] }]
        }), data());

        expect(placed(built, 'bal').highlighted).toEqual({ ...red, fontWeight: 'bold' });
        expect(render(built)).toMatch(/font-weight:bold;[\s\S]*?color:#b3261e;[\s\S]*?data-item-id="bal"/);
    });

    it('styles a text item by a field of the data, whatever it prints', () => {
        const built = run(report({
            items: [{ ...text('note', { value: 'Account review' }), highlight: [rule({ field: 'balance', op: '<', value: 0 }, shade)] }]
        }), data());

        expect(placed(built, 'note').highlighted).toEqual(shade);
        expect(render(built)).toContain('background:#fdecec;');
    });

    it('styles a total by the total', () => {
        const built = run(report({
            items: [{ ...text('tot', { value: '{sum(amount)}' }), highlight: [rule({ op: '>', value: 50 })] }]
        }), data());

        expect(placed(built, 'tot').highlighted).toEqual(red);
    });

    it("styles a group subtotal by its own group's total", () => {
        const json = report();
        json.bands[0].items[0].grouping = [{
            by: 'status', header: null,
            footer: { height: 20, items: [{ ...text('sub', { value: '{sum(amount)}' }), highlight: [rule({ op: '<', value: 0 })] }] }
        }];

        const fragments = placed(run(json, data()), 'sales').groups;
        expect(fragments.map(f => f.footerBand.items[0].highlighted ?? null)).toEqual([null, red]);
    });

    it('measures a bold cell bold, so it wraps where the plain one would not', () => {
        /**
         * 89px leaves 71px for text: "Overdue now" is about 70px plain and 74px
         * bold, so only the bold one runs onto a second line.
         */
        const columns = (highlight) => [
            { field: 'name', label: 'Item', width: 625 },
            { field: 'status', label: 'S', width: 89, highlight }
        ];
        const payload = { sales: [{ name: 'x', status: 'Overdue now', amount: 0 }] };

        const plain = report({ columns: columns(undefined) });
        const bold = report({ columns: columns([rule({ op: 'notEmpty' }, { fontWeight: 'bold' })]) });
        for (const json of [plain, bold]) json.bands[0].items[0].rowHeight = 16;

        const heightOf = (json) => placed(run(json, payload), 'sales').rowHeights[0];
        expect(heightOf(plain)).toBe(16);
        expect(heightOf(bold)).toBeGreaterThan(heightOf(plain));
    });

    it('draws as before with no rules', () => {
        const json = report({ columns: [{ field: 'amount', label: 'A', width: 714 }] });

        expect(render(run(json, data()))).not.toContain('color:#b3261e');
    });
});


describe('a highlighted workbook', () => {
    const decoder = new TextDecoder();
    const { DOMParser } = new JSDOM('').window;

    function unzip(bytes) {
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

    const doc = (source) => new DOMParser().parseFromString(source, 'application/xml');

    /** a cell's font colour, fill and boldness, read back the way Excel does */
    function looks(files, sheetNo, ref) {
        const styles = doc(files.get('xl/styles.xml'));
        const list = (parent, tag) => [...styles.getElementsByTagName(parent)[0].getElementsByTagName(tag)];
        const c = [...doc(files.get(`xl/worksheets/sheet${sheetNo}.xml`)).getElementsByTagName('c')]
            .find(el => el.getAttribute('r') === ref);

        const xf = list('cellXfs', 'xf')[Number(c.getAttribute('s') ?? 0)];
        const font = list('fonts', 'font')[Number(xf.getAttribute('fontId'))];
        const fill = list('fills', 'fill')[Number(xf.getAttribute('fillId'))];

        return {
            color: font.getElementsByTagName('color')[0]?.getAttribute('rgb') ?? null,
            bold: font.getElementsByTagName('b').length > 0,
            fill: fill.getElementsByTagName('fgColor')[0]?.getAttribute('rgb') ?? null
        };
    }

    it('styles the same cells the page does', () => {
        const json = report({ rowHighlight: [rule({ field: 'status', op: '=', value: 'Overdue' }, shade)] });
        const files = unzip(toXLSX(run(json, data()).pages, { report: false }));

        expect(looks(files, 1, 'C3')).toMatchObject({ color: 'FFB3261E', fill: 'FFFDECEC' });
        expect(looks(files, 1, 'A3').fill).toBe('FFFDECEC');
        expect(looks(files, 1, 'C2')).toMatchObject({ fill: null });
        expect(looks(files, 1, 'C2').color).not.toBe('FFB3261E');
    });

    it('styles a highlighted text item on the report sheet', () => {
        const built = run(report({
            items: [{ ...text('bal', { value: '{balance}' }), highlight: [rule({ op: '<', value: 0 }, { ...red, fontWeight: 'bold' })] }]
        }), data());
        const files = unzip(toXLSX(built.pages, { tables: false }));

        const sheet = doc(files.get('xl/worksheets/sheet1.xml'));
        const cell = [...sheet.getElementsByTagName('c')]
            .find(c => (c.getElementsByTagName('v')[0] ?? c.getElementsByTagName('t')[0])?.textContent === '-250');

        expect(looks(files, 1, cell.getAttribute('r'))).toMatchObject({ color: 'FFB3261E', bold: true });
    });
});


describe('validating highlight rules', () => {
    it('accepts rules it knows', () => {
        expect(validateLayout(report({ rowHighlight: [rule({ field: 'status', op: 'empty' }, shade)] })))
            .toEqual([]);
    });

    it('names what is wrong with a rule', () => {
        const json = report({
            columns: [{
                field: 'a',
                highlight: [
                    { when: { op: 'like', value: 1 }, style: { color: 'red', border: '1px' } },
                    { when: { op: 'between', value: 1 }, style: red },
                    { style: red }
                ]
            }]
        });

        expect(validateLayout(json)).toEqual([
            'bands[0].items[0].columns[0].highlight[0].when.op "like" is not one of: ' +
                '=, !=, <, <=, >, >=, between, contains, startsWith, empty, notEmpty',
            'bands[0].items[0].columns[0].highlight[0].style.border is not one of: ' +
                'color, background, fontWeight, fontStyle',
            'bands[0].items[0].columns[0].highlight[1].when needs both value and to for between',
            'bands[0].items[0].columns[0].highlight[2].when must say what to test'
        ]);
    });

    it('asks a row rule to name its field', () => {
        expect(validateLayout(report({ rowHighlight: [rule({ op: '<', value: 0 })] })))
            .toEqual(['bands[0].items[0].rowHighlight[0].when.field must name the field of the row to test']);
    });

    it('checks a text item rules', () => {
        const json = report({ items: [{ ...text('t'), highlight: 'red' }] });

        expect(validateLayout(json)).toEqual(['bands[1].items[0].highlight must be a list of rules, or null']);
    });
});

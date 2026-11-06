/**
 * Number and date formats: what a value prints as, and what a workbook holds.
 *
 * A text item or a table column carries a `format`; the report carries the
 * defaults an item's format leaves unsaid, as `layout.format`. The rule the
 * specs hold the package to is the one the feature exists for: the page shows
 * ₹1,00,000.00 and 17/06/2026, and the spreadsheet holds 100000 and a real
 * date, shown the same way.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
    formatValue, effectiveFormat, excelNumberFormat, excelValue, describeFormat,
    dateParts, INDIAN_DEFAULTS, DEFAULT_FORMAT
} from '../src/engine/format.js';
import { validateLayout } from '../src/engine/validate.js';
import { toXLSX } from '../src/engine/xlsx.js';
import { toCSV } from '../src/engine/csv.js';
import { search } from '../src/engine/search.js';
import { render } from '../src/render/render.js';
import { layout, text, table, band, run } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.useRealTimers() && vi.restoreAllMocks());


const IN = INDIAN_DEFAULTS;


describe('printing a number', () => {
    const n = (value, format, defaults) => formatValue(value, { type: 'number', ...format }, defaults);

    it('groups in threes by default, in lakhs and crores the Indian way', () => {
        expect(n(1234567.891)).toBe('1,234,567.89');
        expect(n(1234567.891, {}, IN)).toBe('12,34,567.89');
        expect(n(100000, {}, IN)).toBe('1,00,000.00');
        expect(n(123456789, { decimals: 0 }, IN)).toBe('12,34,56,789');
        expect(n(999, {}, IN)).toBe('999.00');
        expect(n(1234567, { grouping: 'none', decimals: 0 })).toBe('1234567');
    });

    it('rounds to its places the way people do, not the way toFixed does', () => {
        expect(n(1.005)).toBe('1.01');
        expect(n(2.5, { decimals: 0 })).toBe('3');
        expect(n(1.23456, { decimals: 4 })).toBe('1.2346');
    });

    it('shows a negative with a minus, in brackets or with a trailing minus', () => {
        expect(n(-1234.5)).toBe('-1,234.50');
        expect(n(-1234.5, { negative: 'brackets' })).toBe('(1,234.50)');
        expect(n(-1234.5, { negative: 'trailing' })).toBe('1,234.50-');
    });

    it('never prints minus zero', () => {
        expect(n(-0.001)).toBe('0.00');
    });

    it('shows zero as zero, a dash or nothing', () => {
        expect(n(0)).toBe('0.00');
        expect(n(0, { zero: 'dash' })).toBe('-');
        expect(n(0.001, { zero: 'blank' })).toBe('');
    });

    it('puts a currency symbol before or after, and keeps the sign outside it', () => {
        const c = (value, format) => formatValue(value, { type: 'currency', ...format }, IN);

        expect(c(100000)).toBe('₹1,00,000.00');
        expect(c(100000, { symbolPosition: 'after' })).toBe('1,00,000.00 ₹');
        expect(c(-2500.5)).toBe('-₹2,500.50');
        expect(c(-2500.5, { negative: 'brackets' })).toBe('(₹2,500.50)');
        expect(formatValue(5, { type: 'currency', symbol: '$' })).toBe('$5.00');
    });

    it('prints a fraction as a percentage', () => {
        expect(formatValue(0.125, { type: 'percent', decimals: 1 })).toBe('12.5%');
    });

    it('reads a number written as text, and leaves anything else as it is', () => {
        expect(n('1200', { decimals: 0 })).toBe('1,200');
        expect(n('ACME')).toBe('ACME');
        expect(n('12abc')).toBe('12abc');
        expect(n(null)).toBe('');
    });

    it('prints a value as it comes with no format, or a text one', () => {
        expect(formatValue(1234.5, null)).toBe('1234.5');
        expect(formatValue(1234.5, { type: 'text' })).toBe('1234.5');
        expect(formatValue(1234.5, undefined, IN)).toBe('1234.5');
    });
});


describe('printing a date', () => {
    const d = (value, format, defaults) => formatValue(value, { type: 'date', ...format }, defaults);

    it('prints ISO dates by default, and the report pattern when it has one', () => {
        expect(d('2026-06-17')).toBe('2026-06-17');
        expect(d('2026-06-17', {}, IN)).toBe('17/06/2026');
    });

    it('lays a date out by its pattern', () => {
        expect(d('2026-06-07', { pattern: 'dd-MMM-yyyy' })).toBe('07-Jun-2026');
        expect(d('2026-06-07', { pattern: 'd MMMM yyyy' })).toBe('7 June 2026');
        expect(d('2026-06-07', { pattern: 'MM/dd/yy' })).toBe('06/07/26');
    });

    it('prints the day the data says, whatever the time zone', () => {
        /** new Date('2026-06-17') is UTC midnight: the 16th, west of Greenwich */
        expect(dateParts('2026-06-17')).toMatchObject({ year: 2026, month: 6, day: 17 });
        expect(d('2026-06-17T23:30:00-08:00', { pattern: 'dd/MM/yyyy' })).toBe('17/06/2026');
    });

    it('prints a time in 24 or 12 hours', () => {
        const t = (pattern) => formatValue('2026-06-17T15:04:09', { type: 'datetime', pattern });

        expect(t('HH:mm:ss')).toBe('15:04:09');
        expect(t('h:mm a')).toBe('3:04 PM');
        expect(formatValue('2026-06-17', { type: 'datetime', pattern: 'hh a' })).toBe('12 AM');
    });

    it('reads a Date as the host made it', () => {
        expect(d(new Date(2026, 0, 2), { pattern: 'dd/MM/yyyy' })).toBe('02/01/2026');
    });

    it('leaves what is not a date as it is - an impossible day included', () => {
        expect(d('2026-02-31')).toBe('2026-02-31');
        expect(d('next week')).toBe('next week');
        expect(d(20260617)).toBe('20260617');
    });
});


describe('the report defaults and an item format', () => {
    it('fills in everything an item format leaves unsaid', () => {
        expect(effectiveFormat({ type: 'currency' }, IN)).toEqual({
            ...DEFAULT_FORMAT, ...IN, type: 'currency'
        });
    });

    it('lets the item say otherwise', () => {
        expect(effectiveFormat({ type: 'currency', symbol: '$' }, IN).symbol).toBe('$');
    });

    it('takes no type from the report defaults', () => {
        expect(effectiveFormat({ type: 'number' }, { type: 'date' }).type).toBe('number');
    });

    it('puts a value it does not know back to the default', () => {
        expect(effectiveFormat({ type: 'number', decimals: 99, grouping: 'weird' }))
            .toMatchObject({ decimals: 6, grouping: 'international' });
    });

    it('describes itself in one line', () => {
        expect(describeFormat({ type: 'currency' }, IN)).toBe('Currency · ₹12,34,567.89');
        expect(describeFormat({ type: 'date' }, IN)).toBe('Date · dd/MM/yyyy');
        expect(describeFormat(null)).toBe('As it comes');
    });
});


describe('Excel number formats', () => {
    it('says each number format in Excel terms, with its negative and zero', () => {
        expect(excelNumberFormat({ type: 'number' })).toBe('#,##0.00;-#,##0.00;#,##0.00');
        expect(excelNumberFormat({ type: 'number', decimals: 0, negative: 'brackets', zero: 'dash' }))
            .toBe('#,##0;(#,##0);"-"');
        expect(excelNumberFormat({ type: 'percent', decimals: 1, grouping: 'none' }))
            .toBe('0.0%;-0.0%;0.0%');
    });

    it('quotes a currency symbol, before or after', () => {
        expect(excelNumberFormat({ type: 'currency', symbol: '$', decimals: 0 }))
            .toBe('"$"#,##0;-"$"#,##0;"$"#,##0');
        expect(excelNumberFormat({ type: 'currency', symbol: '€', symbolPosition: 'after', decimals: 0 }))
            .toBe('#,##0" ""€";-#,##0" ""€";#,##0" ""€"');
    });

    it('groups in lakhs and crores with two conditional sections', () => {
        expect(excelNumberFormat({ type: 'currency' }, IN)).toBe(
            '[>=10000000]"₹"##\\,##\\,##\\,##0.00;[>=100000]"₹"##\\,##\\,##0.00;"₹"#,##0.00');
    });

    it("escapes a date pattern's separators, which Excel would swap for the reader's", () => {
        expect(excelNumberFormat({ type: 'date' }, IN)).toBe('dd\\/mm\\/yyyy');
        expect(excelNumberFormat({ type: 'datetime', pattern: 'dd-MMM-yyyy hh:mm a' }))
            .toBe('dd\\-mmm\\-yyyy hh\\:mm AM/PM');
    });

    it('has nothing to say for a value printed as it comes', () => {
        expect(excelNumberFormat(null)).toBeNull();
        expect(excelNumberFormat({ type: 'text' })).toBeNull();
    });

    it('turns a date into its serial, and a number into itself', () => {
        expect(excelValue('2026-06-17', { type: 'date' })).toBe(46190);
        expect(excelValue('2026-06-17T12:00', { type: 'datetime' })).toBe(46190.5);
        expect(excelValue('1200', { type: 'number' })).toBe(1200);
        expect(excelValue('ACME', { type: 'number' })).toBeNull();
    });
});


/* ---------------- through the engine ---------------- */


const money = { type: 'currency' };
const day = { type: 'date' };

const report = ({ defaults = IN, columns, items = [] } = {}) => ({
    ...layout({
        bands: [
            band('detail', [{
                ...table({ id: 'sales' }),
                dataset: 'sales',
                columns: columns ?? [
                    { field: 'name', label: 'Item', width: 300 },
                    { field: 'date', label: 'Date', width: 150, format: day },
                    { field: 'amount', label: 'Amount', width: 264, align: 'right', format: money }
                ]
            }]),
            band('reportFooter', items, { height: 60 })
        ]
    }),
    format: defaults
});

const data = () => ({
    sales: [
        { name: 'Cable', date: '2026-06-17', amount: 100000 },
        { name: 'Plug', date: '2026-06-02', amount: 2500.5 }
    ],
    customer: { joined: '2020-01-05', limit: 500000 }
});

const tableOf = (built) => built.pages[0].bands.flatMap(b => b.items).find(i => i.id === 'sales');
const textOf = (built, id) => built.pages.flatMap(p => p.bands).flatMap(b => b.items)
    .find(i => i.id === id);


describe('a formatted report', () => {
    it('prints each column in its own format', () => {
        const html = render(run(report(), data()));

        expect(html).toContain('₹1,00,000.00');
        expect(html).toContain('17/06/2026');
        expect(html).toContain('₹2,500.50');
    });

    it('keeps the rows themselves as they came', () => {
        expect(tableOf(run(report(), data())).row[0]).toEqual(data().sales[0]);
    });

    it('prints a placeholder in its text item format', () => {
        const built = run(report({
            items: [
                { ...text('lim', { value: 'Limit {customer.limit}' }), format: money },
                { ...text('since', { value: 'Since {customer.joined}', y: 20 }), format: day }
            ]
        }), data());

        expect(textOf(built, 'lim').text).toBe('Limit ₹5,00,000.00');
        expect(textOf(built, 'since').text).toBe('Since 05/01/2020');
    });

    it('prints a total in its text item format, and a count as a count', () => {
        const built = run(report({
            items: [
                { ...text('tot', { value: 'Total {sum(amount)} over {count()}' }), format: money }
            ]
        }), data());

        expect(textOf(built, 'tot').text).toBe('Total ₹1,02,500.50 over 2');
    });

    it('prints group totals in their own format', () => {
        const json = report();
        json.bands[0].items[0].grouping = [{
            by: 'name',
            header: null,
            footer: { height: 20, items: [{ ...text('sub', { value: '{sum(amount)}' }), format: money }] }
        }];

        const fragments = tableOf(run(json, data())).groups;
        expect(fragments.map(f => f.footerBand.items[0].text)).toEqual(['₹1,00,000.00', '₹2,500.50']);
    });

    it("prints {today} in the report's date pattern", () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 5, 17, 3, 0));

        const built = run(report({ items: [text('now', { value: 'Printed {today}' })] }), data());

        expect(textOf(built, 'now').text).toBe('Printed 17/06/2026');
    });

    it('measures a cell as printed, so a long formatted figure wraps and the row grows', () => {
        /**
         * "1,00,000.00 ₹" breaks at its space; "100000" fits on one line. The
         * wide column keeps the narrow one narrow - columns are scaled to fill
         * the table, so a lone 60px column would be the table's whole width.
         */
        const wide = { field: 'name', label: 'Item', width: 654 };
        const narrow = report({
            columns: [wide, { field: 'amount', label: 'A', width: 60, format: { ...money, symbolPosition: 'after' } }]
        });
        const plain = report({ columns: [wide, { field: 'amount', label: 'A', width: 60 }] });

        /** one line's height, so a second line has to grow the row */
        for (const json of [narrow, plain]) json.bands[0].items[0].rowHeight = 16;

        const grown = tableOf(run(narrow, data())).rowHeights[0];
        const flat = tableOf(run(plain, data())).rowHeights[0];

        expect(grown).toBeGreaterThan(flat);
    });

    it('finds a value as it is printed', () => {
        const pages = run(report(), data()).pages;

        expect(search(pages, '1,00,000')).toHaveLength(1);
        expect(search(pages, '17/06/2026')).toHaveLength(1);
    });

    it('prints everything as before when nothing is formatted', () => {
        const json = report({ defaults: undefined, columns: [{ field: 'amount', label: 'A', width: 300 }] });

        expect(render(run(json, data()))).toContain('>100000<');
    });
});


describe('exporting a formatted report', () => {
    const decoder = new TextDecoder();
    const { DOMParser } = new JSDOM('').window;

    /** stored entries only - the package's zip does not compress */
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

    /** a cell's value and the number format code it is shown with */
    function cellAt(files, sheetNo, ref) {
        const sheet = doc(files.get(`xl/worksheets/sheet${sheetNo}.xml`));
        const styles = doc(files.get('xl/styles.xml'));

        const c = [...sheet.getElementsByTagName('c')].find(el => el.getAttribute('r') === ref);
        if (!c) throw new Error(`no cell ${ref}`);

        const xf = [...styles.getElementsByTagName('cellXfs')[0].getElementsByTagName('xf')][
            Number(c.getAttribute('s') ?? 0)];
        const id = xf.getAttribute('numFmtId');
        const custom = [...styles.getElementsByTagName('numFmt')]
            .find(f => f.getAttribute('numFmtId') === id);

        return {
            type: c.getAttribute('t'),
            value: c.getElementsByTagName(c.getAttribute('t') === 'inlineStr' ? 't' : 'v')[0]?.textContent,
            code: custom?.getAttribute('formatCode') ?? null
        };
    }

    it('writes a formatted column as real numbers and dates, shown the same way', () => {
        const files = unzip(toXLSX(run(report(), data()).pages, { report: false }));

        expect(cellAt(files, 1, 'C2')).toEqual({
            type: null,
            value: '100000',
            code: excelNumberFormat(money, IN)
        });
        expect(cellAt(files, 1, 'B2')).toEqual({ type: null, value: '46190', code: 'dd\\/mm\\/yyyy' });
        expect(cellAt(files, 1, 'A2')).toMatchObject({ type: 'inlineStr', value: 'Cable', code: null });
    });

    it('writes a grand total on the report sheet as its number, in its format', () => {
        const built = run(report({
            items: [{ ...text('tot', { value: '{sum(amount)}', x: 400, w: 200 }), format: money }]
        }), data());
        const files = unzip(toXLSX(built.pages, { tables: false }));

        const sheet = doc(files.get('xl/worksheets/sheet1.xml'));
        const total = [...sheet.getElementsByTagName('c')]
            .find(c => c.getElementsByTagName('v')[0]?.textContent === '102500.5');

        expect(total).toBeDefined();
        expect(cellAt(files, 1, total.getAttribute('r')).code).toBe(excelNumberFormat(money, IN));
    });

    it('keeps a total with words around it as the text it printed', () => {
        const built = run(report({
            items: [{ ...text('tot', { value: 'Total {sum(amount)}' }), format: money }]
        }), data());
        const files = unzip(toXLSX(built.pages, { tables: false }));

        expect(files.get('xl/worksheets/sheet1.xml')).toContain('Total ₹1,02,500.50');
    });

    it('writes raw values to CSV, or what is printed when asked', () => {
        const pages = run(report(), data()).pages;

        expect(toCSV(pages).split('\r\n')[1]).toBe('Cable,2026-06-17,100000');
        expect(toCSV(pages, { formatted: true }).split('\r\n')[1]).toBe('Cable,17/06/2026,"₹1,00,000.00"');
    });
});


describe('validating formats', () => {
    it('accepts what format.js knows', () => {
        expect(validateLayout(report())).toEqual([]);
    });

    it('names what it does not', () => {
        const json = report({
            columns: [{ field: 'a', format: { type: 'money', decimals: 9, grouping: 'chinese' } }]
        });

        expect(validateLayout(json)).toEqual([
            'bands[0].items[0].columns[0].format.type "money" is not one of: ' +
                'text, number, currency, percent, date, datetime',
            'bands[0].items[0].columns[0].format.grouping "chinese" is not one of: ' +
                'international, indian, none',
            'bands[0].items[0].columns[0].format.decimals must be a whole number from 0 to 6'
        ]);
    });

    it('keeps the type off the report defaults', () => {
        expect(validateLayout(report({ defaults: { type: 'number' } })))
            .toEqual(["layout.format.type is an item's or a column's to say, not the report's"]);
    });

    it('checks a text item format', () => {
        const json = report({ items: [{ ...text('t'), format: { negative: 'red' } }] });

        expect(validateLayout(json)).toEqual([
            'bands[1].items[0].format.negative "red" is not one of: minus, brackets, trailing'
        ]);
    });
});

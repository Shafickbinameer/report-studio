import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { toXLSX, columnName, sheetNames, XLSX_LIMITS } from '../src/engine/xlsx.js';
import { zip, crc32 } from '../src/engine/zip.js';
import { toReportCSV } from '../src/engine/csv.js';
import {
    argb, fontName, points, columnChars, isBold, excelBorder, cellFormat, indentLevels,
    createStyles, REPORT_DEFAULTS
} from '../src/engine/xlsx-style.js';
import { toXLSXAsync, reportImageSources } from '../src/engine/xlsx.js';
import { sniffImage, fitImage, decodeDataUri, pen, emu } from '../src/engine/xlsx-drawing.js';
import { reportLayout, reportRows } from '../src/engine/rows.js';
import { line, box, image } from './helpers/layout.js';
import { readFileSync } from 'node:fs';
import { layout, text, table, band, rows, groupedRows, run } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());

const { DOMParser } = new JSDOM('').window;
const decoder = new TextDecoder();


/**
 * Reads a STORED zip back, by the central directory as a real reader does,
 * and checks every entry's local header and CRC against it on the way.
 */
function unzip(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = bytes.length - 22;

    expect(view.getUint32(eocd, true)).toBe(0x06054B50);

    const count = view.getUint16(eocd + 10, true);
    const centralSize = view.getUint32(eocd + 12, true);
    const centralStart = view.getUint32(eocd + 16, true);
    expect(centralStart + centralSize).toBe(eocd);

    const files = new Map();
    let at = centralStart;

    for (let i = 0; i < count; i++) {
        expect(view.getUint32(at, true)).toBe(0x02014B50);

        const crc = view.getUint32(at + 16, true);
        const size = view.getUint32(at + 24, true);
        const nameLength = view.getUint16(at + 28, true);
        const offset = view.getUint32(at + 42, true);
        const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));

        expect(view.getUint32(offset, true)).toBe(0x04034B50);
        expect(view.getUint16(offset + 8, true)).toBe(0);
        expect(view.getUint32(offset + 14, true)).toBe(crc);

        const localName = view.getUint16(offset + 26, true);
        const start = offset + 30 + localName + view.getUint16(offset + 28, true);
        const data = bytes.subarray(start, start + size);

        expect(crc32(data)).toBe(crc);
        files.set(name, decoder.decode(data));

        at += 46 + nameLength;
    }

    return files;
}

function xml(source) {
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    return doc;
}

/** a sheet's rows as arrays of { ref, type, style, value } */
function sheet(files, n) {
    const doc = xml(files.get(`xl/worksheets/sheet${n}.xml`));

    return [...doc.getElementsByTagName('row')].map(row =>
        [...row.getElementsByTagName('c')].map(c => ({
            ref: c.getAttribute('r'),
            type: c.getAttribute('t'),
            style: c.getAttribute('s'),
            value: c.getElementsByTagName(c.getAttribute('t') === 'inlineStr' ? 't' : 'v')[0]
                ?.textContent ?? null
        }))
    );
}

/** a sheet's <row> elements, for their height attributes */
function rowElements(files, n) {
    return [...xml(files.get(`xl/worksheets/sheet${n}.xml`)).getElementsByTagName('row')];
}

/**
 * What a cell looks like, read back out of styles.xml through its s index the
 * way Excel does: { font, fill, border, alignment, numFmtId }.
 */
function look(files, n, ref) {
    const styles = xml(files.get('xl/styles.xml'));
    const list = (parent, tag) =>
        [...styles.getElementsByTagName(parent)[0].getElementsByTagName(tag)];

    const c = [...xml(files.get(`xl/worksheets/sheet${n}.xml`)).getElementsByTagName('c')]
        .find(el => el.getAttribute('r') === ref);
    if (!c) throw new Error(`no cell ${ref}`);

    const xf = list('cellXfs', 'xf')[Number(c.getAttribute('s') ?? 0)];
    const font = list('fonts', 'font')[Number(xf.getAttribute('fontId'))];
    const fill = list('fills', 'fill')[Number(xf.getAttribute('fillId'))];
    const border = list('borders', 'border')[Number(xf.getAttribute('borderId'))];
    const alignment = xf.getElementsByTagName('alignment')[0];

    const val = (el, tag) => el.getElementsByTagName(tag)[0]?.getAttribute('val') ?? null;
    const side = (name) => {
        const el = border.getElementsByTagName(name)[0];
        return {
            style: el?.getAttribute('style') ?? null,
            color: el?.getElementsByTagName('color')[0]?.getAttribute('rgb') ?? null
        };
    };

    return {
        numFmtId: xf.getAttribute('numFmtId'),
        font: {
            name: val(font, 'name'),
            size: Number(val(font, 'sz')),
            bold: font.getElementsByTagName('b').length > 0,
            italic: font.getElementsByTagName('i').length > 0,
            color: font.getElementsByTagName('color')[0]?.getAttribute('rgb') ?? null
        },
        fill: fill.getElementsByTagName('fgColor')[0]?.getAttribute('rgb') ?? null,
        border: { left: side('left'), right: side('right'), top: side('top'), bottom: side('bottom') },
        alignment: {
            horizontal: alignment?.getAttribute('horizontal') ?? null,
            vertical: alignment?.getAttribute('vertical') ?? null,
            wrapText: alignment?.getAttribute('wrapText') === '1',
            indent: alignment?.getAttribute('indent') ?? null
        }
    };
}

function sheetList(files) {
    return [...xml(files.get('xl/workbook.xml')).getElementsByTagName('sheet')]
        .map(s => s.getAttribute('name'));
}

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

/** a hand-built page list with one table, for values the engine would not make */
const pagesWith = (rowsData, columns = [{ field: 'v', label: 'V' }]) => [{
    bands: [{ top: 0, items: [{ type: 'table', id: 't', showHeader: true, columns, row: rowsData }] }]
}];


describe('zip', () => {
    it('computes the standard CRC-32', () => {
        expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xCBF43926);
        expect(crc32(new Uint8Array(0))).toBe(0);
    });

    it('packs files a reader can find again', () => {
        const files = unzip(zip([
            { name: 'a.txt', data: 'hello' },
            { name: 'dir/b.xml', data: new TextEncoder().encode('<x/>') },
            { name: 'ünïcode.txt', data: 'தமிழ்' }
        ]));

        expect([...files.keys()]).toEqual(['a.txt', 'dir/b.xml', 'ünïcode.txt']);
        expect(files.get('a.txt')).toBe('hello');
        expect(files.get('ünïcode.txt')).toBe('தமிழ்');
    });

    it('writes the same bytes for the same input', () => {
        const input = [{ name: 'a', data: 'x' }];
        expect(zip(input)).toEqual(zip(input));
    });

    it('makes a valid empty archive', () => {
        expect(unzip(zip([])).size).toBe(0);
    });
});


describe('toXLSX - package', () => {
    it('is empty when the report writes nothing', () => {
        const pages = run(layout({ bands: [band('detail', [table({ showHeader: false })])] }),
            { items: [] }).pages;

        expect(toXLSX([], {})).toHaveLength(0);
        expect(toXLSX(pages, { tables: false })).toHaveLength(0);
    });

    it('starts with the zip signature', () => {
        const bytes = toXLSX(flat({ items: rows(2) }).pages);
        expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4B, 0x03, 0x04]);
    });

    it('holds every part a workbook needs, each well-formed', () => {
        const files = unzip(toXLSX(flat({ items: rows(2) }).pages));

        expect([...files.keys()]).toEqual([
            '[Content_Types].xml',
            '_rels/.rels',
            'xl/workbook.xml',
            'xl/_rels/workbook.xml.rels',
            'xl/styles.xml',
            'xl/worksheets/sheet1.xml',
            'xl/worksheets/sheet2.xml'
        ]);

        for (const source of files.values()) xml(source);
    });

    it('declares a content type and a relationship for every sheet', () => {
        const files = unzip(toXLSX(flat({ items: rows(2) }).pages));

        const overrides = [...xml(files.get('[Content_Types].xml')).getElementsByTagName('Override')]
            .map(o => o.getAttribute('PartName'));
        expect(overrides).toContain('/xl/worksheets/sheet1.xml');
        expect(overrides).toContain('/xl/worksheets/sheet2.xml');

        const targets = [...xml(files.get('xl/_rels/workbook.xml.rels')).getElementsByTagName('Relationship')]
            .map(r => r.getAttribute('Target'));
        expect(targets).toEqual(['worksheets/sheet1.xml', 'worksheets/sheet2.xml', 'styles.xml']);
    });
});


describe('toXLSX - sheets', () => {
    it('writes a Report sheet and one sheet per table', () => {
        const files = unzip(toXLSX(flat({ items: rows(2) }).pages));
        expect(sheetList(files)).toEqual(['Report', 'tbl']);
    });

    it('can leave either kind out', () => {
        const pages = flat({ items: rows(2) }).pages;

        expect(sheetList(unzip(toXLSX(pages, { report: false })))).toEqual(['tbl']);
        expect(sheetList(unzip(toXLSX(pages, { tables: false })))).toEqual(['Report']);
    });

    it('names the report sheet as asked', () => {
        const files = unzip(toXLSX(flat({ items: rows(2) }).pages, { reportSheetName: 'Invoice' }));
        expect(sheetList(files)[0]).toBe('Invoice');
    });

    it('gives the Report sheet the same rows as toReportCSV', () => {
        const pages = flat({ items: rows(60) }).pages;
        const files = unzip(toXLSX(pages));

        expect(pages.length).toBeGreaterThan(1);
        expect(sheet(files, 1)).toHaveLength(toReportCSV(pages).split('\r\n').length);
        expect(sheet(files, 1)[0][0].value).toBe('INVOICE');
    });

    it('gathers a table split across pages into one rectangle', () => {
        const pages = flat({ items: rows(120) }).pages;
        const rowsOut = sheet(unzip(toXLSX(pages)), 2);

        expect(pages.length).toBeGreaterThan(2);
        expect(rowsOut).toHaveLength(121);
        expect(rowsOut[0].map(c => c.value)).toEqual(['Item', 'Qty', 'Price']);
        expect(rowsOut[120][0].value).toBe('row-119');
    });

    it('prepends the group key on a grouped table', () => {
        const files = unzip(toXLSX(grouped({ items: groupedRows(['North', 'South'], 2) }).pages));
        const rowsOut = sheet(files, 2);

        expect(rowsOut[0].map(c => c.value)).toEqual(['Group', 'Item', 'Qty', 'Price']);
        expect(rowsOut[1][0].value).toBe('North');
        expect(rowsOut[3][0].value).toBe('South');
    });

    it('freezes and filters a table sheet\'s header, and not the Report sheet', () => {
        const files = unzip(toXLSX(flat({ items: rows(3) }).pages));

        const report = files.get('xl/worksheets/sheet1.xml');
        const tbl = files.get('xl/worksheets/sheet2.xml');

        expect(report).not.toContain('<pane');
        expect(report).not.toContain('<autoFilter');
        expect(tbl).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
        expect(tbl).toContain('<autoFilter ref="A1:C4"/>');

        const names = xml(files.get('xl/workbook.xml')).getElementsByTagName('definedName');
        expect(names).toHaveLength(1);
        expect(names[0].getAttribute('localSheetId')).toBe('1');
        expect(names[0].textContent).toBe("'tbl'!$A$1:$C$4");
    });

    it('keeps the worksheet children in schema order', () => {
        const tbl = unzip(toXLSX(flat({ items: rows(3) }).pages)).get('xl/worksheets/sheet2.xml');
        const order = ['<dimension', '<sheetViews', '<cols', '<sheetData', '<autoFilter']
            .map(tag => tbl.indexOf(tag));

        expect(order.every(i => i >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it('records the used range', () => {
        const tbl = unzip(toXLSX(flat({ items: rows(3) }).pages)).get('xl/worksheets/sheet2.xml');
        expect(tbl).toContain('<dimension ref="A1:C4"/>');
    });
});


describe('toXLSX - cells', () => {
    it('writes numbers as numbers', () => {
        const rowsOut = sheet(unzip(toXLSX(flat({ items: [{ name: 'Cable', qty: 4, price: 12.5 }] }).pages)), 2);

        expect(rowsOut[1][0]).toMatchObject({ ref: 'A2', type: 'inlineStr', value: 'Cable' });
        expect(rowsOut[1][1]).toMatchObject({ ref: 'B2', type: null, value: '4' });
        expect(rowsOut[1][2]).toMatchObject({ ref: 'C2', type: null, value: '12.5' });
    });

    it('keeps number-like strings as text', () => {
        const rowsOut = sheet(unzip(toXLSX(pagesWith([{ v: '007' }]))), 2);
        expect(rowsOut[1][0]).toMatchObject({ type: 'inlineStr', value: '007' });
    });

    it('bolds header rows', () => {
        const files = unzip(toXLSX(flat({ items: rows(1) }).pages));

        expect(['A1', 'B1', 'C1'].every(ref => look(files, 2, ref).font.bold)).toBe(true);
        expect(['A2', 'B2', 'C2'].some(ref => look(files, 2, ref).font.bold)).toBe(false);
    });

    it('bolds the column labels on the Report sheet too', () => {
        const files = unzip(toXLSX(flat({ items: rows(1) }).pages));

        expect(look(files, 1, 'A1').font.bold).toBe(false);          // INVOICE
        expect(['A2', 'B2', 'C2'].every(ref => look(files, 1, ref).font.bold)).toBe(true);
    });

    it('writes booleans as booleans', () => {
        const rowsOut = sheet(unzip(toXLSX(pagesWith([{ v: true }, { v: false }]))), 2);

        expect(rowsOut[1][0]).toMatchObject({ type: 'b', value: '1' });
        expect(rowsOut[2][0]).toMatchObject({ type: 'b', value: '0' });
    });

    it('writes dates as serial numbers with a date format', () => {
        const files = unzip(toXLSX(pagesWith([
            { v: new Date(2026, 10, 2) },
            { v: new Date(2026, 10, 2, 18, 0) }
        ])));
        const rowsOut = sheet(files, 2);

        expect(rowsOut[1][0].value).toBe('46328');
        expect(rowsOut[2][0].value).toBe('46328.75');
        expect(look(files, 2, 'A2').numFmtId).toBe('14');
        expect(look(files, 2, 'A3').numFmtId).toBe('22');
    });

    it('keeps the table\'s look on a date cell', () => {
        const files = unzip(toXLSX(pagesWith([{ v: new Date(2026, 10, 2) }])));
        const date = look(files, 2, 'A2');

        expect(date.numFmtId).toBe('14');
        expect(date.border.left.style).toBe('thin');
        expect(date.font.name).toBe('Arial');
    });

    it('keeps NaN and Infinity as words', () => {
        const rowsOut = sheet(unzip(toXLSX(pagesWith([{ v: NaN }, { v: Infinity }]))), 2);

        expect(rowsOut[1][0]).toMatchObject({ type: 'inlineStr', value: 'NaN' });
        expect(rowsOut[2][0]).toMatchObject({ type: 'inlineStr', value: 'Infinity' });
    });

    it('leaves empty values out of a plain sheet', () => {
        const rowsOut = sheet(unzip(toXLSX(pagesWith(
            [{ a: null, b: 'x', c: '' }],
            [{ field: 'a' }, { field: 'b' }, { field: 'c' }]
        ), { styled: false })), 2);

        expect(rowsOut[1]).toEqual([{ ref: 'B2', type: 'inlineStr', style: null, value: 'x' }]);
    });

    it('keeps an empty table cell\'s grid on a styled sheet', () => {
        const files = unzip(toXLSX(pagesWith(
            [{ a: null, b: 'x' }],
            [{ field: 'a' }, { field: 'b' }]
        )));

        expect(sheet(files, 2)[1].map(c => [c.ref, c.value])).toEqual([['A2', null], ['B2', 'x']]);
        expect(look(files, 2, 'A2').border.top.style).toBe('thin');
    });

    it('escapes markup', () => {
        const value = '<b>Tom & "Jerry"</b>';
        const rowsOut = sheet(unzip(toXLSX(pagesWith([{ v: value }]))), 2);
        expect(rowsOut[1][0].value).toBe(value);
    });

    it('drops characters XML cannot carry', () => {
        const rowsOut = sheet(unzip(toXLSX(pagesWith([{ v: 'a\u0000b\u0007c\u001Fd' }]))), 2);
        expect(rowsOut[1][0].value).toBe('abcd');
    });

    it('keeps a literal _x0041_ from being read as an escape', () => {
        const source = unzip(toXLSX(pagesWith([{ v: 'id_x0041_' }]))).get('xl/worksheets/sheet2.xml');
        expect(source).toContain('id_x005F_x0041_');
    });

    it('preserves surrounding spaces and line breaks', () => {
        const source = unzip(toXLSX(pagesWith([{ v: '  two\nlines ' }]))).get('xl/worksheets/sheet2.xml');
        expect(source).toContain('<t xml:space="preserve">  two\nlines </t>');
    });

    it('never writes a formula, whatever the text', () => {
        const source = unzip(toXLSX(pagesWith([{ v: '=HYPERLINK("http://x")' }]))).get('xl/worksheets/sheet2.xml');

        expect(source).not.toContain('<f>');
        expect(source).toContain('t="inlineStr"');
        expect(source).not.toContain('\t=');
    });

    it('cuts text at Excel\'s cell limit', () => {
        const rowsOut = sheet(unzip(toXLSX(pagesWith([{ v: 'x'.repeat(40000) }]))), 2);
        expect(rowsOut[1][0].value).toHaveLength(XLSX_LIMITS.cellText);
    });

    it('refuses a sheet wider than Excel allows', () => {
        const columns = Array.from({ length: XLSX_LIMITS.columns + 1 }, (_, i) => ({ field: `f${i}` }));
        expect(() => toXLSX(pagesWith([], columns))).toThrow(RangeError);
    });
});


describe('columnName', () => {
    it('counts in bijective base 26', () => {
        expect(columnName(0)).toBe('A');
        expect(columnName(25)).toBe('Z');
        expect(columnName(26)).toBe('AA');
        expect(columnName(51)).toBe('AZ');
        expect(columnName(701)).toBe('ZZ');
        expect(columnName(702)).toBe('AAA');
        expect(columnName(16383)).toBe('XFD');
    });
});


describe('sheetNames', () => {
    it('replaces the characters Excel bans', () => {
        expect(sheetNames(['a/b\\c:d*e?f[g]h'])).toEqual(['a-b-c-d-e-f-g-h']);
    });

    it('cuts to 31 characters', () => {
        expect(sheetNames(['x'.repeat(40)])[0]).toHaveLength(31);
    });

    it('makes duplicates unique, ignoring case', () => {
        expect(sheetNames(['Sales', 'sales', 'SALES'])).toEqual(['Sales', 'sales (2)', 'SALES (3)']);
    });

    it('keeps a long duplicate within the limit', () => {
        const [, second] = sheetNames(['x'.repeat(40), 'x'.repeat(40)]);
        expect(second).toHaveLength(31);
        expect(second.endsWith(' (2)')).toBe(true);
    });

    it('treats History as taken', () => {
        expect(sheetNames(['History'])).toEqual(['History (2)']);
    });

    it('never leaves a name blank or wrapped in apostrophes', () => {
        expect(sheetNames(['', '   ', "'quoted'"])).toEqual(['Sheet', 'Sheet (2)', 'quoted']);
    });
});


/* ---------------- the report's design ---------------- */

/** a text item with its style overridden */
const styledText = (id, opts = {}, style = {}) => {
    const item = text(id, opts);
    item.style = { ...item.style, ...style };
    return item;
};

/** a flat report around a table with its style overridden */
const tableWith = (style = {}, extra = {}) => run(layout({
    bands: [band('detail', [{ ...table(), ...extra, style: { ...table().style, ...style } }])]
}), { items: rows(3) });

/** a report header of the given items over the standard table */
const headed = (items) => run(layout({
    bands: [band('reportHeader', items, { height: 80 }), band('detail', [table()])]
}), { items: rows(2) });


describe('toXLSX - design', () => {
    it('draws an unstyled table header as report.css does', () => {
        const head = look(unzip(toXLSX(flat({ items: rows(1) }).pages)), 2, 'A1');

        expect(head.fill).toBe('FFF1F3F5');
        expect(head.font).toMatchObject({ bold: true, name: 'Arial', size: 9 });
        expect(head.border.top).toEqual({ style: 'thin', color: 'FFCCCCCC' });
    });

    it('carries a table\'s own header colours and grid', () => {
        const files = unzip(toXLSX(tableWith({
            headerBackground: '#1f4e79', headerColor: '#ffffff',
            borderStyle: 'dashed', borderWidth: 2, borderColor: '#1f4e79',
            color: '#333333', fontSize: 16, fontFamily: 'Verdana, sans-serif'
        }).pages));

        const head = look(files, 2, 'A1');
        expect(head.fill).toBe('FF1F4E79');
        expect(head.font.color).toBe('FFFFFFFF');
        expect(head.border.left).toEqual({ style: 'mediumDashed', color: 'FF1F4E79' });

        const body = look(files, 2, 'A2');
        expect(body.fill).toBeNull();
        expect(body.font).toMatchObject({ name: 'Verdana', size: 12, color: 'FF333333', bold: false });
    });

    it('drops the grid a table turned off', () => {
        const body = look(unzip(toXLSX(tableWith({ borderStyle: 'none' }).pages)), 2, 'A2');
        expect(body.border.left.style).toBeNull();
    });

    it('aligns each column as designed, centred vertically', () => {
        const files = unzip(toXLSX(flat({ items: rows(1) }).pages));

        expect(look(files, 2, 'A2').alignment).toMatchObject({ horizontal: 'left', vertical: 'center' });
        expect(look(files, 2, 'B2').alignment.horizontal).toBe('right');
    });

    it('wraps cells unless the table asks it not to', () => {
        expect(look(unzip(toXLSX(tableWith().pages)), 2, 'A2').alignment.wrapText).toBe(true);
        expect(look(unzip(toXLSX(tableWith({}, { wrap: false }).pages)), 2, 'A2').alignment.wrapText)
            .toBe(false);
    });

    it('insets table cells by report.css\'s padding, and a right-aligned label clear of the filter button', () => {
        const files = unzip(toXLSX(flat({ items: rows(1) }).pages));

        expect(look(files, 2, 'A1').alignment.indent).toBe('1');
        expect(look(files, 2, 'B2').alignment.indent).toBe('1');
        expect(look(files, 2, 'B1').alignment.indent).toBe('2');
        expect(look(files, 1, 'B2').alignment.indent).toBe('1');
    });

    it('does not inset a centred column', () => {
        const files = unzip(toXLSX(run(layout({
            bands: [band('detail', [{ ...table(), columns: [{ field: 'name', label: 'Item', width: 400, align: 'center' }] }])]
        }), { items: rows(1) }).pages));

        expect(look(files, 2, 'A2').alignment.indent).toBeNull();
    });

    it('carries a text item\'s font and colour', () => {
        const files = unzip(toXLSX(headed([
            styledText('t', { value: 'INVOICE', h: 32 },
                { fontSize: 24, fontWeight: 'bold', fontStyle: 'italic', color: '#c00000' })
        ]).pages));

        const title = look(files, 1, 'A1');
        expect(title.font).toMatchObject({ size: 18, bold: true, italic: true, color: 'FFC00000' });
        expect(title.alignment.vertical).toBe('top');
    });

    it('leaves out the text background, border and padding the viewer does not draw', () => {
        const files = unzip(toXLSX(headed([
            styledText('t', { value: 'DRAFT' }, { background: '#eeeeee', border: '2px dashed #c00000', padding: 40 })
        ]).pages));

        const draft = look(files, 1, 'A1');
        expect(draft.fill).toBeNull();
        expect(draft.border.top.style).toBeNull();
        expect(draft.alignment.indent).toBeNull();
        expect(files.has('xl/drawings/drawing1.xml')).toBe(false);
    });

    it('puts text in the column under where it sits on the page', () => {
        /** table columns are 400, 100 and 214px wide, so 414..714 ends in C */
        const files = unzip(toXLSX(headed([
            styledText('left', { value: 'Left', x: 0, w: 300 }),
            styledText('right', { value: 'Right', x: 414, w: 300 }, { align: 'right' })
        ]).pages));

        expect(sheet(files, 1)[0].map(c => [c.ref, c.value])).toEqual([['A1', 'Left'], ['C1', 'Right']]);
        expect(look(files, 1, 'C1').alignment.horizontal).toBe('right');
    });

    it('stacks items that want the same column, rather than moving one sideways', () => {
        const files = unzip(toXLSX(headed([
            styledText('title', { value: 'TITLE', x: 0, w: 300, y: 0, h: 60 }),
            styledText('period', { value: 'June', x: 414, w: 300, y: 0, h: 20 }, { align: 'right' }),
            styledText('made', { value: 'Generated', x: 414, w: 300, y: 24, h: 20 }, { align: 'right' })
        ]).pages));

        const rowsOut = sheet(files, 1);
        expect(rowsOut[0].map(c => [c.ref, c.value])).toEqual([['A1', 'TITLE'], ['C1', 'June']]);
        expect(rowsOut[1].map(c => [c.ref, c.value])).toEqual([['C2', 'Generated']]);
    });

    it('centres a wide text item across the columns it spans', () => {
        const files = unzip(toXLSX(headed([
            styledText('title', { value: 'CENTRED', x: 0, w: 714 }, { align: 'center', fontWeight: 'bold' })
        ]).pages));

        const first = sheet(files, 1)[0];
        expect(first.map(c => [c.ref, c.value])).toEqual([['A1', 'CENTRED'], ['B1', null], ['C1', null]]);
        expect(new Set(first.map(c => c.style)).size).toBe(1);
        expect(look(files, 1, 'A1').alignment.horizontal).toBe('centerContinuous');
        expect(look(files, 1, 'C1').font.bold).toBe(true);
    });

    it('turns gridlines off on the Report sheet only', () => {
        const files = unzip(toXLSX(flat({ items: rows(2) }).pages));

        expect(files.get('xl/worksheets/sheet1.xml')).toContain('showGridLines="0"');
        expect(files.get('xl/worksheets/sheet2.xml')).not.toContain('showGridLines');
    });

    it('gives rows their height on the page, in points', () => {
        const heights = rowElements(unzip(toXLSX(flat({ items: rows(2) }).pages)), 2)
            .map(r => [r.getAttribute('ht'), r.getAttribute('customHeight')]);

        expect(heights).toEqual([['24', '1'], ['21', '1'], ['21', '1']]);
    });

    it('sizes columns as designed', () => {
        const widths = (files, n) => [...xml(files.get(`xl/worksheets/sheet${n}.xml`))
            .getElementsByTagName('col')].map(c => Number(c.getAttribute('width')));

        const files = unzip(toXLSX(flat({ items: rows(2) }).pages));

        expect(widths(files, 1)).toEqual([columnChars(400), columnChars(100), columnChars(214)]);
        expect(widths(files, 2)).toEqual([columnChars(400) + 2.5, columnChars(100) + 2.5, columnChars(214) + 2.5]);
    });

    it('shares one format among every cell that looks the same', () => {
        const files = unzip(toXLSX(flat({ items: rows(300) }).pages));
        const count = xml(files.get('xl/styles.xml')).getElementsByTagName('cellXfs')[0]
            .getAttribute('count');

        expect(Number(count)).toBeLessThan(12);
    });

    it('silences the number-stored-as-text flag', () => {
        const source = unzip(toXLSX(flat({ items: rows(2) }).pages)).get('xl/worksheets/sheet2.xml');
        expect(source).toContain('<ignoredError sqref="A1:C3" numberStoredAsText="1"/>');
    });

    it('writes plain data when asked', () => {
        const files = unzip(toXLSX(flat({ items: rows(2) }).pages, { styled: false }));

        expect(look(files, 2, 'A1').font.bold).toBe(true);
        expect(look(files, 2, 'A1').fill).toBeNull();
        expect(look(files, 2, 'A2').border.left.style).toBeNull();
        expect(files.get('xl/worksheets/sheet1.xml')).not.toContain('showGridLines');
        expect(rowElements(files, 2).every(r => !r.hasAttribute('ht'))).toBe(true);
        expect(sheet(files, 1).map(r => r.length)).toEqual([1, 3, 3, 3]);
    });
});


describe('xlsx-style', () => {
    it('reads CSS colours as ARGB', () => {
        expect(argb('#1f4e79')).toBe('FF1F4E79');
        expect(argb('#abc')).toBe('FFAABBCC');
        expect(argb('#abcd')).toBe('FFAABBCC');
        expect(argb('#11223380')).toBe('FF112233');
        expect(argb('rgb(255, 0, 10)')).toBe('FFFF000A');
        expect(argb('rgb(255 0 10 / 0.5)')).toBe('FFFF000A');
        expect(argb('rgba(0,0,0,0.2)')).toBe('FF000000');
        expect(argb('rgb(100%, 0%, 50%)')).toBe('FFFF0080');
        expect(argb(' Navy ')).toBe('FF000080');
    });

    it('has no colour for what is not one, or is see-through', () => {
        for (const value of [null, undefined, '', 'transparent', 'inherit', '#12', 'hsl(0,0%,0%)',
            'rgba(0,0,0,0)', '#00000000', 'chartreuse-ish', 42]) {
            expect(argb(value), String(value)).toBeNull();
        }
    });

    it('picks a font Office has from a CSS stack', () => {
        expect(fontName('Helvetica, Arial, sans-serif')).toBe('Arial');
        expect(fontName('"Segoe UI", Roboto, sans-serif')).toBe('Segoe UI');
        expect(fontName('Inter, system-ui')).toBe('Inter');
        expect(fontName('serif')).toBe('Times New Roman');
        expect(fontName('monospace')).toBe('Courier New');
        expect(fontName('')).toBe('Arial');
        expect(fontName('x'.repeat(40))).toHaveLength(31);
    });

    it('converts pixels to points and to column widths', () => {
        expect(points(12)).toBe(9);
        expect(points(13)).toBe(10);
        expect(points(28)).toBe(21);
        expect(columnChars(64)).toBe(8.43);
        expect(columnChars(1)).toBe(1);
    });

    it('knows bold when it sees it', () => {
        expect(isBold('bold')).toBe(true);
        expect(isBold('600')).toBe(true);
        expect(isBold(700)).toBe(true);
        expect(isBold('normal')).toBe(false);
        expect(isBold(500)).toBe(false);
        expect(isBold(undefined)).toBe(false);
    });

    it('maps rules to the nearest border Excel draws', () => {
        expect(excelBorder({ style: 'solid', width: 1 }).style).toBe('thin');
        expect(excelBorder({ style: 'solid', width: 2 }).style).toBe('medium');
        expect(excelBorder({ style: 'solid', width: 4 }).style).toBe('thick');
        expect(excelBorder({ style: 'dashed', width: 1 }).style).toBe('dashed');
        expect(excelBorder({ style: 'dashed', width: 3 }).style).toBe('mediumDashed');
        expect(excelBorder({ style: 'dotted', width: 3 }).style).toBe('dotted');
        expect(excelBorder({ style: 'double', width: 3 }).style).toBe('double');
        expect(excelBorder({ style: 'groove', width: 1 }).style).toBe('thin');
        expect(excelBorder({ style: 'none' })).toBeNull();
        expect(excelBorder({ width: 0 })).toBeNull();
    });

    it('rounds pixels of inset to indent levels', () => {
        expect(indentLevels(0)).toBe(0);
        expect(indentLevels(8)).toBe(1);
        expect(indentLevels(14)).toBe(2);
        expect(indentLevels(-5)).toBe(0);
        expect(indentLevels(10000)).toBe(15);
    });

    it('has nothing to say about a cell with no design', () => {
        expect(cellFormat(null)).toBeNull();
        expect(cellFormat({ kind: 'mystery' })).toBeNull();
    });

    it('lets a table turn its header fill off', () => {
        const format = cellFormat({ kind: 'head', column: {}, table: { style: { headerBackground: null } } });
        expect(format.fill).toBeNull();
    });

    it('hands out one index per distinct format', () => {
        const styles = createStyles();
        const a = styles.xf({ font: { bold: true } });
        const b = styles.xf({ font: { bold: true } });
        const c = styles.xf({ font: { bold: true } }, 14);

        expect(a).toBe(b);
        expect(c).not.toBe(a);
        expect(styles.xf(null)).toBe(0);
        expect(styles.size).toBe(3);
    });

    it('keeps the stylesheet defaults in step with report.css', () => {
        const css = readFileSync(new URL('../src/render/report.css', import.meta.url), 'utf8');

        expect(css).toContain(`var(--rs-cell-family, ${REPORT_DEFAULTS.fontFamily})`);
        expect(css).toContain(`var(--rs-cell-size, ${REPORT_DEFAULTS.fontSize}px)`);
        expect(css).toMatch(new RegExp(`\\.page th \\{[^}]*font-weight: ${REPORT_DEFAULTS.headerWeight}`));
        expect(css).toContain(`var(--rs-head-bg, var(--surface-muted, ${REPORT_DEFAULTS.headerBackground}))`);
        expect(css).toContain(`var(--rs-rule-color, var(--border, ${REPORT_DEFAULTS.ruleColor}))`);
        expect(css).toContain(
            `var(--rs-rule-width, ${REPORT_DEFAULTS.ruleWidth}px) var(--rs-rule-style, ${REPORT_DEFAULTS.ruleStyle})`);
        expect(css).toMatch(new RegExp(`\\.page \\.cell \\{[^}]*padding: 0 ${REPORT_DEFAULTS.cellPadding}px`));
    });
});


/* ---------------- page geometry ---------------- */

describe('toXLSX - page geometry', () => {
    it('spaces rows as the page spaces its lines', () => {
        const files = unzip(toXLSX(headed([
            styledText('a', { value: 'First', y: 0, h: 20 }),
            styledText('b', { value: 'Second', y: 40, h: 20 })
        ]).pages));

        expect(rowElements(files, 1)[0].getAttribute('ht')).toBe(String(points(40)));
    });

    it('keeps no more than a little of a long gap', () => {
        const files = unzip(toXLSX(run(layout({
            bands: [
                band('reportHeader', [
                    styledText('a', { value: 'Top', y: 0, h: 20 }),
                    styledText('b', { value: 'Far below', y: 300, h: 20 })
                ], { height: 340 }),
                band('detail', [table()])
            ]
        }), { items: rows(1) }).pages));

        expect(rowElements(files, 1)[0].getAttribute('ht')).toBe(String(points(20 + 24)));
    });

    it('indents text by how far into its column it starts', () => {
        const files = unzip(toXLSX(headed([styledText('a', { value: 'Inset', x: 14, w: 200 })]).pages));
        expect(look(files, 1, 'A1').alignment.indent).toBe('2');
    });

    it('reads a placeholder that printed a plain number as a number', () => {
        const files = unzip(toXLSX(headed([
            styledText('sum', { value: '{sum(qty)}', y: 0, h: 20 }),
            styledText('label', { value: 'Total {sum(qty)}', y: 30, h: 20 }),
            styledText('literal', { value: '2026', y: 60, h: 20 })
        ]).pages));

        const [sum, label, literal] = sheet(files, 1);
        expect(sum[0]).toMatchObject({ type: null, value: '1' });
        expect(label[0]).toMatchObject({ type: 'inlineStr', value: 'Total 1' });
        expect(literal[0]).toMatchObject({ type: 'inlineStr', value: '2026' });
    });
});


/* ---------------- drawings ---------------- */

/** the first bytes of a PNG: enough for sniffImage to read its size */
const fakePng = (w, h) => {
    const bytes = new Uint8Array(33);
    bytes.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, w);
    view.setUint32(20, h);
    return bytes;
};

const pngUri = (bytes) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;

/** a report header holding the given items, over the standard table */
const drawn = (items, data = { items: rows(2) }) => run(layout({
    bands: [band('reportHeader', items, { height: 140 }), band('detail', [table()])]
}), data);

const anchorsOf = (files) => [...xml(files.get('xl/drawings/drawing1.xml'))
    .getElementsByTagName('xdr:oneCellAnchor')];

const extOf = (anchor) => {
    const ext = anchor.getElementsByTagName('xdr:ext')[0];
    return { cx: Number(ext.getAttribute('cx')), cy: Number(ext.getAttribute('cy')) };
};


describe('toXLSX - drawings', () => {
    it('adds no drawing to a report with nothing to draw', () => {
        const files = unzip(toXLSX(flat({ items: rows(2) }).pages));

        expect([...files.keys()].some(name => name.includes('drawing'))).toBe(false);
        expect(files.get('xl/worksheets/sheet1.xml')).not.toContain('<drawing');
    });

    it('embeds a picture with every part Excel needs', () => {
        const bytes = fakePng(200, 100);
        const files = unzip(toXLSX(drawn([
            image('logo', { src: pngUri(bytes), w: 70, h: 60, alt: 'Acme logo' })
        ]).pages));

        expect(files.get('xl/media/image1.png')).toBe(new TextDecoder().decode(bytes));
        expect(files.get('xl/worksheets/sheet1.xml')).toMatch(/<drawing r:id="rId1"\/><\/worksheet>$/);
        expect(files.get('xl/worksheets/_rels/sheet1.xml.rels')).toContain('Target="../drawings/drawing1.xml"');
        expect(files.get('xl/drawings/_rels/drawing1.xml.rels')).toContain('Target="../media/image1.png"');

        const types = files.get('[Content_Types].xml');
        expect(types).toContain('<Default Extension="png" ContentType="image/png"/>');
        expect(types).toContain('PartName="/xl/drawings/drawing1.xml"');

        const pic = xml(files.get('xl/drawings/drawing1.xml')).getElementsByTagName('xdr:pic')[0];
        expect(pic.getElementsByTagName('a:blip')[0].getAttribute('r:embed')).toBe('rId1');
        expect(pic.getElementsByTagName('xdr:cNvPr')[0].getAttribute('descr')).toBe('Acme logo');
    });

    it('letterboxes a contained picture as the page does', () => {
        const files = unzip(toXLSX(drawn([
            image('logo', { src: pngUri(fakePng(200, 100)), w: 70, h: 60, fit: 'contain' })
        ]).pages));

        expect(extOf(anchorsOf(files)[0])).toEqual({ cx: emu(70), cy: emu(35) });
    });

    it('crops a covering picture as the page does', () => {
        const files = unzip(toXLSX(drawn([
            image('photo', { src: pngUri(fakePng(60, 180)), w: 60, h: 60, fit: 'cover' })
        ]).pages));

        const crop = xml(files.get('xl/drawings/drawing1.xml')).getElementsByTagName('a:srcRect')[0];
        expect(['l', 't', 'r', 'b'].map(k => crop.getAttribute(k))).toEqual(['0', '33333', '0', '33333']);
        expect(extOf(anchorsOf(files)[0])).toEqual({ cx: emu(60), cy: emu(60) });
    });

    it('stores a picture once however often it is drawn', () => {
        const src = pngUri(fakePng(10, 10));
        const files = unzip(toXLSX(drawn([
            image('a', { src, x: 0 }),
            image('b', { src, x: 400 })
        ]).pages));

        expect([...files.keys()].filter(name => name.startsWith('xl/media/'))).toEqual(['xl/media/image1.png']);
        expect(anchorsOf(files)).toHaveLength(2);
    });

    it('leaves out a picture it has no bytes for, or cannot embed', () => {
        const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
        const files = unzip(toXLSX(drawn([
            image('url', { src: 'https://example.test/logo.png' }),
            image('webp', { src: `data:image/webp;base64,${Buffer.from(webp).toString('base64')}`, x: 300 })
        ]).pages));

        expect(files.has('xl/drawings/drawing1.xml')).toBe(false);
    });

    it('embeds a URL picture whose bytes it is given', () => {
        const pages = drawn([image('url', { src: 'https://example.test/logo.png' })]).pages;
        const files = unzip(toXLSX(pages, { images: { 'https://example.test/logo.png': fakePng(10, 10) } }));

        expect(files.has('xl/media/image1.png')).toBe(true);
    });

    it('lists the pictures that need fetching, once each', () => {
        const pages = drawn([
            image('a', { src: 'https://example.test/a.png' }),
            image('b', { src: 'https://example.test/a.png', x: 200 }),
            image('c', { src: pngUri(fakePng(1, 1)), x: 400 })
        ]).pages;

        expect(reportImageSources(pages)).toEqual(['https://example.test/a.png']);
    });

    it('fetches URL pictures, and does without one that fails', async () => {
        const pages = drawn([
            image('ok', { src: 'https://example.test/ok.png' }),
            image('gone', { src: 'https://example.test/gone.png', x: 300 })
        ]).pages;

        const fetch = vi.fn(async (url) => {
            if (url.endsWith('gone.png')) throw new Error('offline');
            return { ok: true, arrayBuffer: async () => fakePng(10, 10).buffer };
        });

        const files = unzip(await toXLSXAsync(pages, { fetch }));

        expect(fetch).toHaveBeenCalledTimes(2);
        expect(anchorsOf(files)).toHaveLength(1);
    });

    it('draws a rule with its weight, style and colour', () => {
        const files = unzip(toXLSX(drawn([
            line('rule', { y: 40, w: 714, h: 10, thickness: 2, lineStyle: 'dashed', color: '#1f4e79' })
        ]).pages));

        const shape = xml(files.get('xl/drawings/drawing1.xml')).getElementsByTagName('xdr:cxnSp')[0];
        const ln = shape.getElementsByTagName('a:ln')[0];

        expect(shape.getElementsByTagName('a:prstGeom')[0].getAttribute('prst')).toBe('line');
        expect(ln.getAttribute('w')).toBe(String(emu(2)));
        expect(ln.getElementsByTagName('a:prstDash')[0].getAttribute('val')).toBe('dash');
        expect(ln.getElementsByTagName('a:srgbClr')[0].getAttribute('val')).toBe('1F4E79');
        expect(extOf(anchorsOf(files)[0])).toEqual({ cx: emu(714), cy: 0 });
    });

    it('draws a vertical rule down, and a double one doubled', () => {
        const files = unzip(toXLSX(drawn([
            line('v', { x: 300, w: 10, h: 60, orientation: 'vertical', lineStyle: 'double' })
        ]).pages));

        expect(extOf(anchorsOf(files)[0]).cx).toBe(0);
        expect(files.get('xl/drawings/drawing1.xml')).toContain('cmpd="dbl"');
    });

    it('draws a box with nothing on it as a filled, rounded shape', () => {
        const files = unzip(toXLSX(drawn([
            box('bar', { x: 0, y: 0, w: 300, h: 60, background: '#c00000', borderWidth: 2, radius: 12 })
        ]).pages));

        const shape = xml(files.get('xl/drawings/drawing1.xml')).getElementsByTagName('xdr:sp')[0];
        const geometry = shape.getElementsByTagName('a:prstGeom')[0];

        expect(geometry.getAttribute('prst')).toBe('roundRect');
        /** 12px corners less the 1px inset, over the 58px inset height */
        expect(geometry.getElementsByTagName('a:gd')[0].getAttribute('fmla'))
            .toBe(`val ${Math.round((11 / 58) * 100000)}`);
        expect(shape.getElementsByTagName('a:solidFill')[0].getElementsByTagName('a:srgbClr')[0]
            .getAttribute('val')).toBe('C00000');
        /** the border is drawn inside the box: a 2px stroke centred 1px in from each edge */
        expect(extOf(anchorsOf(files)[0]).cx).toBe(emu(298));
    });

    it('paints a box\'s fill into the cells under text, and draws only its outline', () => {
        const files = unzip(toXLSX(drawn([
            box('panel', { x: 0, y: 0, w: 714, h: 40, background: '#eaf2fb', borderColor: '#1f4e79' }),
            styledText('label', { value: 'TOTAL', x: 10, y: 10, w: 300, h: 20 })
        ]).pages));

        expect(look(files, 1, 'A1').fill).toBe('FFEAF2FB');

        const shape = xml(files.get('xl/drawings/drawing1.xml')).getElementsByTagName('xdr:sp')[0];
        const spPr = shape.getElementsByTagName('xdr:spPr')[0];
        expect([...spPr.children].map(c => c.tagName)).toContain('a:noFill');
        expect(spPr.getElementsByTagName('a:ln')[0].getElementsByTagName('a:srgbClr')[0]
            .getAttribute('val')).toBe('1F4E79');
    });

    it('draws nothing for a box with no fill and no border', () => {
        const files = unzip(toXLSX(drawn([
            box('ghost', { borderStyle: 'none' }),
            styledText('t', { value: 'Text', y: 100 })
        ]).pages));

        expect(files.has('xl/drawings/drawing1.xml')).toBe(false);
    });

    it('gives a graphic on a line of its own a row of its own', () => {
        const pages = drawn([
            styledText('above', { value: 'Above', y: 0, h: 20 }),
            line('rule', { y: 30, w: 714, h: 10 }),
            styledText('below', { value: 'Below', y: 50, h: 20 })
        ]).pages;

        const rowsOut = sheet(unzip(toXLSX(pages)), 1);
        expect(rowsOut.slice(0, 3).map(r => r.map(c => c.value))).toEqual([['Above'], [], ['Below']]);

        expect(reportRows(pages).some(r => r.cells.length === 0)).toBe(false);
        expect(toReportCSV(pages).split('\r\n').slice(0, 2)).toEqual(['Above', 'Below']);
    });

    it('keeps a graphic its height where it reaches past its text', () => {
        const pages = drawn([
            box('panel', { x: 0, y: 0, w: 714, h: 60, background: '#eeeeee' }),
            styledText('t', { value: 'Inside', x: 10, y: 20, w: 300, h: 20 })
        ]).pages;

        const { rows: laid } = reportLayout(pages);
        expect(laid.slice(0, 3).map(r => [r.spacer ?? false, r.top - laid[0].top, r.height]))
            .toEqual([[true, 0, 20], [false, 20, 20], [true, 40, 20]]);
    });

    it('draws nothing on a plain sheet', () => {
        const files = unzip(toXLSX(drawn([line('rule', { y: 0 }), styledText('t', { value: 'x', y: 30 })]).pages,
            { styled: false }));

        expect(files.has('xl/drawings/drawing1.xml')).toBe(false);
    });
});


describe('xlsx-drawing', () => {
    it('reads a picture\'s format and size from its bytes', () => {
        expect(sniffImage(fakePng(640, 480))).toEqual({ ext: 'png', width: 640, height: 480 });

        const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x00, 0x10, 0x00]);
        expect(sniffImage(gif)).toEqual({ ext: 'gif', width: 32, height: 16 });

        const bmp = new Uint8Array(26);
        bmp.set([0x42, 0x4D]);
        new DataView(bmp.buffer).setInt32(18, 12, true);
        new DataView(bmp.buffer).setInt32(22, -7, true);
        expect(sniffImage(bmp)).toEqual({ ext: 'bmp', width: 12, height: 7 });

        const jpeg = new Uint8Array([
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00,
            0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x30, 0x00, 0x40, 0x03
        ]);
        expect(sniffImage(jpeg)).toEqual({ ext: 'jpeg', width: 64, height: 48 });
    });

    it('does not recognise what it will not embed', () => {
        expect(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBeNull();
        expect(sniffImage(new Uint8Array(3))).toBeNull();
        expect(sniffImage(null)).toBeNull();
    });

    it('decodes a base64 data URI, and nothing else', () => {
        expect([...decodeDataUri('data:image/png;base64,AAEC')]).toEqual([0, 1, 2]);
        expect(decodeDataUri('https://example.test/a.png')).toBeNull();
        expect(decodeDataUri('data:image/png;base64,!!!')).toBeNull();
    });

    it('fits a picture the three ways object-fit does', () => {
        const boxSize = { w: 100, h: 100 };
        const natural = { width: 200, height: 100 };

        expect(fitImage('contain', boxSize, natural)).toEqual({ x: 0, y: 25, w: 100, h: 50, crop: null });
        expect(fitImage('fill', boxSize, natural)).toEqual({ x: 0, y: 0, w: 100, h: 100, crop: null });
        expect(fitImage('cover', boxSize, natural).crop).toEqual({ l: 25000, r: 25000, t: 0, b: 0 });
        expect(fitImage('contain', boxSize, { width: null, height: null }).w).toBe(100);
    });

    it('turns line styles into pens', () => {
        expect(pen({ style: 'dashed' })).toMatchObject({ dash: 'dash', double: false });
        expect(pen({ style: 'dotted' })).toMatchObject({ dash: 'sysDot' });
        expect(pen({ style: 'double' })).toMatchObject({ double: true });
        expect(pen({ style: 'none' })).toBeNull();
        expect(pen({ width: 0 })).toBeNull();
    });
});


describe('reportLayout', () => {
    it('places graphics on the page, in the rows\' coordinates', () => {
        const pages = drawn([line('rule', { y: 30 })]).pages;
        const { graphics } = reportLayout(pages);
        const header = pages[0].bands.find(b => b.type === 'reportHeader');

        expect(graphics).toHaveLength(1);
        expect(graphics[0]).toMatchObject({ kind: 'line', page: 0, y: header.top + 30 });
    });

    it('runs a table\'s rows down the page', () => {
        const { rows: laid } = reportLayout(flat({ items: rows(3) }).pages);
        const table = laid.filter(r => r.design[0]?.kind === 'head' || r.design[0]?.kind === 'cell');

        expect(table.map(r => r.top - table[0].top)).toEqual([0, 32, 60, 88]);
    });
});

/**
 * xlsx.js writes a report out as an Excel workbook (.xlsx, Office Open XML).
 *
 * The workbook holds the two shapes CSV offers, side by side, because a
 * workbook has room for both:
 *
 * - a "Report" sheet: the report as it reads on paper - every text line and
 *   table row, in page order, the rows toReportCSV writes (a line whose items
 *   are stacked in one column takes a row per item);
 * - one sheet per table: that table's rows as one rectangle, header row frozen
 *   and filterable, the same rows toCSV writes for it.
 *
 * Unlike CSV the cells are typed. A number in the data is a number Excel can
 * sum, a boolean is a boolean, and a Date is a date. Strings stay strings - a
 * "007" or a phone number is not second-guessed into a number. The one string
 * that is read as a number is a text item that printed nothing but a
 * placeholder's number, such as `{sum(amount)}`: a total, which belongs in a
 * cell a reader can add up. Strings are written inline, which Excel never
 * evaluates, so the formula guard CSV needs has no work to do here.
 *
 * And unlike CSV the workbook looks like the report. Fonts, colours,
 * alignment, the table grid and the header's fill come across as cell formats
 * (xlsx-style.js). On the Report sheet the page's geometry does too: a text
 * item goes in the column under where it sat, inset by an indent to where it
 * started; rows are as tall, and as far apart, as the lines on the page; and
 * pictures, rules and boxes are drawn where the page has them (xlsx-drawing.js).
 * `styled: false` gives plain data instead, headers bold and nothing else.
 *
 * An .xlsx file is a ZIP of XML parts; zip.js packs them. No dependency: the
 * parts below are the minimum Excel opens without complaint (ECMA-376 Part 1,
 * SpreadsheetML and DrawingML).
 *
 * Like every exporter (spec 2.2) it reads the built pages, through rows.js, and
 * never the layout or the data.
 */

import { reportLayout, reportRows, tableRows, reportTables, columnLabel } from './rows.js';
import {
    argb, cellFormat, createStyles, columnChars, indentLevels, DEFAULT_COLUMN_PX, points
} from './xlsx-style.js';
import {
    box, decodeDataUri, drawingRels, drawingXml, fitImage, pen, picture, rule, sniffImage,
    DRAWING_CONTENT_TYPE, IMAGE_TYPES, REL_DRAWING
} from './xlsx-drawing.js';
import { imageSrc } from '../render/items.js';
import { zip } from './zip.js';


/** Excel's hard limits; past them it refuses the whole file */
export const XLSX_LIMITS = Object.freeze({
    rows: 1048576,
    columns: 16384,
    cellText: 32767,
    sheetName: 31
});

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_DOC = `${NS_REL}/officeDocument`;
const REL_SHEET = `${NS_REL}/worksheet`;
const REL_STYLES = `${NS_REL}/styles`;
const CT_SHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const CT_BOOK = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const CT_STYLES = 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml';

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** the one format an unstyled workbook has: a bold header */
const BOLD = Object.freeze({ font: Object.freeze({ bold: true }) });

/** built-in number formats, which follow the reader's locale */
const NUMFMT_DATE = 14;
const NUMFMT_DATE_TIME = 22;

/** characters XML 1.0 cannot carry at all, escaped or not */
const INVALID_XML = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g;

/** Excel reads `_x0041_` in a string as an escaped character; this guards literal ones */
const EXCEL_ESCAPE = /_(x[0-9A-Fa-f]{4}_)/g;

/** characters a sheet name cannot hold */
const SHEET_NAME_BANNED = /[\[\]:*?\/\\\x00-\x1F]/g;

/** content-based column widths, in Excel's character units */
const MIN_WIDTH = 8;
const MAX_WIDTH = 60;

/**
 * How far right text placement will add columns past the last table column.
 * Past it, text goes in the last column and spills - a band item at x 5000 is a
 * layout mistake, not a reason for a sheet eighty columns wide.
 */
const MAX_PLACED_COLUMNS = 50;

/** the drop-down a filtered header row draws, about 16px, in characters */
const FILTER_BUTTON_CHARS = 2.5;

/** and as indent levels, for a right-aligned label to stand clear of it */
const FILTER_BUTTON_INDENT = 2;

/**
 * The most white space a Report sheet row carries below its content. The page
 * leaves gaps - between header lines, and a long one above the footer - and a
 * row keeps the page's gap up to this much, so the sheet is spaced like the
 * report without a screenful of empty row above every page footer.
 */
const MAX_GAP_PX = 24;

/** a row with nothing measured in it, which Excel draws at 20px */
const DEFAULT_ROW_PX = 20;

/** a text item that printed only a number: a total, read as one */
const NUMERIC_TEXT = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/** a placeholder in a text template */
const PLACEHOLDER = /\{[^{}]+\}/;


/**
 * The report as an .xlsx workbook.
 *
 * @param {object[]} pages the `pages` array from buildPages
 * @param {object} [options]
 * @param {boolean} [options.report=true] include the "Report" sheet - the
 *   report as it reads, in page order
 * @param {boolean} [options.tables=true] include one sheet per table
 * @param {boolean} [options.styled=true] carry the report's look - formats,
 *   placement, spacing, pictures, rules and boxes; false writes plain data
 *   with bold headers
 * @param {string} [options.reportSheetName='Report']
 * @param {boolean} [options.groupColumn=true] prepend the group key on a
 *   grouped table's sheet, as toCSV does
 * @param {string} [options.groupLabel='Group']
 * @param {Object<string, Uint8Array|ArrayBuffer>|Map} [options.images] the
 *   bytes of pictures that are not `data:` URIs, keyed by their src - which is
 *   what toXLSXAsync fetches. A picture with no bytes is left out
 * @returns {Uint8Array} the file's bytes; empty when the report writes nothing
 * @throws {RangeError} when a sheet would pass Excel's row or column limit -
 *   Excel would refuse the file, so none is made
 */
export function toXLSX(pages, options = {}) {
    const {
        report = true,
        tables = true,
        styled = true,
        reportSheetName = 'Report',
        groupColumn = true,
        groupLabel = 'Group',
        images = null
    } = options;

    const sheets = [];

    if (report && reportRows(pages).length > 0) {
        sheets.push(reportSheet(pages, reportSheetName, styled, images));
    }

    if (tables) {
        for (const { id } of reportTables(pages)) {
            sheets.push(tableSheet(tableRows(pages, id), styled, groupColumn, groupLabel));
        }
    }

    if (sheets.length === 0) return new Uint8Array(0);

    const names = sheetNames(sheets.map(s => s.name));
    sheets.forEach((sheet, i) => {
        sheet.name = names[i];
        sheet.width = sheet.rows.reduce((n, r) => Math.max(n, r.cells.length), 0);
    });

    /** every sheet has asked for its formats before styles.xml is written */
    const styles = createStyles();
    const worksheets = sheets.map(sheet => worksheet(sheet, styles));

    /** drawings, numbered in sheet order; only the Report sheet has one today */
    const drawings = [];
    const media = [];
    sheets.forEach((sheet, i) => {
        if (!sheet.drawing) return;
        drawings.push({ sheet: i + 1, n: drawings.length + 1, ...sheet.drawing });
        media.push(...sheet.drawing.media);
    });

    return zip([
        { name: '[Content_Types].xml', data: contentTypes(sheets.length, drawings, media) },
        { name: '_rels/.rels', data: packageRels() },
        { name: 'xl/workbook.xml', data: workbook(sheets) },
        { name: 'xl/_rels/workbook.xml.rels', data: workbookRels(sheets.length) },
        { name: 'xl/styles.xml', data: styles.xml() },
        ...worksheets.map((data, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data })),
        ...drawings.flatMap(d => [
            { name: `xl/worksheets/_rels/sheet${d.sheet}.xml.rels`, data: sheetRels(d.n) },
            { name: `xl/drawings/drawing${d.n}.xml`, data: drawingXml(d.anchors) },
            ...(d.media.length
                ? [{ name: `xl/drawings/_rels/drawing${d.n}.xml.rels`, data: drawingRels(d.media) }]
                : [])
        ]),
        ...media.map(m => ({ name: `xl/media/${m.file}`, data: m.bytes }))
    ]);
}


/**
 * toXLSX, with the report's pictures fetched first.
 *
 * A picture held in the layout as a `data:` URI needs nothing fetched, so
 * toXLSX embeds it on its own. One given as a URL needs its bytes, which only
 * a fetch can get, and a fetch is asynchronous - hence this. A picture that
 * cannot be fetched (offline, refused by CORS) is left out of the workbook
 * rather than failing it.
 *
 * @param {object[]} pages
 * @param {object} [options] as toXLSX, plus
 * @param {Function} [options.fetch] defaults to the global fetch
 * @returns {Promise<Uint8Array>}
 */
export async function toXLSXAsync(pages, options = {}) {
    const fetcher = options.fetch ?? globalThis.fetch;
    const images = new Map(options.images instanceof Map
        ? options.images
        : Object.entries(options.images ?? {}));

    if (typeof fetcher === 'function') {
        await Promise.all(reportImageSources(pages)
            .filter(src => !images.has(src))
            .map(async (src) => {
                try {
                    const response = await fetcher(src);
                    if (response?.ok) images.set(src, new Uint8Array(await response.arrayBuffer()));
                } catch {
                    /** left out, as a picture that failed to load prints nothing */
                }
            }));
    }

    return toXLSX(pages, { ...options, images });
}


/**
 * The pictures a report shows that need fetching before they can be embedded:
 * every distinct URL, leaving out `data:` URIs, which carry their own bytes.
 *
 * @param {object[]} pages
 * @returns {string[]}
 */
export function reportImageSources(pages) {
    const found = new Set();

    for (const g of reportLayout(pages).graphics) {
        if (g.kind !== 'image') continue;
        const src = imageSrc(g.item.resolvedSrc);
        if (src && !/^data:/i.test(src)) found.add(src);
    }

    return [...found];
}


/* ---------------- the sheets ---------------- */


/**
 * A sheet is { name, rows, frozen, gridLines, widths, drawing }, where each row
 * is { cells, height } and each cell is { value, format } - cells may have
 * holes, which are empty cells. Formats are resolved to numbers only when the
 * sheet is written.
 */

/**
 * The report as it reads. Styled, it is laid out like the page: table rows in
 * their columns, text where it sat, rows spaced as the page spaces them,
 * graphics drawn over, gridlines off so it looks like paper.
 */
function reportSheet(pages, name, styled, images) {
    const { rows, graphics } = reportLayout(pages);

    if (!styled) {
        const plain = rows.filter(r => !r.spacer).map(({ cells, header }) => ({
            cells: cells.map(value => ({ value, format: header ? BOLD : null })),
            height: null
        }));

        return { name, rows: plain, frozen: false, gridLines: true, widths: contentWidths(plain) };
    }

    const grid = columnGrid(rows);
    const formats = formatCache();

    const laidOut = rows.flatMap((row) => {
        if (row.spacer) return [{ cells: [], page: row.page, top: row.top, own: row.height }];

        const isText = row.design?.length > 0 && row.design.every(d => d?.kind === 'text');
        if (isText) return placeText(row, grid, formats);

        return [{
            cells: row.cells.map((value, i) => ({ value, format: formats(row.design?.[i]) })),
            page: row.page, top: row.top, own: row.height
        }];
    });

    spaceRows(laidOut);

    const drawing = drawGraphics(graphics, laidOut, grid, images);

    const width = laidOut.reduce((n, r) => Math.max(n, r.cells.length), grid.px.length);
    const widths = Array.from({ length: width }, (_, i) => columnChars(grid.px[i] ?? DEFAULT_COLUMN_PX));

    return {
        name,
        rows: laidOut.map(r => ({ cells: r.cells, height: r.height })),
        frozen: false,
        gridLines: false,
        widths,
        drawing: drawing.anchors.length ? drawing : null
    };
}


/**
 * One table as a sheet: the labels, then every row across every page.
 * Grouped tables get the group key as a first column, so the groups survive a
 * sort - the same choice toCSV makes.
 */
function tableSheet(table, styled, groupColumn, groupLabel) {
    const grouped = groupColumn && table.rows.some(r => r.group !== null);
    const columns = grouped ? [{ field: null, align: 'left' }, ...table.columns] : table.columns;
    const labels = grouped ? [groupLabel, ...table.columns.map(columnLabel)] : table.columns.map(columnLabel);

    /**
     * One format object per column, so the writer resolves each once. A
     * right-aligned label is indented clear of the filter button, which sits on
     * the cell's right edge however wide the column is.
     */
    const headFormats = columns.map((column) => {
        if (!styled) return BOLD;

        const format = cellFormat({ kind: 'head', column, table: table.table });
        return format.alignment.horizontal === 'right'
            ? {
                ...format,
                alignment: {
                    ...format.alignment,
                    indent: Math.max(format.alignment.indent ?? 0, FILTER_BUTTON_INDENT)
                }
            }
            : format;
    });
    const cellFormats = columns.map(column =>
        styled ? cellFormat({ kind: 'cell', column, table: table.table }) : null);

    const rows = [{
        cells: labels.map((value, i) => ({ value, format: headFormats[i] })),
        height: styled ? table.headerHeight : null
    }];

    for (const { group, row, height } of table.rows) {
        const values = table.columns.map(c => row?.[c.field]);
        const cells = grouped ? [group, ...values] : values;

        rows.push({
            cells: cells.map((value, i) => ({ value, format: cellFormats[i] })),
            height: styled ? height : null
        });
    }

    /** room for the filter button, which otherwise sits on a right-aligned label */
    const fromContent = contentWidths(rows);
    const widths = styled
        ? columns.map((c, i) => (Number(c.width) > 0 ? columnChars(Number(c.width)) : fromContent[i])
            + FILTER_BUTTON_CHARS)
        : fromContent.map(w => w + FILTER_BUTTON_CHARS);

    return { name: table.id, rows, frozen: true, gridLines: true, widths };
}


/**
 * The Report sheet's columns, in pixels: as wide as the widest table column
 * drawn at each position. Text and graphics are placed against these edges,
 * which works because a table, a text item and a picture all measure x from
 * the same band edge - so sheet pixels and page pixels are the same pixels.
 *
 * `at` finds the column under an x, growing default-width columns past the
 * last table column so anything further right still has somewhere to go.
 */
function columnGrid(rows) {
    const px = [];

    for (const row of rows) {
        row.design?.forEach((d, i) => {
            if (!d || d.kind === 'text') return;
            const w = Number(d.column?.width);
            px[i] = Math.max(px[i] ?? 0, w > 0 ? w : DEFAULT_COLUMN_PX);
        });
    }

    for (let i = 0; i < px.length; i++) px[i] ??= DEFAULT_COLUMN_PX;

    function at(x) {
        let edge = 0;

        for (let i = 0; ; i++) {
            if (i === px.length) {
                if (px.length >= MAX_PLACED_COLUMNS) return px.length - 1;
                px.push(DEFAULT_COLUMN_PX);
            }

            edge += px[i];
            if (x < edge) return i;
        }
    }

    const left = (col) => px.slice(0, col).reduce((sum, w) => sum + w, 0);
    const right = (col) => left(col) + px[col];

    return { px, at, left, right };
}


/**
 * A line of text items, each in the column under it.
 *
 * Left-aligned text goes where it starts and right-aligned where it ends, and
 * Excel spills each into its empty neighbours the way it ran on the page. The
 * distance between the item's edge and its column's is kept as an indent, so
 * text that started 14px into a column still does. Centred text that spans
 * several columns is centred across them with Excel's "centre across
 * selection", which needs no merged cells and so keeps the sheet sortable.
 *
 * Two items wanting one column - a date stacked under a period on the right of
 * a header, which share a line only because a tall title beside them spans
 * both - cannot share a cell, and moving one sideways would put it where the
 * page does not. So the later one goes on a row of its own beneath, in the
 * same column, which is where the page has it.
 *
 * @returns {{cells: object[], page: number, top: number, own: number}[]} one
 *   row, or more; `top` and `own` are the page position and content height
 */
function placeText(row, grid, formats) {
    const lines = [];

    const lineFor = (columns) => {
        let line = lines.find(l => columns.every(c => l.cells[c] === undefined));
        if (!line) {
            line = { cells: [], top: Infinity, bottom: -Infinity };
            lines.push(line);
        }
        return line;
    };

    row.cells.forEach((raw, i) => {
        const design = row.design[i];
        const align = formats(design)?.alignment?.horizontal ?? 'left';
        const value = numericText(raw, design.template);

        const x = Math.max(0, Number(design.x) || 0);
        const w = Math.max(1, Number(design.w) || 1);
        const first = grid.at(x);
        const last = Math.max(first, grid.at(x + w - 1));

        let line;

        if (align === 'center' && last > first) {
            const span = Array.from({ length: last - first + 1 }, (_, k) => first + k);
            const across = formats.text(design, { centred: true });

            line = lineFor(span);
            line.cells[first] = { value, format: across };
            for (let c = first + 1; c <= last; c++) line.cells[c] = { value: null, format: across };
        } else {
            const c = align === 'right' ? last : first;
            const inset = align === 'right' ? grid.right(c) - (x + w) : x - grid.left(c);

            line = lineFor([c]);
            line.cells[c] = { value, format: formats.text(design, { indent: indentLevels(inset) }) };
        }

        line.top = Math.min(line.top, design.y);
        line.bottom = Math.max(line.bottom, design.y + (Number(design.h) || 0));
    });

    return lines.map(l => ({ cells: l.cells, page: row.page, top: l.top, own: l.bottom - l.top }));
}


/**
 * A text item's value, as a number when it is a total: the item's template
 * holds a placeholder and what it printed is a plain number and nothing else.
 *
 * Kept as text when it could be anything else - a leading zero ("007"), a
 * label beside the figure ("Total: 1200"), a literal number typed into the
 * layout, or more digits than Excel shows without switching to 1.2E+11 or
 * than a double holds exactly.
 */
function numericText(value, template) {
    if (typeof value !== 'string' || typeof template !== 'string') return value;
    if (!PLACEHOLDER.test(template)) return value;

    const text = value.trim();
    if (!NUMERIC_TEXT.test(text)) return value;

    const whole = text.replace(/^-/, '').split('.')[0];
    const digits = text.replace(/[-.]/g, '');
    if (whole.length > 11 || digits.length > 15) return value;

    return Number(text);
}


/**
 * Row heights for the Report sheet: each row as tall as its content, plus the
 * page's gap below it - up to MAX_GAP_PX - so the sheet is spaced the way the
 * page is. Also where each row starts down the sheet, which is how a graphic
 * finds the row to anchor to.
 */
function spaceRows(rows) {
    let sheetTop = 0;

    rows.forEach((row, i) => {
        const own = row.own > 0 ? row.own : DEFAULT_ROW_PX;
        const next = rows[i + 1];

        let height = own;
        if (next && next.page === row.page) {
            const gap = next.top - row.top;
            if (gap > own) height = Math.min(gap, own + MAX_GAP_PX);
        }

        /** the height Excel will draw: points, to the half point, back to pixels */
        row.height = points(height) / 0.75;
        row.sheetTop = sheetTop;
        sheetTop += row.height;
    });
}


/**
 * Where a page position lands on the sheet: the row it falls in and how far
 * down that row, the column and how far across.
 *
 * A row is found by its page position, the last one on that page starting at
 * or above y, and the offset is kept inside it - a row whose gap was capped is
 * shorter on the sheet than on the page, and what fell in the gap lands at its
 * foot rather than in the next row.
 */
function locator(rows, grid) {
    const byPage = new Map();
    rows.forEach((row, i) => {
        if (!byPage.has(row.page)) byPage.set(row.page, []);
        byPage.get(row.page).push(i);
    });

    function y(page, value) {
        const list = byPage.get(page) ?? [rows.length - 1];

        let pick = list[0];
        for (const i of list) {
            if (rows[i].top <= value && rows[i].top >= rows[pick].top) pick = i;
        }

        const r = rows[pick];
        const offset = Math.max(0, Math.min(value - r.top, r.height));
        return { row: pick, offset, sheet: r.sheetTop + offset };
    }

    function x(value) {
        const col = grid.at(Math.max(0, value));
        const offset = Math.max(0, Math.min(value - grid.left(col), grid.px[col]));
        return { col, offset, sheet: grid.left(col) + offset };
    }

    return { x, y };
}


/**
 * The graphics, drawn over the laid-out rows.
 *
 * Pictures and rules are drawings. A box is a drawing too, unless text sits
 * on it: drawings are always above the cells, so a filled box would hide the
 * very text it was put behind. Such a box paints its fill into the cells it
 * covers instead, and draws only its outline - rounded corners and all.
 *
 * @returns {{anchors: object[], media: object[]}}
 */
function drawGraphics(graphics, rows, grid, images) {
    const where = locator(rows, grid);
    const anchors = [];
    const media = mediaStore(images);

    /** a page rectangle in sheet pixels, with the anchor for its top-left */
    const place = (page, x, y, w, h) => {
        const from = where.x(x);
        const top = where.y(page, y);
        const to = where.x(x + w);
        const bottom = where.y(page, y + h);

        return {
            anchor: { col: from.col, colOff: from.offset, row: top.row, rowOff: top.offset },
            sheet: { x1: from.sheet, x2: to.sheet, y1: top.sheet, y2: bottom.sheet }
        };
    };

    for (const g of graphics) {
        if (g.kind === 'image') {
            const embedded = media.get(imageSrc(g.item.resolvedSrc));
            if (!embedded) continue;

            const fit = fitImage(g.item.fit, { w: g.w, h: g.h }, embedded.natural);
            const { anchor } = place(g.page, g.x + fit.x, g.y + fit.y, fit.w, fit.h);

            anchors.push({
                ...anchor, cx: fit.w, cy: fit.h,
                shape: picture({ rId: embedded.rId, alt: g.item.alt, crop: fit.crop })
            });
            continue;
        }

        if (g.kind === 'line') {
            const style = g.item.style ?? {};
            const thickness = Math.max(0, Number(style.thickness ?? 1)) || 1;
            const linePen = pen({
                style: ['solid', 'dashed', 'dotted', 'double'].includes(style.lineStyle) ? style.lineStyle : 'solid',
                width: thickness,
                color: argb(style.color) ?? 'FF000000'
            });

            const vertical = g.item.orientation === 'vertical';
            const at = vertical
                ? place(g.page, g.x + g.w / 2, g.y, 0, g.h)
                : place(g.page, g.x, g.y + g.h / 2, g.w, 0);

            anchors.push({
                ...at.anchor,
                cx: vertical ? 0 : at.sheet.x2 - at.sheet.x1,
                cy: vertical ? at.sheet.y2 - at.sheet.y1 : 0,
                shape: rule(linePen)
            });
            continue;
        }

        if (g.kind === 'box') {
            const style = g.item.style ?? {};
            const fill = argb(style.background);
            const width = Math.max(0, Number(style.borderWidth ?? 1)) || 1;
            const outline = style.borderStyle === 'none' ? null : pen({
                style: ['solid', 'dashed', 'dotted', 'double'].includes(style.borderStyle) ? style.borderStyle : 'solid',
                width,
                color: argb(style.borderColor) ?? 'FF000000'
            });

            const area = place(g.page, g.x, g.y, g.w, g.h);
            const behindText = fill && coversText(rows, grid, area.sheet);

            if (behindText) paintFill(rows, grid, area.sheet, fill);
            if (!outline && (behindText || !fill)) continue;

            /** a border is drawn inside the box, as border-box draws it; a stroke straddles its path */
            const inset = outline ? outline.width / 2 : 0;
            const shape = place(g.page, g.x + inset, g.y + inset, g.w - 2 * inset, g.h - 2 * inset);
            const w = Math.max(0, shape.sheet.x2 - shape.sheet.x1);
            const h = Math.max(0, shape.sheet.y2 - shape.sheet.y1);

            anchors.push({
                ...shape.anchor, cx: w, cy: h,
                shape: box({
                    fill: behindText ? null : fill,
                    outline,
                    /** the stroke's path runs inset, so its corners curve that much tighter */
                    radius: Math.max(0, (Number(style.radius) || 0) - inset),
                    w, h
                })
            });
        }
    }

    return { anchors, media: media.list };
}


/**
 * The pictures embedded in a sheet, each stored once however many pages show
 * it - a logo in the page header is one file, drawn on every page.
 */
function mediaStore(images) {
    const supplied = images instanceof Map ? images : new Map(Object.entries(images ?? {}));
    const bySrc = new Map();
    const list = [];

    function get(src) {
        if (!src) return null;
        if (bySrc.has(src)) return bySrc.get(src);

        let bytes = decodeDataUri(src);
        if (!bytes) {
            const given = supplied.get(src);
            bytes = given instanceof ArrayBuffer ? new Uint8Array(given)
                : given instanceof Uint8Array ? given : null;
        }

        const kind = bytes ? sniffImage(bytes) : null;
        if (!kind || !IMAGE_TYPES[kind.ext]) {
            bySrc.set(src, null);
            return null;
        }

        const n = list.length + 1;
        const entry = {
            rId: `rId${n}`,
            file: `image${n}.${kind.ext}`,
            ext: kind.ext,
            bytes,
            natural: { width: kind.width, height: kind.height }
        };

        list.push(entry);
        bySrc.set(src, entry);
        return entry;
    }

    return { get, list };
}


/** the rows and columns a sheet rectangle covers at least half of; or the one under its middle */
function coveredCells(rows, grid, area) {
    const half = (a1, a2, b1, b2) => Math.min(a2, b2) - Math.max(a1, b1) >= (b2 - b1) / 2;

    const rowIndexes = [];
    rows.forEach((row, i) => {
        if (row.height > 0 && half(area.y1, area.y2, row.sheetTop, row.sheetTop + row.height)) rowIndexes.push(i);
    });

    const colIndexes = [];
    for (let c = 0; c < grid.px.length; c++) {
        if (half(area.x1, area.x2, grid.left(c), grid.right(c))) colIndexes.push(c);
    }

    if (rowIndexes.length && colIndexes.length) return { rowIndexes, colIndexes };

    const midY = (area.y1 + area.y2) / 2;
    const midRow = rows.findIndex(r => midY >= r.sheetTop && midY < r.sheetTop + r.height);
    const midCol = grid.at((area.x1 + area.x2) / 2);

    return midRow < 0 ? { rowIndexes: [], colIndexes: [] } : { rowIndexes: [midRow], colIndexes: [midCol] };
}


/** whether any cell with something in it overlaps a sheet rectangle at all */
function coversText(rows, grid, area) {
    return rows.some((row, r) => {
        if (row.sheetTop >= area.y2 || row.sheetTop + row.height <= area.y1) return false;
        return row.cells.some((cell, c) => {
            if (!cell || cell.value === null || cell.value === undefined || cell.value === '') return false;
            return grid.left(c) < area.x2 && grid.right(c) > area.x1;
        });
    });
}


/**
 * A box's fill, painted into the cells under it. A cell with a fill of its own
 * - a table header - keeps it, because that cell is drawn over the box.
 */
function paintFill(rows, grid, area, fill) {
    const { rowIndexes, colIndexes } = coveredCells(rows, grid, area);
    const painted = new Map();

    const withFill = (format) => {
        if (format?.fill) return format;
        if (!painted.has(format)) painted.set(format, { ...(format ?? {}), fill });
        return painted.get(format);
    };

    for (const r of rowIndexes) {
        for (const c of colIndexes) {
            const cell = rows[r].cells[c];
            rows[r].cells[c] = cell ? { ...cell, format: withFill(cell.format) } : { value: null, format: withFill(null) };
        }
    }
}


/**
 * cellFormat, remembered per descriptor shape - a table's column, or a text
 * item's style - so a thousand rows of one table share one format object and
 * the writer resolves it once.
 *
 * `formats.text` gives a text item's format with its placement applied:
 * centred across a span, or indented by so many levels.
 */
function formatCache() {
    const byColumn = new WeakMap();
    const byStyle = new WeakMap();

    function formats(design) {
        if (!design) return null;

        if (design.kind === 'text') return formats.text(design);

        const key = design.column ?? design;
        if (!byColumn.has(key)) byColumn.set(key, {});
        const entry = byColumn.get(key);
        entry[design.kind] ??= cellFormat(design);
        return entry[design.kind];
    }

    formats.text = (design, { centred = false, indent = 0 } = {}) => {
        const key = design.style ?? design;
        if (!byStyle.has(key)) byStyle.set(key, new Map());
        const variants = byStyle.get(key);

        const variant = `${centred}|${indent}`;
        if (!variants.has(variant)) {
            const base = cellFormat(design);
            variants.set(variant, {
                ...base,
                alignment: {
                    ...base.alignment,
                    ...(centred ? { horizontal: 'centerContinuous' } : {}),
                    indent: centred ? 0 : indent
                }
            });
        }
        return variants.get(variant);
    };

    return formats;
}


/**
 * Widths from the content, for plain sheets and for a column the design gives
 * no width - the group column, say.
 */
function contentWidths(rows) {
    const widths = [];

    for (const { cells } of rows) {
        cells.forEach((cell, i) => {
            widths[i] ??= MIN_WIDTH;
            const value = cell?.value;
            if (value === null || value === undefined) return;

            const longest = value instanceof Date
                ? 18
                : String(value).split('\n').reduce((n, line) => Math.max(n, line.length), 0);

            widths[i] = Math.max(widths[i], Math.min(MAX_WIDTH, longest + 2));
        });
    }

    for (let i = 0; i < widths.length; i++) widths[i] ??= MIN_WIDTH;
    return widths;
}


/* ---------------- worksheet ---------------- */


/**
 * A sheet's XML. Children follow the order CT_Worksheet fixes - dimension,
 * sheetViews, cols, sheetData, autoFilter, ignoredErrors, drawing - because
 * Excel rejects them in any other.
 */
function worksheet({ name, rows, frozen, gridLines, widths, width, drawing }, styles) {
    if (rows.length > XLSX_LIMITS.rows) {
        throw new RangeError(
            `Sheet "${name}" has ${rows.length} rows; Excel allows ${XLSX_LIMITS.rows}.`);
    }

    if (width > XLSX_LIMITS.columns) {
        throw new RangeError(
            `Sheet "${name}" has ${width} columns; Excel allows ${XLSX_LIMITS.columns}.`);
    }

    const range = usedRange(width, rows.length);
    const xfFor = xfResolver(styles);

    const out = [XML_HEAD, `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`];

    out.push(`<dimension ref="${range}"/>`);

    out.push(`<sheetViews><sheetView${gridLines ? '' : ' showGridLines="0"'} workbookViewId="0">`);
    if (frozen && rows.length > 1) {
        out.push('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
            '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>');
    }
    out.push('</sheetView></sheetViews>');

    if (width > 0) {
        out.push('<cols>');
        for (let i = 0; i < width; i++) {
            const w = widths?.[i] ?? MIN_WIDTH;
            out.push(`<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`);
        }
        out.push('</cols>');
    }

    out.push('<sheetData>');
    rows.forEach((row, r) => {
        let cells = '';
        row.cells.forEach((c, i) => {
            if (c) cells += cell(`${columnName(i)}${r + 1}`, c.value, c.format, xfFor);
        });

        const height = Number(row.height) > 0
            ? ` ht="${points(Number(row.height))}" customHeight="1"`
            : '';

        out.push(`<row r="${r + 1}"${height}>${cells}</row>`);
    });
    out.push('</sheetData>');

    if (frozen && width > 0) out.push(`<autoFilter ref="${range}"/>`);

    /**
     * Text that looks like a number is text on purpose here - a "007", or a
     * figure beside a label - so Excel's green "number stored as text" flag on
     * every one of them is noise.
     */
    if (width > 0) {
        out.push(`<ignoredErrors><ignoredError sqref="${range}" numberStoredAsText="1"/></ignoredErrors>`);
    }

    if (drawing) out.push('<drawing r:id="rId1"/>');

    out.push('</worksheet>');
    return out.join('');
}


function usedRange(width, height) {
    if (width === 0 || height === 0) return 'A1';
    const last = `${columnName(width - 1)}${height}`;
    return last === 'A1' ? 'A1' : `A1:${last}`;
}


/** format object and number format to a cell format index, each pair resolved once */
function xfResolver(styles) {
    const cache = new WeakMap();
    const plain = new Map();

    return (format, numFmt) => {
        if (!format) {
            if (!plain.has(numFmt)) plain.set(numFmt, styles.xf(null, numFmt));
            return plain.get(numFmt);
        }

        if (!cache.has(format)) cache.set(format, new Map());
        const byNumFmt = cache.get(format);
        if (!byNumFmt.has(numFmt)) byNumFmt.set(numFmt, styles.xf(format, numFmt));
        return byNumFmt.get(numFmt);
    };
}


/**
 * One cell. An empty value with no format writes nothing - an absent <c> is an
 * empty cell. One with a format still writes the cell, so a blank in a table
 * keeps its grid and fill.
 *
 * @param {string} ref such as "B7"
 * @param {*} value the raw value from the row
 * @param {object|null} format
 * @param {Function} xfFor
 */
function cell(ref, value, format, xfFor) {
    const empty = value === null || value === undefined || value === '';
    const isDate = value instanceof Date && !Number.isNaN(value.getTime());

    let numFmt = 0;
    let serial = null;
    if (isDate) {
        serial = excelSerial(value);
        numFmt = Number.isInteger(serial) ? NUMFMT_DATE : NUMFMT_DATE_TIME;
    }

    const xf = xfFor(format, numFmt);
    const s = xf ? ` s="${xf}"` : '';

    if (empty) return xf ? `<c r="${ref}"${s}/>` : '';

    if (isDate) return `<c r="${ref}"${s}><v>${serial}</v></c>`;

    if (typeof value === 'number') {
        /** NaN and Infinity have no spreadsheet form, so they keep their words */
        if (!Number.isFinite(value)) return inlineString(ref, String(value), s);
        return `<c r="${ref}"${s}><v>${value}</v></c>`;
    }

    if (typeof value === 'boolean') {
        return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
    }

    return inlineString(ref, String(value), s);
}


function inlineString(ref, text, s) {
    let clean = text.replace(INVALID_XML, '');

    if (clean.length > XLSX_LIMITS.cellText) {
        clean = clean.slice(0, XLSX_LIMITS.cellText);
        /** never leave half a surrogate pair at the cut */
        if (/[\uD800-\uDBFF]$/.test(clean)) clean = clean.slice(0, -1);
    }

    /** without this, Excel trims leading and trailing spaces and folds line breaks */
    const preserve = /^\s|\s$|\n/.test(clean) ? ' xml:space="preserve"' : '';

    return `<c r="${ref}"${s} t="inlineStr"><is><t${preserve}>` +
        `${escapeText(clean.replace(EXCEL_ESCAPE, '_x005F_$1'))}</t></is></c>`;
}


/**
 * A Date as an Excel serial number: days since 1899-12-30, the fraction the
 * time of day.
 *
 * Read in local time, because a spreadsheet has no time zones and the reader
 * expects the date the report showed them, not the UTC instant behind it.
 */
function excelSerial(date) {
    const local = Date.UTC(
        date.getFullYear(), date.getMonth(), date.getDate(),
        date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()
    );

    return local / 86400000 + 25569;
}


/**
 * A zero-based column index as Excel letters: 0 is A, 25 is Z, 26 is AA.
 * Bijective base 26 - there is no zero digit, which is why it is not toString(26).
 */
export function columnName(index) {
    let name = '';
    let n = index + 1;

    while (n > 0) {
        const rem = (n - 1) % 26;
        name = String.fromCharCode(65 + rem) + name;
        n = Math.floor((n - 1) / 26);
    }

    return name;
}


/**
 * Names Excel will accept: at most 31 characters, none of []:*?/\, not starting
 * or ending with an apostrophe, never blank, and unique ignoring case.
 * "History" is reserved by Excel, so it counts as taken.
 *
 * @param {string[]} wanted
 * @returns {string[]}
 */
export function sheetNames(wanted) {
    const used = new Set(['history']);

    return wanted.map((raw) => {
        let base = String(raw ?? '')
            .replace(SHEET_NAME_BANNED, '-')
            .trim()
            .replace(/^'+|'+$/g, '')
            .trim() || 'Sheet';

        base = clip(base, XLSX_LIMITS.sheetName);

        let name = base;
        for (let n = 2; used.has(name.toLowerCase()); n++) {
            const suffix = ` (${n})`;
            name = clip(base, XLSX_LIMITS.sheetName - suffix.length) + suffix;
        }

        used.add(name.toLowerCase());
        return name;
    });
}


/** cut to a length without splitting a surrogate pair */
function clip(text, length) {
    if (text.length <= length) return text;
    const cut = text.slice(0, length);
    return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}


/* ---------------- package parts ---------------- */


function contentTypes(sheetCount, drawings = [], media = []) {
    const sheets = Array.from({ length: sheetCount }, (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT_SHEET}"/>`
    ).join('');

    const drawingParts = drawings.map(d =>
        `<Override PartName="/xl/drawings/drawing${d.n}.xml" ContentType="${DRAWING_CONTENT_TYPE}"/>`
    ).join('');

    const imageDefaults = [...new Set(media.map(m => m.ext))].map(ext =>
        `<Default Extension="${ext}" ContentType="${IMAGE_TYPES[ext]}"/>`
    ).join('');

    return XML_HEAD +
        `<Types xmlns="${NS_TYPES}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        imageDefaults +
        `<Override PartName="/xl/workbook.xml" ContentType="${CT_BOOK}"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="${CT_STYLES}"/>` +
        sheets +
        drawingParts +
        '</Types>';
}


function packageRels() {
    return XML_HEAD +
        `<Relationships xmlns="${NS_PKG_REL}">` +
        `<Relationship Id="rId1" Type="${REL_DOC}" Target="xl/workbook.xml"/>` +
        '</Relationships>';
}


/** a worksheet's relationships: its drawing, which is the one it can have */
function sheetRels(drawingNumber) {
    return XML_HEAD +
        `<Relationships xmlns="${NS_PKG_REL}">` +
        `<Relationship Id="rId1" Type="${REL_DRAWING}" Target="../drawings/drawing${drawingNumber}.xml"/>` +
        '</Relationships>';
}


/**
 * The sheet list, plus the hidden name Excel keeps for each sheet's filter
 * range - it opens a filter without one, but repairs the file the first time
 * the filter is touched.
 */
function workbook(sheets) {
    const list = sheets.map((sheet, i) =>
        `<sheet name="${escapeAttr(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    ).join('');

    const filters = sheets.map((sheet, i) => {
        if (!sheet.frozen || sheet.width === 0) return '';

        const quoted = `'${sheet.name.replace(/'/g, "''")}'`;
        const ref = `${quoted}!$A$1:$${columnName(sheet.width - 1)}$${sheet.rows.length}`;

        return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">` +
            `${escapeText(ref)}</definedName>`;
    }).join('');

    return XML_HEAD +
        `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
        '<bookViews><workbookView/></bookViews>' +
        `<sheets>${list}</sheets>` +
        (filters ? `<definedNames>${filters}</definedNames>` : '') +
        '</workbook>';
}


function workbookRels(sheetCount) {
    const sheets = Array.from({ length: sheetCount }, (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="${REL_SHEET}" Target="worksheets/sheet${i + 1}.xml"/>`
    ).join('');

    return XML_HEAD +
        `<Relationships xmlns="${NS_PKG_REL}">` +
        sheets +
        `<Relationship Id="rId${sheetCount + 1}" Type="${REL_STYLES}" Target="styles.xml"/>` +
        '</Relationships>';
}


/* ---------------- escaping ---------------- */


function escapeText(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}


function escapeAttr(text) {
    return escapeText(text.replace(INVALID_XML, '')).replace(/"/g, '&quot;');
}

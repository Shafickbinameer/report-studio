/**
 * measure.js computes the rendered height of every band and every item in it.
 *
 * Spec 4.3:
 *   text  - canvas measureText, greedy wrap
 *   table - headerHeight + rows x rowHeight
 *   band  - the fixed `height` field, or the computed height where it holds a table
 */

import { textHeight } from './text-metrics.js';


/**
 * Rows a table is drawn with before there is any data.
 *
 * A table declares no height (spec 3.3): it is its header plus however many
 * rows the data turns out to have. The designer still has to draw it as *some*
 * size, and whatever it draws is what the person arranging the band lines
 * everything else up against.
 *
 * So this is not a designer detail that happens to live here. It is the
 * baseline the engine measures a table's growth from - the difference between
 * this height and the real one is exactly how far what sits below the table has
 * to float down the page.
 */
export const DESIGN_ROWS = 3;


/**
 * The padding report.css draws inside a cell, on each side.
 *
 * Here because it is the difference between the column's width and the width
 * the text actually gets, and a wrap measured against the wrong one is a row
 * that comes out a line short of what prints.
 */
export const CELL_PADDING = 8;


/**
 * The font a table's cells are drawn in.
 *
 * report.css declares the same default, so what is measured here is what the
 * browser draws. A table that names its own font is measured in that one.
 *
 * @param {object} item a table
 * @returns {object} a style block for text-metrics
 */
function cellFont(item) {
    return {
        fontSize: item.style?.fontSize ?? 12,
        fontFamily: item.style?.fontFamily,
        fontWeight: 'normal',
        fontStyle: 'normal'
    };
}


/**
 * How wide each column is actually drawn.
 *
 * Not what the column says. report.css lays a table out with
 * `table-layout: fixed`, and when the columns add up to less than the table is
 * wide the browser hands the difference out in proportion - so a 300px column
 * in a 714px table whose columns total 450 is drawn at 476. Measuring a wrap
 * against the declared width instead put a row two lines tall that prints on
 * one, which is a page count that is wrong in the safe direction and still
 * wrong.
 *
 * @param {object} item a table
 * @returns {number[]}
 */
function columnWidths(item) {
    const declared = (item.columns ?? []).map(c => c.width ?? 0);
    const sum = declared.reduce((a, b) => a + b, 0);
    const table = item.w ?? sum;

    const scale = sum > 0 && table > sum ? table / sum : 1;

    return declared.map(w => w * scale);
}


/**
 * The grid line drawn inside each cell, which eats into the text's width the
 * same way the padding does - box-sizing: border-box, so that it can, which is
 * what keeps a table exactly as tall as it was measured.
 *
 * @param {object} item a table
 * @returns {number} pixels
 */
function ruleWidth(item) {
    if (item.style?.borderStyle === 'none') return 0;

    const declared = Number(item.style?.borderWidth);

    return Number.isFinite(declared) && declared > 0 ? declared : 1;
}


/**
 * What each column leaves for its text, once the padding and the grid have had
 * theirs. The last column carries the table's right-hand rule as well as its
 * left one, so it gets one less pixel than the rest.
 *
 * @param {object} item a table
 * @returns {number[]}
 */
export function textWidths(item) {
    const widths = columnWidths(item);
    const rule = ruleWidth(item);
    const last = widths.length - 1;

    return widths.map((w, index) =>
        w - CELL_PADDING * 2 - rule * (index === last ? 2 : 1));
}


/**
 * How tall each of these rows has to be.
 *
 * A cell whose text is wider than its column wraps, and a row is as tall as its
 * tallest cell - never shorter than the height the table declares, which stays
 * the floor rather than becoming the whole answer.
 *
 * The declared height used to be the whole answer, and a cell that did not fit
 * was cut off with an ellipsis. That is a strange thing for a report to do with
 * somebody's data: an address that runs long is not less true for it.
 *
 * A table can still ask for the old behaviour with `wrap: false`, which is the
 * right answer for a column of figures that must stay one line however wide the
 * numbers get.
 *
 * @param {object} item a table
 * @param {object[]} rows
 * @returns {number[]} one height per row, in order
 */
export function rowHeightsFor(item, rows) {
    const declared = item.rowHeight ?? 0;
    const list = rows ?? [];

    if (item.wrap === false) return list.map(() => declared);

    const font = cellFont(item);
    const columns = item.columns ?? [];
    const widths = textWidths(item);

    return list.map(row => {
        let tallest = declared;

        for (const [index, column] of columns.entries()) {
            const width = widths[index];
            if (!(width > 0)) continue;

            const value = row?.[column.field];
            if (value === null || value === undefined || value === '') continue;

            tallest = Math.max(tallest, textHeight(String(value), width, font));
        }

        return tallest;
    });
}


/**
 * How tall the header row has to be.
 *
 * A column label wraps like any other cell, and one that did so used to be cut
 * off - which is the same fault as a truncated cell, in the one row of a table
 * nobody can scroll past.
 *
 * @param {object} item a table
 * @returns {number} 0 for a table that draws no header
 */
export function headerHeightFor(item) {
    if (!item.showHeader) return 0;

    const declared = item.headerHeight ?? item.rowHeight ?? 0;
    if (item.wrap === false) return declared;

    /**
     * The header is one row whose cells happen to be the column labels, so it
     * is measured as one - each label in its own column, which is why the
     * fields are renamed rather than every column being pointed at one key.
     */
    const columns = (item.columns ?? []).map((column, index) =>
        ({ ...column, field: `label${index}` }));

    const row = Object.fromEntries((item.columns ?? []).map((column, index) =>
        [`label${index}`, column.label]));

    const [measured] = rowHeightsFor(
        { ...item, rowHeight: declared, columns }, [row]);

    return measured ?? declared;
}


/**
 * The height a table is drawn at while it is being designed.
 *
 * Anything that is not a table has a height of its own and keeps it.
 *
 * @param {object} item
 * @returns {number} pixels
 */
export function designHeight(item) {
    if (item.type !== 'table') return item.h ?? 0;

    const rowHeight = item.rowHeight ?? 0;
    const header = item.showHeader ? (item.headerHeight ?? rowHeight) : 0;

    return header + DESIGN_ROWS * rowHeight;
}


export function measure(json) {
    const measureJson = structuredClone(json);
    const grouped = measureJson.groupBy != null;

    for (const band of measureJson.bands) {
        if (!band.items) continue;
        measureBand(band, grouped, measureJson);
    }

    return measureJson;
}


/**
 * Items are absolutely positioned inside their band, so the band's content
 * height is the lowest edge any item reaches - max(y + height). That is order
 * independent, and handles items side by side on the same row as well as items
 * separated by a gap, neither of which a running total can express.
 * @param {object} band
 * @param {boolean} grouped
 * @param {object} json
 * @returns {object} the same band, measured
 */
function measureBand(band, grouped, json) {
    let contentHeight = 0;

    for (const item of band.items) {
        item.measuredHeight = measureItem(item, grouped, json);
        contentHeight = Math.max(contentHeight, (item.y ?? 0) + item.measuredHeight);
    }

    /**
     * A declared band height is the design intent, so it wins - but it can only
     * grow to fit content, never clip it. A band holding a table has no useful
     * declared height; the row count decides.
     */
    band.contentHeight = contentHeight;
    band.measuredHeight = holdsTable(band)
        ? contentHeight
        : Math.max(band.height ?? 0, contentHeight);

    return band;
}


function holdsTable(band) {
    return band.items.some(item => item.type === 'table');
}


function measureItem(item, grouped, json) {
    switch (item.type) {
        case 'text':
            return measureTextItem(item);
        case 'table':
            return measureTableItem(item, grouped, json);
        case 'line':
            return measureLineItem(item);
        case 'box':
            return item.h ?? 0;
        default:
            console.warn(`Unknown item type "${item.type}" on item "${item.id}"; treating as zero height.`);
            return 0;
    }
}


/**
 * A declared `h` is the design intent and is honoured, but text that wraps past
 * it grows the item rather than being clipped. Placeholders are already
 * resolved at this point, so what is measured is what will be drawn.
 * @param {object} item
 * @returns {number}
 */
function measureTextItem(item) {
    const declared = item.h ?? 0;
    const wrapped = textHeight(item.text ?? item.value ?? '', item.w ?? 0, item.style);
    return Math.max(declared, wrapped);
}


/**
 * The box a line occupies, which is its declared `h` - the rule is drawn inside
 * that box rather than being it, so that a hairline is still something the
 * designer can get hold of.
 *
 * A rule thicker than its box grows the box, for the same reason wrapped text
 * grows a text item: what is drawn is never quietly clipped.
 *
 * @param {object} item
 * @returns {number}
 */
function measureLineItem(item) {
    const declared = item.h ?? 0;

    /** only a horizontal rule's thickness is a height; a vertical one's is a width */
    if (item.orientation === 'vertical') return declared;

    return Math.max(declared, item.style?.thickness ?? 0);
}


/**
 * headerHeight + rows x rowHeight. When the report is grouped, each group also
 * carries its own header and footer band, and a table header that repeats per
 * group - all of which occupy real space and were previously unaccounted for.
 * @param {object} item
 * @param {boolean} grouped
 * @param {object} json
 * @returns {number}
 */
function measureTableItem(item, grouped, json) {
    const headerHgt = headerHeightFor(item);

    /** stamped on so the renderer draws the row at the height that was budgeted */
    item.headerMeasured = headerHgt;

    /**
     * The heights are written onto the table as well as summed, because
     * pagination has to slice rows by them and the renderer has to draw each
     * row at its own. Measuring the same wrap three times in three files is how
     * the three of them come to disagree.
     */
    if (!grouped) {
        item.rowHeights = rowHeightsFor(item, item.row);

        return headerHgt + total(item.rowHeights);
    }

    const groups = item.groups ?? [];
    const grpHeaderHgt = bandHeight(json, 'groupHeader');
    const grpFooterHgt = bandHeight(json, 'groupFooter');

    let height = 0;

    for (const group of groups) {
        group.rowHeights = rowHeightsFor(item, group.rows);

        height += headerHgt
            + grpHeaderHgt
            + total(group.rowHeights)
            + grpFooterHgt;
    }

    return height;
}


/** @param {number[]} list @returns {number} */
export function total(list) {
    return (list ?? []).reduce((sum, n) => sum + n, 0);
}


/**
 * Height of a template band that never flows on its own (groupHeader /
 * groupFooter). It is measured here rather than read raw so a group band whose
 * text wraps is still accounted for.
 * @param {object} json
 * @param {string} type
 * @returns {number}
 */
function bandHeight(json, type) {
    const band = json.bands.find(b => b.type === type);
    if (!band?.items) return 0;

    let contentHeight = 0;
    for (const item of band.items) {
        const height = item.type === 'text' ? measureTextItem(item) : 0;
        contentHeight = Math.max(contentHeight, (item.y ?? 0) + height);
    }

    return Math.max(band.height ?? 0, contentHeight);
}

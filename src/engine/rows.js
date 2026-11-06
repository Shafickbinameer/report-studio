/**
 * rows.js reads a built report back as rows of cells - the part CSV and XLSX
 * export share, so the two files can never disagree about what a report holds.
 *
 * Two shapes, the same two csv.js has always written:
 *
 * reportRows is the report as it reads on paper: every text line and every
 * table row, in the order the page draws them. Lines, boxes and images have no
 * text to give, so they do not come along.
 *
 * tableRows is the data rectangle: one table's columns and rows, gathered
 * across every page and group fragment, so a row split by a page break comes
 * back in one piece.
 *
 * Cells are the raw values - a number stays a number - and encoding them is the
 * caller's business: CSV quotes them as text, XLSX types them. Spec 2.2 makes
 * every exporter a page-list consumer, so everything here reads the built pages
 * and never the layout or the data.
 *
 * Each row also carries how it was drawn, for an exporter that can show it:
 * `design` runs parallel to `cells`, one descriptor per cell; `page` is the
 * 0-based page it is on, and `top` and `height` are where it sits on that page
 * and how tall it is, in pixels from the top of the printable area. CSV ignores
 * all of it. A descriptor is one of
 *
 *   { kind: 'text', style, template, format, raw, x, y, w, h }
 *                                                   a text item, placed on the page
 *   { kind: 'head', column, table }                 a table's column label
 *   { kind: 'cell', column, table }                 a table's data cell
 *
 * where `table` is { style, wrap } - the table's own style block, and whether
 * its cells wrap - and `template` is the text item's value before placeholders
 * were filled. `format` is the text item's, and `raw` the one value it printed
 * when it is a single placeholder; a column's format is on the column. They are the page objects' own values, unresolved: what the
 * stylesheet does when they are absent is the exporter's to know.
 *
 * reportLayout adds what reportRows leaves out: the graphics - images, lines
 * and boxes, placed on the page the same way - and a spacer row wherever a
 * graphic stands on a line of its own, so whatever lays the rows out has
 * somewhere to put it.
 */


import { levelsOf, fragmentBandsOf } from './tables.js';
import { cellHighlight } from './highlight.js';


/** the items that are drawn rather than written */
const GRAPHICS = ['image', 'line', 'box'];


/**
 * The whole report as rows, in the order it is read.
 *
 * One row per line of the report: text items that share a line become the
 * cells of one row, and a table contributes its column labels and then its
 * rows, where the table sits. The rows are ragged, because the report is.
 *
 * A page header drawn on three pages is three rows, because that is what the
 * report has.
 *
 * @param {object[]} pages the `pages` array from buildPages
 * @returns {{cells: Array, header: boolean, design: object[], page: number,
 *   top: number, height: number|null}[]} `header` marks a table's column-label row
 */
export function reportRows(pages) {
    return reportLayout(pages).rows.filter(row => !row.spacer);
}


/**
 * The report's rows, plus its graphics and the spacer rows that make room for
 * them.
 *
 * A spacer row has no cells and `spacer: true`; it stands for a stretch of the
 * page that holds a graphic and no text - a rule under a heading, a logo on a
 * band of its own.
 *
 * @param {object[]} pages the `pages` array from buildPages
 * @returns {{rows: object[], graphics: {kind: string, page: number, x: number,
 *   y: number, w: number, h: number, item: object}[]}} graphics in drawing
 *   order, placed in the same coordinates as the rows
 */
export function reportLayout(pages) {
    const rows = [];
    const graphics = [];

    (pages ?? []).forEach((page, index) => {
        for (const band of readingOrder(page?.bands)) {
            collectBand(band, rows, { page: index, origin: Number(band?.top) || 0, graphics });
        }
    });

    return { rows, graphics };
}


/**
 * One table's columns and rows, gathered across the whole report.
 *
 * @param {object[]} pages the `pages` array from buildPages
 * @param {string|null} [only] the table's id; the first table met when absent
 * @returns {{id: string, columns: object[], table: {style: object, wrap: boolean},
 *   headerHeight: number|null, rows: {group: *, row: object, height: number|null}[]}|null}
 *   null when the report holds no such table. `group` is the group key on a
 *   grouped table, null otherwise; `height` is the row's measured height
 */
export function tableRows(pages, only = null) {
    let columns = null;
    let id = only;
    let first = null;
    const rows = [];

    for (const page of (pages ?? [])) {
        for (const band of (page.bands ?? [])) {
            for (const item of (band.items ?? [])) {
                if (item.type !== 'table') continue;
                if (id !== null && item.id !== id) continue;

                if (columns === null) {
                    id = item.id;
                    columns = item.columns ?? [];
                    first = item;
                }

                if (item.row) {
                    item.row.forEach((row, n) => {
                        rows.push({ group: null, row, height: rowHeight(item, item.rowHeights, n) });
                    });
                    continue;
                }

                for (const fragment of (item.groups ?? [])) {
                    const path = Array.isArray(fragment.path) ? fragment.path : [fragment.key];

                    fragment.rows.forEach((row, n) => {
                        rows.push({
                            group: fragment.key, groups: path, row,
                            height: rowHeight(item, fragment.rowHeights, n)
                        });
                    });
                }
            }
        }
    }

    if (columns === null) return null;

    return {
        id, columns, table: tableDesign(first), headerHeight: headerHeight(first), rows,
        groupBy: levelsOf(first).map(level => level?.by ?? null)
    };
}


/**
 * The group columns an export puts before a grouped table's own, one per level
 * it is grouped at - region, then city - so the groups survive a sort.
 *
 * Named by `label`: a list names each level in turn; a single name is the
 * column of a table grouped at one level, as it has always been. A nested
 * table's levels left unnamed are called after the column showing the field
 * they group by, or the field itself.
 *
 * @param {{columns: object[], groupBy?: string[], rows: {group: *, groups?: Array}[]}} table
 *   from tableRows
 * @param {string|string[]} [label='Group']
 * @returns {{labels: string[], cells: (row: object) => Array}} no labels when
 *   the table is not grouped
 */
export function groupColumns(table, label = 'Group') {
    const pathOf = (row) => row.groups ?? (row.group == null ? [] : [row.group]);
    const depth = Math.max(0, ...table.rows.map(row => pathOf(row).length));

    const named = (n) => {
        const by = table.groupBy?.[n];
        const column = table.columns.find(c => by != null && c.field === by);
        return column ? columnLabel(column) : (by ?? `Group ${n + 1}`);
    };

    const labels = Array.from({ length: depth }, (_, n) => {
        if (Array.isArray(label)) return label[n] ?? named(n);
        return depth === 1 ? label : named(n);
    });

    const cells = (row) => {
        const path = pathOf(row);
        return Array.from({ length: depth }, (_, n) => path[n] ?? null);
    };

    return { labels, cells };
}


/**
 * The tables a built report holds, in the order they first appear - what a
 * host offers when it asks which one to export.
 *
 * A table split over three pages is listed once, by its id.
 *
 * @param {object[]} pages the `pages` array from buildPages
 * @returns {{id: string, columns: string[]}[]}
 */
export function reportTables(pages) {
    const found = new Map();

    for (const page of (pages ?? [])) {
        for (const band of (page.bands ?? [])) {
            for (const item of (band.items ?? [])) {
                if (item.type !== 'table' || found.has(item.id)) continue;

                found.set(item.id, {
                    id: item.id,
                    columns: (item.columns ?? []).map(columnLabel)
                });
            }
        }
    }

    return [...found.values()];
}


/** what the descriptors of a table's cells share */
function tableDesign(table) {
    return {
        style: table.style ?? {},
        wrap: table.wrap !== false,
        /** carried for the table sheet, which styles each row by them */
        rowHighlight: table.rowHighlight ?? null
    };
}

/** what items.js draws a header row at: measured if a label wrapped, else declared */
function headerHeight(table) {
    return table.headerMeasured ?? table.headerHeight ?? table.rowHeight ?? null;
}

/** what items.js draws a data row at */
function rowHeight(table, heights, n) {
    return heights?.[n] ?? table.rowHeight ?? null;
}

/** how tall a band is drawn, which is what a table moves down past */
function bandHeight(band) {
    return Number(band?.measuredHeight ?? band?.height) || 0;
}

/** what a column is called in a header row */
export function columnLabel(column) {
    return column.label ?? column.field;
}


/**
 * A page's bands, top of the paper first.
 *
 * The array they arrive in is the order they were built, which is not the order
 * they are read: a page footer is anchored to the bottom edge and is often
 * second in the list. `top` is the position the renderer places them at, so it
 * is the only thing that knows.
 */
function readingOrder(bands) {
    return [...(bands ?? [])].sort((a, b) => (a?.top ?? 0) - (b?.top ?? 0));
}


/**
 * Adds a band's lines to the output, and its graphics to the context's list.
 *
 * Items are sorted down the band and then across it, and neighbours that share
 * a line are written as one row - so a caption and the figure beside it arrive
 * as two cells rather than as two rows, which is how the band was designed to
 * be read.
 *
 * @param {object} band
 * @param {object[]} out gathered rows, appended to
 * @param {{page: number, origin: number, graphics: object[]}} context where
 *   the band's top is on its page, and where graphics are gathered
 */
function collectBand(band, out, context) {
    const { page, origin } = context;
    const start = out.length;

    const sorted = [...(band?.items ?? [])]
        .sort((a, b) => (a?.y ?? 0) - (b?.y ?? 0) || (a?.x ?? 0) - (b?.x ?? 0));

    const graphics = sorted
        .filter(item => GRAPHICS.includes(item?.type))
        .map(item => ({
            kind: item.type, page,
            x: Number(item.x) || 0,
            y: origin + (Number(item.y) || 0),
            w: Number(item.w) || 0,
            h: Number(item.h) || 0,
            item
        }));

    /** the run of text items being gathered, and the item that anchors its line */
    let line = null;
    const flush = () => {
        if (line) {
            out.push({
                cells: line.cells, header: false, design: line.design,
                page, top: line.top, height: line.bottom - line.top
            });
        }
        line = null;
    };

    const textDesign = (item) => ({
        kind: 'text',
        style: item.style ?? {},
        template: item.value,
        /** a share is held as a fraction and shown as a percentage, whatever the item's format */
        format: item.rawFormat ?? item.format,
        raw: item.raw,
        highlight: item.highlighted ?? null,
        x: Number(item.x) || 0,
        y: origin + (Number(item.y) || 0),
        w: Number(item.w) || 0,
        h: Number(item.measuredHeight ?? item.h) || 0
    });

    for (const item of sorted) {
        if (item?.type === 'table') {
            flush();
            collectTable(item, out, { ...context, origin: origin + (Number(item.y) || 0) });
            continue;
        }

        if (item?.type !== 'text') continue;

        const design = textDesign(item);

        if (line && sameLine(line.anchor, item)) {
            line.cells.push(item.text);
            line.design.push(design);
            line.top = Math.min(line.top, design.y);
            line.bottom = Math.max(line.bottom, design.y + design.h);
            continue;
        }

        flush();
        line = {
            anchor: item,
            cells: [item.text],
            design: [design],
            top: design.y,
            bottom: design.y + design.h
        };
    }

    flush();

    addSpacers(out, start, graphics, page);
    context.graphics.push(...graphics);
}


/** a stretch of a graphic thinner than this, beside no row, is absorbed rather than given a row */
const MIN_SPACER_PX = 4;

/**
 * Rows for the parts of the page that hold a graphic and nothing else.
 *
 * A graphic drawn beside a text line or a table row is drawn over that row.
 * Where it reaches past every row in its band - a rule under a heading, a logo
 * taller than the title beside it, a panel with a margin round its text - the
 * part that sticks out would land on whatever row came next, or be squeezed
 * into nothing. So each such stretch gets an empty row of its own, as tall as
 * it is, where the page has it, and the graphic keeps its size.
 *
 * Slivers under MIN_SPACER_PX are left to the row gaps, unless they are the
 * whole graphic: a hairline on a line of its own still needs its row.
 *
 * @param {object[]} out
 * @param {number} start the first row this band added
 * @param {object[]} graphics this band's
 * @param {number} page
 */
function addSpacers(out, start, graphics, page) {
    const taken = out.slice(start).map(row => [row.top, row.top + (row.height ?? 0)]);

    const pieces = [];
    for (const g of graphics) {
        const whole = [g.y, g.y + Math.max(g.h, 1)];
        const free = subtract(whole, taken);
        const alone = free.length === 1 && free[0][0] === whole[0] && free[0][1] === whole[1];

        for (const piece of free) {
            if (alone || piece[1] - piece[0] >= MIN_SPACER_PX) pieces.push(piece);
        }
    }

    const spacers = [];
    for (const [top, bottom] of pieces.sort((a, b) => a[0] - b[0])) {
        const last = spacers[spacers.length - 1];
        if (last && top <= last.top + last.height) {
            last.height = Math.max(last.height, bottom - last.top);
            continue;
        }
        spacers.push({ cells: [], header: false, design: [], page, top, height: bottom - top, spacer: true });
    }

    for (const spacer of spacers) {
        let at = start;
        while (at < out.length && out[at].top < spacer.top + spacer.height) at++;
        out.splice(at, 0, spacer);
    }
}


/** what is left of an interval once some others are taken out of it */
function subtract([from, to], taken) {
    let free = [[from, to]];

    for (const [a, b] of taken) {
        if (!(b > a)) continue;
        free = free.flatMap(([f, t]) => {
            if (b <= f || a >= t) return [[f, t]];
            const left = a > f ? [[f, a]] : [];
            const right = b < t ? [[b, t]] : [];
            return [...left, ...right];
        });
    }

    return free;
}


/**
 * Whether two items are on the same line of the band.
 *
 * By overlap rather than by an equal y: a heading and the date beside it are
 * set in different sizes, so they are placed a few pixels apart and still read
 * as one line. Half the shorter item is the threshold - enough that a genuine
 * second line, which clears the first, is never folded into it.
 *
 * Measured against the item that opened the line rather than against the line
 * as it grows, so one tall item cannot go on absorbing everything under it.
 */
function sameLine(anchor, item) {
    const span = (i) => {
        const top = i.y ?? 0;
        return [top, top + (i.measuredHeight ?? i.h ?? 0)];
    };

    const [aTop, aBottom] = span(anchor);
    const [bTop, bBottom] = span(item);
    const overlap = Math.min(aBottom, bBottom) - Math.max(aTop, bTop);

    return overlap >= Math.min(aBottom - aTop, bBottom - bTop) / 2;
}


/**
 * Adds a table's rows to the output, in the order items.js draws them, each
 * at the height it is drawn down the page.
 *
 * The grouped shape repeats the column labels for every group that starts one,
 * and wraps each fragment's rows in the group's own header and footer bands -
 * which are bands, so they are written by the same code as any other.
 *
 * @param {object} table
 * @param {object[]} out
 * @param {{page: number, origin: number, graphics: object[]}} context origin
 *   is the table's top on the page
 */
function collectTable(table, out, context) {
    const shared = tableDesign(table);
    const { page } = context;
    let cursor = context.origin;

    const labels = () => {
        const height = headerHeight(table);
        out.push({
            cells: table.columns.map(columnLabel),
            header: true,
            design: table.columns.map(column => ({ kind: 'head', column, table: shared })),
            page, top: cursor, height
        });
        cursor += Number(height) || 0;
    };

    const cells = (row, height) => {
        out.push({
            cells: table.columns.map(c => row?.[c.field]),
            header: false,
            design: table.columns.map(column => ({
                kind: 'cell', column, table: shared, highlight: cellHighlight(table, column, row)
            })),
            page, top: cursor, height
        });
        cursor += Number(height) || 0;
    };

    const groupBand = (band) => {
        collectBand(band, out, { ...context, origin: cursor });
        cursor += bandHeight(band);
    };

    if (!table.groups) {
        if (table.showHeader) labels();
        (table.row ?? []).forEach((row, n) => cells(row, rowHeight(table, table.rowHeights, n)));
        return;
    }

    for (const fragment of table.groups) {
        const { headers, footers } = fragmentBandsOf(fragment);

        if (fragment.showHeader && table.showHeader) labels();
        headers.forEach(band => groupBand(band));

        fragment.rows.forEach((row, n) => cells(row, rowHeight(table, fragment.rowHeights, n)));

        footers.forEach(band => groupBand(band));
    }
}

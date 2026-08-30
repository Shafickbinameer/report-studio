/**
 * csv.js writes a report out as CSV, in two shapes.
 *
 * toCSV is the data rectangle: the table's rows and nothing else, one header
 * row and uniform columns, which is what a spreadsheet needs to sort, filter
 * and pivot. Rows split across a page break come back in one piece.
 *
 * toReportCSV is the report as it reads on paper: every text line and every
 * table row, in the order the page draws them. Lines and boxes have no text to
 * give, so they are the two item types that cannot come along.
 *
 * Spec 5.1: "extract table rows from the page list, download as a file", and
 * spec 2.2 lists CSV export as a page-list consumer. So both read the built
 * pages - the same thing the renderer draws - and never the layout or the raw
 * data.
 */


/** cells starting with these are executed as formulas by Excel and Sheets */
const FORMULA_LEAD = /^[=+\-@\t\r]/;


/**
 * The report's table as CSV text.
 *
 * @param {object[]} pages the `pages` array from buildPages
 * @param {object} [options]
 * @param {string} [options.delimiter=','] use ';' for locales where Excel expects it
 * @param {string} [options.newline='\r\n'] RFC 4180 line ending
 * @param {boolean} [options.header=true] emit the column labels as the first row
 * @param {boolean} [options.groupColumn=true] prepend the group key on a grouped report
 * @param {string} [options.groupLabel='Group']
 * @param {boolean} [options.neutraliseFormulas=true] see below
 * @returns {string} CSV text, empty when the report holds no table
 */
export function toCSV(pages, options = {}) {
    const {
        delimiter = ',',
        newline = '\r\n',
        header = true,
        groupColumn = true,
        groupLabel = 'Group',
        neutraliseFormulas = true
    } = options;

    const table = collect(pages);
    if (!table) return '';

    const grouped = groupColumn && table.rows.some(r => r.group !== null);
    const labels = table.columns.map(c => c.label ?? c.field);

    const lines = [];

    if (header) {
        lines.push(encodeRow(grouped ? [groupLabel, ...labels] : labels,
            delimiter, neutraliseFormulas));
    }

    for (const { group, row } of table.rows) {
        const cells = table.columns.map(c => row?.[c.field]);
        lines.push(encodeRow(grouped ? [group, ...cells] : cells,
            delimiter, neutraliseFormulas));
    }

    return lines.join(newline);
}


/**
 * The whole report as CSV, in the order it is read.
 *
 * One CSV row per line of the report: text items that share a line become the
 * cells of one row, and a table contributes its column labels and then its
 * rows, where the table sits. So the file re-reads as the report does, at the
 * cost of the rectangle toCSV keeps - the rows are ragged, because the report
 * is.
 *
 * Boxes and lines are left out. They are drawn rather than written, and a CSV
 * has nowhere to put a rule or a filled panel.
 *
 * Nothing is gathered across pages the way toCSV gathers table rows: a page
 * header drawn on all three pages is written three times, because that is what
 * the report has. The order is the paper's, not the layout array's - bands are
 * anchored to a zone, so `top` is what says which is read first.
 *
 * @param {object[]} pages the `pages` array from buildPages
 * @param {object} [options]
 * @param {string} [options.delimiter=',']
 * @param {string} [options.newline='\r\n'] RFC 4180 line ending
 * @param {boolean} [options.neutraliseFormulas=true] as toCSV
 * @returns {string} CSV text, empty when the report writes nothing
 */
export function toReportCSV(pages, options = {}) {
    const {
        delimiter = ',',
        newline = '\r\n',
        neutraliseFormulas = true
    } = options;

    const out = [];

    for (const page of (pages ?? [])) {
        for (const band of readingOrder(page?.bands)) collectBand(band, out);
    }

    if (out.length === 0) return '';

    return out
        .map(cells => encodeRow(cells, delimiter, neutraliseFormulas))
        .join(newline);
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
 * Adds a band's lines to the output.
 *
 * Items are sorted down the band and then across it, and neighbours that share
 * a line are written as one row - so a caption and the figure beside it arrive
 * as two cells rather than as two rows, which is how the band was designed to
 * be read.
 *
 * @param {object} band
 * @param {Array[]} out gathered rows, appended to
 */
function collectBand(band, out) {
    const drawn = (band?.items ?? [])
        .filter(item => item?.type === 'text' || item?.type === 'table')
        .sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));

    /** the run of text items being gathered, and the item that anchors its line */
    let line = null;
    const flush = () => {
        if (line) out.push(line.cells);
        line = null;
    };

    for (const item of drawn) {
        if (item.type === 'table') {
            flush();
            collectTable(item, out);
            continue;
        }

        if (line && sameLine(line.anchor, item)) {
            line.cells.push(item.text);
            continue;
        }

        flush();
        line = { anchor: item, cells: [item.text] };
    }

    flush();
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
 * Adds a table's rows to the output, in the order items.js draws them.
 *
 * The grouped shape repeats the column labels for every group that starts one,
 * and wraps each fragment's rows in the group's own header and footer bands -
 * which are bands, so they are written by the same code as any other.
 *
 * @param {object} table
 * @param {Array[]} out
 */
function collectTable(table, out) {
    const labels = () => table.columns.map(c => c.label ?? c.field);
    const cells = (row) => table.columns.map(c => row?.[c.field]);

    if (!table.groups) {
        if (table.showHeader) out.push(labels());
        for (const row of (table.row ?? [])) out.push(cells(row));
        return;
    }

    for (const fragment of table.groups) {
        if (fragment.showHeader && table.showHeader) out.push(labels());
        if (fragment.headerBand) collectBand(fragment.headerBand, out);

        for (const row of fragment.rows) out.push(cells(row));

        if (fragment.showFooter && fragment.footerBand) {
            collectBand(fragment.footerBand, out);
        }
    }
}


/**
 * A filename for the download, derived from the layout's name.
 * @param {object} paginated the buildPages result
 * @param {string} [extension='csv']
 * @returns {string}
 */
export function reportFilename(paginated, extension = 'csv') {
    const name = String(paginated?.name ?? 'report')
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/\s+/g, ' ')
        .trim() || 'report';

    return `${name}.${extension}`;
}


/**
 * Walks the page list for the first table, gathering its rows across every page
 * and every group fragment. One table per report today; if that ever changes,
 * this is the single place that has to decide what a multi-table export means.
 * @param {object[]} pages
 * @returns {{columns: object[], rows: {group: string|null, row: object}[]}|null}
 */
function collect(pages) {
    let columns = null;
    let id = null;
    const rows = [];

    for (const page of (pages ?? [])) {
        for (const band of (page.bands ?? [])) {
            for (const item of (band.items ?? [])) {
                if (item.type !== 'table') continue;
                if (id !== null && item.id !== id) continue;

                if (columns === null) {
                    id = item.id;
                    columns = item.columns ?? [];
                }

                if (item.row) {
                    for (const row of item.row) rows.push({ group: null, row });
                    continue;
                }

                for (const fragment of (item.groups ?? [])) {
                    for (const row of fragment.rows) {
                        rows.push({ group: fragment.key, row });
                    }
                }
            }
        }
    }

    return columns === null ? null : { columns, rows };
}


function encodeRow(cells, delimiter, neutraliseFormulas) {
    return cells.map(cell => encodeCell(cell, delimiter, neutraliseFormulas)).join(delimiter);
}


/**
 * RFC 4180 quoting: wrap when the value holds the delimiter, a quote, or a line
 * break, and double any quote inside.
 *
 * A leading =, +, - or @ is prefixed with a tab as well. A spreadsheet treats
 * such a cell as a formula, which turns an exported report into an execution
 * vector the moment someone opens it. The tab keeps the text readable and is
 * dropped on import; pass neutraliseFormulas:false for a byte-exact export.
 */
function encodeCell(value, delimiter, neutraliseFormulas) {
    if (value === null || value === undefined) return '';

    let text = String(value);

    if (neutraliseFormulas && FORMULA_LEAD.test(text)) {
        text = `\t${text}`;
    }

    const mustQuote =
        text.includes(delimiter) ||
        text.includes('"') ||
        text.includes('\n') ||
        text.includes('\r');

    return mustQuote ? `"${text.replace(/"/g, '""')}"` : text;
}

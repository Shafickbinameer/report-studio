/**
 * csv.js writes a report out as CSV, in two shapes.
 *
 * toCSV is the data rectangle: one table's rows and nothing else, one header
 * row and uniform columns, which is what a spreadsheet needs to sort, filter
 * and pivot. Rows split across a page break come back in one piece. A report
 * with several tables is several rectangles, so it is asked for one of them by
 * id - the first when it is not told.
 *
 * toReportCSV is the report as it reads on paper: every text line and every
 * table row, in the order the page draws them. Lines and boxes have no text to
 * give, so they are the two item types that cannot come along.
 *
 * Spec 5.1: "extract table rows from the page list, download as a file", and
 * spec 2.2 lists CSV export as a page-list consumer. So both read the built
 * pages - the same thing the renderer draws - and never the layout or the raw
 * data. Reading them is rows.js, shared with the XLSX export; this file is only
 * the encoding.
 */

import { reportRows, tableRows, columnLabel } from './rows.js';

export { reportTables } from './rows.js';


/** cells starting with these are executed as formulas by Excel and Sheets */
const FORMULA_LEAD = /^[=+\-@\t\r]/;


/**
 * One of the report's tables as CSV text.
 *
 * @param {object[]} pages the `pages` array from buildPages
 * @param {object} [options]
 * @param {string} [options.table] the id of the table to write; the first
 *   table in the report when absent. reportTables lists what there is
 * @param {string} [options.delimiter=','] use ';' for locales where Excel expects it
 * @param {string} [options.newline='\r\n'] RFC 4180 line ending
 * @param {boolean} [options.header=true] emit the column labels as the first row
 * @param {boolean} [options.groupColumn=true] prepend the group key on a grouped report
 * @param {string} [options.groupLabel='Group']
 * @param {boolean} [options.neutraliseFormulas=true] see below
 * @returns {string} CSV text, empty when the report holds no such table
 */
export function toCSV(pages, options = {}) {
    const {
        delimiter = ',',
        newline = '\r\n',
        header = true,
        groupColumn = true,
        groupLabel = 'Group',
        neutraliseFormulas = true,
        table: only = null
    } = options;

    const table = tableRows(pages, only);
    if (!table) return '';

    const grouped = groupColumn && table.rows.some(r => r.group !== null);
    const labels = table.columns.map(columnLabel);

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

    const rows = reportRows(pages);
    if (rows.length === 0) return '';

    return rows
        .map(({ cells }) => encodeRow(cells, delimiter, neutraliseFormulas))
        .join(newline);
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

/**
 * csv.js extracts a report's table rows as CSV.
 *
 * Spec 5.1: "extract table rows from the page list, download as a file", and
 * spec 2.2 lists CSV export as a page-list consumer. So this reads the built
 * pages - the same thing the renderer draws - and never the layout or the raw
 * data. Rows that were split across a page break come back in one piece,
 * because the page list already holds them in order.
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

/**
 * search.js finds text across a built report.
 *
 * Spec 2.2: the page list is the seam, and search is one of the consumers that
 * reads only it. So this walks the same structure the renderer draws and knows
 * nothing about grouping, measurement, or the DOM - which is what lets the
 * vanilla preview and a future React Preview share one implementation.
 */


/**
 * Every occurrence of {query} in a built report, in page order.
 *
 * @param {object[]} pages the `pages` array from buildPages
 * @param {string} query what to look for; blank returns no matches
 * @param {object} [options]
 * @param {boolean} [options.caseSensitive=false]
 * @returns {object[]} matches, each { pageNO, bandType, itemId, field, text, start, end }
 */
export function search(pages, query, { caseSensitive = false } = {}) {
    const needle = String(query ?? '');
    if (needle === '') return [];

    const matches = [];

    for (const page of (pages ?? [])) {
        for (const band of (page.bands ?? [])) {
            collectBand(band, page.pageNO, band.type, needle, caseSensitive, matches);
        }
    }

    return matches;
}


/**
 * The distinct pages a query appears on, in order. Handy for a page-at-a-time
 * viewer, which cares which pages to offer before it cares about offsets.
 * @param {object[]} pages
 * @param {string} query
 * @param {object} [options]
 * @returns {number[]}
 */
export function searchPages(pages, query, options) {
    return [...new Set(search(pages, query, options).map(m => m.pageNO))];
}


function collectBand(band, pageNO, bandType, needle, caseSensitive, matches) {
    for (const item of (band?.items ?? [])) {
        if (item.type === 'text') {
            push(matches, item.text, {
                pageNO, bandType, itemId: item.id, field: null
            }, needle, caseSensitive);
            continue;
        }

        if (item.type === 'table') {
            collectTable(item, pageNO, bandType, needle, caseSensitive, matches);
        }
    }
}


function collectTable(item, pageNO, bandType, needle, caseSensitive, matches) {
    const columns = item.columns ?? [];

    if (item.showHeader) {
        for (const column of columns) {
            push(matches, column.label, {
                pageNO, bandType, itemId: item.id, field: column.field
            }, needle, caseSensitive);
        }
    }

    if (item.row) {
        collectRows(item.row, columns, item.id, pageNO, bandType, needle, caseSensitive, matches);
        return;
    }

    /** a grouped table carries its rows inside per-group fragments */
    for (const fragment of (item.groups ?? [])) {
        collectBand(fragment.headerBand, pageNO, 'groupHeader', needle, caseSensitive, matches);
        collectRows(fragment.rows, columns, item.id, pageNO, bandType, needle, caseSensitive, matches);
        if (fragment.showFooter) {
            collectBand(fragment.footerBand, pageNO, 'groupFooter', needle, caseSensitive, matches);
        }
    }
}


function collectRows(rows, columns, itemId, pageNO, bandType, needle, caseSensitive, matches) {
    for (const row of (rows ?? [])) {
        for (const column of columns) {
            push(matches, row?.[column.field], {
                pageNO, bandType, itemId, field: column.field
            }, needle, caseSensitive);
        }
    }
}


/**
 * Records every occurrence within one string, not just the first - a page that
 * says "Cable" three times should count as three hits.
 */
function push(matches, value, where, needle, caseSensitive) {
    if (value == null) return;

    const text = String(value);
    const haystack = caseSensitive ? text : text.toLowerCase();
    const target = caseSensitive ? needle : needle.toLowerCase();

    let from = 0;

    while (from <= haystack.length - target.length) {
        const at = haystack.indexOf(target, from);
        if (at === -1) break;

        matches.push({
            ...where,
            text,
            start: at,
            end: at + target.length
        });

        from = at + target.length;
    }
}

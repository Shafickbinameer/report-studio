/**
 * tables.js answers the questions every stage asks about a report's tables:
 * which there are, which dataset each reads, and which one is grouped.
 *
 * A report used to have one table, so each stage found "the" table on its own -
 * and three copies of "the first table in the first band that has one" agreed
 * only because there was never a second. With more than one, a stage that
 * picked a different table from the others would bind rows to one table and
 * group bands to another. So the rules live here, once.
 *
 * Nothing here throws or validates; validate.js says what is wrong with a
 * layout, and these read whatever they are given as far as it goes.
 */


/**
 * Every table in the layout, in band order and then item order.
 *
 * Band order is the file's, which is page order for any layout the designer
 * wrote - and it is the order "the first table" has always meant.
 *
 * @param {object} layout
 * @returns {object[]} the table items themselves, not copies
 */
export function tablesOf(layout) {
    const found = [];

    for (const band of (Array.isArray(layout?.bands) ? layout.bands : [])) {
        for (const item of (Array.isArray(band?.items) ? band.items : [])) {
            if (item?.type === 'table') found.push(item);
        }
    }

    return found;
}


/**
 * The dataset a table reads its rows from: its own, or the report's.
 *
 * @param {object} table
 * @param {object} layout
 * @returns {string|null}
 */
export function datasetOf(table, layout) {
    const own = typeof table?.dataset === 'string' && table.dataset !== '' ? table.dataset : null;
    return own ?? layout?.dataset ?? null;
}


/**
 * Whether a table asks to be grouped by a field of its own.
 * @param {object} table
 * @returns {boolean}
 */
export function hasOwnGrouping(table) {
    return typeof table?.groupBy === 'string' && table.groupBy !== '';
}


/**
 * The grouped table, and the field it is grouped by.
 *
 * A table that names its own `groupBy` is the one. Failing that, a report-wide
 * `layout.groupBy` - which is what every layout written before a report could
 * hold two tables says - means the first table, since that was the only one it
 * could have meant.
 *
 * One at most: groupHeader and groupFooter are the report's bands, not a
 * table's, so two grouped tables would have to share one heading design.
 * validate.js refuses a second; this takes the first.
 *
 * @param {object} layout
 * @returns {{table: object, by: string}|null}
 */
export function groupingOf(layout) {
    const tables = tablesOf(layout);

    const own = tables.find(hasOwnGrouping);
    if (own) return { table: own, by: own.groupBy };

    if (layout?.groupBy != null && tables.length > 0) {
        return { table: tables[0], by: layout.groupBy };
    }

    return null;
}

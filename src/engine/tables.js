/**
 * tables.js answers the questions every stage asks about a report's tables:
 * which there are, which dataset each reads, and which are grouped and how.
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
 * The two band types a group is drawn with. In a layout file they are either a
 * table's own (`table.grouping[n].header` / `.footer`) or, in the older form,
 * the report's own bands of these types.
 */
export const GROUP_BAND_TYPES = ['groupHeader', 'groupFooter'];


/**
 * Whether a table asks to be grouped through the older `groupBy` field.
 *
 * Kept under its old name because that is what it has always answered. A table
 * grouped the current way, through `grouping`, is not one of these - isGrouped
 * answers "grouped either way".
 *
 * @param {object} table
 * @returns {boolean}
 */
export function hasOwnGrouping(table) {
    return typeof table?.groupBy === 'string' && table.groupBy !== '';
}


/**
 * A table's grouping levels, outermost first, as the layout states them.
 *
 * Only one level is drawn for now; validate.js refuses more. It is a list
 * anyway because that is the shape nested groups will need, and a layout file
 * written today should not have to change shape to gain a second level.
 *
 * @param {object} table
 * @returns {object[]} `{ by, header, footer }` entries, never null
 */
export function levelsOf(table) {
    return Array.isArray(table?.grouping) ? table.grouping : [];
}


/**
 * Whether a table is grouped, whichever way the layout says so.
 * @param {object} table
 * @returns {boolean}
 */
export function isGrouped(table) {
    return levelsOf(table).length > 0 || hasOwnGrouping(table);
}


/**
 * The group bands a table is drawn with: its first level's. A table that is not
 * grouped, or a level without one of them, gets null for that band.
 *
 * Reads a normalised layout - one that has been through normalizeGrouping, as
 * every layout past group.js has.
 *
 * @param {object} table
 * @returns {{header: object|null, footer: object|null}}
 */
export function groupBandsOf(table) {
    const level = levelsOf(table)[0];

    return {
        header: level?.header ?? null,
        footer: level?.footer ?? null
    };
}


/**
 * The table the older form of grouping means, and its field.
 *
 * A table that names its own `groupBy` is the one. Failing that, a report-wide
 * `layout.groupBy` means the first table, since when that was written it was
 * the only table there could be. Either way it is drawn with the report's own
 * groupHeader and groupFooter bands, which is why there is at most one.
 *
 * @param {object} layout
 * @returns {{table: object, by: string}|null}
 */
function legacyGroupingOf(layout) {
    const tables = tablesOf(layout);

    const own = tables.find(hasOwnGrouping);
    if (own) return { table: own, by: own.groupBy };

    if (layout?.groupBy != null && tables.length > 0) {
        return { table: tables[0], by: layout.groupBy };
    }

    return null;
}


/** the report's own band of a type, which only the older form of grouping uses */
function reportBand(layout, type) {
    return (Array.isArray(layout?.bands) ? layout.bands : [])
        .find(band => band?.type === type) ?? null;
}


/**
 * Every grouped table, in table order, with the field it is grouped by and the
 * bands its groups are drawn with.
 *
 * Reads either form. A table's own `grouping` says all three itself; a table
 * grouped the older way borrows the report's groupHeader and groupFooter.
 * Where a table says both, its own `grouping` is the one taken - validate.js
 * calls that a mistake, and this reads whatever it is given as far as it goes.
 *
 * @param {object} layout
 * @returns {{table: object, by: string, header: object|null, footer: object|null}[]}
 */
export function groupingsOf(layout) {
    const legacy = legacyGroupingOf(layout);
    const found = [];

    for (const table of tablesOf(layout)) {
        const level = levelsOf(table)[0];

        if (level) {
            found.push({
                table,
                by: level.by,
                header: level.header ?? null,
                footer: level.footer ?? null
            });
        } else if (legacy?.table === table) {
            found.push({
                table,
                by: legacy.by,
                header: reportBand(layout, 'groupHeader'),
                footer: reportBand(layout, 'groupFooter')
            });
        }
    }

    return found;
}


/**
 * The first grouped table, and the field it is grouped by - or null.
 *
 * What this answered when a report could group only one table, and still the
 * question a caller asks when it only wants to know whether anything is.
 * groupingsOf lists them all.
 *
 * @param {object} layout
 * @returns {{table: object, by: string, header: object|null, footer: object|null}|null}
 */
export function groupingOf(layout) {
    return groupingsOf(layout)[0] ?? null;
}


/**
 * A copy of a layout with its grouping said one way only: on each table.
 *
 * The older form - `layout.groupBy` or `table.groupBy`, drawn with the report's
 * own groupHeader and groupFooter bands - becomes that table's `grouping`, with
 * those bands moved into it. Every stage after this one then has a single shape
 * to read, and a report that groups three tables is no different to them from
 * one that groups one.
 *
 * What goes away: `layout.groupBy`, every `table.groupBy`, and the report's
 * group bands, which only ever meant "how the grouped table's groups look" and
 * now sit on that table. A group band the older form left unused is dropped
 * too; nothing ever drew it.
 *
 * Each group band is stamped with its type, so the stages that tell a group
 * band from any other by its type go on telling it.
 *
 * Idempotent: a layout already in this shape comes back as an equal copy.
 *
 * @param {object} layout
 * @returns {object} a new layout; the one given is not touched
 */
export function normalizeGrouping(layout) {
    const out = structuredClone(layout);
    if (out == null || typeof out !== 'object') return out;

    for (const grouping of groupingsOf(out)) {
        if (levelsOf(grouping.table).length === 0) {
            grouping.table.grouping = [{
                by: grouping.by,
                header: grouping.header,
                footer: grouping.footer
            }];
        }
    }

    for (const table of tablesOf(out)) {
        delete table.groupBy;

        for (const level of levelsOf(table)) {
            if (level == null || typeof level !== 'object') continue;

            level.header = typed(level.header, 'groupHeader');
            level.footer = typed(level.footer, 'groupFooter');
        }
    }

    delete out.groupBy;

    if (Array.isArray(out.bands)) {
        out.bands = out.bands.filter(band => !GROUP_BAND_TYPES.includes(band?.type));
    }

    return out;
}


/** a group band carrying its type, or null for a level that has none */
function typed(band, type) {
    if (band == null || typeof band !== 'object') return null;
    band.type = type;
    return band;
}

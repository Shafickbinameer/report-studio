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
 * The most levels a table may be grouped at.
 *
 * Every level adds a header and a footer that a page has to find room for
 * beside a row, and a report grouped eight deep has stopped being a table and
 * become an outline. validate.js refuses more; the designer stops offering.
 */
export const MAX_GROUP_LEVELS = 8;


/** the orders a level's groups may be put in, besides the order they are first seen */
export const GROUP_SORTS = ['asc', 'desc'];


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
 * Each level after the first splits the groups of the one before it: grouped
 * by region and then by city, "Oslo" under North and "Oslo" under South are
 * two groups, each inside its own region.
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
 * The group bands one level of a table is drawn with - the outermost level's
 * when no level is named. A table that is not grouped that deep, or a level
 * without one of them, gets null for that band.
 *
 * Reads a normalised layout - one that has been through normalizeGrouping, as
 * every layout past group.js has.
 *
 * @param {object} table
 * @param {number} [level=0] 0 is the outermost level
 * @returns {{header: object|null, footer: object|null}}
 */
export function groupBandsOf(table, level = 0) {
    const found = levelsOf(table)[level];

    return {
        header: found?.header ?? null,
        footer: found?.footer ?? null
    };
}


/**
 * What one fragment of a group draws around its rows - the rule measure.js
 * sizes a grouped table by, paginate.js splits it by, and the renderer draws
 * it by, kept here so the three cannot disagree.
 *
 * `leaf` is one of the innermost groups group.js makes, with `opens` and
 * `closes` (both 0 for a table grouped at one level). A fragment is all of
 * that group's rows on one page, or as many as fit.
 *
 *   column labels   on the first fragment of the table on a page, and wherever
 *                   an outermost group starts. A one-level table so prints
 *                   them over every group, as it always has; a nested one
 *                   does not repeat them for every city in a region.
 *   group headers   from the level the group opens inwards - and every level's
 *                   on the first fragment on a page, so a page that carries
 *                   on a region still says which region it is.
 *   group footers   on the fragment that ends the group only, from the
 *                   innermost level out to the one it closes.
 *
 * @param {object} table the table, past normalizeGrouping
 * @param {object} leaf the group the fragment is of
 * @param {boolean} firstOnPage whether nothing of this table is above it on the page
 * @param {boolean} ends whether the fragment holds the group's last row
 * @returns {{columnHeader: boolean, headers: {level: number, band: object}[],
 *   footers: {level: number, band: object}[]}} headers outermost first,
 *   footers innermost first, each as it is drawn
 */
export function groupFrame(table, leaf, firstOnPage, ends) {
    const levels = levelsOf(table);
    const opens = leaf?.opens ?? 0;
    const closes = leaf?.closes ?? 0;

    const headers = [];
    for (let level = firstOnPage ? 0 : opens; level < levels.length; level++) {
        const band = levels[level]?.header;
        if (band) headers.push({ level, band });
    }

    const footers = [];
    if (ends) {
        for (let level = levels.length - 1; level >= closes; level--) {
            const band = levels[level]?.footer;
            if (band) footers.push({ level, band });
        }
    }

    return { columnHeader: firstOnPage || opens === 0, headers, footers };
}


/**
 * Whether a group has to start on a page of its own: it starts a group at a
 * level that says `newPage`, and it is not the table's first group - which
 * starts wherever the table does, as anything else in a band would.
 *
 * @param {object} table the table, past normalizeGrouping
 * @param {object} leaf one of the innermost groups group.js makes
 * @param {number} n its place in the table's `groups`
 * @returns {boolean}
 */
export function startsPage(table, leaf, n) {
    if (n === 0) return false;

    const levels = levelsOf(table);
    for (let level = leaf?.opens ?? 0; level < levels.length; level++) {
        if (levels[level]?.newPage === true) return true;
    }

    return false;
}


/**
 * The group bands a built fragment draws, in drawing order: headers outermost
 * first, footers innermost first.
 *
 * Reads `headerBands` / `footerBands`, and falls back to the single
 * `headerBand` / `footerBand` a fragment built some other way may carry - the
 * designer's canvas draws one-level fragments of its own.
 *
 * @param {object} fragment one entry of a built table's `groups`
 * @returns {{headers: object[], footers: object[]}}
 */
export function fragmentBandsOf(fragment) {
    const headers = Array.isArray(fragment?.headerBands)
        ? fragment.headerBands
        : [fragment?.headerBand];

    const footers = Array.isArray(fragment?.footerBands)
        ? fragment.footerBands
        : [fragment?.showFooter ? fragment?.footerBand : null];

    return { headers: headers.filter(Boolean), footers: footers.filter(Boolean) };
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
 * bands its groups are drawn with - its outermost level's. A table grouped
 * within its groups as well has the rest in `levels`, which lists every level,
 * outermost first.
 *
 * Reads either form. A table's own `grouping` says all three itself; a table
 * grouped the older way borrows the report's groupHeader and groupFooter.
 * Where a table says both, its own `grouping` is the one taken - validate.js
 * calls that a mistake, and this reads whatever it is given as far as it goes.
 *
 * @param {object} layout
 * @returns {{table: object, by: string, header: object|null, footer: object|null,
 *   levels: {by: string, header: object|null, footer: object|null}[]}[]}
 */
export function groupingsOf(layout) {
    const legacy = legacyGroupingOf(layout);
    const found = [];

    for (const table of tablesOf(layout)) {
        /** each level whole - its `sort` and `newPage` with it - bands made explicit */
        const levels = levelsOf(table)
            .filter(level => level != null && typeof level === 'object')
            .map(level => ({
                ...level,
                header: level.header ?? null,
                footer: level.footer ?? null
            }));

        if (levels.length > 0) {
            found.push({ table, ...levels[0], levels });
        } else if (legacy?.table === table) {
            const only = {
                by: legacy.by,
                header: reportBand(layout, 'groupHeader'),
                footer: reportBand(layout, 'groupFooter')
            };
            found.push({ table, ...only, levels: [only] });
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

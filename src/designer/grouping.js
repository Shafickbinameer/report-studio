/**
 * grouping.js is the designer's side of a table's own grouping.
 *
 * A grouped table carries the bands its groups are drawn with:
 *
 *   { type: 'table', id: 'refunds', grouping: [{ by: 'reason', header, footer }] }
 *
 * Everything else in the designer addresses a band by a string - its type,
 * which was enough when a report had one band of each type. A table's group
 * band is addressed the same way, by a key naming the table as well:
 *
 *   'groupHeader:refunds'   the header of the table whose id is "refunds"
 *
 * So the selection, the canvas's data-band-type, the band rail and every
 * structure.js call keep taking one string, and only the few places that need
 * to know what *kind* of band a key means ask kindOf().
 *
 * Nothing here touches the document, so all of it is specified without one.
 */

import {
    tablesOf, levelsOf, hasOwnGrouping, normalizeGrouping, GROUP_BAND_TYPES
} from '../engine/tables.js';


/** the two kinds of group band, in the order a group draws them */
export const GROUP_KINDS = GROUP_BAND_TYPES;

/** what a group band is worth when it is first switched on - as a report band's */
export const NEW_GROUP_BAND_HEIGHT = 36;

const SEPARATOR = ':';

/** which property of a grouping level holds each kind of band */
const SLOT = { groupHeader: 'header', groupFooter: 'footer' };


/**
 * The key a table's group band is addressed by.
 * @param {'groupHeader'|'groupFooter'} kind
 * @param {string} tableId
 * @returns {string}
 */
export function groupBandKey(kind, tableId) {
    return `${kind}${SEPARATOR}${tableId}`;
}


/**
 * What a band key names, when it names a table's group band.
 *
 * Split at the first separator only, so a table whose id has a colon in it is
 * still found.
 *
 * @param {string} key
 * @returns {{kind: string, table: string}|null} null for any other key
 */
export function parseBandKey(key) {
    if (typeof key !== 'string') return null;

    const at = key.indexOf(SEPARATOR);
    if (at === -1) return null;

    const kind = key.slice(0, at);
    if (!GROUP_KINDS.includes(kind)) return null;

    return { kind, table: key.slice(at + SEPARATOR.length) };
}


/**
 * The band type a key means: `groupHeader:refunds` is a groupHeader, and every
 * other key is its own type.
 * @param {string} key
 * @returns {string}
 */
export function kindOf(key) {
    return parseBandKey(key)?.kind ?? key;
}


/** whether a key means a band drawn once per group, either kind of key */
export function isGroupKind(key) {
    return GROUP_KINDS.includes(kindOf(key));
}


/**
 * What to call a band where a person reads it - the gutter, the band rail, the
 * placeholder dialog. A table's group band says whose it is.
 * @param {string} key
 * @returns {string}
 */
export function bandLabel(key) {
    const parsed = parseBandKey(key);
    return parsed ? `${parsed.kind} · ${parsed.table}` : String(key ?? '');
}


/** the table with this id, or null */
export function tableById(layout, id) {
    return tablesOf(layout).find(table => table.id === id) ?? null;
}


/**
 * The band behind a table's group band key.
 * @param {object} layout
 * @param {string} key
 * @returns {object|null} null when the key is not a group band key, the table
 *   is not there or not grouped, or the level has no band of that kind
 */
export function groupBandAt(layout, key) {
    const parsed = parseBandKey(key);
    if (!parsed) return null;

    const level = levelsOf(tableById(layout, parsed.table))[0];
    const band = level?.[SLOT[parsed.kind]];

    return band && typeof band === 'object' ? band : null;
}


/**
 * Every table group band the report has, in table order.
 * @param {object} layout
 * @returns {{key: string, kind: string, table: string, band: object}[]}
 */
export function groupBandsIn(layout) {
    const found = [];

    for (const table of tablesOf(layout)) {
        const level = levelsOf(table)[0];
        if (!level || typeof level !== 'object') continue;

        for (const kind of GROUP_KINDS) {
            const band = level[SLOT[kind]];

            if (band && typeof band === 'object') {
                found.push({ key: groupBandKey(kind, table.id), kind, table: table.id, band });
            }
        }
    }

    return found;
}


/**
 * Every grouped table, with both its group band keys - whether or not the band
 * is switched on. What the band rail offers a checkbox for.
 * @param {object} layout
 * @returns {{table: string, by: string, keys: string[]}[]}
 */
export function groupedTables(layout) {
    return tablesOf(layout)
        .filter(table => levelsOf(table).length > 0)
        .map(table => ({
            table: table.id,
            by: levelsOf(table)[0]?.by ?? '',
            keys: GROUP_KINDS.map(kind => groupBandKey(kind, table.id))
        }));
}


/**
 * Switches one of a table's group bands on or off.
 *
 * Switching off the last one is allowed, though a group with neither a header
 * nor a footer is a layout validate.js refuses - the same as switching off the
 * report's group band under a report-wide groupBy always was. A half-made
 * report is the normal state of one being designed; the problem is said in the
 * corner, and the switch beside it is the fix. Clearing the table's *Group by*
 * is how grouping is turned off.
 *
 * @param {object} layout
 * @param {string} key
 * @param {boolean} on
 * @returns {object|boolean} the band switched on, true for one switched off,
 *   false when nothing changed
 */
export function setGroupBand(layout, key, on) {
    const parsed = parseBandKey(key);
    if (!parsed) return false;

    const level = levelsOf(tableById(layout, parsed.table))[0];
    if (!level || typeof level !== 'object') return false;

    const slot = SLOT[parsed.kind];

    if (on) {
        if (level[slot]) return false;

        level[slot] = { type: parsed.kind, height: NEW_GROUP_BAND_HEIGHT, items: [] };
        return level[slot];
    }

    if (!level[slot]) return false;

    level[slot] = null;
    return true;
}


/**
 * The groupings a table had before its *Group by* was cleared.
 *
 * Clearing the box and typing a new field arrives as an empty value between
 * the two, and the header and footer someone designed should not be the price
 * of retyping a name. Kept beside the table rather than on it, so it is never
 * saved with the file.
 */
const cleared = new WeakMap();


/**
 * Sets the field a table is grouped by, which is how grouping is switched on
 * and off from the rail.
 *
 *   a field, on a table not yet grouped   grouped, with a header showing the
 *                                         group's value
 *   another field                         regrouped; a `{old}` in its bands
 *                                         becomes `{new}`
 *   nothing                               no longer grouped
 *
 * @param {object} table mutated in place
 * @param {string|null} by
 * @returns {boolean} whether anything changed
 */
export function setGroupBy(table, by) {
    const level = levelsOf(table)[0];

    if (by == null || by === '') {
        if (!level && !hasOwnGrouping(table)) return false;

        if (level) cleared.set(table, level);

        delete table.grouping;
        delete table.groupBy;
        return true;
    }

    if (level) {
        if (level.by === by) return false;

        renameField([level.header, level.footer], level.by, by);
        level.by = by;
        return true;
    }

    delete table.groupBy;

    const before = cleared.get(table);

    if (before) {
        cleared.delete(table);
        renameField([before.header, before.footer], before.by, by);
        table.grouping = [{ ...before, by }];
        return true;
    }

    table.grouping = [{
        by,
        header: {
            type: 'groupHeader',
            height: NEW_GROUP_BAND_HEIGHT,
            items: [groupLabel(by)]
        },
        footer: null
    }];

    return true;
}


/**
 * Gives one grouped table the header and footer another one is drawn with.
 *
 * For two tables that should look alike - a grouping's design is not shared,
 * so this is a copy, and the two are edited apart afterwards. The copy says
 * `{by}` for the table it lands on wherever the original said its own.
 *
 * @param {object} layout
 * @param {string} toId the table to copy onto, which must be grouped
 * @param {string} fromId the grouped table to copy from
 * @returns {boolean} whether anything was copied
 */
export function copyGroupDesign(layout, toId, fromId) {
    if (toId === fromId) return false;

    const target = levelsOf(tableById(layout, toId))[0];
    const source = levelsOf(tableById(layout, fromId))[0];

    if (!target || !source) return false;

    target.header = source.header ? structuredClone(source.header) : null;
    target.footer = source.footer ? structuredClone(source.footer) : null;

    renameField([target.header, target.footer], source.by, target.by);

    return true;
}


/**
 * Whether a layout still says its grouping the older way - `groupBy` on the
 * report or a table - and so has to be moved onto its table before the
 * designer can show it.
 * @param {object} layout
 * @returns {boolean}
 */
export function needsNormalizing(layout) {
    if (layout == null || typeof layout !== 'object') return false;

    return layout.groupBy != null || tablesOf(layout).some(hasOwnGrouping);
}


/**
 * The layout the designer edits, for a layout it was given.
 *
 * The older form of grouping is moved onto its table; anything else is the
 * very object that was passed in, because a host that handed the designer its
 * layout may be holding on to it. A report-level group band that nothing is
 * grouped by is left where it is: it was drawn by somebody, and it is theirs
 * to remove from the band list.
 *
 * @param {object} layout
 * @returns {object}
 */
export function openLayout(layout) {
    return needsNormalizing(layout) ? normalizeGrouping(layout) : layout;
}


/** `{old}` to `{new}` in every text item of the given bands */
function renameField(bands, from, to) {
    if (!from || !to || from === to) return;

    for (const band of bands) {
        for (const item of (band?.items ?? [])) {
            if (item?.type === 'text' && typeof item.value === 'string') {
                item.value = item.value.split(`{${from}}`).join(`{${to}}`);
            }
        }
    }
}


/** the header a new grouping starts with: the group's own value, in bold */
function groupLabel(by) {
    return {
        id: 'group-label',
        type: 'text',
        x: 0,
        y: 8,
        w: 300,
        h: 20,
        value: `{${by}}`,
        style: {
            fontFamily: 'Helvetica, Arial, sans-serif',
            fontSize: 12,
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#000000',
            align: 'left',
            background: null,
            border: null,
            padding: 0
        }
    };
}

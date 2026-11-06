/**
 * grouping.js is the designer's side of a table's own grouping.
 *
 * A grouped table carries the bands its groups are drawn with, one pair for
 * each level it is grouped at, outermost first:
 *
 *   { type: 'table', id: 'sales', grouping: [
 *       { by: 'region', header, footer },
 *       { by: 'city',   header, footer }      within each region
 *   ] }
 *
 * Everything else in the designer addresses a band by a string - its type,
 * which was enough when a report had one band of each type. A table's group
 * band is addressed the same way, by a key naming the table as well, and the
 * level when it is not the outermost:
 *
 *   'groupHeader:sales'     the header of the outermost level of table "sales"
 *   'groupHeader@1:sales'   the header of its second level
 *
 * The outermost level's key is the one a table grouped at one level has always
 * had. The level sits before the separator, where a table id cannot reach, so
 * an id with a colon in it is still read whole.
 *
 * So the selection, the canvas's data-band-type, the band rail and every
 * structure.js call keep taking one string, and only the few places that need
 * to know what *kind* of band a key means ask kindOf().
 *
 * Nothing here touches the document, so all of it is specified without one.
 */

import {
    tablesOf, levelsOf, hasOwnGrouping, normalizeGrouping, GROUP_BAND_TYPES,
    MAX_GROUP_LEVELS, GROUP_SORTS
} from '../engine/tables.js';


/** the two kinds of group band, in the order a group draws them */
export const GROUP_KINDS = GROUP_BAND_TYPES;

/** what a group band is worth when it is first switched on - as a report band's */
export const NEW_GROUP_BAND_HEIGHT = 36;

const SEPARATOR = ':';

/** between a band's kind and its level, in the key of any level but the outermost */
const LEVEL_MARK = '@';

/** which property of a grouping level holds each kind of band */
const SLOT = { groupHeader: 'header', groupFooter: 'footer' };


/**
 * The key a table's group band is addressed by.
 * @param {'groupHeader'|'groupFooter'} kind
 * @param {string} tableId
 * @param {number} [level=0] 0 is the outermost
 * @returns {string}
 */
export function groupBandKey(kind, tableId, level = 0) {
    const mark = level > 0 ? `${LEVEL_MARK}${level}` : '';
    return `${kind}${mark}${SEPARATOR}${tableId}`;
}


/**
 * What a band key names, when it names a table's group band.
 *
 * Split at the first separator only, so a table whose id has a colon in it is
 * still found.
 *
 * @param {string} key
 * @returns {{kind: string, table: string, level: number}|null} null for any other key
 */
export function parseBandKey(key) {
    if (typeof key !== 'string') return null;

    const at = key.indexOf(SEPARATOR);
    if (at === -1) return null;

    const [kind, mark, ...rest] = key.slice(0, at).split(LEVEL_MARK);
    if (!GROUP_KINDS.includes(kind) || rest.length) return null;

    let level = 0;

    if (mark !== undefined) {
        if (!/^[1-9]\d*$/.test(mark)) return null;
        level = Number(mark);
    }

    return { kind, table: key.slice(at + SEPARATOR.length), level };
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
 * placeholder dialog. A table's group band says whose it is, and which level
 * when it is not the outermost.
 * @param {string} key
 * @returns {string}
 */
export function bandLabel(key) {
    const parsed = parseBandKey(key);
    if (!parsed) return String(key ?? '');

    const level = parsed.level > 0 ? ` ${parsed.level + 1}` : '';
    return `${parsed.kind}${level} · ${parsed.table}`;
}


/** the table with this id, or null */
export function tableById(layout, id) {
    return tablesOf(layout).find(table => table.id === id) ?? null;
}


/** a table's level, when it is a level the designer can edit */
function levelAt(table, n) {
    const level = levelsOf(table)[n];
    return level && typeof level === 'object' ? level : null;
}


/**
 * The band behind a table's group band key.
 * @param {object} layout
 * @param {string} key
 * @returns {object|null} null when the key is not a group band key, the table
 *   is not there or not grouped that deep, or the level has no band of that kind
 */
export function groupBandAt(layout, key) {
    const parsed = parseBandKey(key);
    if (!parsed) return null;

    const band = levelAt(tableById(layout, parsed.table), parsed.level)?.[SLOT[parsed.kind]];

    return band && typeof band === 'object' ? band : null;
}


/**
 * Every group band key a table has room for, in the order a group draws them:
 * the headers outermost first, then the footers innermost first.
 * @param {object} table
 * @returns {{key: string, kind: string, level: number}[]}
 */
function tableKeys(table) {
    const depth = levelsOf(table).length;
    const levels = Array.from({ length: depth }, (_, n) => n);

    return [
        ...levels.map(level => ({ kind: 'groupHeader', level })),
        ...levels.reverse().map(level => ({ kind: 'groupFooter', level }))
    ].map(({ kind, level }) => ({ key: groupBandKey(kind, table.id, level), kind, level }));
}


/**
 * Every table group band the report has, in table order and, within a table,
 * in the order a group draws them.
 * @param {object} layout
 * @returns {{key: string, kind: string, table: string, level: number, band: object}[]}
 */
export function groupBandsIn(layout) {
    const found = [];

    for (const table of tablesOf(layout)) {
        for (const { key, kind, level } of tableKeys(table)) {
            const band = levelAt(table, level)?.[SLOT[kind]];

            if (band && typeof band === 'object') {
                found.push({ key, kind, table: table.id, level, band });
            }
        }
    }

    return found;
}


/**
 * Every grouped table, with its group band keys - whether or not the band is
 * switched on. What the band rail offers a checkbox for.
 *
 * `by` and `keys` are the outermost level's; `levels` has every level's,
 * outermost first.
 *
 * @param {object} layout
 * @returns {{table: string, by: string, keys: string[],
 *   levels: {by: string, keys: string[]}[]}[]}
 */
export function groupedTables(layout) {
    return tablesOf(layout)
        .filter(table => levelsOf(table).length > 0)
        .map(table => {
            const levels = levelsOf(table).map((level, n) => ({
                by: level?.by ?? '',
                keys: GROUP_KINDS.map(kind => groupBandKey(kind, table.id, n))
            }));

            return { table: table.id, by: levels[0].by, keys: levels[0].keys, levels };
        });
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

    const level = levelAt(tableById(layout, parsed.table), parsed.level);
    if (!level) return false;

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
 * The groupings a table had before its *Group by* was cleared - every level.
 *
 * Clearing the box and typing a new field arrives as an empty value between
 * the two, and the header and footer someone designed should not be the price
 * of retyping a name. Kept beside the table rather than on it, so it is never
 * saved with the file.
 */
const cleared = new WeakMap();


/**
 * Sets the field one level of a table is grouped by.
 *
 * The outermost level's is the table's *Group by*, which is how grouping is
 * switched on and off from the rail:
 *
 *   a field, on a table not yet grouped   grouped, with a header showing the
 *                                         group's value
 *   another field                         regrouped; a `{old}` in its bands
 *                                         becomes `{new}`
 *   nothing                               no longer grouped, at any level
 *
 * An inner level is only ever renamed. Emptying its box leaves it there with
 * no field - which validate.js names - rather than taking away the level and
 * the box being typed in with it; addGroupLevel and removeGroupLevel are how
 * levels come and go. An inner level given its first field gets a header
 * showing it, as a new grouping does, if its header is still empty.
 *
 * @param {object} table mutated in place
 * @param {string|null} by
 * @param {number} [n=0] the level
 * @returns {boolean} whether anything changed
 */
export function setGroupBy(table, by, n = 0) {
    if (n > 0) return renameLevel(table, n, by ?? '');

    const level = levelAt(table, 0);

    if (by == null || by === '') {
        if (!level && !hasOwnGrouping(table)) return false;

        if (level) cleared.set(table, levelsOf(table));

        delete table.grouping;
        delete table.groupBy;
        return true;
    }

    if (level) return renameLevel(table, 0, by);

    delete table.groupBy;

    const before = cleared.get(table);

    if (before?.length) {
        cleared.delete(table);
        const [outer, ...inner] = before;
        renameField([outer.header, outer.footer], outer.by, by);
        table.grouping = [{ ...outer, by }, ...inner];
        return true;
    }

    table.grouping = [newLevel(by)];

    return true;
}


/** a level's field changed, and its bands' `{old}` with it */
function renameLevel(table, n, by) {
    const level = levelAt(table, n);
    if (!level || level.by === by) return false;

    if (!level.by && by && level.header && !(level.header.items ?? []).length) {
        level.header.items = [groupLabel(by)];
    }

    renameField([level.header, level.footer], level.by, by);
    level.by = by;
    return true;
}


/**
 * Groups a grouped table again, within the groups of its innermost level - by
 * city within region. The new level starts with a header, as a new grouping
 * does, and with no field until one is typed.
 *
 * @param {object} table mutated in place; must already be grouped
 * @param {string} [by='']
 * @returns {number} the new level's index, or -1 when the table is not grouped
 */
export function addGroupLevel(table, by = '') {
    if (!Array.isArray(table?.grouping) || table.grouping.length === 0) return -1;
    if (table.grouping.length >= MAX_GROUP_LEVELS) return -1;

    table.grouping.push(by ? newLevel(by) : {
        by: '',
        header: { type: 'groupHeader', height: NEW_GROUP_BAND_HEIGHT, items: [] },
        footer: null
    });

    return table.grouping.length - 1;
}


/**
 * Sets how one level's groups are put in order and placed:
 *
 *   sort      'asc' or 'desc' by the group's value; '' or null for the order
 *             the values are first seen in, which is left out of the file
 *   newPage   true to start each of the level's groups, after the table's
 *             first, on a page of its own; false is left out of the file
 *
 * @param {object} table mutated in place
 * @param {number} n the level
 * @param {'sort'|'newPage'} option
 * @param {*} value
 * @returns {boolean} whether anything changed
 */
export function setGroupOption(table, n, option, value) {
    const level = levelAt(table, n);
    if (!level) return false;

    let next;

    if (option === 'sort') next = GROUP_SORTS.includes(value) ? value : undefined;
    else if (option === 'newPage') next = value === true ? true : undefined;
    else return false;

    if (level[option] === next) return false;

    if (next === undefined) delete level[option];
    else level[option] = next;

    return true;
}


/**
 * Takes one level out of a table's grouping, with its bands. The levels inside
 * it move out one; taking out the only level ungroups the table, as clearing
 * its *Group by* does.
 *
 * @param {object} table mutated in place
 * @param {number} n
 * @returns {boolean} whether there was such a level
 */
export function removeGroupLevel(table, n) {
    if (!levelAt(table, n)) return false;

    if (levelsOf(table).length === 1) return setGroupBy(table, null);

    table.grouping.splice(n, 1);
    return true;
}


/**
 * Swaps a level with the one outside it: grouping by city and then region
 * rather than region and then city. Each level keeps its own bands.
 *
 * @param {object} table mutated in place
 * @param {number} n the level to move out; 0 cannot be
 * @returns {boolean} whether anything moved
 */
export function moveGroupLevelOut(table, n) {
    if (n < 1 || !levelAt(table, n) || !levelAt(table, n - 1)) return false;

    const [level] = table.grouping.splice(n, 1);
    table.grouping.splice(n - 1, 0, level);
    return true;
}


/**
 * Gives one grouped table the group headers and footers another one is drawn
 * with - every level of them.
 *
 * For two tables that should look alike - a grouping's design is not shared,
 * so this is a copy, and the two are edited apart afterwards. Each level of the
 * copy says `{by}` for the level it lands on wherever the original said its
 * own. Levels the source has and the target does not are left out, and a
 * level the target has and the source does not keeps its own bands.
 *
 * @param {object} layout
 * @param {string} toId the table to copy onto, which must be grouped
 * @param {string} fromId the grouped table to copy from
 * @returns {boolean} whether anything was copied
 */
export function copyGroupDesign(layout, toId, fromId) {
    if (toId === fromId) return false;

    const targets = levelsOf(tableById(layout, toId));
    const sources = levelsOf(tableById(layout, fromId));

    let copied = false;

    targets.forEach((target, n) => {
        const source = sources[n];
        if (!target || typeof target !== 'object' || !source || typeof source !== 'object') return;

        target.header = source.header ? structuredClone(source.header) : null;
        target.footer = source.footer ? structuredClone(source.footer) : null;

        renameField([target.header, target.footer], source.by, target.by);
        copied = true;
    });

    return copied;
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


/** a level grouped by `by`, with a header showing the group's value */
function newLevel(by) {
    return {
        by,
        header: {
            type: 'groupHeader',
            height: NEW_GROUP_BAND_HEIGHT,
            items: [groupLabel(by)]
        },
        footer: null
    };
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

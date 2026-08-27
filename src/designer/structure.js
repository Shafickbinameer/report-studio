/**
 * structure.js changes the shape of a report: which bands exist, what items are
 * on them, and what columns a table has.
 *
 * Pure functions over the layout object, so every rule that matters - a table
 * keeps at least one column, a new id does not collide, a band lands in page
 * order - is specified without a browser.
 *
 * One thing from validate.js shapes all of it: a band type may appear only
 * once. Bands are therefore a *set* of at most seven, not an ordered list, and
 * their order on the page is regions.js's decision rather than the author's.
 * That removes reordering from the designer entirely.
 */

import { GRID, snap, designHeight } from './geometry.js';
import { FONT_STACKS } from './fields.js';
import { absoluteTop } from './canvas.js';


/** every band type, in the order they appear down the page */
export const BAND_TYPES = [
    'pageHeader',
    'reportHeader',
    'groupHeader',
    'detail',
    'groupFooter',
    'reportFooter',
    'pageFooter'
];


/**
 * What a band is worth when it is first switched on.
 *
 * regions.js defaults an undeclared band to 10% of the printable height, which
 * is a tenth of the page given away without being asked for. These are the
 * pixel figures a report actually tends to want. `detail` is absent on purpose:
 * it takes whatever the other zones leave.
 */
const NEW_BAND_HEIGHTS = {
    pageHeader: 40,
    reportHeader: 80,
    groupHeader: 36,
    groupFooter: 36,
    reportFooter: 60,
    pageFooter: 40
};

/**
 * What a column is worth before anyone sets it. Narrow on purpose: a new table
 * is usually several columns, and starting each one narrow means the author
 * widens the two that matter rather than shrinking all six.
 */
export const DEFAULT_COLUMN_WIDTH = 50;

/** how many columns the table tool offers to start with */
export const DEFAULT_COLUMNS = 3;


/** a band that says what it is, for the ones whose purpose is not obvious */
export const BAND_NOTES = {
    reportHeader: 'First page only',
    pageHeader: 'Every page',
    groupHeader: 'Before each group',
    detail: 'The rows',
    groupFooter: 'After each group',
    reportFooter: 'Last page only',
    pageFooter: 'Every page'
};


/**
 * The band list, always as an array.
 *
 * The report rail is drawn for whatever layout is loaded, including one that is
 * currently invalid - so `bands` may legitimately be a string someone typed, or
 * missing entirely, and every reader here has to survive that. A broken layout
 * is reported by the validator, not by a TypeError three calls down.
 */
function bandList(layout) {
    return Array.isArray(layout?.bands) ? layout.bands : [];
}


export function findBand(layout, type) {
    return bandList(layout).find(b => b.type === type) ?? null;
}


export function hasBand(layout, type) {
    return findBand(layout, type) != null;
}


/**
 * Switches a band on. Inserted in page order rather than appended - nothing in
 * the engine reads the array's order, but a hand-edited layout file is read by
 * people, and a file whose bands run top to bottom is the one they can follow.
 *
 * @returns {object|null} the band, or null if it was already there
 */
export function addBand(layout, type) {
    if (!BAND_TYPES.includes(type)) return null;
    if (hasBand(layout, type)) return null;

    const band = { type, items: [] };
    if (NEW_BAND_HEIGHTS[type] != null) band.height = NEW_BAND_HEIGHTS[type];

    /** replaces a `bands` that is not a list, rather than throwing on it */
    if (!Array.isArray(layout.bands)) layout.bands = [];

    const rank = (t) => BAND_TYPES.indexOf(t);
    const at = layout.bands.findIndex(b => rank(b.type) > rank(type));

    if (at === -1) layout.bands.push(band);
    else layout.bands.splice(at, 0, band);

    return band;
}


/**
 * Switches a band off, and everything on it with it.
 * @returns {boolean} whether there was one to remove
 */
export function removeBand(layout, type) {
    const at = bandList(layout).findIndex(b => b.type === type);
    if (at === -1) return false;

    layout.bands.splice(at, 1);
    return true;
}


/** every item id in the report, across every band */
function usedIds(layout) {
    return new Set(bandList(layout)
        .flatMap(b => (b.items || []).map(i => i.id)));
}


/**
 * A free id of the form "text-1".
 *
 * Counted rather than randomised: the layout file is saved to disk and read in
 * diffs, and an id that changes shape every time makes every save look like a
 * rewrite.
 */
export function nextItemId(layout, prefix) {
    const taken = usedIds(layout);

    for (let n = 1; ; n++) {
        const id = `${prefix}-${n}`;
        if (!taken.has(id)) return id;
    }
}


/** the first free grid line below everything already on the band */
function nextY(band) {
    const items = band.items || [];
    if (!items.length) return 0;

    const bottom = Math.max(...items.map(i => (i.y ?? 0) + designHeight(i)));
    return Math.ceil(bottom / GRID) * GRID;
}


/** the printable width, which is as wide as an item can usefully be */
function contentWidth(layout) {
    const { page } = layout;
    return page.width - page.margin.left - page.margin.right;
}


/**
 * A new text box, placed below whatever is already on the band.
 * @returns {object} the item; it has not been added to anything yet
 */
export function createText(layout, band) {
    return {
        id: nextItemId(layout, 'text'),
        type: 'text',
        x: 0,
        y: nextY(band),
        w: 200,
        h: 20,
        value: 'Text',
        style: {
            fontFamily: FONT_STACKS[0].value,
            fontSize: 12,
            fontWeight: 'normal',
            fontStyle: 'normal',
            color: '#000000',
            align: 'left',
            background: null,
            border: null,
            padding: 0
        }
    };
}


/** a column at its default width, numbered by where it sits */
export function makeColumn(n) {
    return {
        field: `field${n}`,
        label: `Column ${n}`,
        width: DEFAULT_COLUMN_WIDTH,
        align: 'left'
    };
}


/**
 * A new table, full printable width, with the columns asked for.
 *
 * Never fewer than one: validate.js will not accept an empty `columns`, and a
 * table with none is not a table but an error waiting for whoever opens the
 * file next. The row count is absent on purpose - rows come from the data at
 * print time (spec 3.3), so there is nothing here to ask for or to store.
 *
 * @param {object} layout
 * @param {object} band the band it is going onto, for its vertical place
 * @param {number} [columns] how many columns to start with
 */
export function createTable(layout, band, columns = DEFAULT_COLUMNS) {
    const count = Math.max(1, Math.floor(Number(columns) || DEFAULT_COLUMNS));

    return {
        id: nextItemId(layout, 'table'),
        type: 'table',
        x: 0,
        y: nextY(band),
        w: contentWidth(layout),
        dataset: layout.dataset ?? null,
        rowHeight: 24,
        headerHeight: 28,
        showHeader: true,
        columns: Array.from({ length: count }, (_, i) => makeColumn(i + 1)),
        style: { fontSize: 12, color: '#000000', borderColor: '#cccccc' }
    };
}


export function addItem(layout, bandType, item) {
    const band = findBand(layout, bandType);
    if (!band) return null;

    band.items ??= [];
    band.items.push(item);

    return item;
}


export function removeItem(layout, bandType, id) {
    const band = findBand(layout, bandType);
    if (!band) return false;

    const at = (band.items || []).findIndex(i => i.id === id);
    if (at === -1) return false;

    band.items.splice(at, 1);
    return true;
}


/**
 * Moves an item from one band to another, keeping it where it looks.
 *
 * An item's y is relative to its band (spec 3.3), so carrying the same number
 * across would jump it - 10px from the top of the detail band is a long way
 * from 10px from the top of the page footer. The position is lifted into page
 * coordinates, the item is moved, and the offset is worked out again against
 * where it has arrived.
 *
 * @param {object} layout
 * @param {string} from
 * @param {string} to
 * @param {string} id
 * @returns {boolean} whether it moved
 */
export function moveItemToBand(layout, from, to, id) {
    if (from === to) return false;

    const source = findBand(layout, from);
    const target = findBand(layout, to);
    if (!source || !target) return false;

    const item = (source.items || []).find(i => i.id === id);
    if (!item) return false;

    const page = absoluteTop(layout, from, item.y ?? 0);

    removeItem(layout, from, id);
    addItem(layout, to, item);

    const landed = absoluteTop(layout, to, 0);
    if (page !== null && landed !== null) item.y = Math.round(page - landed);

    return true;
}


/**
 * Adds a column, at the default width rather than by redistributing the others.
 *
 * Resizing every column because a new one arrived would silently undo widths
 * that were set on purpose. A table wider than its item is the author's to fix,
 * and `table-layout: fixed` draws it predictably meanwhile.
 */
export function addColumn(table) {
    table.columns ??= [];

    const column = makeColumn(table.columns.length + 1);
    table.columns.push(column);

    return column;
}


/**
 * @returns {boolean} false when the column is the last one, which must stay -
 *   validate.js requires a non-empty `columns`, and a table with none is not a
 *   table but a validation error waiting for whoever opens the file next
 */
export function removeColumn(table, index) {
    if (!Array.isArray(table.columns) || table.columns.length <= 1) return false;
    if (index < 0 || index >= table.columns.length) return false;

    table.columns.splice(index, 1);
    return true;
}


/**
 * Where a newly added item should go: the band the selection is on, or the
 * detail band, or whatever band exists at all.
 *
 * @param {object} layout
 * @param {{band: string}|null} selection
 * @returns {string|null}
 */
export function targetBand(layout, selection) {
    if (selection && hasBand(layout, selection.band)) return selection.band;
    if (hasBand(layout, 'detail')) return 'detail';

    return bandList(layout)[0]?.type ?? null;
}


export { snap };

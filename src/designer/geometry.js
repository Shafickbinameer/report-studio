/**
 * geometry.js is the arithmetic behind moving and resizing an item.
 *
 * All of it is pure - numbers in, numbers out - so the awkward cases (dragging
 * a west handle past the minimum width, a table that has no height of its own)
 * are specified without a browser. What is left in select.js is pointer
 * plumbing, which is the part that cannot be tested and so should be the part
 * that decides nothing.
 */


import { DESIGN_ROWS, designHeight as printedDesignHeight } from '../engine/measure.js';
import { levelsOf } from '../engine/tables.js';


/** spec 5.2: positions snap to a 10px grid */
export const GRID = 10;

/**
 * Sizes do not snap - spec 5.2 grids the drag and asks only for a minimum on
 * the resize. That distinction is worth keeping: positions want to line up with
 * each other, but a 34px title is 34px on purpose, and rounding it to 30 while
 * someone drags a different edge is a small theft.
 */
export const MIN_W = 20;
export const MIN_H = 12;

/**
 * Enough rows to show that a table is a table, few enough that it does not
 * swallow the detail zone. The real row count is a print-time fact.
 *
 * Owned by the engine rather than declared here, because it is not only what
 * the canvas draws: paginate.js measures a table's growth from the same figure
 * when it floats what sits below the table down the page. Two copies of it
 * would put the design and the print an invisible three rows apart.
 */
export const SAMPLE_ROWS = DESIGN_ROWS;

/** the eight, clockwise from the top-left */
const ALL_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const SIDE_HANDLES = ['e', 'w'];


export function snap(value) {
    return Math.round(value / GRID) * GRID;
}


/**
 * A table declares no `h` (spec 3.3) - its height is the header plus its rows,
 * and at print time the row count is the data's. This is the design-time
 * equivalent, and it is the same figure the canvas draws with, so the selection
 * outline lands exactly on the table rather than near it.
 *
 * Built on the engine's figure rather than written twice: that is the height
 * paginate.js treats as the table's designed size, and the canvas and the
 * printed page have to agree about it or nothing below a table lands where it
 * was put.
 *
 * A grouped table is drawn as one group - its column headings, its group
 * header, the sample rows, its group footer - because that is the unit it
 * prints in, so its box on the canvas is taller by its two group bands. The
 * engine's figure leaves them out, and a table grows from that figure at print
 * time, so what sits below the table still clears it there.
 *
 * @param {object} item
 * @returns {number} pixels
 */
export function designHeight(item) {
    const height = printedDesignHeight(item);
    if (item?.type !== 'table') return height;

    return height + levelsOf(item).reduce((sum, level) =>
        sum + stripHeight(level?.header) + stripHeight(level?.footer), 0);
}


/**
 * Where every group band of a grouped table sits inside its box, in the order a
 * group draws them: below the column headings each level's header, outermost
 * first; then the sample rows; then each level's footer, innermost first.
 *
 * @param {object} table
 * @returns {{kind: string, level: number, band: object, y: number, h: number}[]}
 *   offsets from the table's own top; only the bands the table has
 */
export function levelStrips(table) {
    const levels = levelsOf(table);

    const rowHeight = table?.rowHeight ?? 0;
    let y = table?.showHeader ? (table.headerHeight ?? rowHeight) : 0;

    const strips = [];
    const add = (kind, level, band) => {
        if (!band) return;
        const h = stripHeight(band);
        strips.push({ kind, level, band, y, h });
        y += h;
    };

    levels.forEach((level, n) => add('groupHeader', n, level?.header));
    y += DESIGN_ROWS * rowHeight;
    for (let n = levels.length - 1; n >= 0; n--) add('groupFooter', n, levels[n]?.footer);

    return strips;
}


/**
 * Where a grouped table's outermost group bands sit inside its box - what a
 * table grouped at one level has. levelStrips has every level's.
 *
 * @param {object} table
 * @returns {{groupHeader: {y: number, h: number}|null,
 *            groupFooter: {y: number, h: number}|null}}
 *   offsets from the table's own top; null for a band the table does not have
 */
export function groupStrips(table) {
    const outer = (kind) => {
        const strip = levelStrips(table).find(s => s.kind === kind && s.level === 0);
        return strip ? { y: strip.y, h: strip.h } : null;
    };

    return { groupHeader: outer('groupHeader'), groupFooter: outer('groupFooter') };
}


/** a group band's height, in pixels - only a number counts, as in validate.js */
export function stripHeight(band) {
    const height = Number(band?.height);
    return band && Number.isFinite(height) && height > 0 ? height : 0;
}


/** an item's box in band-relative coordinates */
export function itemBox(item) {
    return { x: item.x ?? 0, y: item.y ?? 0, w: item.w ?? 0, h: designHeight(item) };
}


/**
 * Which axes an item can be resized on.
 *
 * A table's height is derived, so offering a south handle would promise an edit
 * that cannot be stored - there is nowhere in the layout file to put it. Only
 * the two side handles are shown, which says so without a tooltip.
 */
export function resizableAxes(item) {
    return item.type === 'table' ? 'x' : 'xy';
}


export function handlesFor(axes) {
    return axes === 'x' ? [...SIDE_HANDLES] : [...ALL_HANDLES];
}


/**
 * Where an item lands after a drag. The absolute position is snapped, not the
 * delta, so items dragged from different starting offsets end up on the same
 * grid line - which is the point of having one.
 *
 * @param {object} start the box the drag began from
 * @param {number} dx pointer movement in page pixels
 * @param {number} dy
 * @returns {{x: number, y: number}}
 */
export function moveTo(start, dx, dy) {
    return { x: snap(start.x + dx), y: snap(start.y + dy) };
}


/**
 * Where an item lands after a handle drag.
 *
 * Dragging a north or west handle moves that edge and leaves the opposite one
 * where it is, so the box is re-derived from the far edge rather than by adding
 * the delta to the origin. Without that, an item shrunk to its minimum keeps
 * sliding as the pointer continues past it.
 *
 * @param {string} handle one of nw n ne e se s sw w
 * @param {object} start the box the drag began from
 * @param {number} dx
 * @param {number} dy
 * @param {string} [axes] 'x' pins the height, for a table
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function resizeBy(handle, start, dx, dy, axes = 'xy') {
    let { x, y, w, h } = start;

    if (handle.includes('w')) {
        w = Math.max(start.w - dx, MIN_W);
        x = start.x + start.w - w;
    } else if (handle.includes('e')) {
        w = Math.max(start.w + dx, MIN_W);
    }

    if (axes === 'xy') {
        if (handle.includes('n')) {
            h = Math.max(start.h - dy, MIN_H);
            y = start.y + start.h - h;
        } else if (handle.includes('s')) {
            h = Math.max(start.h + dy, MIN_H);
        }
    }

    return { x, y, w, h };
}


/**
 * Writes a box back onto a layout item.
 *
 * A table's height is not stored - it is derived from the row count - so it is
 * dropped here rather than written as a field the engine would ignore and the
 * next reader would believe.
 *
 * @param {object} item mutated in place; it is the layout the host will be given
 * @param {object} box
 */
export function applyBox(item, box) {
    item.x = box.x;
    item.y = box.y;

    if (box.w != null) item.w = box.w;
    if (box.h != null && item.type !== 'table') item.h = box.h;
}

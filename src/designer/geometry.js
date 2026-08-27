/**
 * geometry.js is the arithmetic behind moving and resizing an item.
 *
 * All of it is pure - numbers in, numbers out - so the awkward cases (dragging
 * a west handle past the minimum width, a table that has no height of its own)
 * are specified without a browser. What is left in select.js is pointer
 * plumbing, which is the part that cannot be tested and so should be the part
 * that decides nothing.
 */


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
 */
export const SAMPLE_ROWS = 3;

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
 * @param {object} item
 * @returns {number} pixels
 */
export function designHeight(item) {
    if (item.type !== 'table') return item.h ?? 0;

    const rowHeight = item.rowHeight ?? 0;
    const header = item.showHeader ? (item.headerHeight ?? rowHeight) : 0;

    return header + SAMPLE_ROWS * rowHeight;
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

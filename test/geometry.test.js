/**
 * The arithmetic behind moving and resizing. No DOM: select.js does the pointer
 * plumbing and decides nothing, so every case worth specifying is here.
 */

import { describe, it, expect } from 'vitest';
import {
    GRID, MIN_W, MIN_H, snap, designHeight, itemBox,
    resizableAxes, handlesFor, moveTo, resizeBy, applyBox
} from '../src/designer/geometry.js';
import { text, table } from './helpers/layout.js';

const box = (x, y, w, h) => ({ x, y, w, h });


describe('snap', () => {
    it('rounds to the grid', () => {
        expect(snap(0)).toBe(0);
        expect(snap(4)).toBe(0);
        expect(snap(5)).toBe(GRID);
        expect(snap(14)).toBe(GRID);
        expect(snap(-4)).toBe(-0);
    });
});


describe('designHeight', () => {
    it('is what a text item declares', () => {
        expect(designHeight(text('t', { h: 34 }))).toBe(34);
    });

    it('is header plus sample rows for a table, which declares no height', () => {
        const t = table({ rowHeight: 28, headerHeight: 32 });

        expect(t.h).toBeUndefined();
        expect(designHeight(t)).toBe(32 + 3 * 28);
    });

    it('drops the header row when the table hides it', () => {
        expect(designHeight(table({ rowHeight: 28, showHeader: false })))
            .toBe(3 * 28);
    });

    it('falls back to the row height when no header height is given', () => {
        const t = table({ rowHeight: 20 });
        delete t.headerHeight;

        expect(designHeight(t)).toBe(20 + 3 * 20);
    });
});


describe('resizableAxes', () => {
    it('lets a text item resize both ways', () => {
        expect(resizableAxes(text('t'))).toBe('xy');
        expect(handlesFor('xy')).toHaveLength(8);
    });

    it('pins a table vertically, because its height is derived', () => {
        /**
         * There is nowhere in the layout file to store a table height, so a
         * south handle would promise an edit that cannot be kept.
         */
        expect(resizableAxes(table())).toBe('x');
        expect(handlesFor('x')).toEqual(['e', 'w']);
    });
});


describe('moveTo', () => {
    it('snaps the destination, not the delta', () => {
        /**
         * Two items dragged by the same amount from different offsets must land
         * on the same grid line - that is the whole point of having one.
         */
        expect(moveTo(box(3, 3, 100, 20), 20, 20)).toEqual({ x: 20, y: 20 });
        expect(moveTo(box(7, 7, 100, 20), 20, 20)).toEqual({ x: 30, y: 30 });
    });

    it('leaves the size alone', () => {
        const start = box(0, 0, 100, 20);
        expect(moveTo(start, 33, 47)).toEqual({ x: 30, y: 50 });
    });

    it('moves above and left of the origin, which a band allows', () => {
        expect(moveTo(box(0, 0, 100, 20), -26, -24)).toEqual({ x: -30, y: -20 });
    });
});


describe('resizeBy - the east and south handles', () => {
    it('grows the box without moving its origin', () => {
        expect(resizeBy('se', box(10, 10, 100, 20), 50, 30))
            .toEqual(box(10, 10, 150, 50));
    });

    it('does not snap the size', () => {
        /** spec 5.2 grids the drag and asks only for a minimum on the resize */
        expect(resizeBy('e', box(0, 0, 100, 20), 7, 0).w).toBe(107);
    });

    it('stops at the minimum width', () => {
        expect(resizeBy('e', box(0, 0, 100, 20), -500, 0).w).toBe(MIN_W);
    });

    it('stops at the minimum height', () => {
        expect(resizeBy('s', box(0, 0, 100, 20), 0, -500).h).toBe(MIN_H);
    });
});


describe('resizeBy - the north and west handles', () => {
    it('moves the near edge and leaves the far one where it was', () => {
        const after = resizeBy('nw', box(100, 100, 200, 40), 50, 10);

        expect(after).toEqual(box(150, 110, 150, 30));
        expect(after.x + after.w).toBe(300);
        expect(after.y + after.h).toBe(140);
    });

    it('keeps the far edge pinned once the minimum is reached', () => {
        /**
         * The box is re-derived from the far edge rather than by adding the
         * delta to the origin - otherwise an item shrunk to its minimum keeps
         * sliding right as the pointer carries on past it.
         */
        const start = box(100, 100, 200, 40);
        const after = resizeBy('w', start, 500, 0);

        expect(after.w).toBe(MIN_W);
        expect(after.x + after.w).toBe(300);
    });

    it('grows leftward when dragged the other way', () => {
        expect(resizeBy('w', box(100, 0, 200, 40), -50, 0))
            .toEqual(box(50, 0, 250, 40));
    });
});


describe('resizeBy - a table', () => {
    const axes = 'x';

    it('resizes horizontally', () => {
        expect(resizeBy('e', box(0, 0, 700, 116), 40, 0, axes).w).toBe(740);
    });

    it('ignores vertical movement even on a corner handle', () => {
        const after = resizeBy('se', box(0, 0, 700, 116), 40, 200, axes);

        expect(after.w).toBe(740);
        expect(after.h).toBe(116);
    });
});


describe('applyBox', () => {
    it('writes position and size onto a text item', () => {
        const item = text('t', { x: 0, y: 0, w: 100, h: 20 });
        applyBox(item, box(30, 40, 250, 60));

        expect(item).toMatchObject({ x: 30, y: 40, w: 250, h: 60 });
    });

    it('never writes a height onto a table', () => {
        /**
         * A table's height is the row count's, so storing one would be a field
         * the engine ignores and the next reader believes.
         */
        const item = table();
        applyBox(item, box(10, 10, 600, 999));

        expect(item.w).toBe(600);
        expect(item.h).toBeUndefined();
    });

    it('round-trips through itemBox', () => {
        const item = text('t', { x: 12, y: 34, w: 56, h: 78 });
        applyBox(item, itemBox(item));

        expect(item).toMatchObject({ x: 12, y: 34, w: 56, h: 78 });
    });
});

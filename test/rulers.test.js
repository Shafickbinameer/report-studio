/**
 * The rulers and the guides dragged off them, as arithmetic.
 *
 * rulers.js is pure, so the awkward cases - a guide on a layout that has never
 * had one, two guides on the same line, a horizontal guide read from a band
 * that does not reach it - are specified here without a document. The pointer
 * plumbing that calls it is specified in select.test.js.
 */

import { describe, it, expect } from 'vitest';
import {
    MINOR, MAJOR, ticksFor, guidesOf, addGuide, removeGuide,
    moveGuide, guideNear, guidesInBand
} from '../src/designer/rulers.js';


describe('the marks on a ruler', () => {
    it('steps by the fine spacing and numbers the coarse one', () => {
        const ticks = ticksFor(100);

        expect(ticks).toHaveLength(11);
        expect(ticks[0]).toEqual({ at: 0, major: true });
        expect(ticks[1]).toEqual({ at: MINOR, major: false });
        expect(ticks[5]).toEqual({ at: MAJOR, major: true });
    });

    it('reaches the far edge even when it is not a whole tick away', () => {
        /** a ruler that stopped short of the edge would say the page does */
        expect(ticksFor(714).at(-1)).toEqual({ at: 714, major: true });
    });

    it('has no marks for a ruler of no length', () => {
        expect(ticksFor(0)).toEqual([]);
        expect(ticksFor(-10)).toEqual([]);
    });
});


describe('the guides a layout carries', () => {
    it('reads two empty axes off a layout that has never had one', () => {
        expect(guidesOf({})).toEqual({ x: [], y: [] });
        expect(guidesOf(null)).toEqual({ x: [], y: [] });
    });

    it('ignores anything in the file that is not a number', () => {
        const layout = { guides: { x: [10, 'twenty', null, 30], y: 'nope' } };

        expect(guidesOf(layout)).toEqual({ x: [10, 30], y: [] });
    });

    it('reads them back in order, however they were written', () => {
        expect(guidesOf({ guides: { x: [300, 20, 150] } }).x)
            .toEqual([20, 150, 300]);
    });
});


describe('placing one', () => {
    it('rounds to the pixel', () => {
        const layout = {};

        expect(addGuide(layout, 'x', 240.4)).toBe(240);
        expect(guidesOf(layout).x).toEqual([240]);
    });

    it('creates the store on a layout that had none', () => {
        const layout = { name: 'no guides yet' };
        addGuide(layout, 'y', 100);

        expect(layout.guides).toEqual({ x: [], y: [100] });
    });

    it('does not stack two on one line', () => {
        /** they are indistinguishable on screen, and the second can only be
         *  deleted by accident */
        const layout = {};
        addGuide(layout, 'x', 240);
        addGuide(layout, 'x', 240.2);

        expect(guidesOf(layout).x).toEqual([240]);
    });

    it('refuses what is not a number', () => {
        const layout = {};

        expect(addGuide(layout, 'x', 'left')).toBeNull();
        expect(guidesOf(layout).x).toEqual([]);
    });

    it('keeps the axis sorted', () => {
        const layout = {};
        for (const at of [300, 20, 150]) addGuide(layout, 'x', at);

        expect(guidesOf(layout).x).toEqual([20, 150, 300]);
    });
});


describe('taking one off', () => {
    it('removes the one that is there', () => {
        const layout = { guides: { x: [10, 20], y: [] } };

        expect(removeGuide(layout, 'x', 20)).toBe(true);
        expect(guidesOf(layout).x).toEqual([10]);
    });

    it('says so when there was nothing there', () => {
        expect(removeGuide({ guides: { x: [10] } }, 'x', 999)).toBe(false);
    });

    it('survives a layout with no guides at all', () => {
        expect(removeGuide({}, 'x', 10)).toBe(false);
    });
});


describe('moving one', () => {
    it('leaves it at the new place and not the old', () => {
        const layout = { guides: { x: [100], y: [] } };
        moveGuide(layout, 'x', 100, 160);

        expect(guidesOf(layout).x).toEqual([160]);
    });

    it('merges rather than hides when dropped onto another', () => {
        const layout = { guides: { x: [100, 160], y: [] } };
        moveGuide(layout, 'x', 100, 160);

        expect(guidesOf(layout).x).toEqual([160]);
    });
});


describe('picking one up', () => {
    const layout = { guides: { x: [100, 400], y: [50] } };

    it('finds the one under the pointer', () => {
        expect(guideNear(layout, 'x', 102)).toBe(100);
    });

    it('finds nothing when the pointer is not near one', () => {
        /** a guide is one pixel wide; without the grab radius none is reachable */
        expect(guideNear(layout, 'x', 250)).toBeNull();
    });

    it('takes the nearer of two in reach', () => {
        expect(guideNear({ guides: { x: [100, 104] } }, 'x', 103, 6)).toBe(104);
    });

    it('looks only on the axis it was asked about', () => {
        expect(guideNear(layout, 'y', 100)).toBeNull();
    });
});


describe('reading them inside a band', () => {
    /** a band 200px tall starting 300px down the printable area */
    const band = { originY: 300, h: 200, w: 714 };

    it('leaves a vertical guide alone - a band shares the x origin', () => {
        expect(guidesInBand({ guides: { x: [240] } }, band).x).toEqual([240]);
    });

    it('measures a horizontal one from the band, not from the page', () => {
        expect(guidesInBand({ guides: { y: [340] } }, band).y).toEqual([40]);
    });

    it('drops the ones that do not cross this band', () => {
        /**
         * The same guide is a different `y` in every band, and in most of them
         * it is not on the band at all. One offered as a snap target from
         * outside the band would pull an item to a line nobody can see.
         */
        const layout = { guides: { y: [100, 340, 700] } };

        expect(guidesInBand(layout, band).y).toEqual([40]);
    });

    it('keeps the vertical ones when there is no band to speak of', () => {
        expect(guidesInBand({ guides: { x: [10], y: [20] } }, null))
            .toEqual({ x: [10], y: [] });
    });
});

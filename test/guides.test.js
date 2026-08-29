/**
 * The alignment guides, as arithmetic.
 *
 * guides.js is pure by design, so what a guide does in the awkward cases - a
 * tie between two things to snap to, a group treated as one shape, an item
 * dragged off the top of its band - is specified here without a browser and
 * without a pointer. What is left in select.js is the pointer plumbing, which
 * is the part that decides nothing.
 */

import { describe, it, expect } from 'vitest';
import {
    SNAP, railsX, railsY, unionBox, targetsOn, pullTowards,
    alignBox, gapOn, gapsAround, guidesFor
} from '../src/designer/guides.js';

const box = (x, y, w = 100, h = 20) => ({ x, y, w, h });

/** a band the size of A4's printable area, near enough */
const BAND = { w: 714, h: 400 };


describe('the lines a box can be aligned on', () => {
    it('offers both sides and the middle, left to right', () => {
        expect(railsX(box(100, 0, 60))).toEqual([
            { at: 100, centre: false },
            { at: 130, centre: true },
            { at: 160, centre: false }
        ]);
    });

    it('offers top, middle and bottom going down', () => {
        expect(railsY(box(0, 40, 100, 20))).toEqual([
            { at: 40, centre: false },
            { at: 50, centre: true },
            { at: 60, centre: false }
        ]);
    });

    it('treats a group as the one shape it looks like', () => {
        expect(unionBox([box(10, 10, 40, 20), box(80, 50, 20, 30)]))
            .toEqual({ x: 10, y: 10, w: 90, h: 70 });
    });

    it('has no shape for an empty group', () => {
        expect(unionBox([])).toBeNull();
        expect(unionBox(null)).toBeNull();
    });
});


describe('what a box can line up with', () => {
    it('offers the band as well as its neighbours', () => {
        const targets = targetsOn([box(0, 0, 100)], BAND, 'x');

        expect(targets.map(t => t.at)).toContain(357);      /** the band's middle */
        expect(targets.map(t => t.at)).toContain(714);      /** and its right edge */
    });

    it('marks a band target with no box, so its guide can span the band', () => {
        const targets = targetsOn([], BAND, 'y');

        expect(targets.every(t => t.box === null)).toBe(true);
    });
});


describe('the pull towards a line', () => {
    it('ignores anything further away than the snap', () => {
        const rails = railsX(box(0, 0, 100));
        const targets = [{ at: SNAP + 1, centre: false, box: null }];

        expect(pullTowards(rails, targets)).toBeNull();
    });

    it('takes the nearest of several', () => {
        const rails = railsX(box(0, 0, 100));
        const targets = [
            { at: 4, centre: false, box: null },
            { at: 2, centre: false, box: null }
        ];

        expect(pullTowards(rails, targets).delta).toBe(2);
    });

    it('lets a neighbour win a tie with the band, by being asked first', () => {
        /**
         * targetsOn puts the band last for this reason. A drag near the middle
         * of the band that is also level with the item beside it should say so
         * about the item - that is the alignment being made.
         */
        const rails = railsX(box(0, 0, 100));
        const near = box(3, 0, 100);
        const targets = [
            ...railsX(near).map(r => ({ ...r, box: near })),
            { at: 3, centre: false, box: null }
        ];

        expect(pullTowards(rails, targets).delta).toBe(3);
        expect(targets.indexOf(
            targets.find(t => t.box !== null && t.at === 3))).toBe(0);
    });
});


describe('aligning a box', () => {
    it('pulls its left edge onto a neighbour that is nearly level', () => {
        const neighbour = box(100, 200);
        const { dx, lines } = alignBox(box(103, 0), [neighbour], BAND);

        expect(dx).toBe(-3);
        expect(lines).toContainEqual(expect.objectContaining({ axis: 'x', at: 100 }));
    });

    it('centres it in the band and says the guide is a centre one', () => {
        const middle = BAND.w / 2;
        const moving = box(middle - 50 + 2, 0, 100);

        const { dx, lines } = alignBox(moving, [], BAND);
        const guide = lines.find(l => l.axis === 'x');

        expect(dx).toBe(-2);
        expect(guide.at).toBe(middle);
        expect(guide.centre).toBe(true);
    });

    it('decides the two axes separately', () => {
        /**
         * Lined up with the item beside it across, and with the middle of the
         * band down - which is the ordinary case, and one winner per drag would
         * have thrown one of them away.
         */
        const neighbour = box(100, 300);
        const moving = box(102, BAND.h / 2 - 10 + 3, 100, 20);

        const { dx, dy } = alignBox(moving, [neighbour], BAND);

        expect(dx).toBe(-2);
        expect(dy).toBe(-3);
    });

    it('draws an edge guide only as far as the things that agree', () => {
        const neighbour = box(100, 200, 100, 20);
        const { lines } = alignBox(box(102, 40), [neighbour], BAND);

        const guide = lines.find(l => l.axis === 'x');

        /** from the top of the moving box to the bottom of the neighbour */
        expect(guide.from).toBe(40);
        expect(guide.to).toBe(220);
    });

    it('draws a band guide right across the band', () => {
        const { lines } = alignBox(box(BAND.w / 2 - 50, 40, 100), [], BAND);
        const guide = lines.find(l => l.axis === 'x');

        expect(guide.from).toBe(0);
        expect(guide.to).toBe(BAND.h);
    });

    it('leaves a box alone when nothing is near it', () => {
        const found = alignBox(box(211, 133), [box(400, 300)], BAND);

        expect(found).toEqual({ dx: 0, dy: 0, lines: [] });
    });

    it('has nothing to say about no box at all', () => {
        expect(alignBox(null, [], BAND)).toEqual({ dx: 0, dy: 0, lines: [] });
    });
});


describe('the space around a box', () => {
    it('measures up to the nearest thing across from it', () => {
        const above = box(0, 40, 100, 20);
        const gap = gapOn(box(0, 100), [above], BAND, 'up');

        expect(gap.distance).toBe(40);
        expect(gap.from).toBe(60);
        expect(gap.to).toBe(100);
        expect(gap.toBand).toBe(false);
    });

    it('measures to the band edge when nothing is across from it', () => {
        /** high up, but off in the right margin - not what the gap above is to */
        const aside = box(400, 10, 100, 20);
        const gap = gapOn(box(0, 100), [aside], BAND, 'up');

        expect(gap.distance).toBe(100);
        expect(gap.toBand).toBe(true);
    });

    it('measures down to the band edge, not up from it', () => {
        const gap = gapOn(box(0, 100, 100, 20), [], BAND, 'down');

        expect(gap.distance).toBe(BAND.h - 120);
        expect(gap.toBand).toBe(true);
    });

    it('puts the measurement down the middle of what the two share', () => {
        const above = box(60, 40, 100, 20);      /** shares 60..100 with the box */
        const gap = gapOn(box(0, 100), [above], BAND, 'up');

        expect(gap.at).toBe(80);
    });

    it('reports nothing for a side the box has already passed', () => {
        expect(gapOn(box(0, -20), [], BAND, 'up')).toBeNull();
    });

    it('measures all four sides at once', () => {
        const gaps = gapsAround(box(100, 100), [], BAND);

        expect(gaps.map(g => g.side).sort())
            .toEqual(['down', 'left', 'right', 'up']);
    });
});


describe('one frame of a drag', () => {
    it('reports the correction and the space it leaves', () => {
        const neighbour = box(100, 200);
        const found = guidesFor([box(103, 40)], [neighbour], BAND);

        expect(found.dx).toBe(-3);
        expect(found.lines.length).toBeGreaterThan(0);
        expect(found.gaps.length).toBeGreaterThan(0);
    });

    it('measures the gaps from where the box ends up, not where it was dropped', () => {
        /**
         * The order matters: a gap read off the un-snapped box is off by the
         * snap, which is exactly the number someone is reading it to check.
         */
        const above = box(0, 80, 100, 20);       /** its bottom edge is at 100 */
        const found = guidesFor([box(0, 103)], [above], BAND);

        const up = found.gaps.find(g => g.side === 'up');

        expect(found.dy).toBe(-3);
        /** 3 before the snap, 0 after it - and 0 is the answer being read */
        expect(up.distance).toBe(0);
    });

    it('aligns a group as one shape', () => {
        const neighbour = box(100, 300);
        const found = guidesFor(
            [box(103, 0, 40, 20), box(160, 40, 30, 20)], [neighbour], BAND);

        /** the union's left edge is 3 off the neighbour's; neither member is */
        expect(found.dx).toBe(-3);
    });

    it('has nothing to say about an empty drag', () => {
        expect(guidesFor([], [], BAND))
            .toEqual({ dx: 0, dy: 0, lines: [], gaps: [] });
    });
});

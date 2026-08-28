/**
 * The box item, through the engine and out to the markup.
 *
 * A box is a rule bent round four sides, so most of what matters is the same as
 * a line's - except for one thing that is not: `w` and `h` are the *outside* of
 * a box however thick its border, because that is what the designer draws round
 * it and what the engine paginated against. A border that added to them would
 * put the design and the print a few pixels apart at every thickness.
 *
 * The designer's side of it is in editing.test.js and fields.test.js.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateLayout } from '../src/engine/validate.js';
import { measure } from '../src/engine/measure.js';
import { resolve } from '../src/engine/resolve.js';
import { render } from '../src/render/render.js';
import { items } from '../src/render/items.js';
import { layout, box, text, band, rows, run } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());


const withBox = (item) => layout({
    bands: [band('detail', [item]), band('pageFooter', [], { height: 40 })]
});


describe('a box is a layout the engine accepts', () => {
    it('validates', () => {
        expect(validateLayout(withBox(box('b1')))).toEqual([]);
    });

    /** a bare box is a hairline rectangle, which is what a box usually is */
    it('validates with nothing but a type and an id', () => {
        expect(validateLayout(withBox({ id: 'b1', type: 'box' }))).toEqual([]);
    });

    it('takes every style a border can be drawn in, off included', () => {
        for (const borderStyle of ['solid', 'dashed', 'dotted', 'double', 'none']) {
            expect(validateLayout(withBox(box('b1', { borderStyle }))), borderStyle)
                .toEqual([]);
        }
    });

    it('refuses a border style that is not one', () => {
        const issues = validateLayout(withBox(box('b1', { borderStyle: 'squiggly' })));

        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatch(/borderStyle "squiggly"/);
    });

    it('refuses a border width of nothing', () => {
        for (const borderWidth of [0, -1, 'thick']) {
            const issues = validateLayout(withBox(box('b1', { borderWidth })));

            expect(issues, String(borderWidth)).toHaveLength(1);
            expect(issues[0]).toMatch(/borderWidth must be a number/);
        }
    });

    /** a corner of nothing is a square corner, which is a real answer */
    it('takes a corner radius of zero, but not of less', () => {
        expect(validateLayout(withBox(box('b1', { radius: 0 })))).toEqual([]);

        const issues = validateLayout(withBox(box('b1', { radius: -4 })));

        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatch(/radius must be a number/);
    });

    it('names box among the types it will take', () => {
        const issues = validateLayout(withBox({ id: 'x', type: 'blob' }));

        expect(issues[0]).toMatch(/text, table, line, box/);
    });
});


describe('measuring a box', () => {
    const measured = (item) => {
        const json = measure(resolve(withBox(item), { items: [] }));
        return json.bands.find(b => b.type === 'detail').items[0].measuredHeight;
    };

    it('is the height it declares', () => {
        expect(measured(box('b1', { h: 60 }))).toBe(60);
    });

    /** border-box: the border is inside h, so a thick one costs no extra space */
    it('does not grow for a thicker border', () => {
        expect(measured(box('b1', { h: 60, borderWidth: 8 }))).toBe(60);
    });

    it('counts towards the band it is on', () => {
        const json = measure(resolve(layout({
            bands: [band('detail', [
                text('t', { y: 0, h: 20 }),
                box('b1', { y: 40, h: 60 })
            ])]
        }), { items: [] }));

        expect(json.bands[0].measuredHeight).toBe(100);
    });
});


describe('drawing a box', () => {
    const drawn = (item) => render(run(withBox(item), { items: rows(1) }));

    it('draws the outline it was given', () => {
        const html = drawn(box('b1', {
            w: 300, h: 60, borderStyle: 'dashed', borderWidth: 2, borderColor: '#ff9c4b'
        }));

        expect(html).toContain('data-item-type="box"');
        expect(html).toContain('width:300px');
        expect(html).toContain('height:60px');
        expect(html).toContain('border:2px dashed #ff9c4b');
    });

    it('draws every style a border can be', () => {
        for (const borderStyle of ['solid', 'dashed', 'dotted', 'double', 'none']) {
            expect(drawn(box('b1', { borderStyle, borderWidth: 3 })))
                .toContain(`border:3px ${borderStyle}`);
        }
    });

    it('leaves an unfilled box unfilled, so it frames what is behind it', () => {
        expect(drawn(box('b1'))).not.toContain('background:');
    });

    it('fills one that asks to be filled', () => {
        expect(drawn(box('b1', { background: '#f1f3f5' })))
            .toContain('background:#f1f3f5');
    });

    it('rounds the corners only when asked', () => {
        expect(drawn(box('b1', { radius: 0 }))).not.toContain('border-radius');
        expect(drawn(box('b1', { radius: 10 }))).toContain('border-radius:10px');
    });

    /** a hand-written layout may say nothing about the pen at all */
    it('falls back to a black hairline outline', () => {
        expect(drawn({ id: 'b1', type: 'box', x: 0, y: 0, w: 200, h: 40 }))
            .toContain('border:1px solid #000000');
    });

    /**
     * The designer canvas draws straight from the layout without asking the
     * validator, so a style it does not know has to fall back to something
     * drawable rather than land in a style attribute.
     */
    it('ignores a border style it does not recognise', () => {
        const html = items([box('b1', { borderStyle: 'squiggly' })]);

        expect(html).not.toContain('squiggly');
        expect(html).toContain('border:1px solid');
    });

    it('escapes an id out of a hand-written file', () => {
        expect(drawn(box('a"><script>alert(1)</script>'))).not.toContain('<script>');
    });

    /**
     * paginate orders a band by y, and a backdrop is placed at the top of what
     * it sits behind - so a box drawn round something is drawn before it.
     */
    it('is drawn before the items it sits behind', () => {
        const html = render(run(layout({
            bands: [band('detail', [
                text('t', { y: 20, h: 20 }),
                box('frame', { y: 10, h: 80 })
            ])]
        }), { items: rows(1) }));

        expect(html.indexOf('id="frame"')).toBeLessThan(html.indexOf('id="t"'));
    });
});

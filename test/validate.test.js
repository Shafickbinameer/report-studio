/**
 * validate.js, on the rules that are not obvious from reading a layout file.
 *
 * Most of what the validator does is exercised wherever the thing it guards is
 * specified - a line's own rules are in line.test.js, and a designer that
 * produces an invalid layout is caught by the suites that build one. What lands
 * here is the checking that has no other home.
 */

import { describe, it, expect } from 'vitest';
import { validateLayout } from '../src/engine/validate.js';
import { layout, table, band } from './helpers/layout.js';


const withTable = (style) => layout({
    bands: [band('detail', [{ ...table(), style }])]
});


describe('a table grid', () => {
    it('takes every style a border can be drawn in', () => {
        for (const borderStyle of ['solid', 'dashed', 'dotted', 'double', 'none']) {
            expect(validateLayout(withTable({ borderStyle })), borderStyle).toEqual([]);
        }
    });

    it('refuses one that is not', () => {
        const issues = validateLayout(withTable({ borderStyle: 'squiggly' }));

        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatch(/borderStyle "squiggly"/);
        expect(issues[0]).toMatch(/solid, dashed, dotted, double, none/);
    });

    /** a table that says nothing about its grid takes the stylesheet's */
    it('does not have to say anything at all', () => {
        expect(validateLayout(withTable({ fontSize: 12 }))).toEqual([]);
        expect(validateLayout(withTable(undefined))).toEqual([]);
    });

    it('names the item at fault, as every other finding does', () => {
        const issues = validateLayout(withTable({ borderStyle: 'nope' }));

        expect(issues[0]).toMatch(/bands\[0\]\.items\[0\]/);
    });

    /**
     * A line may not be turned off - a line that draws nothing is not a line -
     * so the two lists are deliberately different, and this is what says so.
     */
    it('may be turned off, where a line may not', () => {
        expect(validateLayout(withTable({ borderStyle: 'none' }))).toEqual([]);

        const asLine = layout({
            bands: [band('detail', [
                { id: 'l1', type: 'line', x: 0, y: 0, w: 100, h: 12, style: { lineStyle: 'none' } }
            ])]
        });

        expect(validateLayout(asLine)).toHaveLength(1);
    });
});


describe('a table rule width', () => {
    it('takes a positive number of pixels', () => {
        expect(validateLayout(withTable({ borderWidth: 3 }))).toEqual([]);
    });

    it('refuses nothing, or less than nothing', () => {
        for (const borderWidth of [0, -1, '3px']) {
            const issues = validateLayout(withTable({ borderWidth }));

            expect(issues, String(borderWidth)).toHaveLength(1);
            expect(issues[0]).toMatch(/borderWidth must be a positive number/);
        }
    });

    /**
     * A width past what the row can hold is not refused here - the renderer
     * clamps it, so an old layout still draws rather than failing to open.
     */
    it('does not refuse one wider than the row, which the renderer clamps', () => {
        expect(validateLayout(withTable({ borderWidth: 40 }))).toEqual([]);
    });
});

describe('several tables in a report', () => {
    /** table() is 32 + 3 x 28 = 116px tall as designed */
    const stacked = (...ys) => layout({
        bands: [band('detail', ys.map((y, i) => table({ id: `t${i + 1}`, y })))]
    });

    it('takes one', () => {
        expect(validateLayout(layout({ bands: [band('detail', [table()])] })))
            .toEqual([]);
    });

    it('takes none', () => {
        expect(validateLayout(layout({ bands: [band('detail', [])] }))).toEqual([]);
    });

    it('takes several, one under another', () => {
        expect(validateLayout(stacked(0, 140, 280))).toEqual([]);
    });

    it('takes tables in different bands', () => {
        expect(validateLayout(layout({
            bands: [
                band('reportHeader', [table({ id: 'a' })], { height: 200 }),
                band('detail', [table({ id: 'b' })])
            ]
        }))).toEqual([]);
    });

    it('takes one that starts exactly where the one above ends', () => {
        expect(validateLayout(stacked(0, 116))).toEqual([]);
    });

    /**
     * Each table splits across pages on its own, so two side by side would
     * print one after the other rather than together.
     */
    it('refuses two that share any height of a band', () => {
        const issues = validateLayout(stacked(0, 60));

        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatch(/"t1" and "t2" overlap in the detail band/);
    });

    it('says where the lower one has to go', () => {
        expect(validateLayout(stacked(0, 60))[0]).toMatch(/y 116 or lower/);
    });

    it('refuses side by side, whatever x each is at', () => {
        const issues = validateLayout(layout({
            bands: [band('detail', [
                { ...table({ id: 'left' }), w: 300 },
                { ...table({ id: 'right' }), x: 400, w: 300 }
            ])]
        }));

        expect(issues[0]).toMatch(/"left" and "right" overlap/);
    });

    it('checks every neighbour, not only the first pair', () => {
        const issues = validateLayout(stacked(0, 140, 200));

        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatch(/"t2" and "t3"/);
    });

    /** groupHeader and groupFooter are shared, so they cannot head two tables */
    it('refuses two grouped tables', () => {
        const issues = validateLayout(layout({
            bands: [
                band('detail', [
                    { ...table({ id: 'a' }), groupBy: 'name' },
                    { ...table({ id: 'b', y: 140 }), groupBy: 'qty' }
                ]),
                band('groupHeader', [], { height: 20 })
            ]
        }));

        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatch(/2 tables are grouped \("a", "b"\)/);
    });

    it('asks for a group band to show a table grouped by its own field', () => {
        const issues = validateLayout(layout({
            bands: [band('detail', [{ ...table(), groupBy: 'name' }])]
        }));

        expect(issues).toEqual([expect.stringMatching(/no groupHeader or groupFooter/)]);
    });

    it('refuses a dataset or a groupBy that is not a name', () => {
        const issues = validateLayout(layout({
            bands: [band('detail', [{ ...table(), dataset: 4, groupBy: ['x'] }])]
        }));

        expect(issues).toEqual(expect.arrayContaining([
            expect.stringMatching(/groupBy must be a field name/),
            expect.stringMatching(/dataset must be a dataset name/)
        ]));
    });
});

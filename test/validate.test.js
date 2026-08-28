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
import { layout, table, band, rows, run } from './helpers/layout.js';


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

describe('one table per report', () => {
    const twoTables = () => layout({
        bands: [
            band('reportHeader', [table({ id: 'a' })], { height: 200 }),
            band('detail', [table({ id: 'b' })])
        ]
    });

    it('takes one', () => {
        expect(validateLayout(layout({ bands: [band('detail', [table()])] })))
            .toEqual([]);
    });

    it('takes none', () => {
        expect(validateLayout(layout({ bands: [band('detail', [])] }))).toEqual([]);
    });

    /**
     * group.js binds the dataset to the first table it finds and stops, so a
     * second one printed its header and no rows - and nothing said so. Refused
     * rather than warned about: the alternative is a report that quietly leaves
     * data out.
     */
    it('refuses a second, wherever the two bands are', () => {
        const issues = validateLayout(twoTables());

        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatch(/2 tables/);
        expect(issues[0]).toMatch(/"a", "b"/);
    });

    it('refuses two on one band as readily as two on separate ones', () => {
        const issues = validateLayout(layout({
            bands: [band('detail', [table({ id: 'a' }), table({ id: 'b' })])]
        }));

        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatch(/2 tables/);
    });

    it('says what would go wrong, not just that it is wrong', () => {
        expect(validateLayout(twoTables())[0])
            .toMatch(/header and no rows/);
    });

    it('counts them all, so the message is not off by one', () => {
        const issues = validateLayout(layout({
            bands: [band('detail', [
                table({ id: 'a' }), table({ id: 'b' }), table({ id: 'c' })
            ])]
        }));

        expect(issues[0]).toMatch(/3 tables/);
    });

    /** the engine refuses to build it rather than building it wrongly */
    it('stops the engine, rather than printing an empty table', () => {
        expect(() => run(twoTables(), { items: rows(2) })).toThrow(/2 tables/);
    });
});

/**
 * Adding and removing bands, items and columns. Pure functions over the layout
 * object, so the rules that matter are specified here rather than through a
 * browser.
 */

import { describe, it, expect } from 'vitest';
import {
    BAND_TYPES, findBand, hasBand, addBand, removeBand,
    nextItemId, createText, createTable, addItem, removeItem,
    addColumn, removeColumn, targetBand
} from '../src/designer/structure.js';
import { validateLayout } from '../src/engine/validate.js';
import { blankLayout } from '../src/designer/blank.js';
import { layout, text, table, band } from './helpers/layout.js';

const types = (l) => l.bands.map(b => b.type);


describe('addBand', () => {
    it('adds a band that was not there', () => {
        const l = layout({ bands: [band('detail', [table()])] });
        addBand(l, 'pageFooter');

        expect(hasBand(l, 'pageFooter')).toBe(true);
    });

    it('refuses a second band of the same type', () => {
        /** validate.js places one band of each type and rejects a repeat */
        const l = layout({ bands: [band('detail', [])] });

        expect(addBand(l, 'detail')).toBeNull();
        expect(types(l)).toEqual(['detail']);
    });

    it('refuses a type the engine does not know', () => {
        const l = layout({ bands: [] });

        expect(addBand(l, 'sidebar')).toBeNull();
        expect(l.bands).toHaveLength(0);
    });

    it('inserts in page order rather than appending', () => {
        /**
         * Nothing in the engine reads the array's order, but the file is read
         * in diffs by people, and one that runs top to bottom is followable.
         */
        const l = layout({ bands: [band('detail', [])] });

        addBand(l, 'pageFooter');
        addBand(l, 'pageHeader');
        addBand(l, 'reportHeader');

        expect(types(l)).toEqual(['pageHeader', 'reportHeader', 'detail', 'pageFooter']);
    });

    it('gives a new band a pixel height rather than a tenth of the page', () => {
        const l = layout({ bands: [] });
        const made = addBand(l, 'pageHeader');

        expect(typeof made.height).toBe('number');
    });

    it('gives the detail band no height, because it takes what is left', () => {
        const l = layout({ bands: [] });

        expect(addBand(l, 'detail').height).toBeUndefined();
    });

    it('starts a band with no items', () => {
        const l = layout({ bands: [] });

        expect(addBand(l, 'detail').items).toEqual([]);
    });

    it('survives a layout whose bands are not a list', () => {
        /** the report rail is drawn for whatever is loaded, valid or not */
        const l = { page: {}, bands: 'nope' };

        expect(() => addBand(l, 'detail')).not.toThrow();
        expect(types(l)).toEqual(['detail']);
    });
});


describe('removeBand', () => {
    it('removes the band and everything on it', () => {
        const l = layout({ bands: [band('detail', [text('a')]), band('pageFooter', [])] });

        expect(removeBand(l, 'detail')).toBe(true);
        expect(types(l)).toEqual(['pageFooter']);
    });

    it('says so when there was nothing to remove', () => {
        expect(removeBand(layout({ bands: [] }), 'detail')).toBe(false);
    });
});


describe('nextItemId', () => {
    it('counts rather than randomises', () => {
        /**
         * The layout file is saved to disk and read in diffs - an id that
         * changes shape every time makes every save look like a rewrite.
         */
        expect(nextItemId(layout({ bands: [] }), 'text')).toBe('text-1');
    });

    it('skips ids already taken anywhere in the report', () => {
        const l = layout({
            bands: [
                band('pageHeader', [text('text-1')]),
                band('detail', [text('text-2')])
            ]
        });

        expect(nextItemId(l, 'text')).toBe('text-3');
    });

    it('keeps its own count per prefix', () => {
        const l = layout({ bands: [band('detail', [text('text-1')])] });

        expect(nextItemId(l, 'table')).toBe('table-1');
    });
});


describe('createText', () => {
    it('lands at the top of an empty band', () => {
        const l = layout({ bands: [band('detail', [])] });
        const made = createText(l, findBand(l, 'detail'));

        expect(made).toMatchObject({ x: 0, y: 0 });
    });

    it('lands below what is already on the band', () => {
        const l = layout({
            bands: [band('detail', [text('a', { y: 0, h: 34 })])]
        });

        expect(createText(l, findBand(l, 'detail')).y).toBe(40);
    });

    it('clears a table, whose height is its rows', () => {
        const l = layout({
            bands: [band('detail', [table({ rowHeight: 20, headerHeight: 20 })])]
        });

        /** 20 header + 3 sample rows of 20, rounded up to the grid */
        expect(createText(l, findBand(l, 'detail')).y).toBe(80);
    });

    it('is a valid item on its own', () => {
        const l = layout({ bands: [band('detail', [])] });
        addItem(l, 'detail', createText(l, findBand(l, 'detail')));

        expect(validateLayout(l)).toEqual([]);
    });
});


describe('createTable', () => {
    it('is the full printable width', () => {
        const l = layout({ bands: [band('detail', [])] });

        expect(createTable(l, findBand(l, 'detail')).w).toBe(794 - 80);
    });

    it('takes the number of columns it is asked for', () => {
        const l = layout({ bands: [band('detail', [])] });

        expect(createTable(l, findBand(l, 'detail'), 5).columns).toHaveLength(5);
    });

    it('starts each column at the default width', () => {
        const l = layout({ bands: [band('detail', [])] });
        const made = createTable(l, findBand(l, 'detail'), 4);

        expect(made.columns.map(c => c.width))
            .toEqual([50, 50, 50, 50]);
    });

    it('numbers the columns by where they sit', () => {
        const l = layout({ bands: [band('detail', [])] });

        expect(createTable(l, findBand(l, 'detail'), 3).columns.map(c => c.field))
            .toEqual(['field1', 'field2', 'field3']);
    });

    it('never makes a table with no columns, whatever it is asked', () => {
        /** validate.js rejects an empty columns array */
        const l = layout({ bands: [band('detail', [])] });

        for (const asked of [0, -3, 'abc', null]) {
            expect(createTable(l, findBand(l, 'detail'), asked).columns.length)
                .toBeGreaterThanOrEqual(1);
        }
    });

    it('takes the report dataset, so it has one to draw', () => {
        const l = layout({ bands: [band('detail', [])] });
        l.dataset = 'sales';

        expect(createTable(l, findBand(l, 'detail')).dataset).toBe('sales');
    });

    it('is a valid item on its own', () => {
        const l = layout({ bands: [band('detail', [])] });
        addItem(l, 'detail', createTable(l, findBand(l, 'detail')));

        expect(validateLayout(l)).toEqual([]);
    });
});


describe('addItem and removeItem', () => {
    it('puts the item on the named band', () => {
        const l = layout({ bands: [band('pageHeader', []), band('detail', [])] });
        addItem(l, 'pageHeader', text('a'));

        expect(findBand(l, 'pageHeader').items).toHaveLength(1);
        expect(findBand(l, 'detail').items).toHaveLength(0);
    });

    it('does nothing for a band that is not there', () => {
        const l = layout({ bands: [] });
        expect(addItem(l, 'detail', text('a'))).toBeNull();
    });

    it('removes by band and id', () => {
        const l = layout({ bands: [band('detail', [text('a'), text('b')])] });

        expect(removeItem(l, 'detail', 'a')).toBe(true);
        expect(findBand(l, 'detail').items.map(i => i.id)).toEqual(['b']);
    });

    it('leaves the same id on another band alone', () => {
        const l = layout({
            bands: [band('pageHeader', [text('same')]), band('detail', [text('same')])]
        });

        removeItem(l, 'detail', 'same');

        expect(findBand(l, 'pageHeader').items).toHaveLength(1);
        expect(findBand(l, 'detail').items).toHaveLength(0);
    });
});


describe('columns', () => {
    it('adds one at the default width, leaving the others alone', () => {
        /**
         * Redistributing widths because a new column arrived would silently
         * undo widths that were set on purpose.
         */
        const t = table();
        const before = t.columns.map(c => c.width);

        addColumn(t);

        expect(t.columns).toHaveLength(4);
        expect(t.columns.slice(0, 3).map(c => c.width)).toEqual(before);
    });

    it('names the new column after its position', () => {
        const t = table();
        expect(addColumn(t)).toMatchObject({ field: 'field4', width: 50 });
    });

    it('removes by index', () => {
        const t = table();
        removeColumn(t, 1);

        expect(t.columns.map(c => c.field)).toEqual(['name', 'price']);
    });

    it('keeps the last column, which must stay', () => {
        const t = table();
        t.columns = [t.columns[0]];

        expect(removeColumn(t, 0)).toBe(false);
        expect(t.columns).toHaveLength(1);
    });

    it('ignores an index that is not there', () => {
        const t = table();
        expect(removeColumn(t, 9)).toBe(false);
        expect(t.columns).toHaveLength(3);
    });
});


describe('targetBand', () => {
    const l = () => layout({
        bands: [band('pageHeader', []), band('detail', [])]
    });

    it('is the band the selection is on', () => {
        expect(targetBand(l(), { band: 'pageHeader', id: 'x' })).toBe('pageHeader');
    });

    it('is the detail band with nothing selected', () => {
        expect(targetBand(l(), null)).toBe('detail');
    });

    it('falls back to whatever band exists', () => {
        const only = layout({ bands: [band('pageFooter', [])] });
        expect(targetBand(only, null)).toBe('pageFooter');
    });

    it('is nothing when the report has no bands at all', () => {
        expect(targetBand(layout({ bands: [] }), null)).toBeNull();
    });
});


describe('a report built entirely through these', () => {
    it('validates', () => {
        /**
         * The point of the phase: someone who starts from a blank report and
         * only ever clicks must end up with a file the engine accepts.
         */
        const l = blankLayout();

        addBand(l, 'reportHeader');
        addBand(l, 'groupHeader');
        l.groupBy = 'region';

        addItem(l, 'reportHeader', createText(l, findBand(l, 'reportHeader')));
        addItem(l, 'groupHeader', createText(l, findBand(l, 'groupHeader')));

        const t = createTable(l, findBand(l, 'detail'));
        addColumn(t);
        addItem(l, 'detail', t);

        expect(validateLayout(l)).toEqual([]);
        expect(BAND_TYPES).toContain(l.bands[0].type);
    });
});

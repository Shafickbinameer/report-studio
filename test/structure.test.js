/**
 * Adding and removing bands, items and columns. Pure functions over the layout
 * object, so the rules that matter are specified here rather than through a
 * browser.
 */

import { describe, it, expect } from 'vitest';
import {
    BAND_TYPES, findBand, hasBand, addBand, removeBand,
    nextItemId, createText, createTable, addItem, removeItem, duplicateItem,
    pasteItems, addColumn, removeColumn, targetBand, createLine, createBox, LINE_BOX
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

describe('duplicateItem', () => {
    const detailOf = (l) => findBand(l, 'detail');

    it('puts a copy on the same band', () => {
        const l = layout({ bands: [band('detail', [text('t1')])] });
        const copy = duplicateItem(l, 'detail', 't1');

        expect(copy).not.toBeNull();
        expect(detailOf(l).items.map(i => i.id)).toEqual(['t1', copy.id]);
    });

    it('gives the copy an id of its own', () => {
        const l = layout({ bands: [band('detail', [text('text-1')])] });
        const copy = duplicateItem(l, 'detail', 'text-1');

        expect(copy.id).not.toBe('text-1');
        expect(copy.id).toBe('text-2');
    });

    it('counts on from a hand-written name rather than renaming it', () => {
        const l = layout({ bands: [band('detail', [text('rh_title')])] });
        const copy = duplicateItem(l, 'detail', 'rh_title');

        expect(copy.id).toBe('rh_title-1');
    });

    it('never collides with an id already in another band', () => {
        const l = layout({
            bands: [
                band('pageHeader', [text('text-2')]),
                band('detail', [text('text-1')])
            ]
        });
        const copy = duplicateItem(l, 'detail', 'text-1');

        expect(copy.id).toBe('text-3');
    });

    it('offsets the copy so it does not hide the original', () => {
        const l = layout({ bands: [band('detail', [text('t1', { x: 40, y: 60, w: 200 })])] });
        const copy = duplicateItem(l, 'detail', 't1');

        expect(copy.x).toBe(50);
        expect(copy.y).toBe(70);
    });

    it('keeps a copy of an item at the right edge on the page', () => {
        /** the printable width is 714; an item flush to it cannot shift right */
        const l = layout({ bands: [band('detail', [text('t1', { x: 514, y: 0, w: 200 })])] });
        const copy = duplicateItem(l, 'detail', 't1');

        expect(copy.x).toBe(514);
        expect(copy.y).toBe(10);
    });

    /**
     * The failure this rules out is quiet: a shared style object means setting
     * the copy's font also sets the original's, and nothing says so until the
     * report prints.
     */
    it('deep copies the style, so the two do not share one', () => {
        const l = layout({ bands: [band('detail', [text('t1')])] });
        const copy = duplicateItem(l, 'detail', 't1');

        copy.style.fontSize = 40;

        expect(detailOf(l).items[0].style.fontSize).not.toBe(40);
    });

    /**
     * A report binds one table (validateOneTable in validate.js), so a copy of
     * one would print its header and no rows. Refused rather than made.
     */
    it('will not copy a table, since a report binds one', () => {
        const l = layout({ bands: [band('detail', [table({ id: 'tbl' })])] });

        expect(duplicateItem(l, 'detail', 'tbl')).toBeNull();
        expect(detailOf(l).items).toHaveLength(1);
    });

    it('returns null for an item that is not on that band', () => {
        const l = layout({ bands: [band('detail', [text('t1')])] });

        expect(duplicateItem(l, 'detail', 'nope')).toBeNull();
        expect(duplicateItem(l, 'pageFooter', 't1')).toBeNull();
        expect(detailOf(l).items).toHaveLength(1);
    });

    it('leaves a layout that still validates', () => {
        const l = layout({ bands: [band('detail', [table({ id: 'tbl' })])] });
        duplicateItem(l, 'detail', 'tbl');

        expect(() => validateLayout(l)).not.toThrow();
    });

    it('can be run again on the copy, and steps down each time', () => {
        const l = layout({ bands: [band('detail', [text('t1', { x: 0, y: 0, w: 200 })])] });

        const first = duplicateItem(l, 'detail', 't1');
        const second = duplicateItem(l, 'detail', first.id);

        expect(second.y).toBe(20);
        expect(new Set(detailOf(l).items.map(i => i.id)).size).toBe(3);
    });
});

describe('pasteItems', () => {
    const itemsOn = (l, type) => findBand(l, type).items;

    it('puts a copy of each entry on the band', () => {
        const l = layout({ bands: [band('detail', [])] });
        const made = pasteItems(l, 'detail', [
            { band: 'detail', item: text('a', { w: 100 }) },
            { band: 'detail', item: text('b', { w: 100 }) }
        ]);

        expect(made).toHaveLength(2);
        expect(itemsOn(l, 'detail')).toHaveLength(2);
    });

    it('gives every paste an id that is free', () => {
        const l = layout({ bands: [band('detail', [text('text-1', { w: 100 })])] });
        const [copy] = pasteItems(l, 'detail', [
            { band: 'detail', item: findBand(l, 'detail').items[0] }
        ]);

        expect(copy.id).toBe('text-2');
    });

    it('offsets a paste so it does not land on what it came from', () => {
        const source = text('t1', { x: 20, y: 30, w: 100 });
        const l = layout({ bands: [band('detail', [source])] });
        const [copy] = pasteItems(l, 'detail', [{ band: 'detail', item: source }]);

        expect(copy).toMatchObject({ x: 30, y: 40 });
    });

    it('keeps the position when pasting back onto the same band', () => {
        const source = text('t1', { x: 0, y: 600, w: 100 });
        const l = layout({
            bands: [band('pageFooter', [], { height: 40 }), band('detail', [source])]
        });
        const [copy] = pasteItems(l, 'detail', [{ band: 'detail', item: source }]);

        expect(copy.y).toBe(610);
    });

    /**
     * A y of 600 places an item in a 900px detail zone and places it nowhere in
     * a 40px page footer - a paste the author cannot see is a paste that looks
     * like it failed.
     */
    it('brings a paste from another band into the zone it lands in', () => {
        const source = text('t1', { x: 0, y: 600, w: 100, h: 20 });
        const l = layout({
            bands: [band('pageFooter', [], { height: 40 }), band('detail', [source])]
        });
        const [copy] = pasteItems(l, 'pageFooter', [{ band: 'detail', item: source }]);

        expect(copy.y).toBeLessThanOrEqual(40 - 20);
        expect(copy.y).toBeGreaterThanOrEqual(0);
    });

    it('deep copies, so the paste and its source do not share a style', () => {
        const source = text('t1', { w: 100 });
        const l = layout({ bands: [band('detail', [source])] });
        const [copy] = pasteItems(l, 'detail', [{ band: 'detail', item: source }]);

        copy.style.fontSize = 40;

        expect(source.style.fontSize).not.toBe(40);
    });

    it('skips a table when the report already has one', () => {
        const source = table({ id: 'tbl' });
        const l = layout({ bands: [band('detail', [source])] });

        expect(pasteItems(l, 'detail', [{ band: 'detail', item: source }])).toEqual([]);
        expect(findBand(l, 'detail').items).toHaveLength(1);
    });

    it('pastes a table into a report that has none, columns and all', () => {
        const source = table({ id: 'tbl' });
        const l = layout({ bands: [band('detail', [])] });
        const [copy] = pasteItems(l, 'detail', [{ band: 'detail', item: source }]);

        expect(copy.columns).toHaveLength(3);

        copy.columns[0].label = 'Changed';

        expect(source.columns[0].label).not.toBe('Changed');
        expect(validateLayout(l)).toEqual([]);
    });

    /** one item of a clipboard being unplaceable does not refuse the rest */
    it('places what it can when one of several cannot be pasted', () => {
        const l = layout({ bands: [band('detail', [table({ id: 'tbl' })])] });

        const made = pasteItems(l, 'detail', [
            { band: 'detail', item: table({ id: 'tbl' }) },
            { band: 'detail', item: text('t1', { w: 100 }) }
        ]);

        expect(made).toHaveLength(1);
        expect(made[0].type).toBe('text');
    });

    it('does nothing for a band that is not switched on', () => {
        const l = layout({ bands: [band('detail', [])] });

        expect(pasteItems(l, 'pageFooter', [
            { band: 'detail', item: text('a') }
        ])).toEqual([]);
    });

    it('survives an empty clipboard', () => {
        const l = layout({ bands: [band('detail', [])] });

        expect(pasteItems(l, 'detail', [])).toEqual([]);
        expect(pasteItems(l, 'detail', null)).toEqual([]);
    });
});


describe('createLine', () => {
    it('spans the printable width, on the grid below what is there', () => {
        const l = layout({ bands: [band('detail', [text('t1', { y: 0, h: 40 })])] });
        const made = createLine(l, findBand(l, 'detail'));

        expect(made.type).toBe('line');
        expect(made.w).toBe(714);
        expect(made.y).toBe(40);
    });

    /**
     * A hairline that was its own box would be a 1px target on the canvas, so
     * the box is grabbable and the rule is drawn down the middle of it.
     */
    it('gives the rule a box big enough to grab', () => {
        const l = layout({ bands: [band('detail', [])] });
        const made = createLine(l, findBand(l, 'detail'));

        expect(made.h).toBe(LINE_BOX);
        expect(made.style.thickness).toBe(1);
        expect(made.h).toBeGreaterThan(made.style.thickness);
    });

    it('starts as a plain hairline rule', () => {
        const l = layout({ bands: [band('detail', [])] });
        const made = createLine(l, findBand(l, 'detail'));

        expect(made.orientation).toBe('horizontal');
        expect(made.style).toMatchObject({ lineStyle: 'solid', color: '#000000' });
    });

    it('turns the box on its side when asked for a vertical one', () => {
        const l = layout({ bands: [band('detail', [])] });
        const made = createLine(l, findBand(l, 'detail'), 'vertical');

        expect(made.orientation).toBe('vertical');
        expect(made.w).toBe(LINE_BOX);
        expect(made.h).toBeGreaterThan(made.w);
    });

    it('numbers itself apart from everything else on the report', () => {
        const l = layout({ bands: [band('detail', [])] });

        addItem(l, 'detail', createLine(l, findBand(l, 'detail')));
        const second = createLine(l, findBand(l, 'detail'));

        expect(second.id).toBe('line-2');
    });

    it('leaves a layout the engine accepts', () => {
        const l = layout({ bands: [band('detail', [table()])] });
        addItem(l, 'detail', createLine(l, findBand(l, 'detail')));

        expect(validateLayout(l)).toEqual([]);
    });

    it('duplicates like anything else', () => {
        const l = layout({ bands: [band('detail', [])] });
        const made = addItem(l, 'detail', createLine(l, findBand(l, 'detail')));
        const copy = duplicateItem(l, 'detail', made.id);

        expect(copy.style).not.toBe(made.style);
        expect(copy.style.lineStyle).toBe('solid');
        expect(findBand(l, 'detail').items).toHaveLength(2);
    });
});


describe('createBox', () => {
    it('spans the printable width, on the grid below what is there', () => {
        const l = layout({ bands: [band('detail', [text('t1', { y: 0, h: 40 })])] });
        const made = createBox(l, findBand(l, 'detail'));

        expect(made.type).toBe('box');
        expect(made.w).toBe(714);
        expect(made.y).toBe(40);
    });

    /** a fill it did not ask for would hide whatever it was put there to frame */
    it('starts as an empty hairline frame', () => {
        const l = layout({ bands: [band('detail', [])] });
        const made = createBox(l, findBand(l, 'detail'));

        expect(made.style).toMatchObject({
            borderStyle: 'solid', borderWidth: 1, background: null, radius: 0
        });
    });

    it('numbers itself apart from everything else on the report', () => {
        const l = layout({ bands: [band('detail', [])] });

        addItem(l, 'detail', createBox(l, findBand(l, 'detail')));

        expect(createBox(l, findBand(l, 'detail')).id).toBe('box-2');
    });

    it('leaves a layout the engine accepts', () => {
        const l = layout({ bands: [band('detail', [table()])] });
        addItem(l, 'detail', createBox(l, findBand(l, 'detail')));

        expect(validateLayout(l)).toEqual([]);
    });
});

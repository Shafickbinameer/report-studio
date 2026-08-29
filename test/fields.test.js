/**
 * What can be edited about an item, and what happens to what is typed. No DOM:
 * panel.js draws these and decides nothing, so the decisions are all here.
 */

import { describe, it, expect } from 'vitest';
import {
    FONT_STACKS, fieldsFor, allFields, readField, writeField
} from '../src/designer/fields.js';
import { text, table } from './helpers/layout.js';

const keys = (item) => allFields(item).map(f => f.key);
const field = (item, key) => allFields(item).find(f => f.key === key);


describe('fieldsFor', () => {
    it('has nothing to offer for nothing selected', () => {
        expect(fieldsFor(null)).toEqual([]);
    });

    it('offers a text item its value, box and type', () => {
        const has = keys(text('t'));

        expect(has).toEqual(expect.arrayContaining([
            'value', 'x', 'y', 'w', 'h',
            'style.fontFamily', 'style.fontSize', 'style.fontWeight',
            'style.fontStyle', 'style.align', 'style.color'
        ]));
    });

    it('gives a table no height field, because it stores none', () => {
        /**
         * A table's height is the header plus its rows (spec 3.3) - a box to
         * type one into is a promise the layout file cannot keep.
         */
        expect(keys(table())).not.toContain('h');
        expect(keys(text('t'))).toContain('h');
    });

    it('offers the header its own height and colours', () => {
        /**
         * The height was buried among the rows', and it is the one figure that
         * is not a row's - the engine paginates a table as headerHeight + rows
         * x rowHeight. The colours were not offered at all.
         */
        expect(keys(table())).toEqual(expect.arrayContaining([
            'headerHeight', 'showHeader',
            'style.headerBackground', 'style.headerColor'
        ]));
    });

    it('offers a table its row heights instead', () => {
        expect(keys(table())).toEqual(expect.arrayContaining([
            'rowHeight', 'headerHeight', 'showHeader'
        ]));
    });

    it('does not offer a table the text-only type controls', () => {
        /**
         * The font is not one of them any more. A table's cells wrap, and the
         * engine wraps them against a font - so which font it is has to be the
         * table's to say, or measured and drawn part company.
         */
        expect(keys(table())).not.toContain('value');
        expect(keys(table())).not.toContain('style.fontWeight');
        expect(keys(table())).not.toContain('style.align');
    });

    it('lets a table choose the font its cells are measured in', () => {
        expect(keys(table())).toContain('style.fontFamily');
    });

    it('groups the fields into sections with titles', () => {
        for (const section of fieldsFor(text('t'))) {
            expect(section.title).toBeTruthy();
            expect(section.fields.length).toBeGreaterThan(0);
        }
    });
});


describe('FONT_STACKS', () => {
    it('offers web-safe families only', () => {
        /**
         * Spec 4.3 measures text against this exact string with canvas
         * measureText. A family the browser lacks measures as a fallback and
         * then paginates to a different page count than it prints.
         */
        for (const stack of FONT_STACKS) {
            expect(stack.value).toMatch(/sans-serif|serif|monospace$/);
        }
    });

    it('includes the family the fixtures already use', () => {
        expect(FONT_STACKS.map(s => s.value))
            .toContain('Helvetica, Arial, sans-serif');
    });
});


describe('readField', () => {
    it('reads a plain key', () => {
        expect(readField(text('t', { w: 320 }), field(text('t'), 'w'))).toBe(320);
    });

    it('reads a nested one', () => {
        const item = text('t');
        item.style.fontSize = 18;

        expect(readField(item, field(item, 'style.fontSize'))).toBe(18);
    });

    it('is undefined when the item does not carry it', () => {
        const item = table();
        delete item.style;

        expect(readField(item, field(item, 'style.color'))).toBeUndefined();
    });
});


describe('writeField - numbers', () => {
    it('writes a number typed as a string', () => {
        const item = text('t');
        expect(writeField(item, field(item, 'x'), '250')).toBe(true);
        expect(item.x).toBe(250);
    });

    it('refuses an empty box rather than storing NaN', () => {
        /**
         * The controls are bound live, so an empty box is a half-typed number.
         * Storing NaN would blank the item while someone retypes a width.
         */
        const item = text('t', { w: 200 });

        expect(writeField(item, field(item, 'w'), '')).toBe(false);
        expect(item.w).toBe(200);
    });

    it('refuses text', () => {
        const item = text('t', { w: 200 });

        expect(writeField(item, field(item, 'w'), 'abc')).toBe(false);
        expect(item.w).toBe(200);
    });

    it('clamps to the field minimum', () => {
        const item = text('t');
        writeField(item, field(item, 'w'), '-40');

        expect(item.w).toBe(1);
    });

    it('lets a position go negative, which a band allows', () => {
        const item = text('t');
        writeField(item, field(item, 'x'), '-30');

        expect(item.x).toBe(-30);
    });

    it('reports no change when the value is already that', () => {
        const item = text('t', { w: 200 });
        expect(writeField(item, field(item, 'w'), '200')).toBe(false);
    });
});


describe('writeField - the rest', () => {
    it('writes a nested style value', () => {
        const item = text('t');
        writeField(item, field(item, 'style.align'), 'center');

        expect(item.style.align).toBe('center');
    });

    it('builds the style object when the item has none', () => {
        const item = text('t');
        delete item.style;

        expect(writeField(item, field(item, 'style.color'), '#ff0000')).toBe(true);
        expect(item.style.color).toBe('#ff0000');
    });

    it('writes a toggle as a boolean, not a string', () => {
        const item = table();
        writeField(item, field(item, 'showHeader'), false);

        expect(item.showHeader).toBe(false);
    });

    it('writes an empty string, because a text value may be cleared', () => {
        const item = text('t', { value: 'Total' });

        expect(writeField(item, field(item, 'value'), '')).toBe(true);
        expect(item.value).toBe('');
    });

    it('keeps a placeholder verbatim', () => {
        const item = text('t');
        writeField(item, field(item, 'value'), 'Due {invoice.date}');

        expect(item.value).toBe('Due {invoice.date}');
    });
});


describe('fieldsFor - a line', () => {
    const rule = { id: 'l1', type: 'line', x: 0, y: 0, w: 300, h: 12, style: {} };

    const keysOf = (item) =>
        fieldsFor(item).flatMap(section => section.fields.map(f => f.key));

    it('offers the pen: direction, thickness, dashes and colour', () => {
        expect(keysOf(rule)).toEqual(expect.arrayContaining([
            'orientation', 'style.thickness', 'style.lineStyle', 'style.color'
        ]));
    });

    it('offers the box, height included - a line has one, unlike a table', () => {
        expect(keysOf(rule)).toEqual(expect.arrayContaining(['x', 'y', 'w', 'h']));
    });

    /** there is no text on a line, so nothing that sets any should be offered */
    it('offers nothing about type', () => {
        const keys = keysOf(rule);

        expect(keys).not.toContain('value');
        expect(keys).not.toContain('style.fontSize');
        expect(keys).not.toContain('style.align');
    });

    it('offers the four styles a border can actually be drawn in', () => {
        const field = fieldsFor(rule)
            .flatMap(s => s.fields)
            .find(f => f.key === 'style.lineStyle');

        expect(field.type).toBe('choice');
        expect(field.options.map(o => o.value))
            .toEqual(['solid', 'dashed', 'dotted', 'double']);
    });

    it('will not let the thickness be typed down to nothing', () => {
        const field = fieldsFor(rule)
            .flatMap(s => s.fields)
            .find(f => f.key === 'style.thickness');

        expect(field.min).toBe(1);
    });
});


describe('fieldsFor - a table grid', () => {
    const grid = (key) => fieldsFor(table())
        .flatMap(section => section.fields)
        .find(f => f.key === key);

    it('offers the border style as a choice, beside its colour', () => {
        expect(grid('style.borderStyle').type).toBe('choice');
        expect(grid('style.borderColor').type).toBe('color');
    });

    it('offers the four rules a border can be drawn in, and off', () => {
        expect(grid('style.borderStyle').options.map(o => o.value))
            .toEqual(['solid', 'dashed', 'dotted', 'double', 'none']);
    });

    /** a line that draws nothing is not a line, so it is not offered the choice */
    it('does not offer None to a line', () => {
        const rule = { id: 'l1', type: 'line', x: 0, y: 0, w: 300, h: 12, style: {} };

        const options = fieldsFor(rule)
            .flatMap(s => s.fields)
            .find(f => f.key === 'style.lineStyle')
            .options.map(o => o.value);

        expect(options).not.toContain('none');
    });
});


describe('fieldsFor - a box', () => {
    const frame = {
        id: 'b1', type: 'box', x: 0, y: 0, w: 300, h: 60,
        style: { borderStyle: 'solid', borderWidth: 1, borderColor: '#000000' }
    };

    const keysOf = (item) =>
        fieldsFor(item).flatMap(section => section.fields.map(f => f.key));

    it('offers the outline: style, width, colour and corner', () => {
        expect(keysOf(frame)).toEqual(expect.arrayContaining([
            'style.borderStyle', 'style.borderWidth',
            'style.borderColor', 'style.radius'
        ]));
    });

    it('offers a fill, and the box it fills', () => {
        expect(keysOf(frame)).toEqual(expect.arrayContaining([
            'style.background', 'x', 'y', 'w', 'h'
        ]));
    });

    it('offers the same five border styles a table has', () => {
        const field = fieldsFor(frame)
            .flatMap(s => s.fields)
            .find(f => f.key === 'style.borderStyle');

        expect(field.options.map(o => o.value))
            .toEqual(['solid', 'dashed', 'dotted', 'double', 'none']);
    });

    /** nothing on a box is text, so nothing that sets type belongs on it */
    it('offers nothing about type', () => {
        const keys = keysOf(frame);

        expect(keys).not.toContain('value');
        expect(keys).not.toContain('style.fontSize');
    });

    /** a square corner is a real answer; a negative one is not */
    it('lets the corner go to nothing but no further', () => {
        const field = fieldsFor(frame)
            .flatMap(s => s.fields)
            .find(f => f.key === 'style.radius');

        expect(field.min).toBe(0);
    });
});


describe('fieldsFor - a table rule width', () => {
    const width = (item) => fieldsFor(item)
        .flatMap(s => s.fields)
        .find(f => f.key === 'style.borderWidth');

    it('will not offer a rule wider than half the shallowest row', () => {
        expect(width(table({ rowHeight: 24, headerHeight: 28 })).max).toBe(12);
        expect(width(table({ rowHeight: 40, headerHeight: 10 })).max).toBe(5);
    });

    it('ignores the header height of a table that hides its header', () => {
        expect(width(table({ rowHeight: 40, headerHeight: 10, showHeader: false })).max)
            .toBe(20);
    });

    it('still offers a hairline for a row too shallow for anything else', () => {
        expect(width(table({ rowHeight: 1, headerHeight: 1 })).max).toBe(1);
    });
});


describe('writeField - a ceiling', () => {
    it('holds a number down to the maximum the field allows', () => {
        const item = table({ rowHeight: 24, headerHeight: 28 });
        const field = fieldsFor(item)
            .flatMap(s => s.fields)
            .find(f => f.key === 'style.borderWidth');

        writeField(item, field, '40');

        expect(item.style.borderWidth).toBe(12);
    });

    it('leaves a number inside it alone', () => {
        const item = table({ rowHeight: 24, headerHeight: 28 });
        const field = fieldsFor(item)
            .flatMap(s => s.fields)
            .find(f => f.key === 'style.borderWidth');

        writeField(item, field, '3');

        expect(item.style.borderWidth).toBe(3);
    });
});

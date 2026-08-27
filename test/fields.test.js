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

    it('offers a table its row heights instead', () => {
        expect(keys(table())).toEqual(expect.arrayContaining([
            'rowHeight', 'headerHeight', 'showHeader'
        ]));
    });

    it('does not offer a table the text-only type controls', () => {
        expect(keys(table())).not.toContain('style.fontFamily');
        expect(keys(table())).not.toContain('value');
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

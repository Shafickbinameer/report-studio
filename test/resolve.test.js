import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve } from '../src/engine/resolve.js';
import { layout, text, band } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    vi.spyOn(console, 'error').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());

const only = (value, data) => {
    const json = layout({ bands: [band('reportHeader', [text('t', { value })])] });
    return resolve(json, data).bands[0].items[0].text;
};

describe('resolve - placeholders', () => {
    it('substitutes a top-level key', () => {
        expect(only('Hello {name}', { name: 'Ana' })).toBe('Hello Ana');
    });

    it('substitutes a dotted path', () => {
        expect(only('{invoice.number}', { invoice: { number: 'INV-1' } })).toBe('INV-1');
    });

    it('substitutes several placeholders in one value', () => {
        expect(only('{a} / {b}', { a: '1', b: '2' })).toBe('1 / 2');
    });

    it('keeps the literal text around a placeholder', () => {
        expect(only('Total: {n} items', { n: 4 })).toBe('Total: 4 items');
    });

    it('renders an unresolved key as empty rather than throwing', () => {
        expect(only('[{missing}]', {})).toBe('[]');
        expect(console.warn).toHaveBeenCalled();
    });

    it('renders a broken path as empty', () => {
        expect(only('[{a.b.c}]', { a: null })).toBe('[]');
    });

    it('leaves {page} and {totalPages} for pagination to fill in', () => {
        expect(only('{page}/{totalPages}', {})).toBe('{page}/{totalPages}');
    });

    it('leaves aggregate expressions for the grouping stage', () => {
        expect(only('[{sum(price)}]', {})).toBe('[{sum(price)}]');
    });

    it('keeps data resolved alongside a deferred page placeholder', () => {
        expect(only('{who} - page {page}', { who: 'Ana' })).toBe('Ana - page {page}');
    });

    it('resolves an array index in either notation', () => {
        const data = { items: [{ name: 'first' }, { name: 'second' }] };
        expect(only('{items.1.name}', data)).toBe('second');
        expect(only('{items[0].name}', data)).toBe('first');
    });

    it('tolerates whitespace inside the braces', () => {
        expect(only('{ name }', { name: 'Ana' })).toBe('Ana');
    });

    it('resolves {today} to an ISO date', () => {
        expect(only('{today}', {})).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('does not mutate the input layout', () => {
        const json = layout({ bands: [band('reportHeader', [text('t', { value: '{n}' })])] });
        const before = structuredClone(json);
        resolve(json, { n: 1 });
        expect(json).toEqual(before);
    });
});

describe('resolve - input validation', () => {
    it('names every problem in a malformed layout', () => {
        expect(() => resolve({ notALayout: true }, {}))
            .toThrow(/layout\.page must be an object[\s\S]*layout\.bands must be an array/);
    });

    it('rejects a non-object layout', () => {
        expect(() => resolve(null, {})).toThrow(/layout must be an object/);
    });

    it('rejects a non-object data payload', () => {
        const json = layout({ bands: [band('reportHeader', [text('t')])] });
        expect(() => resolve(json, [])).toThrow(/data must be an object/);
    });

    it('names the offending band and item', () => {
        const json = layout({ bands: [band('reportHeader', [{ id: 'x', type: 'blob' }])] });
        expect(() => resolve(json, {})).toThrow(/bands\[0\]\.items\[0\]\.type "blob"/);
    });
});


/**
 * A library that talks while it works is a library the host cannot hear over.
 * These are console.debug in a browser, where the level is hidden by default -
 * and stdout under Node, where a host rendering a report on a server got the
 * lot.
 */
describe('resolve - what it says while it works', () => {
    const buildOne = (value, data = {}) => {
        const json = layout({ bands: [band('reportHeader', [text('t', { value })])] });
        return resolve(json, data);
    };

    it('says nothing about a placeholder it resolves', () => {
        buildOne('Hello {name}', { name: 'Ana' });

        expect(console.debug).not.toHaveBeenCalled();
        expect(console.warn).not.toHaveBeenCalled();
    });

    it('says nothing about an aggregate, which is grouping\'s to answer', () => {
        buildOne('Total {sum(price)}');

        expect(console.debug).not.toHaveBeenCalled();
        expect(console.warn).not.toHaveBeenCalled();
    });

    it('says nothing about a page key, which is pagination\'s to answer', () => {
        /**
         * The loud one: a footer reading "Page {page} of {totalPages}" wrote
         * two lines per page, so a two hundred page report opened behind four
         * hundred lines of the engine narrating itself.
         */
        buildOne('Page {page} of {totalPages}');

        expect(console.debug).not.toHaveBeenCalled();
        expect(console.warn).not.toHaveBeenCalled();
    });

    it('still warns about a placeholder nothing can resolve', () => {
        /** the one case worth a word: the report will print a gap */
        buildOne('Hello {nobody}', { name: 'Ana' });

        expect(console.warn).toHaveBeenCalled();
    });
});

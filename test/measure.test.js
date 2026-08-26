import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { measure } from '../src/engine/measure.js';
import { resolve } from '../src/engine/resolve.js';
import { group } from '../src/engine/group.js';
import { textHeight, wrapLines, measureText, clearMetricsCache } from '../src/engine/text-metrics.js';
import { layout, text, table, band, rows, groupedRows } from './helpers/layout.js';

beforeEach(() => {
    clearMetricsCache();
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());

const measured = (json, data) => measure(group(resolve(json, data), data));
const STYLE = { fontSize: 12, fontFamily: 'Helvetica, Arial, sans-serif', fontWeight: 'normal', fontStyle: 'normal' };

describe('text-metrics', () => {
    it('measures a wider string as wider', () => {
        expect(measureText('mmmmm', STYLE)).toBeGreaterThan(measureText('iiiii', STYLE));
    });

    it('wraps greedily at the item width', () => {
        const lines = wrapLines('The quick brown fox jumps over the lazy dog', 60, STYLE);
        expect(lines.length).toBeGreaterThan(1);
        for (const line of lines) {
            expect(measureText(line, STYLE)).toBeLessThanOrEqual(60);
        }
    });

    it('breaks a single word wider than the line', () => {
        const lines = wrapLines('supercalifragilisticexpialidocious', 50, STYLE);
        expect(lines.length).toBeGreaterThan(1);
        expect(lines.join('')).toBe('supercalifragilisticexpialidocious');
    });

    it('treats a newline as a hard break', () => {
        expect(wrapLines('a\nb', 999, STYLE)).toEqual(['a', 'b']);
    });

    it('gives empty text one line of height, not zero', () => {
        expect(textHeight('', 300, STYLE)).toBeGreaterThan(0);
    });

    it('grows height with the number of wrapped lines', () => {
        const one = textHeight('The quick brown fox', 999, STYLE);
        const many = textHeight('The quick brown fox jumps over the lazy dog again', 60, STYLE);
        expect(many).toBeGreaterThan(one);
    });

    it('returns the same width for a repeated string, so the cache is transparent', () => {
        const a = measureText('Invoice #INV-2041', STYLE);
        const b = measureText('Invoice #INV-2041', STYLE);
        expect(a).toBe(b);
    });
});

describe('measure - text items', () => {
    it('honours a declared height that is big enough', () => {
        const json = layout({
            bands: [
                band('reportHeader', [text('t', { h: 80, w: 700, value: 'short' })]),
                band('detail', [table()])
            ]
        });
        const out = measured(json, { items: rows(1) });
        expect(out.bands[0].items[0].measuredHeight).toBe(80);
    });

    it('grows past a declared height when the text wraps', () => {
        const long = 'word '.repeat(80).trim();
        const json = layout({
            bands: [
                band('reportHeader', [text('t', { h: 20, w: 120, value: long })]),
                band('detail', [table()])
            ]
        });
        const out = measured(json, { items: rows(1) });
        expect(out.bands[0].items[0].measuredHeight).toBeGreaterThan(20);
    });

    it('measures the resolved text, not the raw template', () => {
        const json = layout({
            bands: [
                band('reportHeader', [text('t', { h: 0, w: 60, value: '{blurb}' })]),
                band('detail', [table()])
            ]
        });
        const short = measured(json, { items: rows(1), blurb: 'hi' });
        const long = measured(json, {
            items: rows(1),
            blurb: 'a much longer sentence that will certainly wrap several times over'
        });
        expect(long.bands[0].items[0].measuredHeight)
            .toBeGreaterThan(short.bands[0].items[0].measuredHeight);
    });
});

describe('measure - band height', () => {
    it('is the lowest edge any item reaches, not the sum of heights', () => {
        const json = layout({
            bands: [
                band('reportHeader', [
                    text('a', { x: 0, y: 0, w: 300, h: 20, value: 'a' }),
                    text('b', { x: 400, y: 0, w: 300, h: 20, value: 'b' })
                ], { height: 0 }),
                band('detail', [table()])
            ]
        });
        const out = measured(json, { items: rows(1) });
        expect(out.bands[0].measuredHeight).toBe(20);
    });

    it('does not depend on item order', () => {
        const items = [
            text('a', { y: 0, h: 20, value: 'a' }),
            text('b', { y: 40, h: 20, value: 'b' })
        ];
        const forward = measured(layout({
            bands: [band('reportHeader', [...items], { height: 0 }), band('detail', [table()])]
        }), { items: rows(1) });
        const backward = measured(layout({
            bands: [band('reportHeader', [...items].reverse(), { height: 0 }), band('detail', [table()])]
        }), { items: rows(1) });

        expect(forward.bands[0].measuredHeight).toBe(60);
        expect(backward.bands[0].measuredHeight).toBe(60);
    });

    it('accounts for a gap above an item', () => {
        const json = layout({
            bands: [
                band('reportHeader', [text('a', { y: 100, h: 20, value: 'a' })], { height: 0 }),
                band('detail', [table()])
            ]
        });
        expect(measured(json, { items: rows(1) }).bands[0].measuredHeight).toBe(120);
    });

    it('honours a declared band height larger than its content', () => {
        const json = layout({
            bands: [
                band('reportHeader', [text('a', { y: 0, h: 20, value: 'a' })], { height: 200 }),
                band('detail', [table()])
            ]
        });
        expect(measured(json, { items: rows(1) }).bands[0].measuredHeight).toBe(200);
    });

    it('never clips content to a smaller declared band height', () => {
        const json = layout({
            bands: [
                band('reportHeader', [text('a', { y: 0, h: 300, value: 'a' })], { height: 20 }),
                band('detail', [table()])
            ]
        });
        expect(measured(json, { items: rows(1) }).bands[0].measuredHeight).toBe(300);
    });
});

describe('measure - table height', () => {
    it('is headerHeight + rows x rowHeight', () => {
        const json = layout({ bands: [band('detail', [table({ rowHeight: 28, headerHeight: 32 })])] });
        const out = measured(json, { items: rows(10) });
        expect(out.bands[0].items[0].measuredHeight).toBe(32 + 10 * 28);
    });

    it('drops the header height when showHeader is false', () => {
        const json = layout({
            bands: [band('detail', [table({ rowHeight: 28, headerHeight: 32, showHeader: false })])]
        });
        const out = measured(json, { items: rows(10) });
        expect(out.bands[0].items[0].measuredHeight).toBe(10 * 28);
    });

    it('is just the header for an empty dataset', () => {
        const json = layout({ bands: [band('detail', [table({ headerHeight: 32 })])] });
        expect(measured(json, { items: [] }).bands[0].items[0].measuredHeight).toBe(32);
    });

    it('counts group header and footer bands once per group', () => {
        const json = layout({
            groupBy: 'name',
            bands: [
                band('groupHeader', [text('gh', { h: 22, value: '{name}' })], { height: 22 }),
                band('detail', [table({ rowHeight: 28, headerHeight: 32 })]),
                band('groupFooter', [text('gf', { h: 20, value: '{sum(price)}' })], { height: 20 })
            ]
        });
        const out = measured(json, { items: groupedRows(['A', 'B'], 5) });

        /** per group: table header 32 + group header 22 + 5 x 28 + group footer 20 */
        expect(out.bands[1].items[0].measuredHeight).toBe(2 * (32 + 22 + 140 + 20));
    });
});

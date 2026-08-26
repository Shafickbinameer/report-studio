import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { search, searchPages } from '../src/engine/search.js';
import { layout, text, table, band, rows, groupedRows, run } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());

const flatReport = (data) => run(layout({
    bands: [
        band('reportHeader', [text('rh', { value: 'INVOICE for {customer.name}' })]),
        band('detail', [table()]),
        band('pageFooter', [text('pf', { value: 'Page {page} of {totalPages}' })])
    ]
}), data);

const groupedReport = (data) => run(layout({
    groupBy: 'name',
    bands: [
        band('groupHeader', [text('gh', { value: 'Region: {name}', h: 22 })], { height: 22 }),
        band('detail', [table()]),
        band('groupFooter', [text('gf', { value: 'Subtotal: {sum(price)}', h: 20 })], { height: 20 })
    ]
}), data);

describe('search - basics', () => {
    it('returns nothing for a blank query', () => {
        const out = flatReport({ items: rows(3), customer: { name: 'Anand' } });
        expect(search(out.pages, '')).toEqual([]);
        expect(search(out.pages, null)).toEqual([]);
    });

    it('finds text in a band item', () => {
        const out = flatReport({ items: rows(3), customer: { name: 'Anand' } });
        const hits = search(out.pages, 'Anand');

        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({ pageNO: 1, itemId: 'rh', bandType: 'reportHeader' });
    });

    it('finds text in a table cell', () => {
        const out = flatReport({ items: rows(3), customer: { name: 'Anand' } });
        const hits = search(out.pages, 'row-1');

        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({ itemId: 'tbl', field: 'name' });
    });

    it('finds text in a column header', () => {
        const out = flatReport({ items: rows(1), customer: { name: 'Anand' } });
        expect(search(out.pages, 'Qty')).toHaveLength(1);
    });

    it('is case insensitive by default', () => {
        const out = flatReport({ items: rows(1), customer: { name: 'Anand' } });
        expect(search(out.pages, 'anand')).toHaveLength(1);
        expect(search(out.pages, 'anand', { caseSensitive: true })).toHaveLength(0);
    });

    it('records every occurrence in one string, not just the first', () => {
        const out = run(layout({
            bands: [
                band('reportHeader', [text('rh', { value: 'aa aa aa' })]),
                band('detail', [table()])
            ]
        }), { items: rows(1) });

        expect(search(out.pages, 'aa').filter(m => m.itemId === 'rh')).toHaveLength(3);
    });

    it('reports where in the string each hit falls', () => {
        const out = run(layout({
            bands: [
                band('reportHeader', [text('rh', { value: 'xxABxx' })]),
                band('detail', [table()])
            ]
        }), { items: rows(1) });

        const hit = search(out.pages, 'AB').find(m => m.itemId === 'rh');
        expect(hit.start).toBe(2);
        expect(hit.end).toBe(4);
        expect(hit.text.slice(hit.start, hit.end)).toBe('AB');
    });
});

describe('search - across pages', () => {
    it('reports the page each hit is on', () => {
        const out = flatReport({ items: rows(48), customer: { name: 'Anand' } });
        const hits = search(out.pages, 'row-40');

        expect(hits).toHaveLength(1);
        expect(hits[0].pageNO).toBe(2);
    });

    it('finds a term repeated on every page', () => {
        const out = flatReport({ items: rows(48), customer: { name: 'Anand' } });
        expect(searchPages(out.pages, 'Page')).toEqual(
            out.pages.map(p => p.pageNO)
        );
    });

    it('lists distinct pages in order, without repeats', () => {
        const out = flatReport({ items: rows(48), customer: { name: 'Anand' } });
        const pages = searchPages(out.pages, 'row-');

        expect(pages).toEqual([...new Set(pages)]);
        expect(pages).toEqual([...pages].sort((a, b) => a - b));
    });

    it('returns hits in page order', () => {
        const out = flatReport({ items: rows(48), customer: { name: 'Anand' } });
        const pageNumbers = search(out.pages, 'row-').map(m => m.pageNO);

        expect(pageNumbers).toEqual([...pageNumbers].sort((a, b) => a - b));
    });
});

describe('search - grouped reports', () => {
    it('finds rows inside group fragments', () => {
        const out = groupedReport({ items: groupedRows(['North', 'South'], 4) });
        expect(search(out.pages, 'North').length).toBeGreaterThan(0);
    });

    it('finds text in a group header band', () => {
        const out = groupedReport({ items: groupedRows(['North'], 4) });
        expect(search(out.pages, 'Region:')).toHaveLength(1);
    });

    it('finds text in a group footer band', () => {
        const out = groupedReport({ items: groupedRows(['North'], 4) });
        expect(search(out.pages, 'Subtotal:')).toHaveLength(1);
    });

    it('does not double count a group footer that has not printed yet', () => {
        const out = groupedReport({ items: groupedRows(['North'], 60) });
        const fragments = out.pages.flatMap(p => p.bands)
            .filter(b => b.type === 'detail')
            .flatMap(b => b.items)
            .flatMap(i => i.groups || []);

        expect(fragments.length).toBeGreaterThan(1);
        expect(search(out.pages, 'Subtotal:')).toHaveLength(1);
    });
});

describe('search - resilience', () => {
    it('tolerates an empty page list', () => {
        expect(search([], 'x')).toEqual([]);
        expect(search(undefined, 'x')).toEqual([]);
    });

    it('does not match across a value boundary', () => {
        const out = flatReport({ items: rows(3), customer: { name: 'Anand' } });
        expect(search(out.pages, 'row-0row-1')).toEqual([]);
    });
});

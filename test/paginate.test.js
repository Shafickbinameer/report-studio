import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    layout, text, table, band, rows, groupedRows,
    run, runWithoutGroup, detailBands, itemIdsOn, placedRows,
    drawnBottom, footerTop
} from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());

describe('paginate - band placement', () => {
    it('places a detail band that fits entirely on one page', () => {
        const json = layout({
            bands: [
                band('reportHeader', [text('title', { h: 34 })]),
                band('detail', [table()])
            ]
        });
        const out = run(json, { items: rows(3) });

        expect(out.pages).toHaveLength(1);
        expect(detailBands(out.pages[0])).toHaveLength(1);
        expect(placedRows(out)).toHaveLength(3);
    });

    it('emits a detail band on every page a split table touches', () => {
        const json = layout({ bands: [band('detail', [table()])] });
        const out = run(json, { items: rows(48) });

        expect(out.pages.length).toBeGreaterThan(1);
        for (const page of out.pages) {
            expect(detailBands(page).length).toBeLessThanOrEqual(1);
        }
    });

    it('never places the same band object on a page twice', () => {
        const json = layout({ bands: [band('detail', [table()])] });
        const out = run(json, { items: rows(48) });

        for (const page of out.pages) {
            const seen = new Set();
            for (const b of page.bands) {
                expect(seen.has(b)).toBe(false);
                seen.add(b);
            }
        }
    });
});

describe('paginate - row conservation', () => {
    const cases = [
        ['empty', 0],
        ['one row', 1],
        ['exactly one page', 31],
        ['one row over a page', 32],
        ['several pages', 120]
    ];

    for (const [name, n] of cases) {
        it(`places every row exactly once - ${name} (${n})`, () => {
            const json = layout({ bands: [band('detail', [table()])] });
            const out = run(json, { items: rows(n) });

            const placed = placedRows(out);
            expect(placed).toHaveLength(n);
            expect(placed.map(r => r.name)).toEqual(rows(n).map(r => r.name));
        });
    }
});

describe('paginate - text overflow', () => {
    it('carries the overflowing item to the next page without duplicating the first', () => {
        const json = layout({
            bands: [
                band('detail', [
                    text('t0', { y: 0, h: 300 }),
                    text('t1', { y: 300, h: 300 }),
                    text('t2', { y: 600, h: 300 }),
                    text('t3', { y: 900, h: 300 })
                ])
            ]
        });
        const out = runWithoutGroup(json, { items: [] });

        expect(out.pages).toHaveLength(2);
        expect(itemIdsOn(out.pages[0])).toEqual(['t0', 't1', 't2']);
        expect(itemIdsOn(out.pages[1])).toEqual(['t3']);
    });

    it('keeps every text item across the whole report', () => {
        const items = Array.from({ length: 9 }, (_, i) =>
            text(`t${i}`, { y: i * 300, h: 300 }));
        const json = layout({ bands: [band('detail', items)] });
        const out = runWithoutGroup(json, { items: [] });

        const all = out.pages.flatMap(p => itemIdsOn(p));
        expect(all).toEqual(items.map(i => i.id));
    });

    it('does not drop text already placed when a following table forces a new page', () => {
        const json = layout({
            bands: [band('detail', [text('blurb', { h: 1000 }), table()])]
        });
        const out = run(json, { items: rows(10) });

        const allText = out.pages.flatMap(p => itemIdsOn(p));
        expect(allText).toContain('blurb');
        expect(placedRows(out)).toHaveLength(10);
    });
});

describe('paginate - termination', () => {
    it('terminates when a row is taller than the printable page', () => {
        const json = layout({
            bands: [band('detail', [table({ rowHeight: 1200 })])]
        });
        const out = run(json, { items: rows(3) });

        expect(placedRows(out)).toHaveLength(3);
        expect(console.warn).toHaveBeenCalled();
    });

    it('terminates when a grouped slice is taller than the printable page', () => {
        const json = layout({
            groupBy: 'name',
            bands: [
                band('detail', [table({ rowHeight: 1200 })]),
                band('groupFooter', [text('gf', { value: '{sum(price)}' })])
            ]
        });
        const out = run(json, { items: groupedRows(['A', 'B'], 2) });

        expect(placedRows(out)).toHaveLength(4);
        expect(console.warn).toHaveBeenCalled();
    });
});

describe('paginate - grouped tables', () => {
    it('places every grouped row exactly once across pages', () => {
        const json = layout({
            groupBy: 'name',
            bands: [
                band('detail', [table()]),
                band('groupFooter', [text('gf', { value: '{sum(price)}' })])
            ]
        });
        const data = { items: groupedRows(['A', 'B', 'C'], 16) };
        const out = run(json, data);

        expect(placedRows(out)).toHaveLength(48);
        for (const page of out.pages) {
            expect(detailBands(page).length).toBeLessThanOrEqual(1);
        }
    });

    it('gives every placed table fragment a numeric measuredHeight', () => {
        const json = layout({
            groupBy: 'name',
            bands: [
                band('detail', [table()]),
                band('groupFooter', [text('gf', { value: '{sum(price)}' })])
            ]
        });
        const out = run(json, { items: groupedRows(['A', 'B', 'C'], 16) });

        for (const page of out.pages) {
            for (const b of page.bands) {
                for (const i of (b.items || [])) {
                    expect(Number.isFinite(i.measuredHeight)).toBe(true);
                }
                expect(Number.isFinite(b.measuredHeight)).toBe(true);
            }
        }
    });
});

describe('paginate - page numbers', () => {
    it('resolves {page} and {totalPages} in a page header too', () => {
        const json = layout({
            bands: [
                band('pageHeader', [text('ph', { value: 'Sheet {page}/{totalPages}' })]),
                band('detail', [table()])
            ]
        });
        const out = run(json, { items: rows(48) });
        const total = out.pages.length;

        out.pages.forEach((page, idx) => {
            const header = page.bands.find(b => b.type === 'pageHeader');
            expect(header.items[0].text).toBe(`Sheet ${idx + 1}/${total}`);
        });
    });

    it('keeps data resolved alongside a page placeholder', () => {
        const json = layout({
            bands: [
                band('detail', [table()]),
                band('pageFooter', [text('pf', { value: '{customer.name} - page {page} of {totalPages}' })])
            ]
        });
        const out = run(json, { items: rows(48), customer: { name: 'Anand' } });

        expect(out.pages[0].bands.find(b => b.type === 'pageFooter').items[0].text)
            .toBe(`Anand - page 1 of ${out.pages.length}`);
    });

    it('keeps root data resolved inside a group band', () => {
        const json = layout({
            groupBy: 'name',
            bands: [
                band('groupHeader', [text('gh', { value: '{customer.city} / {name}', h: 22 })], { height: 22 }),
                band('detail', [table()]),
                band('groupFooter', [text('gf', { value: '{authorizer}: {sum(price)}', h: 20 })], { height: 20 })
            ]
        });
        const out = run(json, {
            items: groupedRows(['A'], 3),
            customer: { city: 'Kozhikode' },
            authorizer: 'R. Menon'
        });

        const frag = out.pages.flatMap(p => p.bands)
            .filter(b => b.type === 'detail')
            .flatMap(b => b.items)
            .flatMap(i => i.groups || [])[0];

        expect(frag.headerBand.items[0].text).toBe('Kozhikode / A');
        expect(frag.footerBand.items[0].text).toBe('R. Menon: 30');
    });

    it('resolves {page} inside a group band', () => {
        const json = layout({
            groupBy: 'name',
            bands: [
                band('groupHeader', [text('gh', { value: '{name} (page {page})', h: 22 })], { height: 22 }),
                band('detail', [table()]),
                band('groupFooter', [text('gf', { value: '{sum(price)}', h: 20 })], { height: 20 })
            ]
        });
        const out = run(json, { items: groupedRows(['A', 'B'], 4) });

        const headers = out.pages.flatMap(p =>
            p.bands.filter(b => b.type === 'detail')
                .flatMap(b => b.items.flatMap(i => i.groups || []))
                .map(g => g.headerBand.items[0].text));

        expect(headers).toContain('A (page 1)');
        expect(headers.every(t => !t.includes('{page}'))).toBe(true);
    });

    it('resolves {page} and {totalPages} in the page footer', () => {
        const json = layout({
            bands: [
                band('detail', [table()]),
                band('pageFooter', [text('pf', { value: 'Page {page} of {totalPages}' })])
            ]
        });
        const out = run(json, { items: rows(48) });
        const total = out.pages.length;

        out.pages.forEach((page, idx) => {
            const footer = page.bands.find(b => b.type === 'pageFooter');
            expect(footer.items[0].text).toBe(`Page ${idx + 1} of ${total}`);
        });
    });
});

describe('paginate - the detail band stays inside its zone', () => {
    /**
     * The bug this covers: items are drawn absolutely at their `y`, but
     * pagination used to add their heights up as if they flowed. The gap above
     * a table was then never charged to the page, so a long table ran that many
     * pixels past its zone and printed over the page footer.
     */
    it('charges the gap above a table to the page it is on', () => {
        const json = layout({
            bands: [
                band('pageHeader', [text('ph', { h: 20 })], { height: 60 }),
                band('detail', [
                    text('name', { y: 14, h: 20 }),
                    table({ y: 123 })
                ]),
                band('pageFooter', [text('pf', { h: 20 })], { height: 40 })
            ]
        });
        const out = run(json, { items: rows(40) });

        for (const page of out.pages) {
            for (const b of detailBands(page)) {
                expect(b.top + drawnBottom(b)).toBeLessThanOrEqual(footerTop(page));
            }
        }
    });

    it('re-anchors a continued table to the top of the next zone', () => {
        const json = layout({
            bands: [
                band('detail', [table({ y: 300 })]),
                band('pageFooter', [text('pf', { h: 20 })], { height: 40 })
            ]
        });
        const out = run(json, { items: rows(80) });

        expect(out.pages.length).toBeGreaterThan(1);

        const [first, ...rest] = out.pages
            .flatMap(p => detailBands(p))
            .flatMap(b => b.items.filter(i => i.type === 'table'));

        expect(first.y).toBe(300);
        for (const slice of rest) expect(slice.y).toBe(0);
    });

    it('places items by their y, not by their order in the layout', () => {
        const json = layout({
            bands: [
                band('detail', [
                    table({ y: 100 }),
                    text('above', { y: 10, h: 20 })
                ]),
                band('pageFooter', [text('pf', { h: 20 })], { height: 40 })
            ]
        });
        const out = run(json, { items: rows(80) });

        expect(itemIdsOn(out.pages[0])).toEqual(['above', 'tbl']);
    });

    /**
     * The group footer only prints on the fragment that ends a group, and its
     * height used to be added to that fragment without ever being reserved.
     */
    it('reserves the group footer on the page that ends a group', () => {
        const json = layout({
            groupBy: 'name',
            bands: [
                band('groupHeader', [text('gh', { value: '{name}', h: 38 })], { height: 38 }),
                band('detail', [table()]),
                band('groupFooter', [text('gf', { value: '{sum(price)}', h: 42 })], { height: 42 }),
                band('pageFooter', [text('pf', { h: 20 })], { height: 40 })
            ]
        });

        for (const n of [4, 6, 8, 10, 12]) {
            const out = run(structuredClone(json), { items: groupedRows(['A', 'B', 'C'], n) });

            for (const page of out.pages) {
                for (const b of detailBands(page)) {
                    expect(b.top + drawnBottom(b)).toBeLessThanOrEqual(footerTop(page));
                }
            }
        }
    });

    it('never lets a detail band reach the footer, for any row count', () => {
        for (const n of [0, 1, 30, 31, 32, 33, 64, 65, 96, 200]) {
            const json = layout({
                bands: [
                    band('reportHeader', [text('rh', { h: 60 })], { height: 100 }),
                    band('detail', [text('lead', { y: 20, h: 40 }), table({ y: 90 })]),
                    band('reportFooter', [text('rf', { h: 40 })], { height: 120 }),
                    band('pageFooter', [text('pf', { h: 20 })], { height: 40 })
                ]
            });
            const out = run(json, { items: rows(n) });

            expect(placedRows(out)).toHaveLength(n);

            for (const page of out.pages) {
                for (const b of detailBands(page)) {
                    expect(b.top + drawnBottom(b)).toBeLessThanOrEqual(footerTop(page));
                }
            }
        }
    });

    it('reports a band height that matches what the band draws', () => {
        const json = layout({
            bands: [
                band('detail', [text('lead', { y: 20, h: 40 }), table({ y: 200 })]),
                band('pageFooter', [text('pf', { h: 20 })], { height: 40 })
            ]
        });
        const out = run(json, { items: rows(90) });

        for (const page of out.pages) {
            for (const b of detailBands(page)) {
                expect(b.measuredHeight).toBe(drawnBottom(b));
            }
        }
    });
});

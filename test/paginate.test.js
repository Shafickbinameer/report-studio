import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    layout, text, table, band, rows, groupedRows,
    run, runWithoutGroup, detailBands, itemIdsOn, placedRows,
    drawnBottom, footerTop, placedItem
} from './helpers/layout.js';
import { designHeight } from '../src/engine/measure.js';

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


describe('paginate - what sits below something that grew floats with it', () => {
    /**
     * A table has no height in the file: it is its header plus however many
     * rows the data turns out to have. The designer draws it at DESIGN_ROWS
     * rows, and that is what everything below it in the band was positioned
     * against - so the first real dataset made the table taller and left the
     * total, the note and the rule underneath it stranded among the rows.
     *
     * The rule these pin down: an item designed below a table keeps the gap it
     * was designed with, measured from wherever the table actually ends.
     */
    const TABLE_Y = 200;
    const GAP = 10;

    /** a table at TABLE_Y, and a line of text GAP px under the size it is drawn at */
    const below = (extra = {}) => {
        const tbl = table({ y: TABLE_Y });
        const designedBottom = TABLE_Y + designHeight(tbl);

        return {
            tbl,
            designedBottom,
            note: text('note', { y: designedBottom + GAP, h: 20, ...extra })
        };
    };

    it('pushes it past the last row when the table grows', () => {
        const { tbl, note } = below();
        const json = layout({ bands: [band('detail', [note, tbl])] });

        const out = run(json, { items: rows(9) });
        const placed = placedItem(out, 'note');
        const drawn = placedItem(out, 'tbl');

        expect(out.pages).toHaveLength(1);
        expect(drawn.measuredHeight).toBeGreaterThan(designHeight(tbl));
        expect(placed.y).toBe(drawn.y + drawn.measuredHeight + GAP);
    });

    it('pulls it back up when the table has fewer rows than it was drawn with', () => {
        const { tbl, note, designedBottom } = below();
        const json = layout({ bands: [band('detail', [note, tbl])] });

        const out = run(json, { items: rows(1) });
        const placed = placedItem(out, 'note');
        const drawn = placedItem(out, 'tbl');

        expect(placed.y).toBe(drawn.y + drawn.measuredHeight + GAP);
        expect(placed.y).toBeLessThan(designedBottom + GAP);
    });

    it('leaves an item level with the rows where it is', () => {
        /**
         * Beside the table, not below it - a caption in the margin at the
         * height of the third row. The rows growing past it is not a reason to
         * move it, and a rule that pushed everything after the table in file
         * order would have.
         */
        const tbl = table({ y: TABLE_Y });
        const caption = text('caption', { x: 600, y: TABLE_Y + 40, w: 100, h: 20 });
        const json = layout({ bands: [band('detail', [tbl, caption])] });

        const out = run(json, { items: rows(9) });

        expect(placedItem(out, 'caption').y).toBe(TABLE_Y + 40);
    });

    it('follows the last slice when the table has run over several pages', () => {
        const { tbl, note } = below();
        const json = layout({
            bands: [
                band('detail', [note, tbl]),
                band('pageFooter', [text('pf', { h: 20 })], { height: 40 })
            ]
        });

        const out = run(json, { items: rows(90) });
        const page = out.pages.find(p =>
            detailBands(p).some(b => b.items.some(i => i.id === 'note')));

        const drawn = page.bands
            .flatMap(b => b.items).find(i => i.id === 'tbl');

        expect(out.pages.length).toBeGreaterThan(1);
        expect(drawn, 'the note left the page its table finished on').toBeDefined();
        expect(placedItem(out, 'note').y)
            .toBe(drawn.y + drawn.measuredHeight + GAP);
    });

    it('floats it past every fragment of a grouped table', () => {
        const { tbl, note } = below();
        const json = layout({
            groupBy: 'name',
            bands: [
                band('groupHeader', [text('gh', { h: 20 })], { height: 24 }),
                band('groupFooter', [text('gf', { h: 20 })], { height: 24 }),
                band('detail', [note, tbl])
            ]
        });

        const out = run(json, { items: groupedRows(['a', 'b'], 3) });
        const drawn = placedItem(out, 'tbl');

        expect(placedItem(out, 'note').y)
            .toBe(drawn.y + drawn.measuredHeight + GAP);
    });

    it('starts it at the top of the next page when the float pushes it off', () => {
        /**
         * The float is the table's, and the table is on the page behind. An
         * item that had to break keeps nothing from it.
         */
        const { tbl, note } = below({ h: 300 });
        const json = layout({
            bands: [
                band('detail', [note, tbl]),
                band('pageFooter', [text('pf', { h: 20 })], { height: 40 })
            ]
        });

        const out = run(json, { items: rows(24) });
        const placed = placedItem(out, 'note');

        expect(out.pages.length).toBeGreaterThan(1);
        expect(placed.y).toBe(0);
    });

    it('never lets the float push a band over the page footer', () => {
        const { tbl, note } = below();
        const json = layout({
            bands: [
                band('detail', [note, tbl]),
                band('pageFooter', [text('pf', { h: 20 })], { height: 40 })
            ]
        });

        for (const n of [1, 9, 31, 32, 90]) {
            const out = run(json, { items: rows(n) });

            for (const page of out.pages) {
                for (const b of detailBands(page)) {
                    expect(b.top + drawnBottom(b), `${n} rows`)
                        .toBeLessThanOrEqual(footerTop(page));
                }
            }
        }
    });
});

describe('paginate - text that wraps pushes what is under it', () => {
    /**
     * The same fault as the table's, from the other direction. A text box is as
     * tall as the words need once they wrap to its width, and `h` is only what
     * it was drawn at. An address that ran to a second line used to print
     * straight through the line underneath it.
     */
    const LONG = 'A very long line of prose that will certainly not fit inside ' +
        'two hundred pixels of width, and so has to wrap onto several lines ' +
        'before it is finished.';

    const GAP = 10;

    /** the wrapped height of a narrow box, so a spec can say what it expects */
    const wrappedHeight = (item) => {
        const json = layout({ bands: [band('detail', [item])] });
        return run(json, { items: rows(0) })
            .pages[0].bands[0].items[0].measuredHeight;
    };

    it('floats the line below down by however far the text ran over', () => {
        const first = text('first', { y: 0, w: 200, h: 20, value: LONG });
        const second = text('second', { y: 20 + GAP, w: 200, h: 20 });

        const grew = wrappedHeight(first);
        expect(grew, 'the sample text did not wrap').toBeGreaterThan(20);

        const json = layout({ bands: [band('detail', [first, second])] });
        const out = run(json, { items: rows(0) });

        expect(placedItem(out, 'second').y).toBe(grew + GAP);
    });

    it('leaves a text beside the wrapping one where it is', () => {
        const wraps = text('wraps', { x: 0, y: 0, w: 200, h: 20, value: LONG });
        const beside = text('beside', { x: 400, y: 10, w: 200, h: 20 });

        const json = layout({ bands: [band('detail', [wraps, beside])] });
        const out = run(json, { items: rows(0) });

        expect(placedItem(out, 'beside').y).toBe(10);
    });

    it('pushes by one line when two boxes side by side each wrap one', () => {
        /**
         * The reason the shift is a difference between two edges and not a sum
         * of how much each item grew: two columns of prose that each run over
         * by a line push what is under them down by a line, not by two.
         */
        const left = text('left', { x: 0, y: 0, w: 200, h: 20, value: LONG });
        const right = text('right', { x: 300, y: 0, w: 200, h: 20, value: LONG });
        const under = text('under', { y: 20 + GAP, w: 200, h: 20 });

        const grew = wrappedHeight(left);

        const json = layout({ bands: [band('detail', [left, right, under])] });
        const out = run(json, { items: rows(0) });

        expect(placedItem(out, 'under').y).toBe(grew + GAP);
    });

    it('carries the shift down a chain of wrapping boxes', () => {
        const a = text('a', { y: 0, w: 200, h: 20, value: LONG });
        const b = text('b', { y: 20 + GAP, w: 200, h: 20, value: LONG });
        const c = text('c', { y: 40 + GAP * 2, w: 200, h: 20 });

        const grew = wrappedHeight(a);

        const json = layout({ bands: [band('detail', [a, b, c])] });
        const out = run(json, { items: rows(0) });

        expect(placedItem(out, 'b').y).toBe(grew + GAP);
        expect(placedItem(out, 'c').y).toBe(grew + GAP + grew + GAP);
    });

    it('floats a table down when the text above it wrapped', () => {
        /**
         * Both halves of the rule in one band: the paragraph grows, the table
         * moves down to clear it, and the note below the table clears the rows.
         */
        const lead = text('lead', { y: 0, w: 200, h: 20, value: LONG });
        const tbl = table({ y: 20 + GAP });
        const note = text('note', {
            y: 20 + GAP + designHeight(table({ y: 0 })) + GAP, h: 20
        });

        const grew = wrappedHeight(lead);
        const json = layout({ bands: [band('detail', [lead, tbl, note])] });
        const out = run(json, { items: rows(6) });

        const drawn = placedItem(out, 'tbl');

        expect(drawn.y).toBe(grew + GAP);
        expect(placedItem(out, 'note').y)
            .toBe(drawn.y + drawn.measuredHeight + GAP);
    });

    it('never lets a wrap push a band over the page footer', () => {
        const json = layout({
            bands: [
                band('detail', [
                    text('lead', { y: 0, w: 200, h: 20, value: LONG }),
                    table({ y: 100 }),
                    text('note', { y: 300, h: 20 })
                ]),
                band('pageFooter', [text('pf', { h: 20 })], { height: 40 })
            ]
        });

        for (const n of [0, 1, 9, 31, 32, 90]) {
            const out = run(json, { items: rows(n) });

            for (const page of out.pages) {
                for (const b of detailBands(page)) {
                    expect(b.top + drawnBottom(b), `${n} rows`)
                        .toBeLessThanOrEqual(footerTop(page));
                }
            }
        }
    });
});


describe('paginate - a table whose rows are not all the same height', () => {
    /**
     * A table used to be sliced with a division, because every row was the
     * height the table declared. A row is now as tall as its own text wraps to,
     * so the only honest answer is to add them up until one does not fit.
     */
    const LONG = 'a note long enough that it cannot possibly fit on one line '
        + 'inside a hundred and eighty pixels of column, or two';

    const tbl = (extra = {}) => ({
        id: 'tbl', type: 'table', x: 0, y: 0, w: 300,
        rowHeight: 24, headerHeight: 24, showHeader: true,
        columns: [
            { field: 'name', label: 'Name', width: 120, align: 'left' },
            { field: 'note', label: 'Note', width: 180, align: 'left' }
        ],
        style: { fontSize: 12, fontFamily: 'Helvetica, Arial, sans-serif' },
        ...extra
    });

    /** every fourth row runs long, so no page is a whole number of rows */
    const mixed = (n) => Array.from({ length: n }, (_, i) => ({
        name: `row ${i + 1}`,
        note: i % 4 === 0 ? LONG : 'short'
    }));

    const withFooter = (item) => layout({
        bands: [
            band('detail', [item]),
            band('pageFooter', [text('pf', { h: 20 })], { height: 40 })
        ]
    });

    it('places every row, however tall they came out', () => {
        for (const n of [1, 5, 40, 120]) {
            const out = run(withFooter(tbl()), { items: mixed(n) });

            expect(placedRows(out), `${n} rows`).toHaveLength(n);
        }
    });

    it('never lets a slice reach the page footer', () => {
        for (const n of [5, 40, 120]) {
            const out = run(withFooter(tbl()), { items: mixed(n) });

            for (const page of out.pages) {
                for (const b of detailBands(page)) {
                    expect(b.top + drawnBottom(b), `${n} rows`)
                        .toBeLessThanOrEqual(footerTop(page));
                }
            }
        }
    });

    it('says a slice is exactly as tall as the rows it carries', () => {
        const out = run(withFooter(tbl()), { items: mixed(40) });

        for (const page of out.pages) {
            for (const b of detailBands(page)) {
                for (const item of b.items) {
                    if (item.type !== 'table') continue;

                    const sum = item.rowHeights.reduce((a, b2) => a + b2, 0);

                    expect(item.measuredHeight).toBe(item.headerMeasured + sum);
                }
            }
        }
    });

    it('hands each slice its own rows heights, so the renderer measures nothing', () => {
        const out = run(withFooter(tbl()), { items: mixed(40) });

        for (const page of out.pages) {
            for (const b of detailBands(page)) {
                for (const item of b.items) {
                    if (item.type !== 'table') continue;

                    expect(item.rowHeights).toHaveLength(item.row.length);
                }
            }
        }
    });

    it('fits fewer rows on a page than it would have with none of them wrapped', () => {
        const wrapped = run(withFooter(tbl()), { items: mixed(40) });
        const flat = run(withFooter(tbl({ wrap: false })), { items: mixed(40) });

        expect(wrapped.pages.length).toBeGreaterThan(flat.pages.length);
    });

    it('still conserves every row when the table is grouped', () => {
        const json = layout({
            groupBy: 'name',
            bands: [
                band('groupHeader', [text('gh', { h: 20 })], { height: 24 }),
                band('groupFooter', [text('gf', { h: 20 })], { height: 24 }),
                band('detail', [tbl()]),
                band('pageFooter', [text('pf', { h: 20 })], { height: 40 })
            ]
        });

        const items = groupedRows(['a', 'b', 'c'], 8)
            .map((row, i) => ({ ...row, note: i % 3 === 0 ? LONG : 'short' }));

        const out = run(json, { items });

        expect(placedRows(out)).toHaveLength(items.length);

        for (const page of out.pages) {
            for (const b of detailBands(page)) {
                expect(b.top + drawnBottom(b)).toBeLessThanOrEqual(footerTop(page));
            }
        }
    });
});

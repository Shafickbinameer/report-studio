import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '../src/render/render.js';
import { items } from '../src/render/items.js';
import {
    layout, text, table, band, rows, groupedRows, run, box as boxItem
} from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());

const flat = (data, bands) => render(run(layout({ bands }), data));

const groupedLayout = () => layout({
    groupBy: 'name',
    bands: [
        band('groupHeader', [text('gh', { value: 'Region: {name}', h: 22 })], { height: 22 }),
        band('detail', [table()]),
        band('groupFooter', [
            text('gf_l', { value: 'Subtotal', h: 20 }),
            text('gf_s', { x: 400, value: 'Subtotal: {sum(price)}', h: 20 })
        ], { height: 20 })
    ]
});

describe('render - flat tables', () => {
    it('emits one row per record plus a header', () => {
        const html = flat({ items: rows(3) }, [band('detail', [table()])]);
        expect((html.match(/<tr/g) || [])).toHaveLength(4);
    });

    it('prints cell values', () => {
        const html = flat({ items: [{ name: 'Cable', qty: 2, price: 50 }] },
            [band('detail', [table()])]);
        expect(html).toContain('Cable');
        expect(html).toContain('>50<');
    });

    it('gives text items real CSS lengths', () => {
        const html = flat({ items: rows(1) },
            [band('reportHeader', [text('t', { w: 300, h: 34 })]), band('detail', [table()])]);
        expect(html).toMatch(/width:300px/);
        expect(html).toMatch(/height:34px/);
    });
});

describe('render - grouped tables', () => {
    it('does not throw', () => {
        const data = { items: groupedRows(['A', 'B'], 4) };
        expect(() => render(run(groupedLayout(), data))).not.toThrow();
    });

    it('renders every grouped row', () => {
        const data = { items: groupedRows(['A', 'B'], 4) };
        const html = render(run(groupedLayout(), data));
        expect((html.match(/<tbody>/g) || []).length).toBeGreaterThanOrEqual(2);
        expect((html.match(/class="group-header"/g) || [])).toHaveLength(2);
    });

    it('renders a group header per group with the group value filled in', () => {
        const data = { items: groupedRows(['North', 'South'], 3) };
        const html = render(run(groupedLayout(), data));
        expect(html).toContain('Region: North');
        expect(html).toContain('Region: South');
    });

    it('renders per-group subtotals, not the report total', () => {
        const data = {
            items: [
                { name: 'A', qty: 1, price: 10 },
                { name: 'A', qty: 1, price: 10 },
                { name: 'B', qty: 1, price: 500 }
            ]
        };
        const html = render(run(groupedLayout(), data));
        expect(html).toContain('Subtotal: 20');
        expect(html).toContain('Subtotal: 500');
        expect(html).not.toContain('Subtotal: 520');
    });

    it('keeps the literal text around an aggregate placeholder', () => {
        const data = { items: groupedRows(['A'], 2) };
        const html = render(run(groupedLayout(), data));
        expect(html).toMatch(/Subtotal: \d+/);
    });

    it('prints a group footer only on the fragment that ends the group', () => {
        const data = { items: groupedRows(['A'], 60) };
        const paginated = run(groupedLayout(), data);
        const fragments = paginated.pages.flatMap(p =>
            p.bands.filter(b => b.type === 'detail')
                .flatMap(b => b.items.flatMap(i => i.groups || [])));

        expect(fragments.length).toBeGreaterThan(1);
        expect(fragments.filter(f => f.showFooter)).toHaveLength(1);
        expect(fragments.at(-1).showFooter).toBe(true);
    });
});

describe('render - escaping', () => {
    it('escapes markup in a table cell', () => {
        const html = flat({ items: [{ name: '</td><script>alert(1)</script>', qty: 1, price: 1 }] },
            [band('detail', [table()])]);
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('escapes markup in a resolved text item', () => {
        const html = flat({ items: rows(1), evil: '<img src=x onerror=alert(1)>' },
            [band('reportHeader', [text('t', { value: '{evil}' })]), band('detail', [table()])]);
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('&lt;img');
    });

    it('escapes markup in a group header value', () => {
        const data = { items: [{ name: '<b>X</b>', qty: 1, price: 1 }] };
        const html = render(run(groupedLayout(), data));
        expect(html).not.toContain('Region: <b>');
        expect(html).toContain('&lt;b&gt;');
    });
});

describe('render - anchored bands', () => {
    const anchored = (html, type, pageNO = 1) =>
        html.match(new RegExp(`id="${type}-${pageNO}" style="([^"]*)"`))?.[1] ?? '';

    const full = () => layout({
        bands: [
            band('pageHeader', [text('ph', { value: 'head', h: 16 })]),
            band('detail', [table()]),
            band('pageFooter', [text('pf', { value: 'Page {page}', h: 16 })])
        ]
    });

    it('positions bands absolutely rather than stacking them', () => {
        const html = render(run(full(), { items: rows(3) }));

        expect(anchored(html, 'pageHeader')).toContain('position:absolute');
        expect(anchored(html, 'detail')).toContain('position:absolute');
        expect(anchored(html, 'pageFooter')).toContain('position:absolute');
    });

    it('adds the page margins back, since absolute anchors to the padding box', () => {
        const paginated = run(full(), { items: rows(3) });
        const html = render(paginated);
        const { margin } = paginated.page;

        const header = paginated.pages[0].bands.find(b => b.type === 'pageHeader');
        expect(anchored(html, 'pageHeader'))
            .toContain(`top:${header.top + margin.top}px`);
        expect(anchored(html, 'pageHeader')).toContain(`left:${margin.left}px`);
    });

    it('puts the footer on the bottom edge of the printable area', () => {
        const paginated = run(full(), { items: rows(2) });
        const html = render(paginated);
        const { height, margin } = paginated.page;

        const footer = paginated.pages[0].bands.find(b => b.type === 'pageFooter');
        const cssTop = footer.top + margin.top;

        expect(anchored(html, 'pageFooter')).toContain(`top:${cssTop}px`);
        expect(cssTop + footer.zoneHeight).toBeCloseTo(height - margin.bottom, 5);
    });

    it('falls back to flowing a band the engine did not anchor', () => {
        const paginated = run(full(), { items: rows(3) });
        for (const b of paginated.pages[0].bands) delete b.top;

        expect(render(paginated)).toContain('position:relative');
    });
});

describe('render - purity', () => {
    it('does not reorder the page list in place', () => {
        const paginated = run(layout({
            bands: [
                band('detail', [table()]),
                band('pageFooter', [text('pf', { value: 'p' })]),
                band('reportHeader', [text('rh', { value: 'h' })])
            ]
        }), { items: rows(3) });

        const before = paginated.pages.map(p => p.bands.map(b => b.type));
        render(paginated);
        const after = paginated.pages.map(p => p.bands.map(b => b.type));

        expect(after).toEqual(before);
    });
});

describe('render - a row is exactly the height the engine budgeted', () => {
    /**
     * `height` on a <tr> is a floor, not a height. When the cell's own padding
     * and line box needed more, every row came out a few pixels taller than the
     * rowHeight pagination had counted, and a long table drifted over the page
     * footer. The height belongs to a box inside the cell, where nothing can
     * add to it.
     */
    it('puts the row height on a box inside the cell', () => {
        const html = flat({ items: rows(2) },
            [band('detail', [table({ rowHeight: 24, headerHeight: 28 })])]);

        expect(html).toContain('<tr style="height:24px">');
        expect((html.match(/class="cell" style="height:24px/g) || []))
            .toHaveLength(2 * 3);
        expect((html.match(/class="cell" style="height:28px/g) || []))
            .toHaveLength(3);
    });

    it('leaves the cell itself nothing to add to that height', () => {
        const html = flat({ items: rows(1) }, [band('detail', [table()])]);

        expect(html).not.toMatch(/<t[dh][^>]*padding/);
        expect(html).not.toMatch(/<t[dh][^>]*height/);
    });

    it('draws column alignment on the cell box', () => {
        /**
         * text-align rather than justify-content, since cells wrap: a
         * right-aligned column needs every line on the right, not the wrapped
         * paragraph pushed over as a block.
         */
        const html = flat({ items: rows(1) }, [band('detail', [table()])]);

        /* the fixture aligns Item left, Qty and Price right */
        expect(html).toContain('text-align:left');
        expect(html).toContain('text-align:right');
    });

    it('gives grouped rows the same fixed-height cells', () => {
        const html = render(run(groupedLayout(), { items: groupedRows(['A'], 2) }));

        expect((html.match(/class="cell" style="height:28px/g) || []).length)
            .toBeGreaterThan(0);
        expect(html).toContain('<tr style="height:28px">');
    });
});


describe('render - the table grid', () => {
    const withStyle = (style) => flat({ items: rows(2) },
        [band('detail', [{ ...table(), style }])]);

    it('carries the style and colour the table asked for', () => {
        const html = withStyle({ borderStyle: 'dashed', borderColor: '#ff9c4b' });

        expect(html).toContain('--rs-rule-style:dashed');
        expect(html).toContain('--rs-rule-color:#ff9c4b');
    });

    it('draws every style a border can be', () => {
        for (const borderStyle of ['solid', 'dashed', 'dotted', 'double', 'none']) {
            expect(withStyle({ borderStyle })).toContain(`--rs-rule-style:${borderStyle}`);
        }
    });

    /** a table with no opinion keeps taking the stylesheet's own border colour */
    it('says nothing when the table says nothing', () => {
        const html = withStyle({ fontSize: 12 });

        expect(html).not.toContain('--rs-rule-style');
        expect(html).not.toContain('--rs-rule-color');
    });

    /**
     * The designer canvas draws straight from the layout without asking the
     * validator, so a style it does not know has to fall back rather than land
     * in a style attribute.
     */
    it('ignores a border style it does not recognise', () => {
        /** drawn directly: the validator would turn this layout away first */
        const html = items([
            { ...table(), style: { borderStyle: 'squiggly', borderColor: '#000000' } }
        ]);

        expect(html).not.toContain('squiggly');
        expect(html).toContain('--rs-rule-color:#000000');
    });

    /**
     * Set once on the table and inherited, not written onto every cell: a five
     * hundred row table would otherwise repeat it fifteen hundred times.
     */
    it('declares the grid once, on the table itself', () => {
        const html = withStyle({ borderStyle: 'dotted' });

        expect((html.match(/--rs-rule-style/g) || [])).toHaveLength(1);
        expect(html).toMatch(/<table[^>]*--rs-rule-style:dotted/);
    });
});


describe('render - the table rule width', () => {
    const withStyle = (style, extra = {}) => items([
        { ...table(), ...extra, style }
    ]);

    it('carries the width the table asked for', () => {
        expect(withStyle({ borderWidth: 3 })).toContain('--rs-rule-width:3px');
    });

    it('says nothing when the table says nothing, so the hairline stands', () => {
        expect(withStyle({ borderStyle: 'solid' })).not.toContain('--rs-rule-width');
    });

    /**
     * .cell is border-box with a fixed height, so a rule is drawn inside the
     * row until the two rules of a cell are together taller than it - at which
     * point the cell grows and the table stops measuring what it declared.
     */
    it('clamps a rule too wide for the row it is drawn in', () => {
        const html = withStyle({ borderWidth: 40 }, { rowHeight: 24, headerHeight: 28 });

        expect(html).toContain('--rs-rule-width:12px');
    });

    it('clamps against the shallowest row, not the tallest', () => {
        const html = withStyle({ borderWidth: 40 }, { rowHeight: 40, headerHeight: 10 });

        expect(html).toContain('--rs-rule-width:5px');
    });

    it('never clamps below a hairline', () => {
        const html = withStyle({ borderWidth: 4 }, { rowHeight: 1, headerHeight: 1 });

        expect(html).toContain('--rs-rule-width:1px');
    });

    it('ignores a width that is not a number', () => {
        expect(withStyle({ borderWidth: 'thick' })).not.toContain('--rs-rule-width');
        expect(withStyle({ borderWidth: 0 })).not.toContain('--rs-rule-width');
    });
});


describe('render - a box among other items', () => {
    it('draws with the rest of its band', () => {
        const html = flat({ items: rows(2) }, [band('detail', [
            table(), boxItem('frame', { y: 300, h: 80 })
        ])]);

        expect(html).toContain('data-item-type="box"');
        expect(html).toContain('data-item-type="table"');
    });
});


describe('render - the table header', () => {
    const withStyle = (style) => flat({ items: rows(2) },
        [band('detail', [{ ...table(), style }])]);

    it('carries the fill and the text colour the table asked for', () => {
        const html = withStyle({ headerBackground: '#ff9c4b', headerColor: '#22272c' });

        expect(html).toContain('--rs-head-bg:#ff9c4b');
        expect(html).toContain('--rs-head-color:#22272c');
    });

    it('says nothing when the table says nothing', () => {
        /** so a table with no opinion keeps the quiet fill report.css gives it */
        const html = withStyle({ fontSize: 12 });

        expect(html).not.toContain('--rs-head-bg');
        expect(html).not.toContain('--rs-head-color');
    });

    it('sets them once, on the table, not once per cell', () => {
        /**
         * The reason they are custom properties: a five hundred row table has
         * fifteen hundred cells, and the same colour repeated that many times is
         * markup nobody needs to send.
         */
        const html = withStyle({ headerBackground: '#eeeeee' });

        expect(html.match(/--rs-head-bg/g)).toHaveLength(1);
        expect(html).toMatch(/<table[^>]*--rs-head-bg:#eeeeee/);
    });

    it('draws the header at the height the table declared', () => {
        const html = flat({ items: rows(2) },
            [band('detail', [{ ...table(), headerHeight: 44 }])]);

        expect(html).toContain('<tr style="height:44px">');
        expect(html).toContain('class="cell" style="height:44px');
    });

    it('leaves the rows their own height while the header has another', () => {
        const html = flat({ items: rows(2) },
            [band('detail', [{ ...table(), headerHeight: 44, rowHeight: 20 }])]);

        expect(html).toContain('<tr style="height:44px">');
        expect(html).toContain('<tr style="height:20px">');
    });
});


describe('render - a wrapped row is drawn at the height it was measured at', () => {
    const LONG = 'a note long enough that it cannot possibly fit on one line '
        + 'inside a hundred and eighty pixels of column';

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

    const data = { items: [{ name: 'a', note: 'short' }, { name: 'b', note: LONG }] };

    const html = (item = tbl()) =>
        render(run(layout({ bands: [band('detail', [item])] }), data));

    it("draws each row at its own height, not the table's", () => {
        const heights = [...html().matchAll(/<tr style="height:([\d.]+)px"/g)]
            .map(m => Number(m[1]));

        /** the header, a short row, and a tall one */
        expect(heights).toHaveLength(3);
        expect(heights[1]).toBe(24);
        expect(heights[2]).toBeGreaterThan(24);
    });

    it('gives the cell the same height as the row it is in', () => {
        const tall = [...html().matchAll(/<tr style="height:([\d.]+)px">([\s\S]*?)<\/tr>/g)]
            .map(m => ({ height: m[1], body: m[2] }))
            .find(row => Number(row.height) > 24);

        expect(tall.body).toContain(`class="cell" style="height:${tall.height}px`);
    });

    it('carries the font it was measured in onto the table', () => {
        expect(html()).toContain('--rs-cell-family:Helvetica, Arial, sans-serif');
        expect(html()).toContain('--rs-cell-size:12px');
    });

    it('says nothing about the font when the table has no opinion', () => {
        const bare = tbl({ style: { borderColor: '#cccccc' } });

        expect(html(bare)).not.toContain('--rs-cell-family');
        expect(html(bare)).not.toContain('--rs-cell-size');
    });

    it('asks for one line when the table has turned wrapping off', () => {
        const flat = html(tbl({ wrap: false }));
        const heights = [...flat.matchAll(/<tr style="height:([\d.]+)px"/g)]
            .map(m => Number(m[1]));

        expect(flat).toContain('--rs-cell-wrap:nowrap');
        expect(new Set(heights)).toEqual(new Set([24]));
    });

    it('says nothing about wrapping when it is on, which is the default', () => {
        expect(html()).not.toContain('--rs-cell-wrap');
    });
});

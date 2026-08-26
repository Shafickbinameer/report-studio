import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '../src/render/render.js';
import { layout, text, table, band, rows, groupedRows, run } from './helpers/layout.js';

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

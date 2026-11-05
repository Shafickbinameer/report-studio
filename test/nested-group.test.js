/**
 * A table grouped within its groups: by region, and within each region by city.
 *
 *   { type: 'table', ..., grouping: [
 *       { by: 'region', header, footer },     outermost first
 *       { by: 'city',   header, footer }
 *   ] }
 *
 * The engine still hands every stage a flat list of groups - the innermost
 * ones, in drawing order - each saying which outer groups it opens and closes.
 * What these specs hold it to:
 *
 *   - an inner group lives inside its outer one: Oslo in North and Oslo in
 *     South are two groups
 *   - every level is totalled over its own group: a region footer sums the
 *     region, a city footer the city
 *   - headers draw outermost first where their groups start, footers innermost
 *     first where they end
 *   - the column labels head each outermost group, not every city
 *   - a page that carries a group on repeats every level's header, and a page
 *     break never lets a stack of footers run past the page footer
 *
 * One level is in group.test.js and multi-group.test.js, and has to come out
 * as it always has.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { group } from '../src/engine/group.js';
import { resolve } from '../src/engine/resolve.js';
import { validateLayout } from '../src/engine/validate.js';
import { tablesOf, groupFrame, fragmentBandsOf, MAX_GROUP_LEVELS } from '../src/engine/tables.js';
import { toCSV } from '../src/engine/csv.js';
import { toXLSX } from '../src/engine/xlsx.js';
import { reportRows } from '../src/engine/rows.js';
import { search } from '../src/engine/search.js';
import { render } from '../src/render/render.js';
import { layout, table, text, band, run, drawnBottom, footerTop } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());


const groupBand = (items, height = 20) => ({ height, items });

const regionLevel = (extra = {}) => ({
    by: 'region',
    header: groupBand([text('rh', { value: 'Region {region}' })]),
    footer: groupBand([text('rf', { value: 'Region total {sum(qty)} in {count()}' })]),
    ...extra
});

const cityLevel = (extra = {}) => ({
    by: 'city',
    header: groupBand([text('ch', { value: 'City {city}' })]),
    footer: groupBand([text('cf', { value: 'City total {sum(qty)}' })]),
    ...extra
});

const nested = ({ levels = [regionLevel(), cityLevel()], footer = false, showHeader = true } = {}) =>
    layout({
        bands: [
            band('detail', [{ ...table({ id: 'sales', showHeader }), grouping: levels }]),
            ...(footer
                ? [band('pageFooter', [text('pf', { value: 'Page {page}' })], { height: 40 })]
                : [])
        ]
    });

/**
 * Interleaved on purpose: grouping keeps the order each value is first seen
 * in, inside its outer group, whatever order the rows come in.
 */
const data = () => ({
    items: [
        { name: 'a', qty: 1, price: 10, region: 'North', city: 'Oslo' },
        { name: 'b', qty: 2, price: 20, region: 'South', city: 'Rome' },
        { name: 'c', qty: 3, price: 30, region: 'North', city: 'Bergen' },
        { name: 'd', qty: 4, price: 40, region: 'North', city: 'Oslo' },
        { name: 'e', qty: 5, price: 50, region: 'South', city: 'Oslo' },
        { name: 'f', qty: 6, price: 60, region: 'South', city: 'Rome' }
    ]
});

/** the bound table, after resolve and group */
const bound = (json = nested(), payload = data()) =>
    tablesOf(group(resolve(json, payload), payload))[0];

const slices = (built, id = 'sales') => built.pages.flatMap(page => page.bands
    .flatMap(b => b.items)
    .filter(item => item.id === id));

const fragmentsOf = (built, id = 'sales') => slices(built, id).flatMap(item => item.groups);

const textOf = (band) => band?.items.map(i => i.text).join(' ');

const levelsOfBands = (bands) => bands.map(b => b.level);


describe('grouping within groups', () => {
    it('lists the innermost groups, each inside its outer group, in first-seen order', () => {
        expect(bound().groups.map(g => g.path)).toEqual([
            ['North', 'Oslo'], ['North', 'Bergen'], ['South', 'Rome'], ['South', 'Oslo']
        ]);
    });

    it('keeps an inner key that repeats under two outer groups as two groups', () => {
        const oslo = bound().groups.filter(g => g.key === 'Oslo');

        expect(oslo.map(g => g.rows.map(r => r.name))).toEqual([['a', 'd'], ['e']]);
    });

    it('says where each outer group starts and ends', () => {
        const groups = bound().groups;

        expect(groups.map(g => g.opens)).toEqual([0, 1, 0, 1]);
        expect(groups.map(g => g.closes)).toEqual([1, 0, 1, 0]);
    });

    it('totals every level over its own group', () => {
        const [northOslo, northBergen, southRome] = bound().groups;

        /** the city's own */
        expect(northOslo.aggregates.qty.sum).toBe(5);
        expect(northBergen.aggregates.qty.sum).toBe(3);

        /** the region's, the same object for every city in it */
        expect(northOslo.levels[0].aggregates.qty.sum).toBe(8);
        expect(northOslo.levels[0].aggregates[''].count).toBe(3);
        expect(northBergen.levels[0]).toBe(northOslo.levels[0]);
        expect(southRome.levels[0].aggregates.qty.sum).toBe(13);
    });

    it("works out only what each level's own bands ask for", () => {
        const json = nested({
            levels: [regionLevel(), cityLevel({ footer: groupBand([text('cf', { value: '{avg(price)}' })]) })]
        });
        const [first] = bound(json).groups;

        expect(first.levels[0].aggregates).not.toHaveProperty('price');
        expect(first.levels[1].aggregates).not.toHaveProperty('qty');
    });

    it('goes three levels deep', () => {
        const json = nested({
            levels: [regionLevel(), cityLevel(), {
                by: 'name', header: groupBand([text('nh', { value: 'Name {name}' })]), footer: null
            }]
        });
        const groups = bound(json).groups;

        expect(groups).toHaveLength(6);
        expect(groups[0].path).toEqual(['North', 'Oslo', 'a']);
        expect(groups.map(g => g.opens)).toEqual([0, 2, 1, 0, 2, 1]);
        expect(groups.map(g => g.closes)).toEqual([2, 1, 0, 2, 1, 0]);
    });

    it('still opens and closes level 0 on every group of a one-level table', () => {
        const groups = bound(nested({ levels: [regionLevel()] })).groups;

        expect(groups.map(g => [g.path, g.opens, g.closes]))
            .toEqual([[['North'], 0, 0], [['South'], 0, 0]]);
    });

    it('keeps the order numbers are first seen in, rather than ascending', () => {
        const payload = {
            items: [
                { name: 'x', qty: 1, region: 2024, city: 'A' },
                { name: 'y', qty: 1, region: 2023, city: 'A' }
            ]
        };

        expect(bound(nested(), payload).groups.map(g => g.path))
            .toEqual([['2024', 'A'], ['2023', 'A']]);
    });
});


describe('what a fragment draws around its rows', () => {
    const levels = [regionLevel(), cityLevel()];
    const tbl = { grouping: levels };

    it('heads the first fragment on a page with every level, whatever it opens', () => {
        const frame = groupFrame(tbl, { opens: 1, closes: 1 }, true, false);

        expect(frame.columnHeader).toBe(true);
        expect(frame.headers.map(h => h.level)).toEqual([0, 1]);
    });

    it('heads a later fragment with the levels it opens only', () => {
        const frame = groupFrame(tbl, { opens: 1, closes: 1 }, false, false);

        expect(frame.columnHeader).toBe(false);
        expect(frame.headers.map(h => h.level)).toEqual([1]);
    });

    it('closes innermost first, out to the level the group closes, only where it ends', () => {
        expect(groupFrame(tbl, { opens: 0, closes: 0 }, false, true).footers.map(f => f.level))
            .toEqual([1, 0]);
        expect(groupFrame(tbl, { opens: 0, closes: 1 }, false, true).footers.map(f => f.level))
            .toEqual([1]);
        expect(groupFrame(tbl, { opens: 0, closes: 0 }, false, false).footers).toEqual([]);
    });

    it('skips a level that has no band of that kind', () => {
        const frame = groupFrame({ grouping: [regionLevel({ header: null }), cityLevel()] },
            { opens: 0, closes: 0 }, true, true);

        expect(frame.headers.map(h => h.level)).toEqual([1]);
        expect(frame.footers.map(f => f.level)).toEqual([1, 0]);
    });
});


describe('a nested table on one page', () => {
    const built = () => run(nested(), data());

    it('draws each header where its group starts, outermost first', () => {
        const fragments = fragmentsOf(built());

        expect(fragments.map(f => fragmentBandsOf(f).headers.map(textOf))).toEqual([
            ['Region North', 'City Oslo'],
            ['City Bergen'],
            ['Region South', 'City Rome'],
            ['City Oslo']
        ]);
    });

    it('draws each footer where its group ends, innermost first, with its own total', () => {
        const fragments = fragmentsOf(built());

        expect(fragments.map(f => fragmentBandsOf(f).footers.map(textOf))).toEqual([
            ['City total 5'],
            ['City total 3', 'Region total 8 in 3'],
            ['City total 8'],
            ['City total 5', 'Region total 13 in 3']
        ]);
    });

    it('marks each band with its level', () => {
        const [first, second] = fragmentsOf(built());

        expect(levelsOfBands(first.headerBands)).toEqual([0, 1]);
        expect(levelsOfBands(second.footerBands)).toEqual([1, 0]);
    });

    it('heads each region with the column labels, not every city', () => {
        expect(fragmentsOf(built()).map(f => f.showHeader)).toEqual([true, false, true, false]);
    });

    it('keeps headerBand and footerBand as the innermost level', () => {
        const [first, second] = fragmentsOf(built());

        expect(textOf(first.headerBand)).toBe('City Oslo');
        expect(first.footerBand).not.toBeNull();
        expect(textOf(second.footerBand)).toBe('City total 3');
    });

    it('is as tall as everything it draws', () => {
        const [placed] = slices(built());

        /** labels twice, 2 region and 4 city headers and footers, 6 rows */
        expect(placed.measuredHeight).toBe(2 * 32 + (2 + 4) * 20 * 2 + 6 * 28);
    });

    it('renders every band in drawing order', () => {
        const html = render(built());
        const order = [
            'Region North', 'City Oslo', 'City total 5', 'City Bergen', 'City total 3',
            'Region total 8 in 3', 'Region South', 'City Rome', 'City total 8',
            'City total 5', 'Region total 13 in 3'
        ];

        let from = 0;
        for (const expected of order) {
            const at = html.indexOf(expected, from);
            expect(at, expected).toBeGreaterThan(-1);
            from = at + expected.length;
        }

        expect(html).toContain('data-group-level="0"');
        expect(html).toContain('data-group-level="1"');
    });

    it('fills in {page} in an outer band', () => {
        const json = nested({
            levels: [regionLevel({ header: groupBand([text('rh', { value: '{region} p{page}' })]) }), cityLevel()]
        });

        expect(fragmentBandsOf(fragmentsOf(run(json, data()))[0]).headers.map(textOf)[0]).toBe('North p1');
    });

    it('finds text in every level of band', () => {
        const pages = built().pages;

        expect(search(pages, 'Region total 13').map(m => m.bandType)).toEqual(['groupFooter']);
        expect(search(pages, 'City Bergen').map(m => m.bandType)).toEqual(['groupHeader']);
    });

    it('reads out every band, in order, as report rows', () => {
        const lines = reportRows(built().pages).map(r => r.cells.join(' '));

        expect(lines.indexOf('Region North')).toBeLessThan(lines.indexOf('City Oslo'));
        expect(lines.indexOf('City total 3')).toBeLessThan(lines.indexOf('Region total 8 in 3'));
    });
});


describe('a nested table across page breaks', () => {
    const regions = ['North', 'South', 'East'];
    const cities = ['Oslo', 'Rome', 'Lima', 'Kyiv'];

    /** n rows, cycling regions and cities at different rates so groups vary in size */
    const big = (n) => ({
        items: Array.from({ length: n }, (_, i) => ({
            name: `r${i}`, qty: 1, price: 1,
            region: regions[i % regions.length],
            city: cities[Math.floor(i / 2) % cities.length]
        }))
    });

    /** what grouping should give, worked out separately */
    const expectedGroups = (payload) => {
        const out = new Map();
        for (const row of payload.items) {
            const key = `${row.region}/${row.city}`;
            if (!out.has(row.region)) out.set(row.region, new Map());
            const inRegion = out.get(row.region);
            if (!inRegion.has(row.city)) inRegion.set(row.city, []);
            inRegion.get(row.city).push(row.name);
            void key;
        }
        return out;
    };

    for (const n of [40, 75, 110, 160]) {
        describe(`${n} rows`, () => {
            const payload = big(n);
            const out = run(nested({ footer: true }), payload);

            it('places every row once, in group order', () => {
                const expected = [...expectedGroups(payload).values()]
                    .flatMap(inRegion => [...inRegion.values()].flat());

                expect(fragmentsOf(out).flatMap(f => f.rows.map(r => r.name))).toEqual(expected);
            });

            it('goes over more than one page', () => {
                expect(slices(out).length).toBeGreaterThan(1);
            });

            it('never places a fragment without a row', () => {
                expect(fragmentsOf(out).every(f => f.rows.length > 0)).toBe(true);
            });

            it("repeats every level's header on the first fragment of each page", () => {
                for (const slice of slices(out)) {
                    const [first] = slice.groups;

                    expect(levelsOfBands(first.headerBands)).toEqual([0, 1]);
                    expect(first.showHeader).toBe(true);
                    expect(textOf(first.headerBands[0])).toBe(`Region ${first.path[0]}`);
                }
            });

            it('prints each footer once, on the fragment that ends its group', () => {
                const groups = expectedGroups(payload);
                const footers = fragmentsOf(out).flatMap(f => f.footerBands);

                const cityCount = [...groups.values()].reduce((sum, m) => sum + m.size, 0);
                expect(footers.filter(b => b.level === 1)).toHaveLength(cityCount);
                expect(footers.filter(b => b.level === 0).map(textOf)).toEqual(
                    [...groups.values()].map(inRegion => {
                        const count = [...inRegion.values()].flat().length;
                        return `Region total ${count} in ${count}`;
                    }));
            });

            it('keeps every page clear of the page footer', () => {
                for (const page of out.pages) {
                    for (const detail of page.bands.filter(b => b.type === 'detail')) {
                        expect(detail.top + drawnBottom(detail)).toBeLessThanOrEqual(footerTop(page));
                    }
                }
            });

            it('sizes each slice as what it draws', () => {
                for (const slice of slices(out)) {
                    const drawn = slice.groups.reduce((sum, f) => {
                        const { headers, footers } = fragmentBandsOf(f);
                        return sum
                            + (f.showHeader ? 32 : 0)
                            + [...headers, ...footers].reduce((s, b) => s + b.measuredHeight, 0)
                            + f.rowHeights.reduce((s, h) => s + h, 0);
                    }, 0);

                    expect(slice.measuredHeight).toBe(drawn);
                }
            });
        });
    }
});


describe('exporting a nested table', () => {
    const pages = () => run(nested(), data()).pages;

    it('writes one group column per level, named after the fields', () => {
        const lines = toCSV(pages()).split('\r\n');

        expect(lines[0]).toBe('region,city,Item,Qty,Price');
        expect(lines[1]).toBe('North,Oslo,a,1,10');
        expect(lines.slice(1).map(l => l.split(',').slice(0, 2).join('/')))
            .toEqual(['North/Oslo', 'North/Oslo', 'North/Bergen', 'South/Rome', 'South/Rome', 'South/Oslo']);
    });

    it('names the group columns from a list', () => {
        expect(toCSV(pages(), { groupLabel: ['Region', 'City'] }).split('\r\n')[0])
            .toBe('Region,City,Item,Qty,Price');
    });

    it('keeps a one-level table to a single column named as before', () => {
        const lines = toCSV(run(nested({ levels: [regionLevel()] }), data()).pages).split('\r\n');

        expect(lines[0]).toBe('Group,Item,Qty,Price');
    });

    it('leaves the group columns out when asked', () => {
        expect(toCSV(pages(), { groupColumn: false }).split('\r\n')[0]).toBe('Item,Qty,Price');
    });

    it('writes a workbook', () => {
        expect(() => toXLSX(pages())).not.toThrow();
    });
});


describe('validating a nested grouping', () => {
    it('accepts three levels', () => {
        expect(validateLayout(nested({
            levels: [regionLevel(), cityLevel(), { by: 'name', header: groupBand([]), footer: null }]
        }))).toEqual([]);
    });

    it('checks every level, not only the first', () => {
        expect(validateLayout(nested({ levels: [regionLevel(), cityLevel({ by: '' })] })))
            .toEqual(['table "sales".grouping[1].by must be the name of the field to group by']);
    });
});


describe('sorting a level', () => {
    const sorted = (regionSort, citySort) => bound(nested({
        levels: [regionLevel({ sort: regionSort }), cityLevel({ sort: citySort })]
    })).groups.map(g => g.path.join('/'));

    it('keeps the order groups are first seen in without a sort', () => {
        expect(sorted(null, null)).toEqual(['North/Oslo', 'North/Bergen', 'South/Rome', 'South/Oslo']);
    });

    it('sorts each level on its own, inside its outer group', () => {
        expect(sorted('desc', 'asc')).toEqual(['South/Oslo', 'South/Rome', 'North/Bergen', 'North/Oslo']);
        expect(sorted(null, 'desc')).toEqual(['North/Oslo', 'North/Bergen', 'South/Rome', 'South/Oslo']);
    });

    it('sorts numbers as numbers and digits within words as numbers', () => {
        const payload = {
            items: ['10', '9', '100', 'Item 10', 'Item 9'].map((key, i) =>
                ({ name: `n${i}`, qty: 1, region: key, city: 'x' }))
        };
        const json = nested({ levels: [regionLevel({ sort: 'asc' }), cityLevel()] });

        expect(bound(json, payload).groups.map(g => g.key === 'x' && g.path[0]))
            .toEqual(['9', '10', '100', 'Item 9', 'Item 10']);
    });

    it('works out where outer groups start and end in the sorted order', () => {
        const groups = bound(nested({ levels: [regionLevel({ sort: 'desc' }), cityLevel({ sort: 'asc' })] })).groups;

        expect(groups.map(g => [g.opens, g.closes])).toEqual([[0, 1], [1, 0], [0, 1], [1, 0]]);
    });
});


describe('a new page for each group', () => {
    const pagesOf = (out) => slices(out).map(slice => slice.groups.map(g => g.path.join('/')));

    it('starts every region after the first on a page of its own', () => {
        const out = run(nested({ levels: [regionLevel({ newPage: true }), cityLevel()] }), data());

        expect(pagesOf(out)).toEqual([['North/Oslo', 'North/Bergen'], ['South/Rome', 'South/Oslo']]);
        expect(out.pages).toHaveLength(2);
    });

    it('starts every inner group on a page of its own', () => {
        const out = run(nested({ levels: [regionLevel(), cityLevel({ newPage: true })] }), data());

        expect(pagesOf(out)).toEqual([['North/Oslo'], ['North/Bergen'], ['South/Rome'], ['South/Oslo']]);
    });

    it('heads each new page with every level and the column labels', () => {
        const out = run(nested({ levels: [regionLevel(), cityLevel({ newPage: true })] }), data());

        for (const slice of slices(out)) {
            expect(levelsOfBands(slice.groups[0].headerBands)).toEqual([0, 1]);
            expect(slice.groups[0].showHeader).toBe(true);
        }
    });

    it('starts the first group where the table is, rather than on a page of its own', () => {
        const json = nested({ levels: [regionLevel({ newPage: true }), cityLevel()] });
        json.bands[0].items.unshift(text('intro', { y: 0 }));
        json.bands[0].items[1].y = 40;

        const out = run(json, data());

        expect(out.pages[0].bands.flatMap(b => b.items).map(i => i.id)).toEqual(['intro', 'sales']);
    });

    it('still splits a group that is longer than a page', () => {
        const payload = { items: Array.from({ length: 80 }, (_, i) =>
            ({ name: `r${i}`, qty: 1, region: i < 60 ? 'North' : 'South', city: 'x' })) };
        const out = run(nested({ levels: [regionLevel({ newPage: true }), cityLevel()], footer: true }), payload);

        const firstOf = slices(out).map(slice => slice.groups[0].path[0]);
        expect(firstOf.filter(r => r === 'North').length).toBeGreaterThan(1);
        expect(slices(out).find(s => s.groups[0].path[0] === 'South').groups.every(g => g.path[0] === 'South'))
            .toBe(true);
        expect(fragmentsOf(out).flatMap(f => f.rows)).toHaveLength(80);
    });
});


describe('validating level options and depth', () => {
    it('refuses a sort it does not know', () => {
        expect(validateLayout(nested({ levels: [regionLevel({ sort: 'up' }), cityLevel()] })))
            .toEqual(['table "sales".grouping[0].sort must be "asc" or "desc", or null to keep ' +
                'the groups in the order they are first seen']);
    });

    it('refuses a newPage that is not true or false', () => {
        expect(validateLayout(nested({ levels: [regionLevel(), cityLevel({ newPage: 'yes' })] })))
            .toEqual(['table "sales".grouping[1].newPage must be true or false']);
    });

    it('refuses more levels than a table may have', () => {
        const levels = Array.from({ length: MAX_GROUP_LEVELS + 1 }, (_, n) =>
            ({ by: `f${n}`, header: groupBand([]), footer: null }));

        expect(validateLayout(nested({ levels }))).toEqual([
            `table "sales".grouping has ${MAX_GROUP_LEVELS + 1} levels; a table may be grouped ` +
            `at ${MAX_GROUP_LEVELS} at most`
        ]);
    });
});

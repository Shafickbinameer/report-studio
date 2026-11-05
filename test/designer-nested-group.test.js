/**
 * @vitest-environment jsdom
 *
 * A table grouped within its groups, in the designer.
 *
 * Each level's bands are addressed by a key naming the level as well as the
 * table - `groupHeader@1:sales` - except the outermost, whose key is the one a
 * table grouped once has always had. What the engine does with the result is
 * in nested-group.test.js.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDesigner } from '../src/designer/designer.js';
import { validateLayout } from '../src/engine/validate.js';
import { buildPages } from '../src/engine/index.js';
import { tablesOf, MAX_GROUP_LEVELS } from '../src/engine/tables.js';
import { designZones } from '../src/designer/canvas.js';
import { designHeight, levelStrips, groupStrips } from '../src/designer/geometry.js';
import {
    groupBandKey, parseBandKey, bandLabel, groupBandAt, groupBandsIn, groupedTables,
    setGroupBy, setGroupBand, addGroupLevel, removeGroupLevel, moveGroupLevelOut,
    copyGroupDesign, setGroupOption
} from '../src/designer/grouping.js';
import { bandKeys, railBands, findBand, addItem, createText } from '../src/designer/structure.js';
import { bandChoices, findToken } from '../src/designer/tokens.js';
import { sampleData } from '../src/designer/sample-data.js';
import { layout, text, table, band } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    document.body.innerHTML = '<div id="report-designer"></div>';
});

let designer = null;
afterEach(() => {
    designer?.destroy();
    designer = null;
    vi.restoreAllMocks();
});


const groupBand = (items = [], height = 20) => ({ height, items });

/** sales, by region and within each region by city: 32px headings, three 28px rows */
const nested = () => layout({
    bands: [
        band('detail', [{
            ...table({ id: 'sales' }),
            dataset: 'sales',
            grouping: [
                {
                    by: 'region',
                    header: groupBand([text('rh', { value: 'Region {region}' })], 24),
                    footer: groupBand([text('rf', { value: 'Region {sum(qty)}' })], 22)
                },
                {
                    by: 'city',
                    header: groupBand([text('ch', { value: 'City {city}' })], 18),
                    footer: groupBand([text('cf', { value: 'City {sum(qty)}' })], 16)
                }
            ]
        }])
    ]
});

const sales = (l) => tablesOf(l).find(t => t.id === 'sales');

const zonesOf = (l) => Object.fromEntries(designZones(l).map(z => [z.type, z]));


describe('band keys for a level', () => {
    it('names an inner level in its key, and leaves the outermost as it was', () => {
        expect(groupBandKey('groupHeader', 'sales')).toBe('groupHeader:sales');
        expect(groupBandKey('groupHeader', 'sales', 0)).toBe('groupHeader:sales');
        expect(groupBandKey('groupFooter', 'sales', 2)).toBe('groupFooter@2:sales');
    });

    it('reads the level back, and an id with a colon whole', () => {
        expect(parseBandKey('groupFooter@2:sales')).toEqual({ kind: 'groupFooter', table: 'sales', level: 2 });
        expect(parseBandKey('groupHeader@1:a:b')).toEqual({ kind: 'groupHeader', table: 'a:b', level: 1 });
    });

    it('reads a malformed level as no group band', () => {
        for (const key of ['groupHeader@:x', 'groupHeader@0:x', 'groupHeader@a:x', 'groupHeader@1@2:x']) {
            expect(parseBandKey(key), key).toBeNull();
        }
    });

    it('says which level a band is where a person reads it', () => {
        expect(bandLabel('groupHeader:sales')).toBe('groupHeader · sales');
        expect(bandLabel('groupHeader@1:sales')).toBe('groupHeader 2 · sales');
    });

    it("finds each level's band by its key", () => {
        const l = nested();

        expect(groupBandAt(l, 'groupHeader:sales')).toBe(sales(l).grouping[0].header);
        expect(groupBandAt(l, 'groupFooter@1:sales')).toBe(sales(l).grouping[1].footer);
        expect(groupBandAt(l, 'groupFooter@2:sales')).toBeNull();
    });

    it('lists every band in the order a group draws them', () => {
        expect(groupBandsIn(nested()).map(g => g.key)).toEqual([
            'groupHeader:sales', 'groupHeader@1:sales', 'groupFooter@1:sales', 'groupFooter:sales'
        ]);
    });

    it('puts them in page order among the report bands, and on the rail', () => {
        const order = ['groupHeader:sales', 'groupHeader@1:sales', 'detail',
            'groupFooter@1:sales', 'groupFooter:sales'];

        expect(bandKeys(nested()).filter(k => order.includes(k))).toEqual(order);
        expect(railBands(nested()).filter(k => order.includes(k))).toEqual(order);
    });

    it('lists every level of a grouped table', () => {
        const [only] = groupedTables(nested());

        expect(only.by).toBe('region');
        expect(only.keys).toEqual(['groupHeader:sales', 'groupFooter:sales']);
        expect(only.levels.map(l => [l.by, l.keys])).toEqual([
            ['region', ['groupHeader:sales', 'groupFooter:sales']],
            ['city', ['groupHeader@1:sales', 'groupFooter@1:sales']]
        ]);
    });

    it('offers an inner level band for a group-scoped token', () => {
        const choices = bandChoices(nested(), findToken('sum'));

        expect(choices).toContain('groupFooter@1:sales');
        expect(choices).toContain('groupHeader@1:sales');
    });
});


describe('changing levels', () => {
    it('adds a level, with a header and no field yet', () => {
        const l = nested();

        expect(addGroupLevel(sales(l))).toBe(2);
        expect(sales(l).grouping[2]).toMatchObject({ by: '', footer: null, header: { items: [] } });
    });

    it('will not add a level to a table that is not grouped', () => {
        const plain = table({ id: 'x' });

        expect(addGroupLevel(plain)).toBe(-1);
        expect(plain.grouping).toBeUndefined();
    });

    it("labels a new level's header with its field once it has one", () => {
        const l = nested();
        const n = addGroupLevel(sales(l));

        setGroupBy(sales(l), 'n', n);
        setGroupBy(sales(l), 'name', n);

        expect(sales(l).grouping[n].by).toBe('name');
        expect(sales(l).grouping[n].header.items.map(i => i.value)).toEqual(['{name}']);
    });

    it('renames an inner level, and its placeholders', () => {
        const l = nested();

        expect(setGroupBy(sales(l), 'town', 1)).toBe(true);
        expect(sales(l).grouping[1].by).toBe('town');
        expect(sales(l).grouping[1].header.items[0].value).toBe('City {town}');
        expect(sales(l).grouping[0].by).toBe('region');
    });

    it('keeps an inner level whose field is emptied, rather than the box being typed in', () => {
        const l = nested();

        setGroupBy(sales(l), '', 1);

        expect(sales(l).grouping).toHaveLength(2);
        expect(sales(l).grouping[1].by).toBe('');
    });

    it('removes a level, moving the ones inside it out', () => {
        const l = nested();
        addGroupLevel(sales(l), 'name');

        expect(removeGroupLevel(sales(l), 1)).toBe(true);
        expect(sales(l).grouping.map(g => g.by)).toEqual(['region', 'name']);
    });

    it('ungroups the table when its only level is removed', () => {
        const l = nested();
        removeGroupLevel(sales(l), 1);
        removeGroupLevel(sales(l), 0);

        expect(sales(l).grouping).toBeUndefined();
    });

    it('swaps a level with the one outside it, each keeping its bands', () => {
        const l = nested();
        const [region, city] = sales(l).grouping;

        expect(moveGroupLevelOut(sales(l), 1)).toBe(true);
        expect(sales(l).grouping).toEqual([city, region]);
        expect(moveGroupLevelOut(sales(l), 0)).toBe(false);
    });

    it('switches an inner level band on and off', () => {
        const l = nested();

        expect(setGroupBand(l, 'groupFooter@1:sales', false)).toBe(true);
        expect(sales(l).grouping[1].footer).toBeNull();
        expect(setGroupBand(l, 'groupFooter@1:sales', true)).toMatchObject({ type: 'groupFooter' });
    });

    it('brings every level back when Group by is cleared and retyped', () => {
        const l = nested();

        setGroupBy(sales(l), '');
        expect(sales(l).grouping).toBeUndefined();

        setGroupBy(sales(l), 'area');
        expect(sales(l).grouping.map(g => g.by)).toEqual(['area', 'city']);
        expect(sales(l).grouping[0].header.items[0].value).toBe('Region {area}');
    });

    it('copies every level both tables have', () => {
        const l = nested();
        const other = {
            ...table({ id: 'other', y: 300 }), dataset: 'other',
            grouping: [{ by: 'a', header: groupBand(), footer: null }, { by: 'b', header: null, footer: groupBand() }]
        };
        l.bands[0].items.push(other);

        expect(copyGroupDesign(l, 'other', 'sales')).toBe(true);
        expect(other.grouping[1].header.items[0].value).toBe('City {b}');
        expect(other.grouping[0].footer.items[0].value).toBe('Region {sum(qty)}');
    });

    it('puts an item onto an inner level band', () => {
        const l = nested();
        const made = addItem(l, 'groupFooter@1:sales', createText(l, 'groupFooter@1:sales'));

        expect(made).not.toBeNull();
        expect(findBand(l, 'groupFooter@1:sales').items).toContain(made);
    });
});


describe('the canvas, with a nested table', () => {
    it('stacks the headers outermost first under the headings, and the footers innermost first under the rows', () => {
        const zones = zonesOf(nested());
        const top = zones.detail.top;

        expect(zones['groupHeader:sales']).toMatchObject({ top: top + 32, height: 24 });
        expect(zones['groupHeader@1:sales']).toMatchObject({ top: top + 32 + 24, height: 18 });
        expect(zones['groupFooter@1:sales']).toMatchObject({ top: top + 32 + 24 + 18 + 84, height: 16 });
        expect(zones['groupFooter:sales']).toMatchObject({ top: top + 32 + 24 + 18 + 84 + 16, height: 22 });
    });

    it('makes the table as tall as every strip it draws', () => {
        const plain = designHeight({ ...sales(nested()), grouping: undefined });

        expect(designHeight(sales(nested()))).toBe(plain + 24 + 18 + 16 + 22);
    });

    it('lists each strip with its level, and keeps the outermost where groupStrips said', () => {
        const strips = levelStrips(sales(nested()));

        expect(strips.map(s => [s.kind, s.level])).toEqual([
            ['groupHeader', 0], ['groupHeader', 1], ['groupFooter', 1], ['groupFooter', 0]
        ]);
        expect(groupStrips(sales(nested()))).toEqual({
            groupHeader: { y: 32, h: 24 },
            groupFooter: { y: 32 + 24 + 18 + 84 + 16, h: 22 }
        });
    });
});


describe('sample data, for a nested table', () => {
    it('gives every outer group more than one inner group', () => {
        const data = sampleData(nested());
        const regions = new Map();

        for (const row of data.sales) {
            if (!regions.has(row.region)) regions.set(row.region, new Set());
            regions.get(row.region).add(row.city);
        }

        expect(regions.size).toBeGreaterThan(1);
        for (const cities of regions.values()) expect(cities.size).toBeGreaterThan(1);
    });

    it('builds a report from its own sample', () => {
        const l = nested();
        expect(validateLayout(l)).toEqual([]);
        expect(() => buildPages(l, sampleData(l))).not.toThrow();
    });
});


describe('the designer, grouping a table within its groups', () => {
    const root = () => document.getElementById('report-designer');
    const panel = () => root().querySelector('.dz-panel');

    function mount(l = nested()) {
        designer = createDesigner({ mount: '#report-designer', layout: l });
        designer.select({ band: 'detail', id: 'sales' });
        return designer;
    }

    const press = (action, level) => {
        const selector = level == null
            ? `[data-action="${action}"]`
            : `[data-action="${action}"][data-level="${level}"]`;
        panel().querySelector(selector).click();
    };

    const levelBox = (n) => panel().querySelector(`[data-group-level="${n}"]`);

    it('shows a section per level, with the field of each inner one', () => {
        mount();

        expect(panel().querySelectorAll('.dz-group-level')).toHaveLength(2);
        expect(levelBox(1).value).toBe('city');
        expect(levelBox(0)).toBeNull();
    });

    it('shows a table grouped once as it always has', () => {
        const l = nested();
        sales(l).grouping.pop();
        mount(l);

        expect(panel().querySelectorAll('.dz-group-level')).toHaveLength(0);
        expect(panel().querySelector('[data-band="groupHeader:sales"]')).not.toBeNull();
    });

    it('adds a level from the rail, and draws its band', () => {
        const d = mount();

        press('add-group-level');

        expect(sales(d.layout).grouping).toHaveLength(3);
        expect(root().querySelector('[data-band-type="groupHeader@2:sales"]')).not.toBeNull();
        expect(levelBox(2)).not.toBeNull();
    });

    it('sets an inner level field from its box', () => {
        const d = mount();

        levelBox(1).value = 'town';
        levelBox(1).dispatchEvent(new Event('input', { bubbles: true }));

        expect(sales(d.layout).grouping[1].by).toBe('town');
    });

    it('removes a level from the rail, and its band from the canvas', () => {
        const d = mount();

        press('remove-group-level', 1);

        expect(sales(d.layout).grouping.map(g => g.by)).toEqual(['region']);
        expect(root().querySelector('[data-band-type="groupHeader@1:sales"]')).toBeNull();
    });

    it('moves a level out from the rail', () => {
        const d = mount();

        press('move-group-level-out', 1);

        expect(sales(d.layout).grouping.map(g => g.by)).toEqual(['city', 'region']);
    });

    it('switches an inner level band from its own rail row', () => {
        const d = mount();
        const node = panel().querySelector('[data-band="groupFooter@1:sales"]');

        node.checked = false;
        node.dispatchEvent(new Event('change', { bubbles: true }));

        expect(sales(d.layout).grouping[1].footer).toBeNull();
    });

    it('undoes a new level', () => {
        const d = mount();

        press('add-group-level');
        root().querySelector('[data-action="undo"]').click();

        expect(sales(d.layout).grouping).toHaveLength(2);
    });
});


describe('ordering and placing a level’s groups', () => {
    it('sets and clears a sort, leaving none in the file', () => {
        const l = nested();

        expect(setGroupOption(sales(l), 1, 'sort', 'desc')).toBe(true);
        expect(sales(l).grouping[1].sort).toBe('desc');
        expect(setGroupOption(sales(l), 1, 'sort', 'desc')).toBe(false);

        expect(setGroupOption(sales(l), 1, 'sort', '')).toBe(true);
        expect(sales(l).grouping[1]).not.toHaveProperty('sort');
    });

    it('takes no sort it does not know', () => {
        const l = nested();

        expect(setGroupOption(sales(l), 0, 'sort', 'sideways')).toBe(false);
        expect(sales(l).grouping[0]).not.toHaveProperty('sort');
    });

    it('sets and clears newPage, leaving false out of the file', () => {
        const l = nested();

        expect(setGroupOption(sales(l), 0, 'newPage', true)).toBe(true);
        expect(sales(l).grouping[0].newPage).toBe(true);
        expect(setGroupOption(sales(l), 0, 'newPage', false)).toBe(true);
        expect(sales(l).grouping[0]).not.toHaveProperty('newPage');
    });

    it('stops adding levels at the most a table may have', () => {
        const l = nested();
        while (addGroupLevel(sales(l), `f${sales(l).grouping.length}`) !== -1) { /* fill */ }

        expect(sales(l).grouping).toHaveLength(MAX_GROUP_LEVELS);
        expect(validateLayout(l)).toEqual([]);
    });
});


describe('the designer, ordering and placing groups', () => {
    const root = () => document.getElementById('report-designer');
    const panel = () => root().querySelector('.dz-panel');

    function mount(l = nested()) {
        designer = createDesigner({ mount: '#report-designer', layout: l });
        designer.select({ band: 'detail', id: 'sales' });
        return designer;
    }

    const option = (name, level) =>
        panel().querySelector(`[data-group-option="${name}"][data-level="${level}"]`);

    it('offers both options on every level, a table grouped once included', () => {
        const once = nested();
        sales(once).grouping.pop();
        mount(once);

        expect(option('sort', 0)).not.toBeNull();
        expect(option('newPage', 0)).not.toBeNull();
    });

    it('sorts a level from its rail', () => {
        const d = mount();

        option('sort', 1).value = 'asc';
        option('sort', 1).dispatchEvent(new Event('change', { bubbles: true }));

        expect(sales(d.layout).grouping[1].sort).toBe('asc');
    });

    it('starts each group on a new page from its rail', () => {
        const d = mount();

        option('newPage', 0).checked = true;
        option('newPage', 0).dispatchEvent(new Event('change', { bubbles: true }));

        expect(sales(d.layout).grouping[0].newPage).toBe(true);
    });

    it('shows what the level says', () => {
        const l = nested();
        Object.assign(sales(l).grouping[1], { sort: 'desc', newPage: true });
        mount(l);

        expect(option('sort', 1).value).toBe('desc');
        expect(option('newPage', 1).checked).toBe(true);
    });

    it('stops offering another level at the most a table may have', () => {
        const l = nested();
        while (addGroupLevel(sales(l), `f${sales(l).grouping.length}`) !== -1) { /* fill */ }
        mount(l);

        expect(panel().querySelector('[data-action="add-group-level"]')).toBeNull();
    });
});

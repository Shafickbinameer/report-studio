/**
 * @vitest-environment jsdom
 *
 * Grouping several tables, in the designer.
 *
 * Each grouped table carries its own group header and footer. The designer
 * addresses them by a key naming the table - `groupHeader:refunds` - so the
 * selection, the canvas, the band rail and every structure.js call keep taking
 * one string. What the engine does with the result is in multi-group.test.js.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDesigner } from '../src/designer/designer.js';
import { validateLayout } from '../src/engine/validate.js';
import { buildPages } from '../src/engine/index.js';
import { tablesOf } from '../src/engine/tables.js';
import {
    designZones, drawSheet, selectionBox, bandBox, bandUnder, bandAtOffset
} from '../src/designer/canvas.js';
import { designHeight } from '../src/designer/geometry.js';
import { guidesInBand } from '../src/designer/rulers.js';
import {
    groupBandKey, parseBandKey, kindOf, bandLabel, isGroupKind, groupBandAt,
    setGroupBy, setGroupBand, copyGroupDesign, needsNormalizing, openLayout
} from '../src/designer/grouping.js';
import {
    findBand, bandKeys, railBands, addItem, moveItemToBand, pasteItems,
    duplicateItem, targetBand, nextItemId, addBand, removeBand, createText
} from '../src/designer/structure.js';
import {
    bandChoices, defaultBand, aggregateScope, resolvesIn, findToken, availableFields
} from '../src/designer/tokens.js';
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

const orders = (grouping) => ({
    ...table({ id: 'orders', y: 0 }), dataset: 'orders', ...(grouping ? { grouping } : {})
});

const refunds = (grouping) => ({
    ...table({ id: 'refunds', y: 200 }), dataset: 'refunds', ...(grouping ? { grouping } : {})
});

/** two tables, each grouped by a field of its own with a design of its own */
const twoGrouped = () => layout({
    bands: [
        band('pageHeader', [], { height: 40 }),
        band('detail', [
            orders([{
                by: 'region',
                header: groupBand([text('oh', { value: 'Region {region}' })], 24),
                footer: groupBand([text('of', { value: 'Orders {sum(qty)}' })], 20)
            }]),
            refunds([{
                by: 'reason',
                header: groupBand([text('rh', { value: 'Reason {reason}' })], 30),
                footer: null
            }])
        ]),
        band('pageFooter', [], { height: 40 })
    ]
});

const twoPlain = () => layout({
    bands: [
        band('pageHeader', [], { height: 40 }),
        band('detail', [orders(), refunds()])
    ]
});

const tableOf = (l, id) => tablesOf(l).find(t => t.id === id);

/**
 * Every zone on the design page, by key. The fixture's tables have 32px
 * headings and three 28px sample rows; orders has a 24px group header and a
 * 20px footer, refunds a 30px header and no footer.
 */
const zonesOf = (l) => Object.fromEntries(designZones(l).map(z => [z.type, z]));


describe('band keys', () => {
    it("names a table's group band by its kind and its table", () => {
        expect(groupBandKey('groupFooter', 'refunds')).toBe('groupFooter:refunds');
        expect(parseBandKey('groupFooter:refunds')).toEqual({ kind: 'groupFooter', table: 'refunds', level: 0 });
    });

    it('splits at the first colon only, so an id may hold one', () => {
        expect(parseBandKey('groupHeader:a:b')).toEqual({ kind: 'groupHeader', table: 'a:b', level: 0 });
    });

    it('reads any other key as no group band', () => {
        expect(parseBandKey('detail')).toBeNull();
        expect(parseBandKey('detail:orders')).toBeNull();
        expect(parseBandKey(null)).toBeNull();
    });

    it('gives the kind of a key, which is its type for a report band', () => {
        expect(kindOf('groupHeader:orders')).toBe('groupHeader');
        expect(kindOf('pageFooter')).toBe('pageFooter');
        expect(isGroupKind('groupFooter:x')).toBe(true);
        expect(isGroupKind('groupFooter')).toBe(true);
        expect(isGroupKind('detail')).toBe(false);
    });

    it('labels a group band with its table', () => {
        expect(bandLabel('groupHeader:refunds')).toBe('groupHeader · refunds');
        expect(bandLabel('detail')).toBe('detail');
    });

    it('finds the band behind a key', () => {
        const l = twoGrouped();

        expect(groupBandAt(l, 'groupHeader:refunds').items[0].id).toBe('rh');
        expect(groupBandAt(l, 'groupFooter:refunds')).toBeNull();
        expect(groupBandAt(l, 'groupHeader:nobody')).toBeNull();
        expect(findBand(l, 'groupFooter:orders').items[0].id).toBe('of');
        expect(findBand(l, 'detail').type).toBe('detail');
    });
});


describe('setting a table’s Group by', () => {
    it('groups a table, with a header that shows the group', () => {
        const t = table();

        expect(setGroupBy(t, 'region')).toBe(true);
        expect(t.grouping).toHaveLength(1);
        expect(t.grouping[0].by).toBe('region');
        expect(t.grouping[0].header.type).toBe('groupHeader');
        expect(t.grouping[0].header.items[0].value).toBe('{region}');
        expect(t.grouping[0].footer).toBeNull();
    });

    it("regroups by another field, and its bands' {old} become {new}", () => {
        const t = table();
        setGroupBy(t, 'r');
        t.grouping[0].footer = groupBand([text('f', { value: 'Total for {r}: {sum(qty)}' })]);

        setGroupBy(t, 'region');

        expect(t.grouping[0].by).toBe('region');
        expect(t.grouping[0].header.items[0].value).toBe('{region}');
        expect(t.grouping[0].footer.items[0].value).toBe('Total for {region}: {sum(qty)}');
    });

    it('ungroups a table when cleared', () => {
        const t = table();
        setGroupBy(t, 'region');

        expect(setGroupBy(t, null)).toBe(true);
        expect(t).not.toHaveProperty('grouping');
        expect(setGroupBy(t, null)).toBe(false);
    });

    it('gives back the design a cleared box took, when a field is typed again', () => {
        const t = table();
        setGroupBy(t, 'region');
        t.grouping[0].header.items.push(text('extra', { value: 'Hello {region}' }));

        setGroupBy(t, '');
        setGroupBy(t, 'area');

        expect(t.grouping[0].by).toBe('area');
        expect(t.grouping[0].header.items.map(i => i.value)).toEqual(['{area}', 'Hello {area}']);
    });

    it('takes an older groupBy off the table it replaces', () => {
        const t = { ...table(), groupBy: 'old' };
        setGroupBy(t, 'region');

        expect(t).not.toHaveProperty('groupBy');
    });

    it('changes nothing for the field it already has', () => {
        const t = table();
        setGroupBy(t, 'region');

        expect(setGroupBy(t, 'region')).toBe(false);
    });
});


describe("a table's group bands, on and off", () => {
    it('switches one on, at the size a new band starts at', () => {
        const l = twoGrouped();
        const made = setGroupBand(l, 'groupFooter:refunds', true);

        expect(made).toMatchObject({ type: 'groupFooter', height: 36, items: [] });
        expect(findBand(l, 'groupFooter:refunds')).toBe(made);
        expect(setGroupBand(l, 'groupFooter:refunds', true)).toBe(false);
    });

    it('switches one off, the last one included - the problem is then said', () => {
        const l = twoGrouped();

        expect(removeBand(l, 'groupHeader:refunds')).toBe(true);
        expect(validateLayout(l).join()).toMatch(/neither a header nor a footer/);
    });

    it('does nothing for a table that is not grouped', () => {
        expect(setGroupBand(twoPlain(), 'groupHeader:orders', true)).toBe(false);
        expect(addBand(twoPlain(), 'groupHeader:orders')).toBeNull();
    });
});


describe('copying a group design between tables', () => {
    it("gives one table copies of the other's header and footer", () => {
        const l = twoGrouped();

        expect(copyGroupDesign(l, 'refunds', 'orders')).toBe(true);

        const [mine, theirs] = [tableOf(l, 'refunds').grouping[0], tableOf(l, 'orders').grouping[0]];

        expect(mine.by).toBe('reason');
        expect(mine.header).not.toBe(theirs.header);
        expect(mine.header.items[0].value).toBe('Region {reason}');
        expect(mine.footer.items[0].value).toBe('Orders {sum(qty)}');
    });

    it('copies onto a grouped table only', () => {
        const l = twoGrouped();
        delete tableOf(l, 'refunds').grouping;

        expect(copyGroupDesign(l, 'refunds', 'orders')).toBe(false);
        expect(copyGroupDesign(l, 'orders', 'orders')).toBe(false);
    });
});


describe('opening a layout grouped the older way', () => {
    const older = () => layout({
        groupBy: 'region',
        bands: [
            band('groupHeader', [text('gh', { value: '{region}' })], { height: 24 }),
            band('detail', [table({ id: 'tbl' })])
        ]
    });

    it('moves the grouping onto its table', () => {
        const opened = openLayout(older());

        expect(needsNormalizing(older())).toBe(true);
        expect(opened.bands.map(b => b.type)).toEqual(['detail']);
        expect(tableOf(opened, 'tbl').grouping[0].header.items[0].id).toBe('gh');
    });

    it("hands back the host's own object when there is nothing to move", () => {
        const l = twoGrouped();

        expect(needsNormalizing(l)).toBe(false);
        expect(openLayout(l)).toBe(l);
    });

    it('keeps a report group band nothing is grouped by, for its author to remove', () => {
        const l = layout({ bands: [band('detail', [table()]), band('groupFooter', [])] });

        expect(openLayout(l)).toBe(l);
        expect(railBands(l)).toContain('groupFooter');
    });
});


describe('structure, with group band keys', () => {
    it('lists the bands in page order, each table’s group bands with their kind', () => {
        expect(bandKeys(twoGrouped())).toEqual([
            'pageHeader', 'groupHeader:orders', 'groupHeader:refunds',
            'detail', 'groupFooter:orders', 'pageFooter'
        ]);
    });

    it('offers both group bands of every grouped table in the rail, on or off', () => {
        expect(railBands(twoGrouped())).toEqual([
            'pageHeader', 'reportHeader', 'groupHeader:orders', 'groupHeader:refunds',
            'detail', 'groupFooter:orders', 'groupFooter:refunds', 'reportFooter', 'pageFooter'
        ]);
    });

    it('puts an item on a table’s group band', () => {
        const l = twoGrouped();
        const item = createText(l, findBand(l, 'groupFooter:orders'));

        expect(addItem(l, 'groupFooter:orders', item)).toBe(item);
        expect(findBand(l, 'groupFooter:orders').items).toContain(item);
    });

    it('never puts a table on a group band', () => {
        const l = twoGrouped();

        expect(addItem(l, 'groupHeader:orders', table({ id: 'inner' }))).toBeNull();
        expect(moveItemToBand(l, 'detail', 'groupHeader:orders', 'refunds')).toBe(false);
        expect(pasteItems(l, 'groupHeader:orders', [{ band: 'detail', item: table({ id: 'x' }) }]))
            .toEqual([]);
    });

    it('moves an item into a table’s group band, keeping where it looks', () => {
        const l = twoGrouped();
        l.bands[1].items.push(text('loose', { y: 300 }));

        expect(moveItemToBand(l, 'detail', 'groupFooter:orders', 'loose')).toBe(true);
        expect(findBand(l, 'groupFooter:orders').items.map(i => i.id)).toContain('loose');
    });

    it('sends a new table to the detail band when a group band is selected', () => {
        const l = twoGrouped();
        const selection = { band: 'groupHeader:orders', id: 'oh' };

        expect(targetBand(l, selection)).toBe('groupHeader:orders');
        expect(targetBand(l, selection, { table: true })).toBe('detail');
    });

    it('counts ids on group bands when choosing a new one', () => {
        const l = twoGrouped();
        findBand(l, 'groupHeader:orders').items.push(text('text-1'));

        expect(nextItemId(l, 'text')).toBe('text-2');
    });

    it('copies a grouped table with its own grouping', () => {
        const l = twoGrouped();
        const copy = duplicateItem(l, 'detail', 'orders');

        expect(copy.grouping[0].by).toBe('region');
        expect(copy.grouping[0].header).not.toBe(tableOf(l, 'orders').grouping[0].header);
        expect(validateLayout(l)).toEqual([]);
    });
});


describe('the canvas, with several grouped tables', () => {
    it("draws each table's group bands inside it - after the headings, and after the rows", () => {
        const zones = zonesOf(twoGrouped());
        const detail = zones.detail;

        expect(zones['groupHeader:orders']).toMatchObject({ top: detail.top + 32, height: 24 });
        expect(zones['groupFooter:orders']).toMatchObject({ top: detail.top + 32 + 24 + 84, height: 20 });
        expect(zones['groupHeader:refunds']).toMatchObject({ top: detail.top + 200 + 32, height: 30 });
        expect(zones['groupFooter:refunds']).toBeUndefined();
    });

    it('leaves the detail band its whole region - nothing is stacked above or below it', () => {
        const ungrouped = twoGrouped();
        for (const t of tablesOf(ungrouped)) delete t.grouping;

        const grouped = zonesOf(twoGrouped()).detail;
        const plain = zonesOf(ungrouped).detail;

        expect(grouped.top).toBe(plain.top);
        expect(grouped.height).toBe(plain.height);
    });

    it('makes a group band as wide as its table, and starts it where the table starts', () => {
        const l = twoGrouped();
        Object.assign(tableOf(l, 'orders'), { x: 40, w: 300 });

        const zones = zonesOf(l);

        expect(zones['groupHeader:orders']).toMatchObject({ left: 40, width: 300 });
        expect(zones['groupFooter:orders']).toMatchObject({ left: 40, width: 300 });
        expect(zones.detail).toMatchObject({ left: 0, width: 714 });
    });

    it('moves the group bands with their table', () => {
        const l = twoGrouped();
        const before = zonesOf(l)['groupHeader:orders'].top;

        tableOf(l, 'orders').y = 50;

        expect(zonesOf(l)['groupHeader:orders'].top).toBe(before + 50);
    });

    it('starts the group header at the top of a table with no headings', () => {
        const l = twoGrouped();
        tableOf(l, 'orders').showHeader = false;

        const zones = zonesOf(l);
        expect(zones['groupHeader:orders'].top).toBe(zones.detail.top);
        expect(zones['groupFooter:orders'].top).toBe(zones.detail.top + 24 + 84);
    });

    it('draws a grouped table one group tall, its group bands included', () => {
        const l = twoGrouped();

        expect(designHeight(tableOf(l, 'orders'))).toBe(32 + 84 + 24 + 20);
        expect(designHeight(tableOf(l, 'refunds'))).toBe(32 + 84 + 30);
        expect(designHeight(tableOf(twoPlain(), 'orders'))).toBe(32 + 84);
    });

    it('puts the group zones over the band, so a click on one reaches it', () => {
        const types = designZones(twoGrouped()).map(z => z.type);

        expect(types.indexOf('groupHeader:orders')).toBeGreaterThan(types.indexOf('detail'));
    });

    it("labels a table's group zone with its table", () => {
        const zone = designZones(twoGrouped()).find(z => z.type === 'groupHeader:refunds');

        expect(zone).toMatchObject({ kind: 'groupHeader', table: 'refunds', label: 'groupHeader · refunds' });
    });

    it('draws each group band at its place in the table, with its name in the gutter', () => {
        const l = twoGrouped();
        Object.assign(tableOf(l, 'orders'), { x: 40, w: 300 });

        document.body.innerHTML = drawSheet(l);

        const zone = document.querySelector('[data-band-type="groupHeader:orders"]');
        const margin = l.page.margin;

        expect(zone.style.left).toBe(`${40 + margin.left}px`);
        expect(zone.style.width).toBe('300px');
        expect(zone.textContent).toContain('Region {region}');
        expect(document.querySelector('[data-band-tag="groupHeader:refunds"]').textContent)
            .toBe('groupHeader · refunds');
    });

    it('leaves a row in the drawn table for each group band, at its height', () => {
        document.body.innerHTML = drawSheet(twoGrouped());

        const table = document.querySelector('table[data-item-id="orders"]');

        expect(table.querySelector('.group-header .band').style.height).toBe('24px');
        expect(table.querySelector('.group-footer .band').style.height).toBe('20px');
        expect(table.querySelectorAll('tbody > tr:not(.group-header):not(.group-footer)'))
            .toHaveLength(3);
        /** the bands' items are drawn on their zones, never twice */
        expect(table.textContent).not.toContain('Region {region}');
    });

    it('outlines an item on a group band where it is drawn', () => {
        const l = twoGrouped();
        Object.assign(tableOf(l, 'orders'), { x: 40, w: 300 });

        const zone = zonesOf(l)['groupHeader:orders'];
        const { box } = selectionBox(l, { band: 'groupHeader:orders', id: 'oh' });

        expect(box.x).toBe(40 + l.page.margin.left);
        expect(box.y).toBe(zone.top + l.page.margin.top);
    });

    it('measures guides inside a group band from where it starts', () => {
        const l = twoGrouped();
        Object.assign(tableOf(l, 'orders'), { x: 40, w: 300 });

        const box = bandBox(l, 'groupHeader:orders');

        expect(box).toMatchObject({ w: 300, h: 24, originX: 40, left: 40 + l.page.margin.left });
        expect(guidesInBand({ guides: { x: [100, 500] } }, box).x).toEqual([60]);
    });

    it('still stacks a report group band from a layout in the older form', () => {
        const l = layout({
            bands: [band('groupHeader', [], { height: 20 }), band('detail', [table()])]
        });

        const zones = zonesOf(l);

        expect(designZones(l).map(z => z.type)).toEqual(['groupHeader', 'detail']);
        expect(zones.detail.top).toBe(zones.groupHeader.top + 20);
    });
});


describe('dropping onto a table’s group band', () => {
    /** orders' group header runs from 32 to 56 down the detail band */
    const withLoose = (x, y, extra = {}) => {
        const l = twoGrouped();
        Object.assign(tableOf(l, 'orders'), { x: 40, w: 300 });
        l.bands[1].items.push(text('loose', { x, y, w: 100, ...extra }));
        return l;
    };

    const loose = (l, where = 'detail') => findBand(l, where).items.find(i => i.id === 'loose');

    it('lands an item whose corner is over the group band in it', () => {
        const l = withLoose(60, 40);

        expect(bandUnder(l, 'detail', loose(l))).toBe('groupHeader:orders');
    });

    it('leaves an item beside the table, level with its group band, on the band', () => {
        const l = withLoose(400, 40);

        expect(bandUnder(l, 'detail', loose(l))).toBe('detail');
    });

    it('never lands a table on a group band, its own included', () => {
        const l = twoGrouped();
        tableOf(l, 'orders').showHeader = false;

        expect(bandUnder(l, 'detail', tableOf(l, 'orders'))).toBe('detail');
        expect(bandUnder(l, 'detail', { type: 'table', x: 0, y: 240 })).toBe('detail');
    });

    it('finds the band under a point by where it is across the page, too', () => {
        const l = withLoose(0, 0);
        const top = zonesOf(l)['groupHeader:orders'].top + 4;

        expect(bandAtOffset(l, top, 50)).toBe('groupHeader:orders');
        expect(bandAtOffset(l, top, 500)).toBe('detail');
        /** without an x, only the bands that run the page's width are in it */
        expect(bandAtOffset(l, top)).toBe('detail');
    });

    it('keeps where the item looks, on both axes, when it moves in', () => {
        const l = withLoose(60, 40);

        expect(moveItemToBand(l, 'detail', 'groupHeader:orders', 'loose')).toBe(true);

        const moved = loose(l, 'groupHeader:orders');
        expect(moved).toMatchObject({ x: 20, y: 8 });
    });

    it('and when it moves back out', () => {
        const l = twoGrouped();
        Object.assign(tableOf(l, 'orders'), { x: 40, w: 300 });

        expect(moveItemToBand(l, 'groupHeader:orders', 'detail', 'oh')).toBe(true);
        expect(findBand(l, 'detail').items.find(i => i.id === 'oh')).toMatchObject({ x: 40, y: 32 });
    });
});


describe('the field tool, with several grouped tables', () => {
    const sum = findToken('sum');

    it('offers each table’s group bands as places to put a total', () => {
        expect(bandChoices(twoGrouped(), sum)).toEqual([
            'pageHeader', 'groupHeader:orders', 'groupHeader:refunds',
            'detail', 'groupFooter:orders', 'pageFooter'
        ]);
    });

    it('puts a subtotal in the footer of the table being worked on', () => {
        const l = twoGrouped();
        setGroupBand(l, 'groupFooter:refunds', true);

        expect(defaultBand(l, sum)).toBe('groupFooter:orders');
        expect(defaultBand(l, sum, 'groupFooter:refunds')).toBe('groupFooter:refunds');
    });

    it("says a table's group band totals one group", () => {
        expect(aggregateScope(sum, 'groupFooter:refunds')).toBe('group');
        expect(aggregateScope(sum, 'detail')).toBe('report');
        expect(resolvesIn(findToken('page'), 'groupFooter:refunds')).toBe(true);
    });

    it('offers every field a table is grouped by', () => {
        expect(availableFields(twoGrouped())).toEqual(expect.arrayContaining(['region', 'reason']));
    });
});


describe('sample data, with several grouped tables', () => {
    it("repeats each table's own group field, over its own dataset", () => {
        const data = sampleData(twoGrouped());

        expect(new Set(data.orders.map(r => r.region)).size).toBe(2);
        expect(new Set(data.refunds.map(r => r.reason)).size).toBe(2);
        expect(data.orders[0]).not.toHaveProperty('reason');
        expect(data.refunds[0]).not.toHaveProperty('region');
    });

    it("gives a table's rows the fields its own group bands print", () => {
        const l = twoGrouped();
        findBand(l, 'groupHeader:refunds').items.push(text('note', { value: '{approver}' }));

        const data = sampleData(l);

        expect(data.refunds[0]).toHaveProperty('approver');
        expect(data.orders[0]).not.toHaveProperty('approver');
        expect(data).not.toHaveProperty('approver');
    });

    it('builds a report from its own sample data', () => {
        const l = twoGrouped();
        expect(() => buildPages(l, sampleData(l))).not.toThrow();
    });
});


describe('the designer, grouping two tables', () => {
    const root = () => document.getElementById('report-designer');
    const panel = () => root().querySelector('.dz-panel');

    function mount(l = twoPlain()) {
        designer = createDesigner({ mount: '#report-designer', layout: l });
        return designer;
    }

    const groupByBox = () => panel().querySelector('[data-field="groupBy"]');

    function typeGroupBy(value) {
        const box = groupByBox();
        box.focus();
        box.value = value;
        box.setSelectionRange?.(value.length, value.length);
        box.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const flip = (key, on) => {
        const node = panel().querySelector(`[data-band="${key}"]`);
        node.checked = on;
        node.dispatchEvent(new Event('change', { bubbles: true }));
    };

    it('groups the selected table from its Group by', () => {
        const d = mount();
        d.select({ band: 'detail', id: 'refunds' });

        typeGroupBy('reason');

        expect(tableOf(d.layout, 'refunds').grouping[0].by).toBe('reason');
        expect(tableOf(d.layout, 'orders').grouping).toBeUndefined();
        expect(validateLayout(d.layout)).toEqual([]);
    });

    it('draws the new group header on the canvas, named for its table', () => {
        const d = mount();
        d.select({ band: 'detail', id: 'refunds' });

        typeGroupBy('reason');

        expect(root().querySelector('[data-band-type="groupHeader:refunds"]')).not.toBeNull();
        expect(root().querySelector('[data-band-tag="groupHeader:refunds"]').textContent)
            .toBe('groupHeader · refunds');
    });

    it('keeps the cursor in Group by while the rail grows its grouping controls', () => {
        const d = mount();
        d.select({ band: 'detail', id: 'refunds' });

        typeGroupBy('r');

        expect(panel().querySelector('.dz-grouping')).not.toBeNull();
        expect(document.activeElement).toBe(groupByBox());

        typeGroupBy('reason');

        expect(tableOf(d.layout, 'refunds').grouping[0].by).toBe('reason');
        expect(tableOf(d.layout, 'refunds').grouping[0].header.items[0].value).toBe('{reason}');
    });

    it('groups both tables, each by its own field', () => {
        const d = mount();

        d.select({ band: 'detail', id: 'orders' });
        typeGroupBy('region');

        d.select({ band: 'detail', id: 'refunds' });
        typeGroupBy('reason');

        expect(tablesOf(d.layout).map(t => t.grouping[0].by)).toEqual(['region', 'reason']);
        expect(validateLayout(d.layout)).toEqual([]);
    });

    it("switches a table's group footer on from its own rail", () => {
        const d = mount(twoGrouped());
        d.select({ band: 'detail', id: 'refunds' });

        flip('groupFooter:refunds', true);

        expect(findBand(d.layout, 'groupFooter:refunds')).not.toBeNull();
        expect(root().querySelector('[data-band-type="groupFooter:refunds"]')).not.toBeNull();
    });

    it("sizes a table's group band in pixels, not as a share of the page", () => {
        const d = mount(twoGrouped());

        const height = () => panel().querySelector('[data-band-height="groupHeader:refunds"]');

        height().value = '48';
        height().dispatchEvent(new Event('input', { bubbles: true }));
        expect(findBand(d.layout, 'groupHeader:refunds').height).toBe(48);

        height().value = '10%';
        height().dispatchEvent(new Event('input', { bubbles: true }));
        expect(findBand(d.layout, 'groupHeader:refunds').height).toBe(48);
    });

    it('selects and edits an item on a table’s group band', () => {
        const d = mount(twoGrouped());
        d.select({ band: 'groupHeader:refunds', id: 'rh' });

        expect(panel().querySelector('.dz-panel-id').textContent).toBe('rh');

        const value = panel().querySelector('[data-field="value"]');
        value.value = 'Because {reason}';
        value.dispatchEvent(new Event('input', { bubbles: true }));

        expect(findBand(d.layout, 'groupHeader:refunds').items[0].value).toBe('Because {reason}');
    });

    it('takes a table’s group bands along while the table is dragged', () => {
        const d = mount(twoGrouped());
        const margin = d.layout.page.margin;

        const zone = () => root().querySelector('.dz-zone[data-band-type="groupHeader:orders"]');
        const tag = () => root().querySelector('[data-band-tag="groupHeader:orders"]');
        const pointer = (type, node, y) => {
            const event = new MouseEvent(type, {
                bubbles: true, cancelable: true, clientX: 0, clientY: y, button: 0
            });
            event.pointerId = 1;
            node.dispatchEvent(event);
        };

        /** pressing selects it, which redraws the sheet; the drag only patches */
        pointer('pointerdown', root().querySelector('[data-band-type="detail"] [data-item-id="orders"]'), 0);
        const before = zone();
        pointer('pointermove', root().querySelector('.dz-canvas'), 30);

        /** mid-drag: the same zone, patched rather than redrawn */
        const now = zonesOf(d.layout)['groupHeader:orders'];
        expect(tableOf(d.layout, 'orders').y).toBeGreaterThan(0);
        expect(zone()).toBe(before);
        expect(zone().style.top).toBe(`${now.top + margin.top}px`);
        expect(tag().style.top).toBe(`${now.top + margin.top}px`);

        pointer('pointerup', root().querySelector('.dz-canvas'), 30);
        expect(findBand(d.layout, 'groupHeader:orders').items[0].id).toBe('oh');
    });

    it('offers to copy the group design of another grouped table', () => {
        const d = mount(twoGrouped());
        d.select({ band: 'detail', id: 'refunds' });

        const button = panel().querySelector('[data-action="copy-grouping"][data-from="orders"]');
        expect(button).not.toBeNull();

        button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        const mine = tableOf(d.layout, 'refunds').grouping[0];
        expect(mine.header.items[0].value).toBe('Region {reason}');
        expect(mine.footer).not.toBeNull();
    });

    it('ungroups a table when its Group by is cleared', () => {
        const d = mount(twoGrouped());
        d.select({ band: 'detail', id: 'refunds' });

        typeGroupBy('');

        expect(tableOf(d.layout, 'refunds').grouping).toBeUndefined();
        expect(root().querySelector('[data-band-type="groupHeader:refunds"]')).toBeNull();
    });

    it('opens a layout grouped the older way with the grouping on its table', () => {
        const older = layout({
            groupBy: 'region',
            bands: [
                band('groupHeader', [text('gh', { value: '{region}' })], { height: 24 }),
                band('detail', [table({ id: 'tbl' })])
            ]
        });

        const d = mount(older);

        expect(d.layout.groupBy).toBeUndefined();
        expect(tableOf(d.layout, 'tbl').grouping[0].header.items[0].id).toBe('gh');
        expect(root().querySelector('[data-band-type="groupHeader:tbl"]')).not.toBeNull();

        /** the host's object is not where the change was made */
        expect(older.groupBy).toBe('region');
    });

    it('undoes a grouping', () => {
        const d = mount();
        d.select({ band: 'detail', id: 'refunds' });
        typeGroupBy('reason');

        root().querySelector('[data-action="undo"]')
            .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(tableOf(d.layout, 'refunds').grouping).toBeUndefined();
    });

    it('previews two grouped tables', () => {
        const d = mount(twoGrouped());

        expect(() => d.togglePreview()).not.toThrow();
        expect(root().querySelector('.dz-problems')).toBeNull();
    });
});

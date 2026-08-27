/**
 * @vitest-environment jsdom
 *
 * Selection, dragging and resizing driven through real pointer events, so the
 * wiring in select.js is specified rather than assumed. The arithmetic it calls
 * is specified in geometry.test.js, which needs no document.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDesigner } from '../src/designer/designer.js';
import { GRID, MIN_W } from '../src/designer/geometry.js';
import { designZones } from '../src/designer/canvas.js';
import { layout, text, table, band } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    document.body.innerHTML = '<div id="report-designer"></div>';
});

/**
 * select.js listens on document for the arrow keys, so each designer is torn
 * down before the next. Without it every earlier mount keeps handling
 * keystrokes and a nudge moves one item per test that has run so far.
 */
let designer = null;
afterEach(() => {
    designer?.destroy();
    designer = null;
    vi.restoreAllMocks();
});

const json = () => layout({
    bands: [
        band('pageHeader', [text('ph', { x: 0, y: 0, w: 300, h: 20 })], { height: 60 }),
        band('detail', [
            text('t1', { x: 100, y: 100, w: 200, h: 40 }),
            table({ id: 'tbl' })
        ])
    ]
});

function mount(l = json()) {
    designer = createDesigner({ mount: '#report-designer', layout: l });
    return designer;
}

const root = () => document.getElementById('report-designer');
const canvas = () => root().querySelector('.dz-canvas');
const drawn = (id) => root().querySelector(`[data-item-id="${id}"]`);
const outline = () => root().querySelector('[data-role="select"]');
const itemIn = (d, bandType, id) =>
    d.layout.bands.find(b => b.type === bandType).items.find(i => i.id === id);

/**
 * jsdom has no PointerEvent, and MouseEvent carries the clientX/clientY and
 * button that select.js actually reads - so the events are built from that.
 */
function pointer(type, target, { x = 0, y = 0, shiftKey = false } = {}) {
    const event = new MouseEvent(type, {
        bubbles: true, cancelable: true,
        clientX: x, clientY: y, button: 0, shiftKey
    });
    event.pointerId = 1;
    target.dispatchEvent(event);
    return event;
}

/** a whole gesture: press on `target`, move by (dx, dy), release */
function drag(target, dx, dy, from = { x: 0, y: 0 }) {
    pointer('pointerdown', target, from);
    pointer('pointermove', canvas(), { x: from.x + dx, y: from.y + dy });
    pointer('pointerup', canvas(), { x: from.x + dx, y: from.y + dy });
}

function key(name, { shiftKey = false } = {}) {
    document.dispatchEvent(new KeyboardEvent('keydown', {
        key: name, bubbles: true, cancelable: true, shiftKey
    }));
}


describe('selection', () => {
    it('selects the item that was clicked', () => {
        const d = mount();
        pointer('pointerdown', drawn('t1'));

        expect(d.selection).toEqual({ band: 'detail', id: 't1' });
    });

    it('draws an outline round it', () => {
        mount();
        pointer('pointerdown', drawn('t1'));

        expect(outline()).not.toBeNull();
    });

    it('selects a table through the cell that was clicked', () => {
        const d = mount();
        pointer('pointerdown', root().querySelector('#tbl td'));

        expect(d.selection).toEqual({ band: 'detail', id: 'tbl' });
    });

    it('tells two items with the same id apart by their band', () => {
        /**
         * validate.js requires an id to be a non-empty string and no more, so
         * the same id in two bands is a layout someone can legitimately write.
         */
        const d = mount(layout({
            bands: [
                band('pageHeader', [text('same', { y: 0 })], { height: 60 }),
                band('detail', [text('same', { y: 5 })])
            ]
        }));

        const inDetail = root()
            .querySelector('[data-band-type="detail"] [data-item-id="same"]');
        pointer('pointerdown', inDetail);

        expect(d.selection.band).toBe('detail');
    });

    it('deselects on a click that misses everything', () => {
        const d = mount();
        pointer('pointerdown', drawn('t1'));
        pointer('pointerdown', root().querySelector('[data-band-type="detail"]'));

        expect(d.selection).toBeNull();
        expect(outline()).toBeNull();
    });

    it('deselects on escape', () => {
        const d = mount();
        pointer('pointerdown', drawn('t1'));
        key('Escape');

        expect(d.selection).toBeNull();
    });

    it('ignores a right-click', () => {
        const d = mount();
        const event = new MouseEvent('pointerdown', {
            bubbles: true, cancelable: true, button: 2
        });
        drawn('t1').dispatchEvent(event);

        expect(d.selection).toBeNull();
    });
});


describe('moving', () => {
    it('moves the item by the drag, snapped to the grid', () => {
        const d = mount();
        drag(drawn('t1'), 43, 27);

        expect(itemIn(d, 'detail', 't1')).toMatchObject({ x: 140, y: 130 });
    });

    it('writes to the layout the host will be handed', () => {
        const d = mount();
        drag(drawn('t1'), 50, 0);

        expect(d.layout.bands[1].items[0].x).toBe(150);
    });

    it('leaves the size alone', () => {
        const d = mount();
        drag(drawn('t1'), 33, 33);

        expect(itemIn(d, 'detail', 't1')).toMatchObject({ w: 200, h: 40 });
    });

    it('does not move on a click that never travelled', () => {
        const d = mount();
        pointer('pointerdown', drawn('t1'), { x: 5, y: 5 });
        pointer('pointerup', canvas(), { x: 5, y: 5 });

        expect(itemIn(d, 'detail', 't1')).toMatchObject({ x: 100, y: 100 });
    });

    it('redraws the item where it was dropped', () => {
        mount();
        drag(drawn('t1'), 50, 50);

        expect(drawn('t1').style.left).toBe('150px');
        expect(drawn('t1').style.top).toBe('150px');
    });

    it('keeps the outline on the item while it is dragged', () => {
        mount();
        pointer('pointerdown', drawn('t1'), { x: 0, y: 0 });
        pointer('pointermove', canvas(), { x: 50, y: 0 });

        /** the page x is the item x plus the left margin */
        expect(outline().style.left).toBe('190px');
    });

    it('moves an item in the header band too', () => {
        const d = mount();
        drag(drawn('ph'), 20, 20);

        expect(itemIn(d, 'pageHeader', 'ph')).toMatchObject({ x: 20, y: 20 });
    });
});


describe('resizing', () => {
    const select = (id) => pointer('pointerdown', drawn(id));
    const handle = (name) => root().querySelector(`[data-handle="${name}"]`);

    it('offers eight handles on a text item', () => {
        mount();
        select('t1');

        expect(root().querySelectorAll('[data-handle]')).toHaveLength(8);
    });

    it('offers only the side handles on a table', () => {
        mount();
        select('tbl');

        expect([...root().querySelectorAll('[data-handle]')]
            .map(h => h.dataset.handle)).toEqual(['e', 'w']);
    });

    it('grows the box from the east handle', () => {
        const d = mount();
        select('t1');
        drag(handle('e'), 40, 0);

        expect(itemIn(d, 'detail', 't1')).toMatchObject({ x: 100, w: 240 });
    });

    it('moves the near edge from the west handle', () => {
        const d = mount();
        select('t1');
        drag(handle('w'), 40, 0);

        const item = itemIn(d, 'detail', 't1');
        expect(item).toMatchObject({ x: 140, w: 160 });
        /** the far edge has not moved */
        expect(item.x + item.w).toBe(300);
    });

    it('does not snap the size', () => {
        const d = mount();
        select('t1');
        drag(handle('e'), 7, 0);

        expect(itemIn(d, 'detail', 't1').w).toBe(207);
    });

    it('stops at the minimum width', () => {
        const d = mount();
        select('t1');
        drag(handle('e'), -500, 0);

        expect(itemIn(d, 'detail', 't1').w).toBe(MIN_W);
    });

    it('never gives a table a height', () => {
        const d = mount();
        select('tbl');
        drag(handle('e'), 30, 0);

        const item = itemIn(d, 'detail', 'tbl');
        expect(item.w).toBe(744);
        expect(item.h).toBeUndefined();
    });

    it('resizes the selection, not whatever is under the handle', () => {
        /** the outline overlaps its neighbours by design */
        const d = mount();
        select('t1');
        drag(handle('e'), 40, 0);

        expect(itemIn(d, 'detail', 'tbl').w).toBe(714);
    });
});


describe('nudging', () => {
    it('moves a pixel at a time', () => {
        const d = mount();
        pointer('pointerdown', drawn('t1'));
        key('ArrowRight');

        expect(itemIn(d, 'detail', 't1').x).toBe(101);
    });

    it('moves a grid step with shift', () => {
        const d = mount();
        pointer('pointerdown', drawn('t1'));
        key('ArrowDown', { shiftKey: true });

        expect(itemIn(d, 'detail', 't1').y).toBe(100 + GRID);
    });

    it('does nothing with no selection', () => {
        const d = mount();
        key('ArrowRight');

        expect(itemIn(d, 'detail', 't1').x).toBe(100);
    });
});


describe('teardown', () => {
    it('stops listening once destroyed', () => {
        const d = mount();
        pointer('pointerdown', drawn('t1'));

        const before = { ...itemIn(d, 'detail', 't1') };
        const layoutRef = d.layout;
        d.destroy();
        designer = null;

        key('ArrowRight');

        expect(layoutRef.bands[1].items[0]).toMatchObject({ x: before.x });
    });
});


describe('dragging between bands', () => {
    /**
     * Until this existed an item followed the pointer across a band boundary
     * and stayed in the band it started in - which is only noticed once the
     * report prints the page number among the rows.
     */
    const stacked = () => layout({
        bands: [
            band('pageHeader', [text('ph', { x: 0, y: 0, w: 200, h: 20 })], { height: 60 }),
            band('detail', [text('d1', { x: 0, y: 0, w: 200, h: 20 }), table({ id: 'tbl' })]),
            band('pageFooter', [], { height: 60 })
        ]
    });

    const zones = () => Object.fromEntries(
        designZones(stacked()).map(z => [z.type, z]));

    const bandOf = (d, id) => d.layout.bands
        .find(b => (b.items || []).some(i => i.id === id))?.type ?? null;

    const itemAnywhere = (d, id) => d.layout.bands
        .flatMap(b => b.items || []).find(i => i.id === id);

    it('moves the item into the band it was dropped on', () => {
        const d = mount(stacked());
        const z = zones();

        /** far enough down to land in the page footer */
        drag(drawn('d1'), 0, z.pageFooter.top - z.detail.top + 5);

        expect(bandOf(d, 'd1')).toBe('pageFooter');
    });

    it('keeps it where it looks, rather than carrying the offset over', () => {
        /**
         * y is band-relative, so the same number in another band is a different
         * place on the page.
         */
        const d = mount(stacked());
        const z = zones();
        const travel = z.pageFooter.top - z.detail.top + 20;

        drag(drawn('d1'), 0, travel);

        const item = itemAnywhere(d, 'd1');
        const landed = z.pageFooter.top + item.y;

        expect(landed).toBeCloseTo(z.detail.top + Math.round(travel / GRID) * GRID, 0);
    });

    it('follows the item with the selection', () => {
        const d = mount(stacked());
        const z = zones();

        drag(drawn('d1'), 0, z.pageFooter.top - z.detail.top + 5);

        expect(d.selection).toEqual({ band: 'pageFooter', id: 'd1' });
    });

    it('leaves it alone when it never left its own band', () => {
        const d = mount(stacked());
        drag(drawn('d1'), 0, 20);

        expect(bandOf(d, 'd1')).toBe('detail');
    });

    it('moves upward too', () => {
        const d = mount(stacked());
        const z = zones();

        drag(drawn('d1'), 0, -(z.detail.top - z.pageHeader.top) - 5);

        expect(bandOf(d, 'd1')).toBe('pageHeader');
    });

    it('does not move anything on a resize', () => {
        /** a handle drag changes the box, not where the item lives */
        const d = mount(stacked());
        const z = zones();

        pointer('pointerdown', drawn('d1'));
        const handle = root().querySelector('[data-handle="s"]');
        drag(handle, 0, z.pageFooter.top - z.detail.top + 40);

        expect(bandOf(d, 'd1')).toBe('detail');
    });
});


describe('showing which band it is going into', () => {
    const stacked = () => layout({
        bands: [
            band('pageHeader', [], { height: 60 }),
            band('detail', [text('d1', { x: 0, y: 0, w: 200, h: 20 })]),
            band('pageFooter', [], { height: 60 })
        ]
    });

    const zones = () => Object.fromEntries(
        designZones(stacked()).map(z => [z.type, z]));

    const lit = () => [...root().querySelectorAll('.dz-zone.is-target')]
        .map(n => n.dataset.bandType);

    it('lights nothing before anything moves', () => {
        mount(stacked());
        expect(lit()).toEqual([]);
    });

    it('lights the band the item is over', () => {
        mount(stacked());
        const z = zones();

        pointer('pointerdown', drawn('d1'), { x: 0, y: 0 });
        pointer('pointermove', canvas(),
            { x: 0, y: z.pageFooter.top - z.detail.top + 5 });

        expect(lit()).toEqual(['pageFooter']);
    });

    it('lights the name in the gutter with it', () => {
        mount(stacked());
        const z = zones();

        pointer('pointerdown', drawn('d1'), { x: 0, y: 0 });
        pointer('pointermove', canvas(),
            { x: 0, y: z.pageFooter.top - z.detail.top + 5 });

        expect([...root().querySelectorAll('.dz-tag.is-target')]
            .map(n => n.dataset.bandTag)).toEqual(['pageFooter']);
    });

    it('lights nothing while the item is still in its own band', () => {
        mount(stacked());

        pointer('pointerdown', drawn('d1'), { x: 0, y: 0 });
        pointer('pointermove', canvas(), { x: 0, y: 20 });

        expect(lit()).toEqual([]);
    });

    it('puts the light out when the drag ends', () => {
        mount(stacked());
        const z = zones();

        drag(drawn('d1'), 0, z.pageFooter.top - z.detail.top + 5);

        expect(lit()).toEqual([]);
    });
});


describe('selecting several at once', () => {
    const three = () => layout({
        bands: [
            band('pageHeader', [text('ph', { x: 0, y: 0, w: 200, h: 20 })], { height: 60 }),
            band('detail', [
                text('a', { x: 0, y: 0, w: 100, h: 20 }),
                text('b', { x: 0, y: 40, w: 100, h: 20 }),
                text('c', { x: 0, y: 80, w: 100, h: 20 })
            ])
        ]
    });

    /** a click is a press and a release; the release is where a group collapses */
    const tap = (id, options = {}) => {
        pointer('pointerdown', drawn(id), options);
        pointer('pointerup', canvas(), options);
    };

    const shiftClick = (id) => tap(id, { shiftKey: true });
    const click = (id) => tap(id);
    const ids = (d) => d.selections.map(one => one.id);
    const item = (d, id) => d.layout.bands
        .flatMap(b => b.items || []).find(i => i.id === id);

    it('adds to the selection on shift-click', () => {
        const d = mount(three());

        click('a');
        shiftClick('b');

        expect(ids(d)).toEqual(['a', 'b']);
    });

    it('keeps going for a third', () => {
        const d = mount(three());

        click('a');
        shiftClick('b');
        shiftClick('c');

        expect(ids(d)).toEqual(['a', 'b', 'c']);
    });

    it('takes one out again with the same gesture', () => {
        /** a mis-click is undone without starting the selection over */
        const d = mount(three());

        click('a');
        shiftClick('b');
        shiftClick('b');

        expect(ids(d)).toEqual(['a']);
    });

    it('reaches across bands', () => {
        const d = mount(three());

        click('a');
        shiftClick('ph');

        expect(d.selections.map(one => one.band)).toEqual(['detail', 'pageHeader']);
    });

    it('starts again on a plain click', () => {
        const d = mount(three());

        click('a');
        shiftClick('b');
        click('c');

        expect(ids(d)).toEqual(['c']);
    });

    it('keeps the group while one of its members is held', () => {
        /** so a group can be picked up by grabbing any of the items in it */
        const d = mount(three());

        click('a');
        shiftClick('b');
        pointer('pointerdown', drawn('b'));

        expect(ids(d)).toEqual(['a', 'b']);
    });

    it('collapses to one when a member is clicked without dragging', () => {
        /**
         * The press keeps the group so it can be dragged; the release, having
         * gone nowhere, was a click - and that is how a group is broken up and
         * how one item's properties are reached.
         */
        const d = mount(three());

        click('a');
        shiftClick('b');
        click('b');

        expect(ids(d)).toEqual(['b']);
    });

    it('still moves the whole group when a member is dragged', () => {
        const d = mount(three());

        click('a');
        shiftClick('b');
        drag(drawn('b'), 20, 0);

        expect(ids(d)).toEqual(['a', 'b']);
        expect(item(d, 'a').x).toBe(20);
        expect(item(d, 'b').x).toBe(20);
    });

    it('drops the lot on a click that misses', () => {
        const d = mount(three());

        click('a');
        shiftClick('b');
        pointer('pointerdown', root().querySelector('[data-band-type="detail"]'));

        expect(ids(d)).toEqual([]);
        expect(d.selection).toBeNull();
    });

    it('names the last one clicked as the one the rail describes', () => {
        const d = mount(three());

        click('a');
        shiftClick('b');

        expect(d.selection).toEqual({ band: 'detail', id: 'b' });
    });
});


describe('what several selected items look like', () => {
    const two = () => layout({
        bands: [band('detail', [
            text('a', { x: 0, y: 0, w: 100, h: 20 }),
            text('b', { x: 0, y: 40, w: 100, h: 20 })
        ])]
    });

    const outlines = () => [...root().querySelectorAll('[data-role="select"]')];

    const tap = (id, options = {}) => {
        pointer('pointerdown', drawn(id), options);
        pointer('pointerup', canvas(), options);
    };

    it('draws an outline round each of them', () => {
        mount(two());
        tap('a');
        tap('b', { shiftKey: true });

        expect(outlines().map(n => n.dataset.selectId)).toEqual(['a', 'b']);
    });

    it('offers handles on one alone, and none on a group', () => {
        /**
         * Dragging the south edge of six items has no single answer - do they
         * all become that tall, or does the group scale? A handle that has to
         * ask is worse than one that is not offered.
         */
        mount(two());
        tap('a');
        expect(root().querySelectorAll('[data-handle]')).toHaveLength(8);

        tap('b', { shiftKey: true });
        expect(root().querySelectorAll('[data-handle]')).toHaveLength(0);
    });

    it('marks all but the primary as secondary', () => {
        mount(two());
        tap('a');
        tap('b', { shiftKey: true });

        expect(outlines().map(n => n.classList.contains('is-secondary')))
            .toEqual([true, false]);
    });

    it('gives the rail a count and a list instead of properties', () => {
        mount(two());
        tap('a');
        tap('b', { shiftKey: true });

        const panel = root().querySelector('.dz-panel');

        expect(panel.querySelector('.dz-panel-type').textContent).toBe('2 items');
        expect(panel.querySelectorAll('.dz-selected li')).toHaveLength(2);
        expect(panel.querySelector('[data-field="w"]')).toBeNull();
    });

    it('goes back to properties when one is selected again', () => {
        mount(two());
        tap('a');
        tap('b', { shiftKey: true });
        tap('a');

        expect(root().querySelector('.dz-panel [data-field="w"]')).not.toBeNull();
    });
});


describe('moving several at once', () => {
    const two = () => layout({
        bands: [band('detail', [
            text('a', { x: 0, y: 0, w: 100, h: 20 }),
            text('b', { x: 50, y: 40, w: 100, h: 20 })
        ])]
    });

    const item = (d, id) => d.layout.bands[0].items.find(i => i.id === id);

    function selectBoth() {
        pointer('pointerdown', drawn('a'));
        pointer('pointerup', canvas());
        pointer('pointerdown', drawn('b'), { shiftKey: true });
        pointer('pointerup', canvas(), { shiftKey: true });
    }

    it('moves them all by the same amount', () => {
        const d = mount(two());
        selectBoth();

        drag(drawn('a'), 30, 30);

        expect(item(d, 'a')).toMatchObject({ x: 30, y: 30 });
        expect(item(d, 'b')).toMatchObject({ x: 80, y: 70 });
    });

    it('keeps the gap between them', () => {
        const d = mount(two());
        selectBoth();

        const before = item(d, 'b').y - item(d, 'a').y;
        drag(drawn('b'), 0, 70);

        expect(item(d, 'b').y - item(d, 'a').y).toBe(before);
    });

    it('does not drift over a long drag', () => {
        /**
         * Each item moves from its own starting box, not from wherever it has
         * got to - applying the delta repeatedly would let rounding pull the
         * group apart.
         */
        const d = mount(two());
        selectBoth();

        pointer('pointerdown', drawn('a'), { x: 0, y: 0 });
        for (let step = 1; step <= 20; step++) {
            pointer('pointermove', canvas(), { x: step * 7, y: step * 3 });
        }
        pointer('pointerup', canvas(), { x: 140, y: 60 });

        expect(item(d, 'b').x - item(d, 'a').x).toBe(50);
        expect(item(d, 'b').y - item(d, 'a').y).toBe(40);
    });

    it('nudges them all with the arrow keys', () => {
        const d = mount(two());
        selectBoth();

        key('ArrowRight');

        expect(item(d, 'a').x).toBe(1);
        expect(item(d, 'b').x).toBe(51);
    });

    it('deletes them all', () => {
        const d = mount(two());
        selectBoth();

        key('Delete');

        expect(d.layout.bands[0].items).toHaveLength(0);
        expect(d.selections).toEqual([]);
    });

    it('is one step to undo, not one per item', () => {
        const d = mount(two());
        selectBoth();
        drag(drawn('a'), 30, 30);

        root().dispatchEvent(new KeyboardEvent('keydown', {
            key: 'z', ctrlKey: true, bubbles: true, cancelable: true
        }));

        expect(d.layout.bands[0].items.find(i => i.id === 'a').x).toBe(0);
        expect(d.layout.bands[0].items.find(i => i.id === 'b').x).toBe(50);
    });

    it('carries each item into whichever band it landed in', () => {
        const spread = layout({
            bands: [
                band('detail', [
                    text('a', { x: 0, y: 0, w: 100, h: 20 }),
                    text('b', { x: 0, y: 40, w: 100, h: 20 })
                ]),
                band('pageFooter', [], { height: 60 })
            ]
        });

        const d = mount(spread);
        const zones = Object.fromEntries(
            designZones(spread).map(z => [z.type, z]));

        pointer('pointerdown', drawn('a'));
        pointer('pointerup', canvas());
        pointer('pointerdown', drawn('b'), { shiftKey: true });
        pointer('pointerup', canvas(), { shiftKey: true });

        drag(drawn('a'), 0, zones.pageFooter.top - zones.detail.top + 5);

        const bandOf = (id) => d.layout.bands
            .find(b => (b.items || []).some(i => i.id === id))?.type;

        expect(bandOf('a')).toBe('pageFooter');
        expect(bandOf('b')).toBe('pageFooter');
    });
});

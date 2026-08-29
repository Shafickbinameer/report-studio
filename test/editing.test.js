/**
 * @vitest-environment jsdom
 *
 * Structural editing through the designer: adding and deleting items, switching
 * bands on and off, and the column editor. What each operation does to the
 * layout is specified in structure.test.js; this is the wiring.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDesigner } from '../src/designer/designer.js';
import { validateLayout } from '../src/engine/validate.js';
import { designZones } from '../src/designer/canvas.js';
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

const json = () => layout({
    bands: [
        band('pageHeader', [], { height: 40 }),
        band('detail', [text('t1', { x: 0, y: 0, w: 200, h: 40 }), table({ id: 'tbl' })])
    ]
});

function mount(l = json()) {
    designer = createDesigner({ mount: '#report-designer', layout: l });
    return designer;
}

/**
 * The shared fixture already has a table, and a report binds one - so the table
 * tool is only offered on a report that has not got one yet.
 */
const tableless = () => layout({
    bands: [
        band('pageHeader', [], { height: 40 }),
        band('detail', [text('t1', { x: 0, y: 0, w: 200, h: 40 })])
    ]
});


const root = () => document.getElementById('report-designer');
const panel = () => root().querySelector('.dz-panel');
const drawn = (id) => root().querySelector(`[data-item-id="${id}"]`);
const bandsOf = (d) => d.layout.bands.map(b => b.type);
const itemsOn = (d, type) =>
    d.layout.bands.find(b => b.type === type)?.items.map(i => i.id) ?? [];

function click(node) {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function press(node, action) {
    click(node.querySelector(`[data-action="${action}"]`));
}

function select(id) {
    const event = new MouseEvent('pointerdown', {
        bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0
    });
    event.pointerId = 1;
    drawn(id).dispatchEvent(event);
}

/**
 * Right-click something and press one of the pill's buttons. The actions that
 * used to sit in the rail and the tool strip live there now.
 */
function menuOn(id = null) {
    const target = id ? drawn(id) : root().querySelector('.dz-canvas');

    target.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 2
    }));

    return root().querySelector('[data-role="menu"]');
}

/**
 * The table tool opens a dialog, so adding one is a two-step gesture: press the
 * tool, then answer. Awaited because the answer resolves a promise.
 */
async function addTable(columns) {
    press(root().querySelector('.dz-foot'), 'add-table');

    const dialog = root().querySelector('[data-role="column-dialog"]');
    if (!dialog) return null;

    if (columns != null) dialog.querySelector('[data-role="count"]').value = String(columns);

    dialog.querySelector('form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }));

    await new Promise(resolve => setTimeout(resolve, 0));
    return dialog;
}


function key(name) {
    document.dispatchEvent(new KeyboardEvent('keydown', {
        key: name, bubbles: true, cancelable: true
    }));
}


describe('the tool footer', () => {
    const foot = () => root().querySelector('.dz-foot');

    it('is under the page rather than in the bar', () => {
        mount();

        expect(foot()).not.toBeNull();
        expect(root().querySelector('.dz-bar [data-action="add-text"]')).toBeNull();
    });

    it('draws each tool as a glyph, not a word', () => {
        mount();
        const button = foot().querySelector('[data-action="add-text"]');

        expect(button.querySelector('svg')).not.toBeNull();
        expect(button.textContent.trim()).toBe('');
    });

    it('names each tool for a screen reader, since the glyph cannot', () => {
        mount();

        for (const button of foot().querySelectorAll('[data-action]')) {
            expect(button.getAttribute('aria-label')).toBeTruthy();
            expect(button.getAttribute('title')).toBeTruthy();
        }
    });

    it('hides the glyph from the accessibility tree, so it is not read twice', () => {
        mount();
        const svg = foot().querySelector('svg');

        expect(svg.getAttribute('aria-hidden')).toBe('true');
    });
});


describe('adding items', () => {
    /** the tools live under the page, not in the bar */
    const foot = () => root().querySelector('.dz-foot');

    it('adds a text box to the detail band by default', () => {
        const d = mount();
        press(foot(), 'add-text');

        expect(itemsOn(d, 'detail')).toEqual(['t1', 'tbl', 'text-1']);
    });

    it('adds it to the band the selection is on instead', () => {
        const d = mount();
        press(foot(), 'add-text');

        /** now put one on the header by selecting there first */
        d.select({ band: 'pageHeader', id: 'nothing' });
        press(foot(), 'add-text');

        expect(itemsOn(d, 'pageHeader')).toEqual(['text-2']);
    });

    it('selects what it just added, so the rail is already on it', () => {
        const d = mount();
        press(foot(), 'add-text');

        expect(d.selection).toEqual({ band: 'detail', id: 'text-1' });
        expect(panel().querySelector('.dz-panel-id').textContent).toBe('text-1');
    });

    it('draws it on the page', () => {
        mount();
        press(foot(), 'add-text');

        expect(drawn('text-1')).not.toBeNull();
    });

    it('adds a table once the dialog is answered', async () => {
        const d = mount(tableless());
        await addTable(4);

        expect(itemsOn(d, 'detail')).toContain('table-1');
    });

    it('leaves the report valid', async () => {
        const d = mount(tableless());
        press(foot(), 'add-text');
        await addTable(3);

        expect(validateLayout(d.layout)).toEqual([]);
    });
});


describe('the table dialog', () => {
    const dialog = () => root().querySelector('[data-role="column-dialog"]');
    const foot = () => root().querySelector('.dz-foot');

    it('asks before adding anything', () => {
        const d = mount(tableless());
        press(foot(), 'add-table');

        expect(dialog()).not.toBeNull();
        expect(itemsOn(d, 'detail')).toEqual(['t1']);
    });

    it('makes the number of columns it was given', async () => {
        const d = mount(tableless());
        await addTable(5);

        const made = d.layout.bands[1].items.at(-1);
        expect(made.columns).toHaveLength(5);
    });

    it('starts every column at 50 wide', async () => {
        const d = mount(tableless());
        await addTable(4);

        expect(d.layout.bands[1].items.at(-1).columns.map(c => c.width))
            .toEqual([50, 50, 50, 50]);
    });

    it('adds nothing when cancelled', async () => {
        const d = mount(tableless());
        press(foot(), 'add-table');
        click(dialog().querySelector('[data-role="cancel"]'));

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(itemsOn(d, 'detail')).toEqual(['t1']);
        expect(dialog()).toBeNull();
    });

    it('cancels on escape without dropping the selection behind it', async () => {
        /**
         * select.js listens for escape too - the dialog captures and stops it,
         * or cancelling would silently deselect whatever was being worked on.
         */
        const d = mount(tableless());
        select('t1');
        press(foot(), 'add-table');

        dialog().querySelector('[data-role="count"]').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(dialog()).toBeNull();
        expect(d.selection).toEqual({ band: 'detail', id: 't1' });
    });

    it('closes with the designer rather than outliving it', async () => {
        /**
         * An open dialog used to leave a document keydown listener behind, and
         * it swallowed escape for every designer mounted afterwards.
         */
        const d = mount();
        press(foot(), 'add-table');
        d.destroy();
        designer = null;

        document.body.innerHTML = '<div id="report-designer"></div>';
        const next = mount();
        select('t1');
        key('Escape');

        expect(next.selection).toBeNull();
    });
});


describe('deleting items', () => {
    it('removes the selected item from the right-click pill', () => {
        const d = mount();
        select('t1');
        press(menuOn('t1'), 'delete-item');

        expect(itemsOn(d, 'detail')).toEqual(['tbl']);
    });

    it('removes it with the delete key', () => {
        const d = mount();
        select('t1');
        key('Delete');

        expect(itemsOn(d, 'detail')).toEqual(['tbl']);
    });

    it('takes it off the page', () => {
        mount();
        select('t1');
        key('Delete');

        expect(drawn('t1')).toBeNull();
    });

    it('drops the selection, since what it pointed at has gone', () => {
        const d = mount();
        select('t1');
        key('Delete');

        expect(d.selection).toBeNull();
        expect(panel().querySelector('.dz-panel-type').textContent).toBe('report');
    });

    it('does nothing on delete with no selection', () => {
        const d = mount();
        key('Delete');

        expect(itemsOn(d, 'detail')).toEqual(['t1', 'tbl']);
    });
});


describe('bands', () => {
    const toggle = (type) => panel().querySelector(`[data-band="${type}"]`);

    const flip = (type, on) => {
        const node = toggle(type);
        node.checked = on;
        node.dispatchEvent(new Event('change', { bubbles: true }));
    };

    it('lists every band type, on or off', () => {
        mount();
        expect(panel().querySelectorAll('[data-band]')).toHaveLength(7);
    });

    it('checks the ones the report has', () => {
        mount();

        expect(toggle('detail').checked).toBe(true);
        expect(toggle('pageFooter').checked).toBe(false);
    });

    it('adds a band when switched on', () => {
        const d = mount();
        flip('pageFooter', true);

        expect(bandsOf(d)).toContain('pageFooter');
        expect(root().querySelector('[data-band-type="pageFooter"]')).not.toBeNull();
    });

    it('removes a band when switched off', () => {
        const d = mount();
        flip('detail', false);

        expect(bandsOf(d)).toEqual(['pageHeader']);
    });

    it('takes the removed band and its items off the page', () => {
        /**
         * The band list is in the report rail, so this is the journey: select
         * something, escape back to the report, switch the band off.
         */
        const d = mount();
        select('t1');
        key('Escape');
        flip('detail', false);

        expect(root().querySelector('[data-band-type="detail"]')).toBeNull();
        expect(drawn('t1')).toBeNull();
        expect(d.selection).toBeNull();
    });

    it('takes a height in pixels', () => {
        const d = mount();
        const box = panel().querySelector('[data-band-height="pageHeader"]');
        box.value = '90';
        box.dispatchEvent(new Event('input', { bubbles: true }));

        expect(d.layout.bands[0].height).toBe(90);
    });

    it('takes a height as a percentage, which regions.js resolves', () => {
        const d = mount();
        const box = panel().querySelector('[data-band-height="pageHeader"]');
        box.value = '15%';
        box.dispatchEvent(new Event('input', { bubbles: true }));

        expect(d.layout.bands[0].height).toBe('15%');
    });

    it('clears the height when the box is emptied, back to the default', () => {
        const d = mount();
        const box = panel().querySelector('[data-band-height="pageHeader"]');
        box.value = '';
        box.dispatchEvent(new Event('input', { bubbles: true }));

        expect(d.layout.bands[0].height).toBeUndefined();
    });

    it('gives the detail band no height box, since it takes what is left', () => {
        mount();
        expect(panel().querySelector('[data-band-height="detail"]')).toBeNull();
    });

    it('does not rebuild the rail while a height is being typed', () => {
        mount();
        const before = panel().querySelector('[data-band-height="pageHeader"]');
        before.focus();
        before.value = '90';
        before.dispatchEvent(new Event('input', { bubbles: true }));

        expect(panel().querySelector('[data-band-height="pageHeader"]')).toBe(before);
    });
});


describe('columns', () => {
    const columns = () => panel().querySelectorAll('.dz-column');
    const cell = (index, key) =>
        panel().querySelector(`[data-column="${index}"][data-field="${key}"]`);

    it('lists the table columns when a table is selected', () => {
        mount();
        select('tbl');

        expect(columns()).toHaveLength(3);
        expect(cell(0, 'field').value).toBe('name');
    });

    it('shows none for a text item', () => {
        mount();
        select('t1');

        expect(columns()).toHaveLength(0);
    });

    it('renames a column field', () => {
        const d = mount();
        select('tbl');

        const node = cell(1, 'field');
        node.value = 'quantity';
        node.dispatchEvent(new Event('input', { bubbles: true }));

        expect(d.layout.bands[1].items[1].columns[1].field).toBe('quantity');
    });

    it('changes a column label, and the page follows', () => {
        mount();
        select('tbl');

        const node = cell(0, 'label');
        node.value = 'Product';
        node.dispatchEvent(new Event('input', { bubbles: true }));

        expect(drawn('tbl').textContent).toContain('Product');
    });

    it('changes a column width as a number, not a string', () => {
        const d = mount();
        select('tbl');

        const node = cell(2, 'width');
        node.value = '150';
        node.dispatchEvent(new Event('input', { bubbles: true }));

        expect(d.layout.bands[1].items[1].columns[2].width).toBe(150);
    });

    it('adds a column', () => {
        const d = mount();
        select('tbl');
        press(panel(), 'add-column');

        expect(d.layout.bands[1].items[1].columns).toHaveLength(4);
        expect(columns()).toHaveLength(4);
    });

    it('removes a column', () => {
        const d = mount();
        select('tbl');
        click(panel().querySelector('[data-action="remove-column"][data-index="1"]'));

        expect(d.layout.bands[1].items[1].columns.map(c => c.field))
            .toEqual(['name', 'price']);
    });

    it('offers no remove button on the last column', () => {
        const d = mount();
        select('tbl');

        press(panel(), 'add-column');
        for (const index of [3, 2, 1]) {
            click(panel().querySelector(`[data-action="remove-column"][data-index="${index}"]`));
        }

        expect(d.layout.bands[1].items[1].columns).toHaveLength(1);
        expect(panel().querySelector('[data-action="remove-column"]')).toBeNull();
    });
});


describe('a broken report stays editable', () => {
    it('shows the problems as a banner and still draws the page', () => {
        /**
         * Setting groupBy before adding a group band is one keystroke from
         * fixed - taking the design away to say so would be a punishment.
         */
        const d = mount();
        d.layout.groupBy = 'region';
        d.redraw();

        expect(root().querySelector('.dz-problems')).not.toBeNull();
        expect(root().querySelector('.dz-page')).not.toBeNull();
    });

    it('is fixed by switching the group band on', () => {
        const d = mount();
        d.layout.groupBy = 'region';
        d.redraw();

        const node = panel().querySelector('[data-band="groupHeader"]');
        node.checked = true;
        node.dispatchEvent(new Event('change', { bubbles: true }));

        expect(root().querySelector('.dz-problems')).toBeNull();
        expect(validateLayout(d.layout)).toEqual([]);
    });
});


describe('the field tool', () => {
    const foot = () => root().querySelector('.dz-foot');
    const box = () => root().querySelector('[data-role="token-dialog"]');
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));

    const withFooters = () => layout({
        groupBy: 'region',
        bands: [
            band('pageHeader', [], { height: 30 }),
            band('detail', [table({ id: 'tbl' })]),
            band('groupFooter', [], { height: 30 }),
            band('pageFooter', [], { height: 26 })
        ]
    });

    async function openTool(l = withFooters()) {
        const d = mount(l);
        press(foot(), 'add-field');
        await settle();
        return d;
    }

    const choose = (id) => {
        const radio = box().querySelector(`[name="dz-token"][value="${id}"]`);
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const pick = (role, value) => {
        const wrapper = box().querySelector(`[data-role="${role}-dropdown"]`);
        click(wrapper.querySelector('.dropdown-trigger'));
        click(wrapper.querySelector(`.dropdown-item[data-value="${value}"]`));
    };

    async function insert() {
        click(box().querySelector('[data-role="confirm"]'));
        await settle();
    }

    const itemsOnBand = (d, type) =>
        d.layout.bands.find(b => b.type === type)?.items ?? [];

    it('offers the placeholders rather than making them be remembered', async () => {
        await openTool();

        const names = [...box().querySelectorAll('.dz-token-name')]
            .map(n => n.textContent);

        expect(names).toEqual(expect.arrayContaining([
            'Page number', 'Total pages', 'Today', 'Row count', 'Sum', 'Average'
        ]));
    });

    it('shows the text each one writes, so it stops being needed', async () => {
        await openTool();

        const syntax = [...box().querySelectorAll('.dz-token-syntax')]
            .map(n => n.textContent);

        expect(syntax).toContain('{totalPages}');
        expect(syntax).toContain('{count()}');
    });

    it('inserts a page number into the page footer', async () => {
        const d = await openTool();
        choose('page');
        await insert();

        expect(itemsOnBand(d, 'pageFooter')[0].value).toBe('{page}');
    });

    it('inserts a total into a group footer by default', async () => {
        const d = await openTool();
        choose('sum');
        await insert();

        expect(itemsOnBand(d, 'groupFooter')[0].value).toMatch(/^\{sum\(/);
    });

    it('offers the fields the report already has, for an aggregate', async () => {
        await openTool();
        choose('sum');

        const fields = [...box()
            .querySelectorAll('[data-role="field-dropdown"] .dropdown-item')]
            .map(n => n.textContent.trim());

        expect(fields).toEqual(['name', 'price', 'qty', 'region']);
    });

    it('writes the field that was picked', async () => {
        const d = await openTool();
        choose('sum');
        pick('field', 'price');
        await insert();

        expect(itemsOnBand(d, 'groupFooter')[0].value).toBe('{sum(price)}');
    });

    it('hides the field picker for a token that takes none', async () => {
        await openTool();

        choose('sum');
        expect(box().querySelector('[data-role="field-row"]').hidden).toBe(false);

        choose('page');
        expect(box().querySelector('[data-role="field-row"]').hidden).toBe(true);
    });

    it('offers an aggregate every band the report has', async () => {
        /**
         * It used to offer the footers alone, because they were the only bands
         * group.js filled in. A total under the rows is where a total most
         * often goes, and the tool would not put one there.
         */
        await openTool();
        choose('sum');

        const bands = [...box()
            .querySelectorAll('[data-role="band-dropdown"] .dropdown-item')]
            .map(n => n.dataset.value);

        expect(bands).toEqual(['pageHeader', 'detail', 'groupFooter', 'pageFooter']);
    });

    it('says which rows the aggregate will cover where it is going', async () => {
        await openTool();
        choose('sum');
        pick('band', 'detail');

        const note = box().querySelector('[data-role="token-warning"]');

        expect(note.hidden).toBe(false);
        expect(note.textContent).toMatch(/every row in the report/);

        /** information, not a caution - so the button stays a plain Insert */
        expect(box().querySelector('[data-role="confirm"]').textContent)
            .toBe('Insert');
    });

    it('says a group band means that group instead', async () => {
        await openTool();
        choose('sum');
        pick('band', 'groupFooter');

        expect(box().querySelector('[data-role="token-warning"]').textContent)
            .toMatch(/each group's own rows/);
    });

    it('inserts an aggregate into the detail band', async () => {
        const d = await openTool(layout({
            bands: [band('detail', [table({ id: 'tbl' })])]
        }));

        choose('sum');
        await insert();

        expect(itemsOnBand(d, 'detail')).toHaveLength(2);
    });

    it('right-aligns a total, where one belongs', async () => {
        const d = await openTool();
        choose('sum');
        await insert();

        expect(itemsOnBand(d, 'groupFooter')[0].style.align).toBe('right');
    });

    it('selects what it inserted, so the rail is already on it', async () => {
        const d = await openTool();
        choose('page');
        await insert();

        expect(d.selection).toEqual({
            band: 'pageFooter',
            id: itemsOnBand(d, 'pageFooter')[0].id
        });
    });

    it('inserts nothing when cancelled', async () => {
        const d = await openTool();
        choose('page');
        click(box().querySelector('[data-role="cancel"]'));
        await settle();

        expect(itemsOnBand(d, 'pageFooter')).toHaveLength(0);
    });

    it('leaves the report valid', async () => {
        const d = await openTool();
        choose('sum');
        pick('field', 'qty');
        await insert();

        expect(validateLayout(d.layout)).toEqual([]);
    });
});

describe('duplicating an item', () => {
    /** shift-click, which is how the canvas extends a selection */
    function addToSelection(id) {
        const event = new MouseEvent('pointerdown', {
            bubbles: true, cancelable: true, clientX: 0, clientY: 0,
            button: 0, shiftKey: true
        });
        event.pointerId = 1;
        drawn(id).dispatchEvent(event);
    }

    /** ctrl+d, on the root the designer binds its shortcuts to */
    function chord(letter, node = root()) {
        node.dispatchEvent(new KeyboardEvent('keydown', {
            key: letter, ctrlKey: true, bubbles: true, cancelable: true
        }));
    }

    it('offers duplicate in the pill, as a labelled glyph', () => {
        mount();
        select('t1');

        const button = menuOn('t1').querySelector('[data-action="duplicate-item"]');

        expect(button).not.toBeNull();
        expect(button.querySelector('svg')).not.toBeNull();
        expect(button.getAttribute('aria-label')).toBeTruthy();
        expect(button.getAttribute('title')).toBeTruthy();
    });

    it('keeps the rail describing the item rather than acting on it', () => {
        mount();
        select('t1');

        expect(panel().querySelector('[data-action="duplicate-item"]')).toBeNull();
        expect(panel().querySelector('[data-action="delete-item"]')).toBeNull();
    });

    it('adds a second item to the band', () => {
        const d = mount();
        select('t1');
        press(menuOn('t1'), 'duplicate-item');

        expect(itemsOn(d, 'detail')).toHaveLength(3);
        expect(itemsOn(d, 'detail')[0]).toBe('t1');
    });

    it('leaves the copy selected, not the original', () => {
        const d = mount();
        select('t1');
        press(menuOn('t1'), 'duplicate-item');

        const made = itemsOn(d, 'detail').at(-1);

        expect(panel().querySelector('.dz-panel-id').textContent).toBe(made);
        expect(made).not.toBe('t1');
    });

    it('duplicates on ctrl+d as well', () => {
        const d = mount();
        select('t1');
        chord('d');

        expect(itemsOn(d, 'detail')).toHaveLength(3);
    });

    it('does nothing when nothing is selected', () => {
        const d = mount();
        chord('d');

        expect(itemsOn(d, 'detail')).toHaveLength(2);
    });

    /**
     * A report binds one table, so a copy of it would be one that printed its
     * header and no rows. Offered greyed rather than hidden, so the pill says
     * the action exists and why it cannot be taken.
     */
    it('will not copy the table, and says why in the pill', () => {
        const d = mount();
        select('tbl');

        const button = menuOn('tbl').querySelector('[data-action="duplicate-item"]');

        expect(button.disabled).toBe(true);
        expect(button.getAttribute('aria-label')).toMatch(/one table/);
        expect(itemsOn(d, 'detail')).toEqual(['t1', 'tbl']);
    });

    it('says why when the shortcut is used instead', () => {
        const d = mount();
        select('tbl');
        chord('d');

        expect(itemsOn(d, 'detail')).toEqual(['t1', 'tbl']);
        expect(root().querySelector('[data-role="status"]').textContent)
            .toMatch(/one table/);
    });

    it('copies every item of a multiple selection', () => {
        const d = mount(layout({
            bands: [band('detail', [
                text('t1', { y: 0, h: 20 }),
                text('t2', { y: 40, h: 20 })
            ])]
        }));
        select('t1');
        addToSelection('t2');

        press(menuOn('t2'), 'duplicate-item');

        expect(itemsOn(d, 'detail')).toHaveLength(4);
        expect(panel().querySelector('.dz-panel-type').textContent).toBe('2 items');
    });

    it('is one undo step, however many were copied', () => {
        const d = mount(layout({
            bands: [band('detail', [
                text('t1', { y: 0, h: 20 }),
                text('t2', { y: 40, h: 20 })
            ])]
        }));
        select('t1');
        addToSelection('t2');
        press(menuOn('t2'), 'duplicate-item');

        expect(itemsOn(d, 'detail')).toHaveLength(4);

        chord('z');

        expect(itemsOn(d, 'detail')).toHaveLength(2);
    });

    it('leaves a layout the engine still accepts', () => {
        const d = mount();
        select('tbl');
        press(menuOn('tbl'), 'duplicate-item');

        expect(() => validateLayout(d.layout)).not.toThrow();
    });

    it('marks the report unsaved, as any other edit does', () => {
        const d = mount();
        select('t1');
        press(menuOn('t1'), 'duplicate-item');

        expect(d.dirty).toBe(true);
    });
});

describe('copy and paste', () => {
    /** the shared fixture has an empty page header; these need something in it */
    const withHeader = () => layout({
        bands: [
            band('pageHeader', [text('ph', { x: 0, y: 0, w: 200, h: 20 })], { height: 60 }),
            band('detail', [text('t1', { x: 0, y: 0, w: 200, h: 40 }), table({ id: 'tbl' })])
        ]
    });
    /** the pill's paste button, for whatever the right-click landed on */
    const pasteButton = (id = null) =>
        menuOn(id).querySelector('[data-action="paste-items"]');

    function chord(letter, { on = root(), target = null } = {}) {
        const event = new KeyboardEvent('keydown', {
            key: letter, ctrlKey: true, bubbles: true, cancelable: true
        });
        (target ?? on).dispatchEvent(event);
        return event;
    }

    it('offers copy on an item, and paste on bare page too', () => {
        mount();
        select('t1');

        expect(menuOn('t1').querySelector('[data-action="copy-items"]')).not.toBeNull();

        /** a right-click on nothing still opens, so paste is always reachable */
        const bare = menuOn();

        expect(bare.querySelector('[data-action="paste-items"]')).not.toBeNull();
        expect(bare.querySelector('[data-action="copy-items"]')).toBeNull();
    });

    it('has nothing to paste until something is copied', () => {
        mount();

        expect(pasteButton().disabled).toBe(true);

        select('t1');
        press(menuOn('t1'), 'copy-items');

        expect(pasteButton().disabled).toBe(false);
    });

    it('copying alone changes nothing', () => {
        const d = mount();
        select('t1');
        press(menuOn('t1'), 'copy-items');

        expect(itemsOn(d, 'detail')).toHaveLength(2);
        expect(d.dirty).toBe(false);
    });

    it('pastes a copy onto the band', () => {
        const d = mount();
        select('t1');
        press(menuOn('t1'), 'copy-items');
        click(pasteButton('t1'));

        expect(itemsOn(d, 'detail')).toHaveLength(3);
        expect(itemsOn(d, 'detail')[0]).toBe('t1');
    });

    it('works from the keyboard', () => {
        const d = mount();
        select('t1');
        chord('c');
        chord('v');

        expect(itemsOn(d, 'detail')).toHaveLength(3);
    });

    it('pastes again without stacking one copy on the last', () => {
        const d = mount();
        select('t1');
        chord('c');
        chord('v');
        chord('v');

        const items = d.layout.bands.find(b => b.type === 'detail').items;
        const copies = items.filter(i => i.id !== 't1' && i.type === 'text');

        expect(copies).toHaveLength(2);
        expect(copies[0].y).not.toBe(copies[1].y);
    });

    it('pastes into the band being worked in', () => {
        const d = mount(withHeader());
        select('t1');
        chord('c');

        /** selecting the header band's own item makes it the paste target */
        select('ph');
        chord('v');

        expect(itemsOn(d, 'pageHeader')).toHaveLength(2);
        expect(itemsOn(d, 'detail')).toHaveLength(2);
    });

    it('brings an item pasted into a shorter band into view', () => {
        const d = mount(withHeader());
        select('t1');
        chord('c');
        select('ph');
        chord('v');

        const zone = designZones(d.layout).find(z => z.type === 'pageHeader');
        const pasted = d.layout.bands
            .find(b => b.type === 'pageHeader').items.at(-1);

        expect(pasted.y).toBeLessThanOrEqual(zone.height);
    });

    it('leaves the clipboard alone when the original is edited afterwards', () => {
        const d = mount();
        select('t1');
        chord('c');

        d.layout.bands.find(b => b.type === 'detail')
            .items.find(i => i.id === 't1').value = 'changed';

        chord('v');

        const pasted = d.layout.bands.find(b => b.type === 'detail').items.at(-1);

        expect(pasted.value).not.toBe('changed');
    });

    /**
     * The shortcut people reach for far more often is copying a value out of
     * the rail, and a designer that swallows it is a designer they stop using.
     */
    it('leaves ctrl+C to the browser while a field has the caret', () => {
        const d = mount();
        select('t1');

        const box = panel().querySelector('textarea, input');
        const event = chord('c', { target: box });

        expect(event.defaultPrevented).toBe(false);
        expect(pasteButton().disabled).toBe(true);
        expect(itemsOn(d, 'detail')).toHaveLength(2);
    });

    it('pastes nothing when nothing was copied', () => {
        const d = mount();
        chord('v');

        expect(itemsOn(d, 'detail')).toHaveLength(2);
    });

    it('leaves a layout the engine still accepts', () => {
        const d = mount();
        select('tbl');
        chord('c');
        chord('v');

        expect(() => validateLayout(d.layout)).not.toThrow();
    });
});

describe('the right-click pill', () => {
    const openMenu = () => root().querySelector('[data-role="menu"]');

    function rightClick(id = null) {
        const target = id ? drawn(id) : root().querySelector('.dz-canvas');

        target.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 2
        }));
    }

    it('opens on a right-click and suppresses the browser menu', () => {
        mount();

        const event = new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 2
        });
        drawn('t1').dispatchEvent(event);

        expect(openMenu()).not.toBeNull();
        expect(event.defaultPrevented).toBe(true);
    });

    /**
     * Otherwise Delete would take whatever happened to be selected somewhere
     * else on the page, which is how a layout gets lost to a stray click.
     */
    it('selects what was right-clicked, if it was not already', () => {
        const d = mount();
        select('t1');
        rightClick('tbl');

        press(openMenu(), 'delete-item');

        expect(itemsOn(d, 'detail')).toEqual(['t1']);
    });

    it('keeps a group when one of its members is right-clicked', () => {
        const d = mount();
        select('t1');

        const event = new MouseEvent('pointerdown', {
            bubbles: true, cancelable: true, clientX: 0, clientY: 0,
            button: 0, shiftKey: true
        });
        event.pointerId = 1;
        drawn('tbl').dispatchEvent(event);

        rightClick('tbl');
        press(openMenu(), 'delete-item');

        expect(itemsOn(d, 'detail')).toEqual([]);
    });

    it('drops the selection when the right-click was on bare page', () => {
        mount();
        select('t1');
        rightClick();

        expect(openMenu().querySelector('[data-action="delete-item"]')).toBeNull();
        expect(openMenu().querySelector('[data-action="paste-items"]')).not.toBeNull();
    });

    it('is placed inside the page area', () => {
        mount();
        rightClick('t1');

        const menu = openMenu();

        expect(menu.parentElement.classList.contains('dz-main')).toBe(true);
        expect(menu.style.left).toMatch(/px$/);
        expect(menu.style.top).toMatch(/px$/);
    });

    it('closes once an action is taken', () => {
        mount();
        rightClick('t1');
        press(openMenu(), 'duplicate-item');

        expect(openMenu()).toBeNull();
    });

    it('closes on a press anywhere else', () => {
        mount();
        rightClick('t1');

        const event = new MouseEvent('pointerdown', {
            bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0
        });
        event.pointerId = 1;
        document.body.dispatchEvent(event);

        expect(openMenu()).toBeNull();
    });

    it('closes on escape', () => {
        mount();
        rightClick('t1');

        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape', bubbles: true, cancelable: true
        }));

        expect(openMenu()).toBeNull();
    });

    it('closes when the page is scrolled out from under it', () => {
        mount();
        rightClick('t1');

        root().querySelector('.dz-canvas')
            .dispatchEvent(new Event('scroll', { bubbles: false }));

        expect(openMenu()).toBeNull();
    });

    it('opens again after being closed, without stacking pills', () => {
        mount();
        rightClick('t1');
        rightClick('tbl');

        expect(root().querySelectorAll('[data-role="menu"]')).toHaveLength(1);
    });

    it('does not open over a report that is being previewed', () => {
        const d = mount();
        d.togglePreview();

        expect(d.mode).toBe('preview');

        rightClick();

        expect(openMenu()).toBeNull();
    });

    it('goes when the designer does', () => {
        mount();
        rightClick('t1');

        expect(openMenu()).not.toBeNull();

        designer.destroy();
        designer = null;

        expect(document.querySelector('[data-role="menu"]')).toBeNull();
    });

    it('says so in the bar when a copy is taken, since nothing else moves', () => {
        mount();
        select('t1');
        press(menuOn('t1'), 'copy-items');

        expect(root().querySelector('[data-role="status"]').textContent)
            .toBe('Copied');
    });
});

describe('problems are said in the corner', () => {
    const toast = () => root().querySelector('.dz-toasts .dz-problems');

    /** the layout the author is halfway through: grouped, but no group band yet */
    const halfGrouped = (d) => {
        d.layout.groupBy = 'region';
        d.redraw();
    };

    it('puts the toast in the corner region, not in the canvas', () => {
        const d = mount();
        halfGrouped(d);

        expect(toast()).not.toBeNull();
        expect(root().querySelector('.dz-canvas .dz-problems')).toBeNull();
    });

    /**
     * The window's top right corner is the top of the properties rail, and the
     * rail is where the band switches are - so a message pinned there would
     * cover the fix for the thing it is complaining about.
     */
    it('hangs over the page area, not over the properties rail', () => {
        const d = mount();
        halfGrouped(d);

        const region = root().querySelector('.dz-toasts');

        expect(region.closest('.dz-main')).not.toBeNull();
        expect(region.closest('.dz-panel')).toBeNull();
    });

    /**
     * The whole point of the move: a half-finished layout is the normal state
     * of one being designed, and a message above the page shifted the design
     * down the canvas every time.
     */
    it('leaves the page where it was', () => {
        /**
         * The sheet is two boxes down from the canvas now - the zoom scales one
         * and sizes the other - so what this is about is that it is still drawn
         * at all, not what it is nested in.
         */
        const d = mount();
        const surface = root().querySelector('[data-role="zoom-layer"]');

        expect(surface.firstElementChild.classList.contains('dz-sheet')).toBe(true);

        halfGrouped(d);

        expect(surface.firstElementChild.classList.contains('dz-sheet')).toBe(true);
        expect(root().querySelector('.dz-page')).not.toBeNull();
    });

    it('closes when told to, and stays closed for the same problem', () => {
        const d = mount();
        halfGrouped(d);

        click(toast().querySelector('[data-action="dismiss-problems"]'));

        expect(toast()).toBeNull();

        d.redraw();

        expect(toast()).toBeNull();
    });

    it('comes back when what is wrong changes', () => {
        const d = mount();
        halfGrouped(d);
        click(toast().querySelector('[data-action="dismiss-problems"]'));

        expect(toast()).toBeNull();

        /** a second fault: the validator now has more to say */
        d.layout.page = {};
        d.redraw();

        expect(toast()).not.toBeNull();
    });

    it('goes when the report validates, and is announced again if it breaks', () => {
        const d = mount();
        halfGrouped(d);

        expect(toast()).not.toBeNull();

        /** re-queried each time: switching a band on rebuilds the rail */
        const setBand = (on) => {
            const node = panel().querySelector('[data-band="groupHeader"]');
            node.checked = on;
            node.dispatchEvent(new Event('change', { bubbles: true }));
        };

        setBand(true);

        expect(toast()).toBeNull();

        setBand(false);

        expect(toast()).not.toBeNull();
    });

    it('says nothing over a preview, which reports its own failure', () => {
        const d = mount();
        halfGrouped(d);

        expect(toast()).not.toBeNull();

        d.togglePreview();

        expect(toast()).toBeNull();

        d.togglePreview();

        expect(toast()).not.toBeNull();
    });

    it('names the field the validator named', () => {
        const d = mount();
        d.layout.page = {};
        d.redraw();

        expect(toast().textContent).toMatch(/page\.width/);
    });
});

describe('the line tool', () => {
    const foot = () => root().querySelector('.dz-foot');

    const lastOn = (d, type) =>
        d.layout.bands.find(b => b.type === type).items.at(-1);

    it('adds a line to the band being worked in', () => {
        const d = mount();
        press(foot(), 'add-line');

        expect(itemsOn(d, 'detail')).toEqual(['t1', 'tbl', 'line-1']);
        expect(lastOn(d, 'detail').type).toBe('line');
    });

    it('draws the tool as a labelled glyph, like the rest of the strip', () => {
        mount();
        const button = foot().querySelector('[data-action="add-line"]');

        expect(button.querySelector('svg')).not.toBeNull();
        expect(button.getAttribute('aria-label')).toBeTruthy();
        expect(button.getAttribute('title')).toBeTruthy();
    });

    it('selects what it added, so the rail is already on it', () => {
        const d = mount();
        press(foot(), 'add-line');

        expect(d.selection).toMatchObject({ band: 'detail', id: 'line-1' });
        expect(panel().querySelector('.dz-panel-type').textContent).toBe('line');
    });

    it('offers the pen in the rail', () => {
        mount();
        press(foot(), 'add-line');

        const labels = [...panel().querySelectorAll('label')]
            .map(l => l.textContent.trim());

        expect(labels).toEqual(expect.arrayContaining(['Runs', 'Thickness', 'Style']));
    });

    it('draws it on the canvas as a line, not as a box', () => {
        mount();
        press(foot(), 'add-line');

        const node = root().querySelector('[data-item-id="line-1"]');

        expect(node.dataset.itemType).toBe('line');
        expect(node.querySelector('.line-mark')).not.toBeNull();
    });

    it('adds it to the band the selection is on instead', () => {
        const d = mount();
        select('t1');
        d.select({ band: 'pageHeader', id: null });
        press(foot(), 'add-line');

        expect(itemsOn(d, 'pageHeader')).toEqual(['line-1']);
    });

    it('leaves a layout the engine accepts', () => {
        const d = mount();
        press(foot(), 'add-line');

        expect(validateLayout(d.layout)).toEqual([]);
    });

    it('is one undo step', () => {
        const d = mount();
        press(foot(), 'add-line');

        expect(itemsOn(d, 'detail')).toHaveLength(3);

        root().dispatchEvent(new KeyboardEvent('keydown', {
            key: 'z', ctrlKey: true, bubbles: true, cancelable: true
        }));

        expect(itemsOn(d, 'detail')).toHaveLength(2);
    });
});

describe('the box tool', () => {
    const foot = () => root().querySelector('.dz-foot');

    it('adds a box to the band being worked in', () => {
        const d = mount();
        press(foot(), 'add-box');

        expect(itemsOn(d, 'detail')).toEqual(['t1', 'tbl', 'box-1']);
    });

    it('draws the tool as a labelled glyph, like the rest of the strip', () => {
        mount();
        const button = foot().querySelector('[data-action="add-box"]');

        expect(button.querySelector('svg')).not.toBeNull();
        expect(button.getAttribute('aria-label')).toBeTruthy();
        expect(button.getAttribute('title')).toBeTruthy();
    });

    it('offers the outline in the rail', () => {
        mount();
        press(foot(), 'add-box');

        const labels = [...panel().querySelectorAll('label')]
            .map(l => l.textContent.trim());

        expect(labels).toEqual(expect.arrayContaining(['Style', 'Width', 'Corner']));
    });

    it('draws it on the canvas as a box', () => {
        mount();
        press(foot(), 'add-box');

        expect(root().querySelector('[data-item-id="box-1"]').dataset.itemType)
            .toBe('box');
    });

    it('leaves a layout the engine accepts', () => {
        const d = mount();
        press(foot(), 'add-box');

        expect(validateLayout(d.layout)).toEqual([]);
    });

    /**
     * A box is usually drawn round something, and the canvas paints in the same
     * order the print does - by y - so a frame placed above what it frames sits
     * behind it rather than over it.
     */
    it('sits behind what it is drawn round, as it will when printed', () => {
        const d = mount();
        press(foot(), 'add-box');

        const detail = d.layout.bands.find(b => b.type === 'detail');
        const frame = detail.items.at(-1);

        /** the frame starts above what it frames, which is what puts it behind */
        frame.y = 0;
        frame.h = 400;
        detail.items.find(i => i.id === 't1').y = 20;
        d.redraw();

        const canvas = root().querySelector('.dz-canvas').innerHTML;

        expect(canvas.indexOf('data-item-id="box-1"'))
            .toBeLessThan(canvas.indexOf('data-item-id="t1"'));
    });
});

describe('the table tool is offered once', () => {
    const foot = () => root().querySelector('.dz-foot');
    const tool = () => foot().querySelector('[data-role="add-table"]');

    it('is available on a report with no table', () => {
        mount(tableless());

        expect(tool().disabled).toBe(false);
        expect(tool().title).toBe('Add a table');
    });

    /** greyed rather than absent: it says the tool exists, and why it is not usable */
    it('is greyed once the report has one, and says why', () => {
        mount();

        expect(tool().disabled).toBe(true);
        expect(tool().title).toMatch(/one table/);
    });

    it('comes back when the table is deleted', () => {
        mount();
        select('tbl');
        press(menuOn('tbl'), 'delete-item');

        expect(tool().disabled).toBe(false);
    });

    it('goes again on undo, which puts the table back', () => {
        mount();
        select('tbl');
        press(menuOn('tbl'), 'delete-item');

        root().dispatchEvent(new KeyboardEvent('keydown', {
            key: 'z', ctrlKey: true, bubbles: true, cancelable: true
        }));

        expect(tool().disabled).toBe(true);
    });

    it('refuses the action too, not only the button', () => {
        const d = mount();

        press(foot(), 'add-table');

        expect(root().querySelector('[data-role="column-dialog"]')).toBeNull();
        expect(itemsOn(d, 'detail')).toEqual(['t1', 'tbl']);
        expect(root().querySelector('[data-role="status"]').textContent)
            .toMatch(/already has a table/);
    });

    it('leaves the report the engine accepts', () => {
        const d = mount();
        press(foot(), 'add-table');

        expect(validateLayout(d.layout)).toEqual([]);
    });
});

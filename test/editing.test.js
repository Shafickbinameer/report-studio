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
        const d = mount();
        await addTable(4);

        expect(itemsOn(d, 'detail')).toContain('table-1');
    });

    it('leaves the report valid', async () => {
        const d = mount();
        press(foot(), 'add-text');
        await addTable(3);

        expect(validateLayout(d.layout)).toEqual([]);
    });
});


describe('the table dialog', () => {
    const dialog = () => root().querySelector('[data-role="column-dialog"]');
    const foot = () => root().querySelector('.dz-foot');

    it('asks before adding anything', () => {
        const d = mount();
        press(foot(), 'add-table');

        expect(dialog()).not.toBeNull();
        expect(itemsOn(d, 'detail')).toEqual(['t1', 'tbl']);
    });

    it('makes the number of columns it was given', async () => {
        const d = mount();
        await addTable(5);

        const made = d.layout.bands[1].items.at(-1);
        expect(made.columns).toHaveLength(5);
    });

    it('starts every column at 50 wide', async () => {
        const d = mount();
        await addTable(4);

        expect(d.layout.bands[1].items.at(-1).columns.map(c => c.width))
            .toEqual([50, 50, 50, 50]);
    });

    it('adds nothing when cancelled', async () => {
        const d = mount();
        press(foot(), 'add-table');
        click(dialog().querySelector('[data-role="cancel"]'));

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(itemsOn(d, 'detail')).toEqual(['t1', 'tbl']);
        expect(dialog()).toBeNull();
    });

    it('cancels on escape without dropping the selection behind it', async () => {
        /**
         * select.js listens for escape too - the dialog captures and stops it,
         * or cancelling would silently deselect whatever was being worked on.
         */
        const d = mount();
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
    it('removes the selected item from the rail button', () => {
        const d = mount();
        select('t1');
        press(panel(), 'delete-item');

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

    it('narrows the band list to where an aggregate resolves', async () => {
        await openTool();
        choose('sum');

        const bands = [...box()
            .querySelectorAll('[data-role="band-dropdown"] .dropdown-item')]
            .map(n => n.dataset.value);

        expect(bands).toEqual(['groupFooter']);
    });

    it('warns rather than refuses when it will not resolve there', async () => {
        /**
         * It is the author's report. An item placed where it prints nothing
         * today may be somewhere it prints tomorrow.
         */
        const d = await openTool(layout({
            bands: [band('detail', [table({ id: 'tbl' })])]
        }));

        choose('sum');

        const warning = box().querySelector('[data-role="token-warning"]');
        expect(warning.hidden).toBe(false);
        expect(warning.textContent).toMatch(/group footer/);
        expect(box().querySelector('[data-role="confirm"]').textContent)
            .toContain('anyway');

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

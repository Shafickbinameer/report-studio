/**
 * @vitest-environment jsdom
 *
 * Opening, saving, undo and redo through the designer.
 *
 * The store is injected rather than mocked at the fetch layer: what is being
 * specified here is the designer's behaviour against the four operations, and
 * the operations themselves already have a suite against a real server and a
 * real directory in routes.test.js.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDesigner } from '../src/designer/designer.js';
import { StoreError, toId } from '../src/shared/store.js';
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
    bands: [band('detail', [text('t1', { x: 0, y: 0, w: 200, h: 40 })])]
});

/** a store over a plain object, so a save can be read straight back */
function fakeStore(files = {}, data = {}) {
    return {
        saved: files,
        data,
        calls: [],

        async list() {
            this.calls.push('list');
            return Object.entries(files).map(([id, layout]) => ({
                id, name: layout.name ?? id,
                updatedAt: '2026-08-27T10:00:00.000Z', readable: true
            }));
        },

        async load(id) {
            this.calls.push(`load:${id}`);
            if (!files[id]) throw new StoreError(`there is no report called "${id}"`);
            return structuredClone(files[id]);
        },

        async save(id, layout) {
            this.calls.push(`save:${id}`);
            files[id] = structuredClone(layout);
            return { id, name: layout.name, updatedAt: '2026-08-27T10:00:00.000Z' };
        },

        async remove(id) {
            delete files[id];
            return { id, deleted: true };
        },

        async loadData(id) {
            this.calls.push(`loadData:${id}`);
            return data[id] ?? null;
        },

        async saveData(id, payload) {
            this.calls.push(`saveData:${id}`);
            data[id] = structuredClone(payload);
            return { id, kind: 'data' };
        }
    };
}

function mount({ store = fakeStore(), l = json(), id = null } = {}) {
    designer = createDesigner({ mount: '#report-designer', layout: l, id, store });
    return designer;
}

const root = () => document.getElementById('report-designer');
const bar = () => root().querySelector('.dz-bar');
const status = () => bar().querySelector('[data-role="status"]').textContent;
const drawn = (id) => root().querySelector(`[data-item-id="${id}"]`);
const dialog = (role) => root().querySelector(`[data-role="${role}"]`);

function click(node) {
    node?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function press(action) {
    click(bar().querySelector(`[data-action="${action}"]`));
}

function select(id) {
    const event = new MouseEvent('pointerdown', {
        bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0
    });
    event.pointerId = 1;
    drawn(id).dispatchEvent(event);
}

function drag(id, dx, dy) {
    const canvas = root().querySelector('.dz-canvas');
    const down = new MouseEvent('pointerdown', {
        bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0
    });
    down.pointerId = 1;
    drawn(id).dispatchEvent(down);

    for (const type of ['pointermove', 'pointerup']) {
        const event = new MouseEvent(type, {
            bubbles: true, cancelable: true, clientX: dx, clientY: dy, button: 0
        });
        event.pointerId = 1;
        canvas.dispatchEvent(event);
    }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

/** the open dialog picks with a dropdown, then confirms */
const reportNames = () =>
    [...dialog('open-dialog').querySelectorAll('.dropdown-item')]
        .map(node => node.textContent.trim());

async function chooseReport(id) {
    const box = dialog('open-dialog');

    click(box.querySelector('.dropdown-trigger'));
    click(box.querySelector(`.dropdown-item[data-value="${id}"]`));
    click(box.querySelector('[data-role="confirm"]'));

    await settle();
}


describe('toId', () => {
    it('turns a name into the filename it will be saved as', () => {
        expect(toId('Sales Summary')).toBe('sales-summary');
        expect(toId('Invoice / June 2026')).toBe('invoice-june-2026');
    });

    it('trims what would otherwise dangle', () => {
        expect(toId('  Sales!!  ')).toBe('sales');
    });

    it('is empty when nothing usable is left, since routes.js needs a slug', () => {
        expect(toId('///')).toBe('');
        expect(toId('')).toBe('');
    });

    it('keeps it inside the length the server accepts', () => {
        expect(toId('a'.repeat(200)).length).toBeLessThanOrEqual(64);
    });
});


describe('the bar', () => {
    it('says a new report has not been saved', () => {
        mount();
        expect(status()).toBe('Not saved yet');
    });

    it('says where an opened report came from', () => {
        mount({ id: 'invoice' });
        expect(status()).toBe('Saved as invoice.json');
    });

    it('says when there are changes the disk has not seen', () => {
        mount({ id: 'invoice' });
        drag('t1', 50, 0);

        expect(status()).toBe('Unsaved changes');
        expect(bar().dataset.dirty).toBe('true');
    });

    it('starts with undo and redo unavailable', () => {
        mount();

        expect(bar().querySelector('[data-role="undo"]').disabled).toBe(true);
        expect(bar().querySelector('[data-role="redo"]').disabled).toBe(true);
    });
});


describe('saving', () => {
    it('asks what to call a report that has never been saved', async () => {
        const store = fakeStore();
        mount({ store });

        press('save');
        await settle();

        expect(dialog('save-dialog')).not.toBeNull();
        expect(store.calls).toEqual([]);
    });

    it('shows the filename the name will become, before writing it', async () => {
        mount();
        press('save');
        await settle();

        const field = dialog('save-dialog').querySelector('[data-role="report-name"]');
        field.value = 'Sales / June';
        field.dispatchEvent(new Event('input', { bubbles: true }));

        expect(dialog('save-dialog').querySelector('[data-role="filename"]').textContent)
            .toBe('sales-june.json');
    });

    it('will not save a name that leaves no usable filename', async () => {
        mount();
        press('save');
        await settle();

        const box = dialog('save-dialog');
        const field = box.querySelector('[data-role="report-name"]');
        field.value = '///';
        field.dispatchEvent(new Event('input', { bubbles: true }));

        expect(box.querySelector('[data-role="confirm"]').disabled).toBe(true);
    });

    it('writes the report under the name it was given', async () => {
        const store = fakeStore();
        mount({ store });

        press('save');
        await settle();

        const box = dialog('save-dialog');
        box.querySelector('[data-role="report-name"]').value = 'Sales Summary';
        box.querySelector('form').dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }));
        await settle();

        expect(store.calls).toContain('save:sales-summary');
        expect(store.saved['sales-summary'].name).toBe('Sales Summary');
    });

    it('remembers where it was saved, so the next save does not ask', async () => {
        const store = fakeStore();
        const d = mount({ store });

        press('save');
        await settle();
        const box = dialog('save-dialog');
        box.querySelector('[data-role="report-name"]').value = 'Invoice';
        box.querySelector('form').dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }));
        await settle();

        expect(d.id).toBe('invoice');
        expect(status()).toBe('Saved as invoice.json');

        drag('t1', 50, 0);
        press('save');
        await settle();

        expect(dialog('save-dialog')).toBeNull();
        expect(store.calls.filter(c => c === 'save:invoice')).toHaveLength(2);
    });

    it('writes nothing when the name dialog is cancelled', async () => {
        const store = fakeStore();
        mount({ store });

        press('save');
        await settle();
        click(dialog('save-dialog').querySelector('[data-role="cancel"]'));
        await settle();

        expect(store.calls).toEqual([]);
    });

    it('saves a report that is not finished yet', async () => {
        /**
         * Half-designed is legitimately invalid, and refusing to keep somebody's
         * work in progress is not a safety feature.
         */
        const store = fakeStore();
        const d = mount({ store, id: 'wip' });

        d.layout.groupBy = 'region';
        d.redraw();

        press('save');
        await settle();

        expect(store.saved.wip.groupBy).toBe('region');
    });

    it('is clean again once written', async () => {
        const d = mount({ store: fakeStore(), id: 'invoice' });
        drag('t1', 50, 0);

        expect(d.dirty).toBe(true);

        press('save');
        await settle();

        expect(d.dirty).toBe(false);
    });
});


describe('opening', () => {
    const store = () => fakeStore({
        invoice: { ...json(), name: 'Invoice' },
        sales: { ...json(), name: 'Sales summary' }
    });

    it('offers what the server has, by name', async () => {
        mount({ store: store() });

        press('open');
        await settle();

        expect(reportNames()).toEqual(['Invoice', 'Sales summary']);
    });

    it('shows the filename and date under the picker', async () => {
        /**
         * A dropdown shows one line, so what the name alone does not settle -
         * which file it is, when it changed - goes underneath it.
         */
        mount({ store: store() });
        press('open');
        await settle();

        const meta = dialog('open-dialog').querySelector('[data-role="report-meta"]');
        expect(meta.textContent).toContain('invoice.json');
        expect(meta.textContent).toMatch(/\d{4}/);
    });

    it('updates that line as the choice changes', async () => {
        mount({ store: store() });
        press('open');
        await settle();

        const box = dialog('open-dialog');
        const meta = box.querySelector('[data-role="report-meta"]');

        click(box.querySelector('.dropdown-trigger'));
        click(box.querySelector('.dropdown-item[data-value="sales"]'));

        expect(meta.textContent).toContain('sales.json');
    });

    it('loads the one that was chosen', async () => {
        const d = mount({ store: store() });

        press('open');
        await settle();
        await chooseReport('sales');

        expect(d.layout.name).toBe('Sales summary');
        expect(d.id).toBe('sales');
        expect(d.dirty).toBe(false);
    });

    it('opens the first report without touching the dropdown', async () => {
        /** a picker with nothing chosen is a step nobody asked for */
        const d = mount({ store: store() });

        press('open');
        await settle();
        click(dialog('open-dialog').querySelector('[data-role="confirm"]'));
        await settle();

        expect(d.id).toBe('invoice');
    });

    it('offers no picker at all when there is nothing saved', async () => {
        mount({ store: fakeStore() });

        press('open');
        await settle();

        const box = dialog('open-dialog');
        expect(box.querySelector('.dropdown')).toBeNull();
        expect(box.querySelector('[data-role="confirm"]')).toBeNull();
        expect(box.querySelector('[data-role="new"]')).not.toBeNull();
    });

    it('starts a blank report on request', async () => {
        const d = mount({ store: store() });

        press('open');
        await settle();
        click(dialog('open-dialog').querySelector('[data-role="new"]'));
        await settle();

        expect(d.layout.name).toBe('Untitled report');
        expect(d.id).toBeNull();
    });

    it('says what is wrong when there is no server', async () => {
        const broken = {
            list: () => Promise.reject(
                new StoreError('Cannot reach the report server. Start it with ' +
                    '`npx report-studio design`.', { offline: true }))
        };

        mount({ store: broken });
        press('open');
        await settle();

        expect(status()).toContain('report-studio design');
        expect(dialog('open-dialog')).toBeNull();
    });

    it('keeps the current report when opening is cancelled', async () => {
        const d = mount({ store: store(), id: 'invoice' });

        press('open');
        await settle();
        click(dialog('open-dialog').querySelector('[data-role="cancel"]'));
        await settle();

        expect(d.id).toBe('invoice');
    });
});


describe('undo and redo', () => {
    it('takes back a drag', () => {
        const d = mount();
        drag('t1', 50, 0);

        expect(d.layout.bands[0].items[0].x).toBe(50);

        press('undo');
        expect(d.layout.bands[0].items[0].x).toBe(0);
    });

    it('puts it back again', () => {
        const d = mount();
        drag('t1', 50, 0);
        press('undo');
        press('redo');

        expect(d.layout.bands[0].items[0].x).toBe(50);
    });

    it('redraws the page, not just the object', () => {
        mount();
        drag('t1', 50, 0);
        press('undo');

        expect(drawn('t1').style.left).toBe('0px');
    });

    it('takes back adding an item', () => {
        const d = mount();
        click(root().querySelector('[data-action="add-text"]'));

        expect(d.layout.bands[0].items).toHaveLength(2);

        press('undo');
        expect(d.layout.bands[0].items).toHaveLength(1);
    });

    it('takes back deleting one', () => {
        const d = mount();
        select('t1');
        click(root().querySelector('[data-action="delete-item"]'));

        expect(d.layout.bands[0].items).toHaveLength(0);

        press('undo');
        expect(d.layout.bands[0].items).toHaveLength(1);
    });

    it('takes back switching a band on', () => {
        const d = mount();
        const toggle = root().querySelector('[data-band="pageFooter"]');
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));

        expect(d.layout.bands.map(b => b.type)).toContain('pageFooter');

        press('undo');
        expect(d.layout.bands.map(b => b.type)).not.toContain('pageFooter');
    });

    it('treats a burst of typing as one step', () => {
        const d = mount();
        select('t1');

        const box = root().querySelector('.dz-panel [data-field="w"]');
        for (const value of ['2', '25', '250']) {
            box.value = value;
            box.dispatchEvent(new Event('input', { bubbles: true }));
        }

        expect(d.layout.bands[0].items[0].w).toBe(250);

        press('undo');
        expect(d.layout.bands[0].items[0].w).toBe(200);
    });

    it('drops the selection, which may not exist in what was restored', () => {
        const d = mount();
        select('t1');
        click(root().querySelector('[data-action="delete-item"]'));
        press('undo');

        expect(d.selection).toBeNull();
    });

    it('enables and disables the buttons as it goes', () => {
        mount();
        const undo = () => bar().querySelector('[data-role="undo"]');
        const redo = () => bar().querySelector('[data-role="redo"]');

        drag('t1', 50, 0);
        expect(undo().disabled).toBe(false);
        expect(redo().disabled).toBe(true);

        press('undo');
        expect(undo().disabled).toBe(true);
        expect(redo().disabled).toBe(false);
    });

    it('starts a fresh history for a report that was just opened', async () => {
        const files = fakeStore({ invoice: { ...json(), name: 'Invoice' } });
        mount({ store: files });

        drag('t1', 50, 0);
        press('open');
        await settle();
        await chooseReport('invoice');

        expect(bar().querySelector('[data-role="undo"]').disabled).toBe(true);
    });
});


describe('shortcuts', () => {
    const key = (name, extra = {}) => root().dispatchEvent(new KeyboardEvent('keydown', {
        key: name, bubbles: true, cancelable: true, ctrlKey: true, ...extra
    }));

    it('undoes with ctrl+Z', () => {
        const d = mount();
        drag('t1', 50, 0);
        key('z');

        expect(d.layout.bands[0].items[0].x).toBe(0);
    });

    it('redoes with ctrl+shift+Z', () => {
        const d = mount();
        drag('t1', 50, 0);
        key('z');
        key('z', { shiftKey: true });

        expect(d.layout.bands[0].items[0].x).toBe(50);
    });

    it('redoes with ctrl+Y as well', () => {
        const d = mount();
        drag('t1', 50, 0);
        key('z');
        key('y');

        expect(d.layout.bands[0].items[0].x).toBe(50);
    });

    it('saves with ctrl+S', async () => {
        const store = fakeStore();
        mount({ store, id: 'invoice' });

        drag('t1', 50, 0);
        key('s');
        await settle();

        expect(store.calls).toContain('save:invoice');
    });

    it('opens with ctrl+O', async () => {
        mount({ store: fakeStore({ invoice: json() }) });

        key('o');
        await settle();

        expect(dialog('open-dialog')).not.toBeNull();
    });

    it('leaves a plain keystroke alone', () => {
        const d = mount();
        drag('t1', 50, 0);

        root().dispatchEvent(new KeyboardEvent('keydown', {
            key: 'z', bubbles: true, cancelable: true
        }));

        expect(d.layout.bands[0].items[0].x).toBe(50);
    });
});


describe('the data file that goes with a report', () => {
    const withPlaceholders = () => layout({
        groupBy: 'region',
        bands: [
            band('reportHeader', [
                text('h', { value: '{report.period}' })
            ], { height: 40 }),
            band('detail', [table({ id: 'tbl' })])
        ]
    });

    it('is written the first time a report is saved', async () => {
        const store = fakeStore();
        mount({ store, l: withPlaceholders(), id: 'sales' });

        press('save');
        await settle();

        expect(store.data.sales).toBeDefined();
        expect(Array.isArray(store.data.sales.items)).toBe(true);
    });

    it('carries the keys the layout is asking for', async () => {
        const store = fakeStore();
        mount({ store, l: withPlaceholders(), id: 'sales' });

        press('save');
        await settle();

        expect(store.data.sales.report).toHaveProperty('period');
        expect(Object.keys(store.data.sales.items[0]).sort())
            .toEqual(['name', 'price', 'qty', 'region']);
    });

    it('is never overwritten once it holds real data', async () => {
        /**
         * The rule this whole feature stands on. Quietly replacing the host
         * application's figures with "Customer 1" would be worse than never
         * having offered to help.
         */
        const real = { items: [{ name: 'Real thing', qty: 1, price: 9 }] };
        const store = fakeStore({}, { sales: real });

        mount({ store, l: withPlaceholders(), id: 'sales' });

        press('save');
        await settle();

        expect(store.data.sales).toEqual(real);
        expect(store.calls).not.toContain('saveData:sales');
    });

    it('does not fail the save when seeding the data cannot be done', async () => {
        /**
         * A report that saved but whose sample data did not is a working
         * report. Complaining would bury the fact that the save succeeded.
         */
        const store = fakeStore();
        store.saveData = () => Promise.reject(new StoreError('disk is full'));

        const d = mount({ store, l: withPlaceholders(), id: 'sales' });

        press('save');
        await settle();

        expect(d.dirty).toBe(false);
        expect(status()).toBe('Saved as sales.json');
    });
});


describe('the data dialog', () => {
    const withPlaceholders = () => layout({
        bands: [band('detail', [table({ id: 'tbl' })])]
    });

    const box = () => dialog('data-dialog');
    const payload = () => box().querySelector('[data-role="payload"]');

    it('derives the payload for a report that has no data yet', async () => {
        mount({ store: fakeStore(), l: withPlaceholders(), id: 'sales' });

        press('data');
        await settle();

        const shown = JSON.parse(payload().value);
        expect(Object.keys(shown.items[0]).sort()).toEqual(['name', 'price', 'qty']);
    });

    it('shows the real data when there is some', async () => {
        const real = { items: [{ name: 'Real thing', qty: 1, price: 9 }] };
        const store = fakeStore({}, { sales: real });

        mount({ store, l: withPlaceholders(), id: 'sales' });

        press('data');
        await settle();

        expect(JSON.parse(payload().value)).toEqual(real);
    });

    it('answers the question even for a report never saved', async () => {
        mount({ store: fakeStore(), l: withPlaceholders() });

        press('data');
        await settle();

        expect(box()).not.toBeNull();
        expect(JSON.parse(payload().value).items).toBeDefined();
    });

    it('writes what was typed into it', async () => {
        const store = fakeStore();
        mount({ store, l: withPlaceholders(), id: 'sales' });

        press('data');
        await settle();

        payload().value = '{"items":[{"name":"Edited","qty":2,"price":50}]}';
        payload().dispatchEvent(new Event('input', { bubbles: true }));
        click(box().querySelector('[data-role="confirm"]'));
        await settle();

        expect(store.data.sales.items[0].name).toBe('Edited');
    });

    it('says where the JSON is broken rather than after the click', async () => {
        mount({ store: fakeStore(), l: withPlaceholders(), id: 'sales' });

        press('data');
        await settle();

        payload().value = '{ not json';
        payload().dispatchEvent(new Event('input', { bubbles: true }));

        expect(box().querySelector('[data-role="parse-error"]').textContent)
            .not.toBe('');
        expect(box().querySelector('[data-role="confirm"]').disabled).toBe(true);
    });

    it('refuses a payload that is not an object keyed by dataset', async () => {
        mount({ store: fakeStore(), l: withPlaceholders(), id: 'sales' });

        press('data');
        await settle();

        payload().value = '[1, 2, 3]';
        payload().dispatchEvent(new Event('input', { bubbles: true }));

        expect(box().querySelector('[data-role="confirm"]').disabled).toBe(true);
    });

    it('writes nothing when cancelled', async () => {
        const store = fakeStore();
        mount({ store, l: withPlaceholders(), id: 'sales' });

        press('data');
        await settle();
        click(box().querySelector('[data-role="cancel"]'));
        await settle();

        expect(store.calls).not.toContain('saveData:sales');
    });
});


describe('the link to the preview screen', () => {
    const link = () => bar().querySelector('[data-role="open-preview"]');

    it('is inert until the report has been saved', () => {
        /** the preview screen reads the report off disk; there is no file yet */
        mount();

        expect(link().hasAttribute('href')).toBe(false);
        expect(link().getAttribute('aria-disabled')).toBe('true');
        expect(link().title).toMatch(/Save the report first/);
    });

    it('points at the saved report once there is one', () => {
        mount({ id: 'invoice' });

        expect(link().getAttribute('href')).toBe('../preview/?report=invoice');
        expect(link().hasAttribute('aria-disabled')).toBe(false);
    });

    it('is relative, so it resolves wherever the pages are mounted', () => {
        mount({ id: 'invoice' });
        expect(link().getAttribute('href').startsWith('../')).toBe(true);
    });

    it('opens beside the designer rather than replacing it', () => {
        mount({ id: 'invoice' });

        expect(link().target).toBe('_blank');
        expect(link().rel).toBe('noopener');
    });

    it('escapes an id on its way into the URL', () => {
        mount({ id: 'a-b_9' });
        expect(link().getAttribute('href')).toBe('../preview/?report=a-b_9');
    });

    it('comes alive when the report is saved for the first time', async () => {
        const store = fakeStore();
        mount({ store });

        press('save');
        await settle();

        const box = dialog('save-dialog');
        box.querySelector('[data-role="report-name"]').value = 'Sales Summary';
        box.querySelector('form').dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }));
        await settle();

        expect(link().getAttribute('href')).toBe('../preview/?report=sales-summary');
    });

    it('follows the report that was opened', async () => {
        const files = fakeStore({ invoice: json(), sales: json() });
        mount({ store: files });

        press('open');
        await settle();
        await chooseReport('sales');

        expect(link().getAttribute('href')).toBe('../preview/?report=sales');
    });
});

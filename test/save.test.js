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

function mount({ store = fakeStore(), l = json(), id = null, ...rest } = {}) {
    designer = createDesigner({
        mount: '#report-designer', layout: l, id, store, ...rest
    });
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


/**
 * Opening another report closes this one, so it is the moment unsaved work is
 * lost. Every way of dismissing the question means keep, because dismissing a
 * question about losing work is not agreeing to lose it.
 */
describe('closing a report with unsaved changes', () => {
    const store = () => fakeStore({
        invoice: { ...json(), name: 'Invoice' },
        sales: { ...json(), name: 'Sales summary' }
    });

    /** mounted under a name, so the question can be checked for saying which */
    const open = (extra = {}) => mount({
        store: store(), id: 'invoice', l: { ...json(), name: 'Invoice' }, ...extra
    });

    const escape = (node) => node.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', bubbles: true, cancelable: true
    }));

    it('asks nothing when the disk has seen everything', async () => {
        open();

        press('open');
        await settle();

        expect(dialog('discard-dialog')).toBeNull();
        expect(dialog('open-dialog')).not.toBeNull();
    });

    it('asks before opening another report, and waits', async () => {
        open();
        drag('t1', 50, 0);

        press('open');
        await settle();

        expect(dialog('discard-dialog')).not.toBeNull();
        expect(dialog('open-dialog')).toBeNull();
    });

    it('names the report it is about to close', async () => {
        open();
        drag('t1', 50, 0);

        press('open');
        await settle();

        expect(dialog('discard-dialog').textContent).toContain('Invoice');
    });

    it('keeps the report, and its changes, on keep editing', async () => {
        const d = open();
        drag('t1', 50, 0);

        press('open');
        await settle();
        click(dialog('discard-dialog').querySelector('[data-role="cancel"]'));
        await settle();

        expect(dialog('open-dialog')).toBeNull();
        expect(d.id).toBe('invoice');
        expect(d.dirty).toBe(true);
        expect(d.layout.bands[0].items[0].x).toBe(50);
    });

    it('goes on to the report list on discard', async () => {
        open();
        drag('t1', 50, 0);

        press('open');
        await settle();
        click(dialog('discard-dialog').querySelector('[data-role="discard"]'));
        await settle();

        expect(dialog('discard-dialog')).toBeNull();
        expect(dialog('open-dialog')).not.toBeNull();
    });

    it('opens the chosen report once the changes are discarded', async () => {
        const d = open();
        drag('t1', 50, 0);

        press('open');
        await settle();
        click(dialog('discard-dialog').querySelector('[data-role="discard"]'));
        await settle();
        await chooseReport('sales');

        expect(d.id).toBe('sales');
        expect(d.dirty).toBe(false);
    });

    /** escape is a dismissal, and a dismissal is never a yes */
    it('treats escape as keep editing', async () => {
        const d = open();
        drag('t1', 50, 0);

        press('open');
        await settle();
        escape(dialog('discard-dialog'));
        await settle();

        expect(dialog('open-dialog')).toBeNull();
        expect(d.dirty).toBe(true);
    });

    it('treats the backdrop as keep editing', async () => {
        const d = open();
        drag('t1', 50, 0);

        press('open');
        await settle();
        click(dialog('discard-dialog').querySelector('[data-role="backdrop"]'));
        await settle();

        expect(dialog('open-dialog')).toBeNull();
        expect(d.dirty).toBe(true);
    });

    /** the question is about leaving, so it comes before the server is asked */
    it('does not reach the server while the question stands', async () => {
        const counting = store();

        open({ store: counting });
        drag('t1', 50, 0);

        press('open');
        await settle();

        expect(counting.calls).toEqual([]);
    });

    it('puts the shortcut behind the same guard as the button', async () => {
        const d = open();
        drag('t1', 50, 0);

        root().dispatchEvent(new KeyboardEvent('keydown', {
            key: 'o', ctrlKey: true, bubbles: true, cancelable: true
        }));
        await settle();

        expect(dialog('discard-dialog')).not.toBeNull();
        expect(d.dirty).toBe(true);
    });
});


/**
 * The other way to close a report: the tab or the window itself.
 *
 * Nothing of the designer's can be shown here - a page may only ask the browser
 * to put its own question, and cannot word it - so what is specified is that
 * the page asks, and that it only asks when there is something to lose.
 */
describe('closing the tab with unsaved changes', () => {
    const closing = () => {
        const event = new Event('beforeunload', { cancelable: true });

        window.dispatchEvent(event);
        return event;
    };

    it('lets a saved report go without a word', () => {
        mount({ id: 'invoice' });

        expect(closing().defaultPrevented).toBe(false);
    });

    it('stops the page leaving while changes are unsaved', () => {
        mount({ id: 'invoice' });
        drag('t1', 50, 0);

        expect(closing().defaultPrevented).toBe(true);
    });

    /**
     * `returnValue` is set by the handler too, because some browsers still read
     * that spelling - but it is not asserted here. On a real BeforeUnloadEvent
     * it is a string of its own; on the plain Event jsdom gives us it is the
     * legacy boolean, which reads back as the inverse of defaultPrevented. The
     * assertion would be about jsdom rather than about the designer.
     */
    it('stops asking once the report is saved', async () => {
        mount({ store: fakeStore(), id: 'invoice' });
        drag('t1', 50, 0);
        press('save');
        await settle();

        expect(closing().defaultPrevented).toBe(false);
    });

    it('can be turned off by a host with its own prompt', () => {
        mount({ id: 'invoice', guardUnload: false });
        drag('t1', 50, 0);

        expect(closing().defaultPrevented).toBe(false);
    });

    /** a destroyed designer must not go on guarding the host's page */
    it('stops guarding once the designer is destroyed', () => {
        const d = mount({ id: 'invoice' });
        drag('t1', 50, 0);

        d.destroy();
        designer = null;

        expect(closing().defaultPrevented).toBe(false);
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
        click(menuOn('t1').querySelector('[data-action="delete-item"]'));

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
        click(menuOn('t1').querySelector('[data-action="delete-item"]'));
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

        /* the drag left changes unsaved, so leaving is asked about first */
        click(dialog('discard-dialog').querySelector('[data-role="discard"]'));
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


describe('the button that opens the report in its own window', () => {
    const button = () => bar().querySelector('[data-role="open-preview"]');

    /**
     * It used to be a link to the preview screen, which reads the report off
     * the disk - so it did nothing at all until the report had been saved,
     * which is the wrong answer to "show me this". The window is built from the
     * design as it stands, so a report that has never been named opens too.
     */
    function fakeWindow() {
        const doc = document.implementation.createHTMLDocument('');
        const opened = {
            document: doc,
            closed: false,
            close() { this.closed = true; },
            addEventListener() { },
            removeEventListener() { }
        };

        /** window.open must be called from a gesture; jsdom has no real one */
        const original = window.open;
        window.open = () => opened;

        return { opened, restore: () => { window.open = original; } };
    }

    it('is a button, not a link that needs a file behind it', () => {
        mount();

        expect(button().tagName).toBe('BUTTON');
        expect(button().dataset.action).toBe('open-window');
    });

    it('works on a report that has never been saved', () => {
        const { opened, restore } = fakeWindow();

        try {
            mount();
            click(button());

            expect(opened.document.querySelector('#report-studio')).not.toBeNull();
        } finally {
            restore();
        }
    });

    it('is never inert, whether the report is saved or not', () => {
        mount();

        expect(button().disabled).toBe(false);
        expect(button().hasAttribute('aria-disabled')).toBe(false);
        expect(button().title).toMatch(/own window/);
    });

    it('carries the stylesheets the designer is using', () => {
        const sheet = document.createElement('style');
        sheet.textContent = '.dz-bar { color: red }';
        document.head.appendChild(sheet);

        const { opened, restore } = fakeWindow();

        try {
            mount();
            click(button());

            const styles = [...opened.document.querySelectorAll('style')]
                .map(n => n.textContent).join('');

            expect(styles).toContain('.dz-bar');
        } finally {
            restore();
            sheet.remove();
        }
    });

    it('titles the window after the report', () => {
        const { opened, restore } = fakeWindow();

        try {
            mount();
            designer.layout.name = 'Sales Summary';
            click(button());

            expect(opened.document.title).toBe('Sales Summary');
        } finally {
            restore();
        }
    });

    /** a blocked pop-up says nothing itself, so the bar has to */
    it('says so when the browser refuses the window', () => {
        const original = window.open;
        window.open = () => null;

        try {
            mount();
            click(button());

            expect(status()).toMatch(/blocked/);
        } finally {
            window.open = original;
        }
    });

    it('closes the windows it opened when the designer goes', () => {
        const { opened, restore } = fakeWindow();

        try {
            mount();
            click(button());

            expect(opened.closed).toBe(false);

            designer.destroy();
            designer = null;

            expect(opened.closed).toBe(true);
        } finally {
            restore();
        }
    });
});

/**
 * @vitest-environment jsdom
 *
 * The properties rail, driven through the designer it lives in. What each
 * control does to the layout is specified in fields.test.js; this is about the
 * wiring - that an edit reaches the page, and that the rail survives being
 * typed into.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDesigner } from '../src/designer/designer.js';
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
        band('detail', [
            text('t1', { x: 100, y: 100, w: 200, h: 40, value: 'Total' }),
            table({ id: 'tbl' })
        ])
    ]
});

function mount(l = json()) {
    designer = createDesigner({ mount: '#report-designer', layout: l });
    return designer;
}

const root = () => document.getElementById('report-designer');
const panel = () => root().querySelector('.dz-panel');
const drawn = (id) => root().querySelector(`[data-item-id="${id}"]`);
const control = (key) => panel().querySelector(`[data-field="${key}"]`);
const item = (d, id) => d.layout.bands[0].items.find(i => i.id === id);

function select(id) {
    const event = new MouseEvent('pointerdown', {
        bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0
    });
    event.pointerId = 1;
    drawn(id).dispatchEvent(event);
}

/** type into a control the way a browser reports it */
function type(key, value) {
    const node = control(key);
    node.value = value;
    node.dispatchEvent(new Event('input', { bubbles: true }));
    return node;
}


describe('the rail', () => {
    it('shows the report itself before anything is selected', () => {
        /**
         * "Nothing selected" was a wasted screen, and the report's own
         * properties have to be editable somewhere.
         */
        mount();

        expect(panel().querySelector('.dz-panel-type').textContent).toBe('report');
        expect(control('page.width')).not.toBeNull();
    });

    it('swaps to the item when one is selected', () => {
        mount();
        select('t1');

        expect(panel().querySelector('.dz-panel-type').textContent).toBe('text');
        expect(control('value')).not.toBeNull();
    });

    it('names the item it is describing', () => {
        mount();
        select('t1');

        expect(panel().querySelector('.dz-panel-id').textContent).toBe('t1');
        expect(panel().querySelector('.dz-panel-type').textContent).toBe('text');
    });

    it('shows the current values of the item', () => {
        mount();
        select('t1');

        expect(control('x').value).toBe('100');
        expect(control('w').value).toBe('200');
        expect(control('value').value).toBe('Total');
    });

    it('returns to the report when the selection is dropped', () => {
        mount();
        select('t1');
        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape', bubbles: true
        }));

        expect(panel().querySelector('.dz-panel-type').textContent).toBe('report');
    });

    it('swaps to the newly selected item', () => {
        mount();
        select('t1');
        select('tbl');

        expect(panel().querySelector('.dz-panel-id').textContent).toBe('tbl');
        expect(control('rowHeight')).not.toBeNull();
        expect(control('value')).toBeNull();
    });
});


describe('editing through the rail', () => {
    it('writes a number onto the layout', () => {
        const d = mount();
        select('t1');
        type('x', '250');

        expect(item(d, 't1').x).toBe(250);
    });

    it('redraws the page so the item moves', () => {
        mount();
        select('t1');
        type('x', '250');

        expect(drawn('t1').style.left).toBe('250px');
    });

    it('moves the outline with it', () => {
        mount();
        select('t1');
        type('x', '250');

        /** the page x is the item x plus the left margin */
        expect(root().querySelector('[data-role="select"]').style.left)
            .toBe('290px');
    });

    it('writes the value string, placeholder and all', () => {
        const d = mount();
        select('t1');
        type('value', 'Due {invoice.date}');

        expect(item(d, 't1').value).toBe('Due {invoice.date}');
        expect(drawn('t1').textContent.trim()).toBe('Due {invoice.date}');
    });

    it('writes a nested style value from a select', () => {
        const d = mount();
        select('t1');

        const node = control('style.align');
        node.value = 'center';
        node.dispatchEvent(new Event('change', { bubbles: true }));

        expect(item(d, 't1').style.align).toBe('center');
    });

    it('writes a checkbox as a boolean', () => {
        const d = mount();
        select('tbl');

        const node = control('showHeader');
        node.checked = false;
        node.dispatchEvent(new Event('change', { bubbles: true }));

        expect(item(d, 'tbl').showHeader).toBe(false);
    });

    it('leaves the item alone when the box is emptied mid-type', () => {
        const d = mount();
        select('t1');
        type('w', '');

        expect(item(d, 't1').w).toBe(200);
    });
});


describe('the rail while typing', () => {
    it('does not rebuild the control being typed into', () => {
        /**
         * Rebuilding an input under a cursor takes the focus and the caret with
         * it, and typing "120" into a width becomes "1".
         */
        mount();
        select('t1');

        const before = control('x');
        before.focus();
        type('x', '250');

        expect(control('x')).toBe(before);
        expect(document.activeElement).toBe(before);
    });
});


describe('the rail after a drag', () => {
    function drag(dx, dy) {
        const canvas = root().querySelector('.dz-canvas');
        const down = new MouseEvent('pointerdown', {
            bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0
        });
        down.pointerId = 1;
        drawn('t1').dispatchEvent(down);

        for (const type of ['pointermove', 'pointerup']) {
            const e = new MouseEvent(type, {
                bubbles: true, cancelable: true, clientX: dx, clientY: dy, button: 0
            });
            e.pointerId = 1;
            canvas.dispatchEvent(e);
        }
    }

    it('shows the position the item was dropped at', () => {
        mount();
        select('t1');
        drag(50, 50);

        expect(control('x').value).toBe('150');
        expect(control('y').value).toBe('150');
    });

    it('leaves a focused control alone, caret and all', () => {
        /**
         * Writing to an input while it has the caret moves the caret to the end,
         * so a drag that ran while a field was focused would reorder its digits.
         */
        mount();
        select('t1');

        const x = control('x');
        x.focus();
        x.value = '99';

        drag(50, 0);

        expect(x.value).toBe('99');
    });
});

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
import { syncPanel } from '../src/designer/panel.js';
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
        expect(control('name')).not.toBeNull();
        expect(control('paper')).not.toBeNull();
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
         * so a sync that ran while a field was focused would reorder its digits.
         *
         * Driven straight at syncPanel rather than through a drag, because a
         * pointer landing on the canvas takes the focus out of the rail now -
         * which is the right answer to "I clicked away", and leaves this claim
         * with no gesture that reaches it.
         */
        const d = mount();
        select('t1');

        const x = control('x');
        const y = control('y');

        x.focus();
        x.value = '99';

        const item = d.layout.bands[0].items.find(i => i.id === 't1');

        item.x = 400;
        item.y = 400;

        syncPanel(panel(), item, d.layout);

        expect(x.value, 'the focused control was written over').toBe('99');
        expect(y.value, 'the others were not refreshed').toBe('400');
    });

    it('takes the caret out of the rail when the canvas is clicked', () => {
        /** clicking away from a field is a way of leaving it */
        mount();
        select('t1');

        const x = control('x');
        x.focus();

        drag(50, 0);

        expect(document.activeElement).not.toBe(x);
    });
});


describe('the paper size', () => {
    /**
     * The page used to be two number boxes, which meant knowing that A4 is
     * 794 x 1123 - a fact nobody carries around, and one the layout is unusable
     * without. The sizes are named now, and the boxes are what Custom means.
     */
    const chooseIn = (key, value) => {
        const node = control(key);
        node.value = value;
        node.dispatchEvent(new Event('change', { bubbles: true }));
        return node;
    };

    const page = (d) => `${d.layout.page.width}x${d.layout.page.height}`;

    it('reads the size back as a name', () => {
        const d = mount();

        expect(page(d)).toBe('794x1123');
        expect(control('paper').value).toBe('A4');
    });

    it('hides the two boxes while the sheet has a name', () => {
        mount();

        expect(control('page.width')).toBeNull();
        expect(control('page.height')).toBeNull();
    });

    it('puts the size in the option, so nothing is hidden that had to be read', () => {
        mount();
        const a4 = [...control('paper').options].find(o => o.value === 'A4');

        expect(a4.textContent).toContain('794');
        expect(a4.textContent).toContain('1123');
    });

    it('resizes the page when another sheet is picked', () => {
        const d = mount();
        chooseIn('paper', 'A3');

        expect(page(d)).toBe('1123x1587');
    });

    it('offers the sizes somebody asked for', () => {
        mount();
        const offered = [...control('paper').options].map(o => o.value);

        for (const sheet of ['A2', 'A3', 'A4', 'A5']) {
            expect(offered, sheet).toContain(sheet);
        }
        expect(offered).toContain('custom');
    });

    it('shows the two boxes when Custom is chosen, and changes nothing else', () => {
        const d = mount();
        chooseIn('paper', 'custom');

        expect(control('page.width')).not.toBeNull();
        expect(control('page.height')).not.toBeNull();

        /** Custom is not a size - it is the absence of one, so it takes nothing away */
        expect(page(d)).toBe('794x1123');
    });

    it('keeps the boxes while a typed size passes through a named one', () => {
        /**
         * Custom sticks. Without that, typing a width that happened to make an
         * A5 would take the boxes away mid-keystroke and leave the height half
         * entered - and getting them back would mean choosing Custom again.
         */
        const d = mount();
        chooseIn('paper', 'custom');

        type('page.width', '559');
        type('page.height', '794');

        expect(page(d)).toBe('559x794');
        expect(control('paper').value).toBe('custom');
        expect(control('page.height')).not.toBeNull();
    });

    it('reads a size loaded from a file as its name, with nothing written down', () => {
        /**
         * The point of deriving it: a layout that has never been near this
         * dropdown - hand written, or saved before it existed - still reads as
         * the sheet it is. Nothing is stored but the absence of a name, so
         * nothing in the file can drift away from the size beside it.
         */
        const a5 = layout({ bands: [band('detail', [text('t1')])] });

        a5.page.width = 559;
        a5.page.height = 794;

        const d = mount(a5);

        expect(d.layout.page.paper).toBeUndefined();
        expect(control('paper').value).toBe('A5');
        expect(control('page.width')).toBeNull();
    });

    it('turns the page over without changing the sheet', () => {
        const d = mount();
        chooseIn('orientation', 'landscape');

        expect(page(d)).toBe('1123x794');

        /** a landscape A4 is still an A4, and the dropdown has to agree */
        expect(control('paper').value).toBe('A4');
    });

    it('keeps the way up when a different sheet is picked', () => {
        const d = mount();
        chooseIn('orientation', 'landscape');
        chooseIn('paper', 'A5');

        expect(page(d)).toBe('794x559');
    });

    it('has no orientation to offer for a custom size', () => {
        /** the two boxes say which way up it is, and say it more exactly */
        mount();
        chooseIn('paper', 'custom');

        expect(control('orientation')).toBeNull();
    });

    it('redraws the page at the new size', () => {
        mount();
        chooseIn('paper', 'A5');

        expect(root().querySelector('.dz-page').style.width).toBe('559px');
    });

    it('is one undo step', () => {
        const d = mount();
        chooseIn('paper', 'A3');

        root().dispatchEvent(new KeyboardEvent('keydown', {
            key: 'z', ctrlKey: true, bubbles: true, cancelable: true
        }));

        expect(page(d)).toBe('794x1123');
    });
});

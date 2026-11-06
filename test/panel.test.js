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
import { syncPanel, parseHex } from '../src/designer/panel.js';
import { layout, text, table, band, box } from './helpers/layout.js';

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

/**
 * Make a choice the way a browser reports it - a select set and changed, or
 * one of a row of glyph buttons clicked.
 */
function choose(key, value) {
    const node = control(key);

    if (node.type === 'radio') {
        const button = panel().querySelector(`[data-field="${key}"][value="${value}"]`);
        button.click();
        return button;
    }

    node.value = value;
    node.dispatchEvent(new Event('change', { bubbles: true }));
    return node;
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

        choose('style.align', 'center');

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
    const chooseIn = choose;

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


describe('a colour that is not set', () => {
    const swatch = (key) => control(key).closest('.dz-swatch');
    const clear = (key) => panel().querySelector(`[data-action="clear-color"][data-for="${key}"]`);

    /** a box with an outline and no fill */
    const withBox = () => {
        const l = json();
        l.bands[0].items.push(box('b1', { x: 100, y: 300, w: 120, h: 60 }));
        return l;
    };

    it('shows as none, not as the black a colour input falls back to', () => {
        const d = mount(withBox());
        select('b1');

        expect(item(d, 'b1').style.background).toBeNull();
        expect(swatch('style.background').classList.contains('is-none')).toBe(true);
        expect(clear('style.background')).not.toBeNull();
    });

    it('shows a colour that is set as itself', () => {
        mount();
        select('t1');

        expect(swatch('style.color').classList.contains('is-none')).toBe(false);
        expect(control('style.color').value).toBe('#000000');
    });

    it('stops being none once one is picked', () => {
        const d = mount(withBox());
        select('b1');

        type('style.background', '#ff0000');

        expect(item(d, 'b1').style.background).toBe('#ff0000');
        expect(swatch('style.background').classList.contains('is-none')).toBe(false);
    });

    it('takes a colour off with its clear button, back to none', () => {
        const d = mount();
        select('t1');

        clear('style.color').click();

        expect(item(d, 't1').style).not.toHaveProperty('color');
        expect(swatch('style.color').classList.contains('is-none')).toBe(true);
    });

    it('can be undone', () => {
        const d = mount();
        select('t1');

        clear('style.color').click();
        root().querySelector('[data-action="undo"]').click();

        expect(item(d, 't1').style.color).toBe('#000000');
    });

    it('follows the item when it changes from elsewhere, as an undo does', () => {
        const d = mount();
        select('t1');
        const t1 = item(d, 't1');

        delete t1.style.color;
        syncPanel(panel(), t1, d.layout);
        expect(swatch('style.color').classList.contains('is-none')).toBe(true);

        t1.style.color = '#00ff00';
        syncPanel(panel(), t1, d.layout);
        expect(swatch('style.color').classList.contains('is-none')).toBe(false);
        expect(control('style.color').value).toBe('#00ff00');
    });
});


describe('a colour typed as hex', () => {
    const hex = (key) => panel().querySelector(`[data-hex="${key}"]`);

    function typeHex(key, value, kind = 'input') {
        const node = hex(key);
        node.value = value;
        node.dispatchEvent(new Event(kind, { bubbles: true }));
        return node;
    }

    it('shows the colour beside its chip, without the hash', () => {
        mount();
        select('t1');

        expect(hex('style.color').value).toBe('000000');
    });

    it('writes the colour once six digits are in', () => {
        const d = mount();
        select('t1');

        typeHex('style.color', 'ff9c');
        expect(item(d, 't1').style.color).toBe('#000000');

        typeHex('style.color', 'FF9C4B');
        expect(item(d, 't1').style.color).toBe('#ff9c4b');
        expect(control('style.color').value).toBe('#ff9c4b');
    });

    it('takes three-digit shorthand only once the box is left', () => {
        const d = mount();
        select('t1');

        typeHex('style.color', 'f00');
        expect(item(d, 't1').style.color).toBe('#000000');

        typeHex('style.color', 'f00', 'change');
        expect(item(d, 't1').style.color).toBe('#ff0000');
    });

    it('goes back to the colour it has when left holding something else', () => {
        mount();
        select('t1');

        const node = typeHex('style.color', 'zz');
        node.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

        expect(node.value).toBe('000000');
    });

    it('empties when the colour is taken off, and follows a change from elsewhere', () => {
        const d = mount();
        select('t1');

        panel().querySelector('[data-action="clear-color"][data-for="style.color"]').click();
        expect(hex('style.color').value).toBe('');

        const t1 = item(d, 't1');
        t1.style.color = '#00ff00';
        syncPanel(panel(), t1, d.layout);
        expect(hex('style.color').value).toBe('00FF00');
    });

    it('reads hex the way a design tool does', () => {
        expect(parseHex('#ABCDEF')).toBe('#abcdef');
        expect(parseHex(' abcdef ')).toBe('#abcdef');
        expect(parseHex('abc')).toBeNull();
        expect(parseHex('abc', true)).toBe('#aabbcc');
        expect(parseHex('abcd', true)).toBeNull();
        expect(parseHex('red', true)).toBeNull();
    });
});


describe('scrubbing a number', () => {
    /** the letter inside a box, or the label above one */
    const handle = (key) => control(key).closest('.dz-field').querySelector('.dz-scrub');

    function pointer(node, type, clientX, extra = {}) {
        const event = new MouseEvent(type, {
            bubbles: true, cancelable: true, clientX, clientY: 0, button: 0, ...extra
        });
        event.pointerId = 1;
        node.dispatchEvent(event);
    }

    function drag(node, from, to, extra) {
        pointer(node, 'pointerdown', from);
        pointer(node, 'pointermove', to, extra);
        pointer(node, 'pointerup', to);
    }

    it('puts the short labels inside their boxes, and keeps the real ones for readers', () => {
        mount();
        select('t1');

        const x = control('x').closest('.dz-field');
        expect(x.querySelector('.dz-input-prefix').textContent).toBe('X');
        expect(x.querySelector('label').textContent.trim()).toBe('X');
        expect(control('w').closest('.dz-field').querySelector('label').textContent.trim()).toBe('Width');
    });

    it('changes the value by one for every two pixels dragged', () => {
        const d = mount();
        select('t1');

        drag(handle('w'), 100, 120);

        expect(item(d, 't1').w).toBe(210);
        expect(control('w').value).toBe('210');
    });

    it('steps by ten with Shift held', () => {
        const d = mount();
        select('t1');

        drag(handle('x'), 100, 90, { shiftKey: true });

        expect(item(d, 't1').x).toBe(50);
    });

    it('stops at the smallest the field allows', () => {
        const d = mount();
        select('t1');

        drag(handle('w'), 400, 0);

        expect(item(d, 't1').w).toBe(1);
    });

    it('scrubs a number whose label sits above its box', () => {
        const d = mount();
        select('t1');

        type('style.fontSize', '12');
        drag(handle('style.fontSize'), 0, 8);

        expect(handle('style.fontSize').tagName).toBe('LABEL');
        expect(item(d, 't1').style.fontSize).toBe(16);
        expect(control('style.fontSize').value).toBe('16');
    });

    it('is one step to undo, however far it went', () => {
        const d = mount();
        select('t1');

        const node = handle('w');
        pointer(node, 'pointerdown', 100);
        pointer(node, 'pointermove', 110);
        pointer(node, 'pointermove', 130);
        pointer(node, 'pointerup', 130);
        expect(item(d, 't1').w).toBe(215);

        root().querySelector('[data-action="undo"]').click();
        expect(item(d, 't1').w).toBe(200);
    });

    it('puts the caret in the box on a press that does not move', () => {
        mount();
        select('t1');

        const node = handle('w');
        pointer(node, 'pointerdown', 100);
        pointer(node, 'pointerup', 101);

        expect(document.activeElement).toBe(control('w'));
    });
});


describe('a short choice as glyph buttons', () => {
    const buttons = (key) => [...panel().querySelectorAll(`[data-field="${key}"]`)];
    const checked = (key) => buttons(key).find(b => b.checked)?.value;

    it('draws alignment as a row of buttons, with the current one chosen', () => {
        mount();
        select('t1');

        expect(buttons('style.align').map(b => b.value)).toEqual(['left', 'center', 'right']);
        expect(buttons('style.align').every(b => b.type === 'radio')).toBe(true);
        expect(panel().querySelector('[role="radiogroup"][aria-label="Align"]')).not.toBeNull();
    });

    it('does not choose the first button when the label above is clicked', () => {
        const d = mount();
        select('t1');
        choose('style.align', 'right');

        const label = [...panel().querySelectorAll('.dz-label')]
            .find(l => l.textContent.trim() === 'Align');
        expect(label.hasAttribute('for')).toBe(false);

        label.click();
        expect(item(d, 't1').style.align).toBe('right');
    });

    it('follows the item when it changes from elsewhere', () => {
        const d = mount();
        select('t1');
        const t1 = item(d, 't1');

        t1.style.align = 'center';
        syncPanel(panel(), t1, d.layout);

        expect(checked('style.align')).toBe('center');
        /** the buttons keep their own values; only which is chosen moves */
        expect(buttons('style.align').map(b => b.value)).toEqual(['left', 'center', 'right']);
    });

    it('turns the page with the orientation buttons', () => {
        const d = mount();

        expect(checked('orientation')).toBe('portrait');
        choose('orientation', 'landscape');

        expect(d.layout.page.width).toBeGreaterThan(d.layout.page.height);
        expect(checked('orientation')).toBe('landscape');
    });
});


describe('a table column as a row that opens', () => {
    const rows = () => [...panel().querySelectorAll('.dz-column')];

    it('starts closed, saying which column it is and how wide', () => {
        mount();
        select('tbl');

        const first = rows()[0];
        expect(first.tagName).toBe('DETAILS');
        expect(first.open).toBe(false);
        expect(first.querySelector('.dz-column-number').textContent).toBe('1');
        expect(first.querySelector('.dz-column-width').textContent).not.toBe('');
    });

    it('opens a column that has just been added, ready to fill in', () => {
        mount();
        select('tbl');
        const before = rows().length;

        panel().querySelector('[data-action="add-column"]').click();

        expect(rows()).toHaveLength(before + 1);
        expect(rows().at(-1).open).toBe(true);
        expect(rows()[0].open).toBe(false);
    });

    it('keeps a column open through a rebuild of the rail', () => {
        mount();
        select('tbl');

        rows()[1].open = true;
        rows()[1].dispatchEvent(new Event('toggle'));

        select('t1');
        select('tbl');

        expect(rows()[1].open).toBe(true);
        expect(rows()[0].open).toBe(false);
    });

    it('renames its closed row as the label is typed', () => {
        mount();
        select('tbl');

        const node = panel().querySelector('[data-column="0"][data-field="label"]');
        node.value = 'Who';
        node.dispatchEvent(new Event('input', { bubbles: true }));

        expect(rows()[0].querySelector('.dz-column-name').textContent).toBe('Who');
    });

    it('removes a column from its row without opening it', () => {
        const d = mount();
        select('tbl');
        const count = rows().length;

        panel().querySelector('[data-action="remove-column"][data-index="0"]').click();

        expect(rows()).toHaveLength(count - 1);
        expect(d.layout.bands[0].items.find(i => i.id === 'tbl').columns).toHaveLength(count - 1);
    });
});


describe('a choice opening its own list', () => {
    const trigger = (key) => control(key).closest('.dz-choice').querySelector('.dz-choice-trigger');
    const shown = (key) => trigger(key).querySelector('.dz-choice-value').textContent;
    const list = () => root().querySelector('.dz-listbox');
    const options = () => [...list().querySelectorAll('[role="option"]')];

    function key(node, name) {
        const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
        node.dispatchEvent(event);
        return event;
    }

    it('keeps the select as the control, behind a button that shows its value', () => {
        mount();
        select('t1');

        expect(control('style.fontFamily').tagName).toBe('SELECT');
        expect(shown('style.fontFamily')).toBe('Helvetica');
        expect(list().hidden).toBe(true);
    });

    it('opens a styled list on a click, the current item ticked', () => {
        mount();
        select('t1');

        trigger('style.fontFamily').click();

        expect(list().hidden).toBe(false);
        expect(trigger('style.fontFamily').getAttribute('aria-expanded')).toBe('true');
        expect(options().map(o => o.textContent.trim())).toContain('Georgia');
        expect(options().find(o => o.getAttribute('aria-selected') === 'true').textContent.trim())
            .toBe('Helvetica');
    });

    it('writes the item chosen, and closes', () => {
        const d = mount();
        select('t1');

        trigger('style.fontFamily').click();
        options().find(o => o.textContent.trim() === 'Georgia').click();

        expect(item(d, 't1').style.fontFamily).toBe('Georgia, "Times New Roman", serif');
        expect(shown('style.fontFamily')).toBe('Georgia');
        expect(list().hidden).toBe(true);
        expect(document.activeElement).toBe(trigger('style.fontFamily'));
    });

    it('is driven by the keys, and keeps them from the designer', () => {
        const d = mount();
        select('t1');
        const x = item(d, 't1').x;

        const button = trigger('style.fontWeight');
        button.focus();
        key(button, 'ArrowDown');
        expect(list().hidden).toBe(false);

        /** Bold is the second weight; Regular is chosen, so one step down */
        key(document.activeElement, 'ArrowUp');
        key(document.activeElement, 'ArrowDown');
        key(document.activeElement, 'Enter');

        expect(item(d, 't1').style.fontWeight).toBe('bold');
        /** the arrows moved the highlight, not the item */
        expect(item(d, 't1').x).toBe(x);
    });

    it('jumps to an item by its first letter', () => {
        const d = mount();
        select('t1');

        trigger('style.fontFamily').click();
        key(document.activeElement, 'v');
        key(document.activeElement, 'Enter');

        expect(item(d, 't1').style.fontFamily).toBe('Verdana, Geneva, sans-serif');
    });

    it('closes on Escape without changing anything, and keeps the selection', () => {
        const d = mount();
        select('t1');
        const before = item(d, 't1').style.fontFamily;

        trigger('style.fontFamily').click();
        key(document.activeElement, 'Escape');

        expect(list().hidden).toBe(true);
        expect(item(d, 't1').style.fontFamily).toBe(before);
        expect(d.selection?.id).toBe('t1');
    });

    it('does not let Backspace on the button delete the item', () => {
        const d = mount();
        select('t1');

        const button = trigger('style.fontFamily');
        button.focus();
        key(button, 'Backspace');

        expect(item(d, 't1')).toBeDefined();
    });

    it('follows a change made elsewhere', () => {
        const d = mount();
        select('t1');
        const t1 = item(d, 't1');

        t1.style.fontWeight = 'bold';
        syncPanel(panel(), t1, d.layout);

        expect(shown('style.fontWeight')).toBe('Bold');
    });

    it('opens the paper list, and still rebuilds the rail for Custom', () => {
        mount();

        trigger('paper').click();
        options().find(o => o.textContent.trim() === 'Custom').click();

        expect(control('page.width')).not.toBeNull();
        expect(shown('paper')).toBe('Custom');
        expect(document.activeElement).toBe(trigger('paper'));
    });

    it('goes when the designer does', () => {
        mount();
        expect(root().querySelector('.dz-listbox')).not.toBeNull();

        designer.destroy();
        designer = null;

        expect(document.querySelector('.dz-listbox')).toBeNull();
    });
});

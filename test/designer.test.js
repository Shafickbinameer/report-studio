/**
 * @vitest-environment jsdom
 *
 * createDesigner owns a DOM node, so this suite needs a document. The drawing
 * itself is markup and is specified in canvas.test.js, in the node environment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDesigner } from '../src/designer/designer.js';
import { blankLayout } from '../src/designer/blank.js';
import { layout, text, table, band } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    document.body.innerHTML = '<div id="report-designer"></div>';
});
afterEach(() => vi.restoreAllMocks());

const valid = () => layout({
    bands: [
        band('pageHeader', [text('ph', { value: 'head' })], { height: 26 }),
        band('detail', [table()])
    ]
});

const mount = (json) => createDesigner({ mount: '#report-designer', layout: json });
const root = () => document.getElementById('report-designer');


describe('createDesigner - mounting', () => {
    it('takes a selector', () => {
        mount(valid());
        expect(root().querySelector('.dz-page')).not.toBeNull();
    });

    it('takes an element', () => {
        createDesigner({ mount: root(), layout: valid() });
        expect(root().querySelector('.dz-page')).not.toBeNull();
    });

    it('builds its own chrome, so the host supplies one empty div', () => {
        mount(valid());

        expect(root().querySelector('.dz-bar')).not.toBeNull();
        expect(root().querySelector('.dz-canvas')).not.toBeNull();
    });

    it('says which element it wanted when there is none', () => {
        expect(() => createDesigner({ mount: '#nope', layout: valid() }))
            .toThrow(/#nope/);
    });

    it('names the report in the bar', () => {
        mount({ ...valid(), name: 'Sales Summary' });
        expect(root().querySelector('[data-role="name"]').textContent)
            .toBe('Sales Summary');
    });
});


describe('createDesigner - a new report', () => {
    it('starts from a blank layout when handed an empty object', () => {
        const designer = mount({});
        expect(designer.layout).toEqual(blankLayout());
    });

    it('starts from a blank layout when handed nothing at all', () => {
        const designer = createDesigner({ mount: '#report-designer' });
        expect(designer.layout.bands).toHaveLength(3);
    });

    it('draws the blank report rather than an error', () => {
        mount({});

        expect(root().querySelector('.dz-page')).not.toBeNull();
        expect(root().querySelector('.dz-problems')).toBeNull();
    });
});


describe('createDesigner - a broken report', () => {
    it('names what is wrong instead of drawing a blank page', () => {
        const issues = mount({ version: 1, bands: 'nope' }).redraw();

        expect(issues.length).toBeGreaterThan(0);
        expect(root().querySelector('.dz-problems')).not.toBeNull();
        expect(root().querySelector('.dz-page')).toBeNull();
    });

    it('reports the field, in the words the validator chose', () => {
        mount({ version: 1, page: {}, bands: [] });
        const shown = root().querySelector('.dz-problems').textContent;

        expect(shown).toMatch(/page\.width/);
    });

    it('does not mistake a broken layout for a new report', () => {
        /**
         * The one case that must not be quietly helpful: replacing someone's
         * mistyped file with a blank page loses their work.
         */
        const designer = mount({ version: 1, bands: 'nope' });
        expect(designer.layout).not.toEqual(blankLayout());
    });
});


describe('createDesigner - the handle', () => {
    it('hands back the layout, which is what onSave will be given', () => {
        const json = valid();
        expect(mount(json).layout).toBe(json);
    });

    it('swaps the report on open', () => {
        const designer = mount(valid());
        designer.open({ ...valid(), name: 'Second' });

        expect(designer.layout.name).toBe('Second');
        expect(root().querySelector('[data-role="name"]').textContent).toBe('Second');
    });

    it('redraws from the layout, so an edit shows without a remount', () => {
        const designer = mount(valid());
        designer.layout.bands.push(
            band('pageFooter', [text('pf', { value: 'Page {page}' })], { height: 30 }));
        designer.redraw();

        expect(root().querySelector('[data-band-type="pageFooter"]')).not.toBeNull();
    });

    it('leaves the host element as it found it on destroy', () => {
        const designer = mount(valid());
        designer.destroy();

        expect(root().innerHTML).toBe('');
        expect(root().className).toBe('');
    });
});


describe('zoom', () => {
    /**
     * The same three controls the viewer has, stepping through the same levels
     * - a report zoomed to 125% while it is being arranged and to 130% while it
     * is being read would be two tools rather than two views of one.
     */
    let designer = null;

    afterEach(() => {
        designer?.destroy();
        designer = null;
    });

    const show = (json = valid()) => (designer = mount(json));

    const layer = () => root().querySelector('[data-role="zoom-layer"]');
    const label = () => root()
        .querySelector('[data-role="zoom-dropdown"] .dropdown-value')
        .textContent.trim();

    const button = (role) => root().querySelector(`[data-role="${role}"]`);
    const click = (node) => node.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }));

    /** the menu is a listbox, so a level is chosen by clicking its item */
    function choose(value) {
        const menu = root().querySelector('[data-role="zoom-dropdown"]');
        click(menu.querySelector('.dropdown-trigger'));
        click(menu.querySelector(`.dropdown-item[data-value="${value}"]`));
    }

    function shortcut(key, { ctrlKey = false, altKey = false, target = root() } = {}) {
        target.dispatchEvent(new KeyboardEvent('keydown', {
            key, ctrlKey, altKey, bubbles: true, cancelable: true
        }));
    }

    it('starts at 100%, with nothing scaled away', () => {
        show();

        expect(label()).toBe('100%');
        expect(layer().style.transform).toBe('scale(1)');
    });

    it('scales the drawing rather than the numbers in it', () => {
        /**
         * Re-computing type at 150% would re-wrap the text and stop matching
         * what the engine paginated, so the screen would no longer be what
         * would print. The transform is the whole mechanism.
         */
        show();
        choose('1.5');

        expect(layer().style.transform).toBe('scale(1.5)');
        expect(label()).toBe('150%');
    });

    it('steps to the neighbouring level rather than multiplying', () => {
        show();
        click(button('zoom-in'));

        expect(label()).toBe('125%');

        click(button('zoom-out'));
        click(button('zoom-out'));

        expect(label()).toBe('75%');
    });

    it('stops at the ends and says so', () => {
        show();
        choose('3');

        expect(button('zoom-in').disabled).toBe(true);
        expect(button('zoom-out').disabled).toBe(false);

        choose('0.5');

        expect(button('zoom-out').disabled).toBe(true);
        expect(button('zoom-in').disabled).toBe(false);
    });

    it('zooms in on z and out on alt+z', () => {
        show();

        shortcut('z');
        expect(label()).toBe('125%');

        shortcut('z');
        expect(label()).toBe('150%');

        shortcut('z', { altKey: true });
        expect(label()).toBe('125%');
    });

    it('leaves ctrl+z to undo', () => {
        /**
         * The reason the zoom key is checked before the ctrl guard rather than
         * inside it: they are the same letter, and undo is not negotiable.
         */
        const d = show(layout({
            bands: [band('detail', [text('t1', { x: 0, y: 0, w: 200, h: 40 })])]
        }));

        shortcut('z');
        expect(label()).toBe('125%');

        click(root().querySelector('[data-action="add-text"]'));
        expect(d.layout.bands[0].items).toHaveLength(2);

        shortcut('z', { ctrlKey: true });

        /** the edit went back, and the zoom stayed where it was put */
        expect(d.layout.bands[0].items).toHaveLength(1);
        expect(label()).toBe('125%');
    });

    it('works when nothing has been clicked yet', () => {
        /**
         * The one that was broken. The shortcuts were bound to the designer's
         * own element, which is a div - so on a page nobody had clicked, the
         * keystroke went to the body and never reached it. Every shortcut was
         * dead until somebody happened to press a button.
         */
        show();
        shortcut('z', { target: document.body });

        expect(label()).toBe('125%');
    });

    it('works after a click on the design, which focuses nothing by itself', () => {
        /**
         * The other half: a click on the canvas leaves the caret wherever it
         * was, so after a trip to the properties rail `z` typed a z. The
         * designer takes the focus when a click lands on something that cannot
         * hold it.
         */
        show();

        const box = root().querySelector('[data-field="name"]');
        box.focus();
        expect(document.activeElement).toBe(box);

        root().querySelector('.dz-canvas').dispatchEvent(
            new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));

        expect(document.activeElement).toBe(root());

        shortcut('z', { target: root() });
        expect(label()).toBe('125%');
    });

    it('leaves a click on a control to focus that control', () => {
        show();

        const box = root().querySelector('[data-field="name"]');

        box.dispatchEvent(
            new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));

        expect(document.activeElement).not.toBe(root());
    });

    it('lets someone type a z into the rail', () => {
        show();

        const box = root().querySelector('[data-field="name"]');
        box.focus();
        shortcut('z', { target: box });

        expect(label()).toBe('100%');
    });

    it('goes back to 100% on ctrl+0', () => {
        show();

        shortcut('z');
        shortcut('z');
        expect(label()).toBe('150%');

        shortcut('0', { ctrlKey: true });
        expect(label()).toBe('100%');
    });

    it('keeps the scale across a redraw', () => {
        show();
        choose('2');

        designer.redraw();

        expect(layer().style.transform).toBe('scale(2)');
    });

    it('scales the run of the report too', () => {
        /** the preview is drawn into the same layer; one zoom, two modes */
        show();
        choose('0.75');
        designer.togglePreview();

        expect(layer().style.transform).toBe('scale(0.75)');
    });

    it('moves a dragged item by the pointer distance, not by the scale', () => {
        /**
         * The reason select.js takes a getZoom at all. Without it a drag at
         * 200% moves an item twice as far as the pointer went, which is the
         * sort of thing that is blamed on the mouse.
         */
        const d = show(layout({
            bands: [band('detail', [text('t1', { x: 0, y: 0, w: 200, h: 40 })])]
        }));

        choose('2');

        const node = root().querySelector('[data-item-id="t1"]');
        const canvas = root().querySelector('.dz-canvas');

        const at = (type, target, x) => {
            const event = new MouseEvent(type, {
                bubbles: true, cancelable: true, clientX: x, clientY: 0, button: 0
            });
            event.pointerId = 1;
            target.dispatchEvent(event);
        };

        at('pointerdown', node, 0);
        at('pointermove', canvas, 200);
        at('pointerup', canvas, 200);

        /** 200 screen px at 200% is 100 page px, snapped to the 10px grid */
        expect(d.layout.bands[0].items[0].x).toBe(100);
    });
});

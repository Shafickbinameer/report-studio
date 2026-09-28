/**
 * @vitest-environment jsdom
 *
 * The image tool in the designer, and the viewer waiting for pictures before it
 * prints. The engine's side of images is in image.test.js.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDesigner } from '../src/designer/designer.js';
import { createImage } from '../src/designer/structure.js';
import { createViewer } from '../src/preview/viewer.js';
import { validateLayout } from '../src/engine/validate.js';
import { SAMPLE_IMAGE } from '../src/designer/sample-data.js';
import { layout, text, table, band, image, run } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    document.body.innerHTML = '<div id="report-designer"></div>';
});

let mounted = null;
afterEach(() => {
    mounted?.destroy();
    mounted = null;
    vi.restoreAllMocks();
});

const json = () => layout({
    bands: [
        band('pageHeader', [], { height: 40 }),
        band('detail', [text('t1', { x: 0, y: 0, w: 200, h: 40 }), table({ id: 'tbl' })])
    ]
});

const root = () => document.getElementById('report-designer');
const panel = () => root().querySelector('.dz-panel');
const foot = () => root().querySelector('.dz-foot');
const itemsOn = (d, type) =>
    d.layout.bands.find(b => b.type === type)?.items.map(i => i.id) ?? [];

function mount(l = json()) {
    mounted = createDesigner({ mount: '#report-designer', layout: l });
    return mounted;
}

function press(node, action) {
    node.querySelector(`[data-action="${action}"]`)
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** the detail band's last item - what a tool has just added */
const added = (d) => d.layout.bands.find(b => b.type === 'detail').items.at(-1);


describe('createImage', () => {
    it('is an empty, logo-sized frame below what is on the band', () => {
        const l = json();
        const made = createImage(l, l.bands[1]);

        expect(made).toMatchObject({
            id: 'image-1', type: 'image', w: 160, h: 80,
            src: null, field: null, fit: 'contain'
        });
        expect(made.y).toBeGreaterThan(0);
    });
});


describe('the image tool', () => {
    it('adds an image to the band being worked in', () => {
        const d = mount();
        press(foot(), 'add-image');

        expect(itemsOn(d, 'detail')).toEqual(['t1', 'tbl', 'image-1']);
    });

    it('draws the tool as a labelled glyph, like the rest of the strip', () => {
        mount();
        const button = foot().querySelector('[data-action="add-image"]');

        expect(button.querySelector('svg')).not.toBeNull();
        expect(button.getAttribute('aria-label')).toBeTruthy();
    });

    it('draws a placeholder on the canvas until there is a picture', () => {
        mount();
        press(foot(), 'add-image');

        const node = root().querySelector('[data-item-id="image-1"]');
        expect(node.dataset.itemType).toBe('image');
        expect(node.querySelector('.image-empty')).not.toBeNull();
    });

    it('offers the picture, the field and the fit in the rail', () => {
        mount();
        press(foot(), 'add-image');

        const labels = [...panel().querySelectorAll('label')].map(l => l.textContent.trim());

        expect(labels).toEqual(expect.arrayContaining(['Image', 'From data', 'Fit']));
        expect(panel().querySelector('[data-action="upload-image"]')).not.toBeNull();
    });

    it('leaves a layout the engine accepts', () => {
        const d = mount();
        press(foot(), 'add-image');

        expect(validateLayout(d.layout)).toEqual([]);
    });

    it('binds to a data field typed into the rail, and unbinds when it is cleared', () => {
        const d = mount();
        press(foot(), 'add-image');

        const input = panel().querySelector('[data-field="field"]');
        input.value = 'company.logo';
        input.dispatchEvent(new Event('input', { bubbles: true }));

        expect(added(d).field).toBe('company.logo');
        expect(root().querySelector('[data-item-id="image-1"]').textContent)
            .toContain('{company.logo}');

        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));

        expect(added(d).field).toBeNull();
    });
});


describe('uploading a picture', () => {
    /**
     * jsdom opens no file dialog, so the input the designer makes is caught on
     * its way to being clicked and handed a file as if one had been chosen.
     */
    function choose(file) {
        const spy = vi.spyOn(HTMLInputElement.prototype, 'click')
            .mockImplementation(function () {
                Object.defineProperty(this, 'files', { value: [file] });
                this.dispatchEvent(new Event('change'));
            });

        press(panel(), 'upload-image');
        spy.mockRestore();
    }

    const png = (bytes = 64) =>
        new File([new Uint8Array(bytes)], 'logo.png', { type: 'image/png' });

    /**
     * FileReader finishes on a later task, and how much later depends on how
     * busy the machine is - so wait for the picture to land rather than for a
     * guess. A refusal never lands one, and gives up after a short while.
     */
    const settle = async (d, ms = 1000) => {
        const until = Date.now() + ms;

        while (Date.now() < until) {
            if (d && added(d).src) return;
            await new Promise(done => setTimeout(done, 10));
        }
    };

    it('stores the picture in the layout as a data: URI', async () => {
        const d = mount();
        press(foot(), 'add-image');

        choose(png());
        await settle(d);

        expect(added(d).src).toMatch(/^data:image\/png;base64,/);
        expect(root().querySelector('[data-item-id="image-1"] img')).not.toBeNull();
    });

    it('is undone in one step', async () => {
        const d = mount();
        press(foot(), 'add-image');

        choose(png());
        await settle(d);

        root().dispatchEvent(new KeyboardEvent('keydown', {
            key: 'z', ctrlKey: true, bubbles: true, cancelable: true
        }));

        expect(added(d).src).toBeNull();
    });

    it('refuses a file that is not a picture it can draw', async () => {
        const d = mount();
        press(foot(), 'add-image');

        choose(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }));
        await settle(null, 50);

        expect(added(d).src).toBeNull();
        expect(root().querySelector('[data-role="status"]').textContent)
            .toMatch(/not a PNG, JPEG, GIF or WebP/);
    });

    it('refuses a picture too large to carry in a layout', async () => {
        const d = mount();
        press(foot(), 'add-image');

        choose(png(2 * 1024 * 1024));
        await settle(null, 50);

        expect(added(d).src).toBeNull();
        expect(root().querySelector('[data-role="status"]').textContent)
            .toMatch(/too large/);
    });

    it('removes a stored picture', async () => {
        const d = mount();
        press(foot(), 'add-image');

        choose(png());
        await settle(d);
        press(panel(), 'clear-image');

        expect(added(d).src).toBeNull();
    });
});


describe('printing a report with pictures', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="report"></div>';
        window.print = vi.fn();
    });

    const view = () => {
        const paginated = run(layout({
            bands: [band('detail', [image('logo', { src: SAMPLE_IMAGE })])]
        }), { items: [] });

        mounted = createViewer({ mount: '#report', paginated });
        return mounted;
    };

    it('waits for a picture that is still loading', async () => {
        const viewer = view();
        const img = document.querySelector('#report img');

        let loaded;
        Object.defineProperty(img, 'complete', { value: false });
        img.decode = () => new Promise(done => { loaded = done; });

        viewer.print();
        expect(window.print).not.toHaveBeenCalled();

        loaded();
        await new Promise(done => setTimeout(done, 0));

        expect(window.print).toHaveBeenCalledOnce();
    });

    it('prints anyway when a picture fails to load', async () => {
        const viewer = view();
        const img = document.querySelector('#report img');

        Object.defineProperty(img, 'complete', { value: false });
        img.decode = () => Promise.reject(new Error('broken'));

        viewer.print();
        await new Promise(done => setTimeout(done, 0));

        expect(window.print).toHaveBeenCalledOnce();
    });

    it('prints at once when every picture is in', () => {
        const viewer = view();
        Object.defineProperty(document.querySelector('#report img'), 'complete', { value: true });

        viewer.print();
        expect(window.print).toHaveBeenCalledOnce();
    });
});

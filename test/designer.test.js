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

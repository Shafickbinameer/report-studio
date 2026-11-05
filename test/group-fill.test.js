/**
 * @vitest-environment jsdom
 *
 * A background colour for a table's group header and footer: set from the
 * group band's row on the rail, kept on the band as `background`, and drawn
 * across the table's width on the printed report and on the design canvas.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDesigner } from '../src/designer/designer.js';
import { validateLayout } from '../src/engine/validate.js';
import { render } from '../src/render/render.js';
import { tablesOf } from '../src/engine/tables.js';
import { layout, text, table, band, run } from './helpers/layout.js';

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


const grouped = ({ header = {}, footer = {} } = {}) => layout({
    bands: [band('detail', [{
        ...table({ id: 'sales' }),
        dataset: 'sales',
        grouping: [{
            by: 'region',
            header: { height: 24, items: [text('rh', { value: 'Region {region}' })], ...header },
            footer: { height: 20, items: [text('rf', { value: 'Total {sum(qty)}' })], ...footer }
        }]
    }])]
});

const data = () => ({
    sales: [
        { name: 'a', qty: 1, price: 1, region: 'North' },
        { name: 'b', qty: 2, price: 2, region: 'South' }
    ]
});

const level = (l) => tablesOf(l)[0].grouping[0];


describe('a group band background on the printed report', () => {
    it('shades the header and the footer across the table', () => {
        const json = grouped({ header: { background: '#e8f0fe' }, footer: { background: '#fff4d6' } });
        const doc = new DOMParser().parseFromString(render(run(json, data())), 'text/html');

        const headers = [...doc.querySelectorAll('.group-header .group-band-cell')];
        const footers = [...doc.querySelectorAll('.group-footer .group-band-cell')];

        expect(headers).toHaveLength(2);
        expect(headers.every(td => td.getAttribute('style') === 'background:#e8f0fe')).toBe(true);
        expect(footers.every(td => td.getAttribute('style') === 'background:#fff4d6')).toBe(true);
    });

    it('leaves a band with no background unshaded', () => {
        const doc = new DOMParser().parseFromString(render(run(grouped(), data())), 'text/html');

        expect(doc.querySelector('.group-header .group-band-cell').hasAttribute('style')).toBe(false);
    });

    it('is a layout validate.js accepts, and names a background that is not a colour', () => {
        expect(validateLayout(grouped({ header: { background: '#e8f0fe' } }))).toEqual([]);
        expect(validateLayout(grouped({ footer: { background: 7 } })))
            .toEqual(['table "sales".grouping[0].footer.background must be a colour, or null']);
    });
});


describe('a group band background from the designer', () => {
    const root = () => document.getElementById('report-designer');
    const panel = () => root().querySelector('.dz-panel');
    const fill = (key) => panel().querySelector(`[data-band-fill="${key}"]`);
    const swatch = (key) => fill(key).closest('.dz-swatch');

    function mount(l = grouped()) {
        designer = createDesigner({ mount: '#report-designer', layout: l });
        designer.select({ band: 'detail', id: 'sales' });
        return designer;
    }

    function pick(key, color) {
        fill(key).value = color;
        fill(key).dispatchEvent(new Event('input', { bubbles: true }));
    }

    it('offers a background on each group band row, none to begin with', () => {
        mount();

        expect(swatch('groupHeader:sales').classList.contains('is-none')).toBe(true);
        expect(swatch('groupFooter:sales').classList.contains('is-none')).toBe(true);
    });

    it('sets the band background, and shades it on the canvas', () => {
        const d = mount();

        pick('groupHeader:sales', '#e8f0fe');

        expect(level(d.layout).header.background).toBe('#e8f0fe');
        expect(swatch('groupHeader:sales').classList.contains('is-none')).toBe(false);
        expect(root().querySelector('.group-header .group-band-cell').getAttribute('style'))
            .toBe('background:#e8f0fe');
    });

    it('takes it off again with the clear button', () => {
        const d = mount(grouped({ footer: { background: '#fff4d6' } }));

        expect(swatch('groupFooter:sales').classList.contains('is-none')).toBe(false);

        panel().querySelector('[data-action="clear-band-fill"][data-fill-for="groupFooter:sales"]').click();

        expect(level(d.layout).footer).not.toHaveProperty('background');
        expect(swatch('groupFooter:sales').classList.contains('is-none')).toBe(true);
    });

    it('can be undone', () => {
        const d = mount();

        pick('groupHeader:sales', '#e8f0fe');
        root().querySelector('[data-action="undo"]').click();

        expect(level(d.layout).header).not.toHaveProperty('background');
    });

    it('is offered for an inner level too, and only for a band that is on', () => {
        const l = grouped();
        tablesOf(l)[0].grouping.push({ by: 'name', header: { height: 18, items: [] }, footer: null });
        mount(l);

        expect(fill('groupHeader@1:sales')).not.toBeNull();
        expect(fill('groupFooter@1:sales')).toBeNull();
    });

    it('offers none for a report band', () => {
        mount();
        designer.select(null);

        expect(panel().querySelector('[data-band-fill="detail"]')).toBeNull();
        expect(panel().querySelector('[data-band-fill]')).not.toBeNull();
    });
});

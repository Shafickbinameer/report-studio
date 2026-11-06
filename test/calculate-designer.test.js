/**
 * @vitest-environment jsdom
 *
 * A calculated column from the designer: the Calculation box on a column's
 * card. What the engine does with the calculation is in calculate.test.js.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDesigner } from '../src/designer/designer.js';
import { validateLayout } from '../src/engine/validate.js';
import { buildPages } from '../src/engine/index.js';
import { layout, table, band } from './helpers/layout.js';

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


const root = () => document.getElementById('report-designer');
const panel = () => root().querySelector('.dz-panel');
const box = (index) => panel().querySelector(`[data-field="expression"][data-column="${index}"]`);

function mount() {
    designer = createDesigner({
        mount: '#report-designer',
        layout: layout({ bands: [band('detail', [table({ id: 'tbl' })])] })
    });
    designer.select({ band: 'detail', id: 'tbl' });
    return designer;
}

function type(index, value) {
    box(index).value = value;
    box(index).dispatchEvent(new Event('input', { bubbles: true }));
}

const column = (n) => designer.layout.bands[0].items[0].columns[n];


describe('the Calculation box', () => {
    it("is on every column's card, empty to begin with", () => {
        mount();

        expect(box(0)).not.toBeNull();
        expect(box(2).value).toBe('');
    });

    it("makes the column a calculated one, worked out from the column's row", () => {
        const d = mount();

        type(2, '{qty} * 10');

        expect(column(2).expression).toBe('{qty} * 10');
        expect(validateLayout(d.layout)).toEqual([]);

        const built = buildPages(d.layout, { items: [{ name: 'a', qty: 3 }] });
        const placed = built.pages[0].bands.flatMap(b => b.items).find(i => i.id === 'tbl');
        expect(placed.row[0].price).toBe(30);
    });

    it('takes the calculation away when the box is cleared', () => {
        mount();

        type(2, '{qty} * 10');
        type(2, '');

        expect(column(2).expression ?? '').toBe('');
        expect(validateLayout(designer.layout)).toEqual([]);
    });

    it('lets validation name a calculation it cannot read', () => {
        mount();

        type(1, '{qty} *');

        expect(validateLayout(designer.layout))
            .toEqual(['bands[0].items[0].columns[1].expression ends where a value is expected']);
    });
});

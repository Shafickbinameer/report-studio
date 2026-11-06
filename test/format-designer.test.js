/**
 * @vitest-environment jsdom
 *
 * Formatting values from the designer: a summary on a text item's rail and on
 * each column's card, the Format Editor behind it, and the report's own
 * defaults. What the engine does with a format is in format.test.js.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDesigner } from '../src/designer/designer.js';
import { validateLayout } from '../src/engine/validate.js';
import { INDIAN_DEFAULTS } from '../src/engine/format.js';
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


const json = (defaults) => ({
    ...layout({
        bands: [band('detail', [
            text('total', { y: 0, value: 'Total {sum(price)}' }),
            { ...table({ id: 'tbl', y: 60 }) }
        ])]
    }),
    ...(defaults ? { format: defaults } : {})
});

function mount(l = json()) {
    designer = createDesigner({ mount: '#report-designer', layout: l });
    return designer;
}

const root = () => document.getElementById('report-designer');
const panel = () => root().querySelector('.dz-panel');
const dialog = () => root().querySelector('[data-role="format-dialog"]');
const item = (id) => designer.layout.bands[0].items.find(i => i.id === id);

const formatButton = (index) => panel().querySelector(index == null
    ? '[data-action="edit-format"]:not([data-index])'
    : `[data-action="edit-format"][data-index="${index}"]`);

/** choose a type, and the like, the way a person does */
function choose(role, value) {
    const node = dialog().querySelector(`[data-role="${role}"]`);
    node.value = value;
    node.dispatchEvent(new Event('change', { bubbles: true }));
}

function pickType(type) {
    const radio = dialog().querySelector(`[name="format-type"][value="${type}"]`);
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
}

const sample = () => [...dialog().querySelectorAll('[data-role="sample"] span')].map(s => s.textContent);

/** the dialog resolves a promise; let it land */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

async function apply() {
    dialog().querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
}


describe('the format on the rail', () => {
    it('shows a text item format as one line, as it comes by default', () => {
        mount();
        designer.select({ band: 'detail', id: 'total' });

        expect(formatButton().textContent).toContain('As it comes');
    });

    it('shows each column its own', () => {
        const l = json(INDIAN_DEFAULTS);
        l.bands[0].items[1].columns[2].format = { type: 'currency' };
        mount(l);
        designer.select({ band: 'detail', id: 'tbl' });

        expect(formatButton(0).textContent).toContain('As it comes');
        expect(formatButton(2).textContent).toContain('Currency · ₹12,34,567.89');
    });
});


describe('the Format Editor', () => {
    it('opens on the format as it stands', () => {
        const l = json();
        l.bands[0].items[1].columns[2].format = { type: 'currency', symbol: '$', decimals: 0 };
        mount(l);
        designer.select({ band: 'detail', id: 'tbl' });

        formatButton(2).click();

        expect(dialog().querySelector('[name="format-type"]:checked').value).toBe('currency');
        expect(dialog().querySelector('[data-role="decimals"]').value).toBe('0');
        expect(sample()).toEqual(['$1,234,568', '-$1,500', '$0']);
    });

    it('shows only the choices the type has', () => {
        mount();
        designer.select({ band: 'detail', id: 'total' });
        formatButton().click();

        pickType('number');
        expect(dialog().querySelector('[data-role="number-options"]').hidden).toBe(false);
        expect(dialog().querySelector('[data-role="currency-options"]').hidden).toBe(true);
        expect(dialog().querySelector('[data-role="date-options"]').hidden).toBe(true);

        pickType('date');
        expect(dialog().querySelector('[data-role="number-options"]').hidden).toBe(true);
        expect(dialog().querySelector('[data-role="date-options"]').hidden).toBe(false);
    });

    it('updates the sample as each choice changes', () => {
        mount();
        designer.select({ band: 'detail', id: 'total' });
        formatButton().click();

        pickType('number');
        choose('grouping', 'indian');
        choose('negative', 'brackets');
        choose('zero', 'dash');

        expect(sample()).toEqual(['12,34,567.89', '(1,500.00)', '-']);
    });

    it('takes decimals in a number box, and shows zero with that many places', () => {
        mount();
        designer.select({ band: 'detail', id: 'total' });
        formatButton().click();
        pickType('number');

        const places = dialog().querySelector('[data-role="decimals"]');
        const zeroOption = () => dialog().querySelector('[data-role="zero"] option[value="zero"]').textContent;

        expect(places.type).toBe('number');
        expect(zeroOption()).toBe('0.00');

        choose('decimals', '3');
        expect(zeroOption()).toBe('0.000');
        expect(sample().at(-1)).toBe('0.000');

        choose('decimals', '0');
        expect(zeroOption()).toBe('0');
    });

    it('holds the decimals to 0 to 6, and keeps the last good number while the box is empty', async () => {
        mount();
        designer.select({ band: 'detail', id: 'total' });
        formatButton().click();
        pickType('number');

        const places = dialog().querySelector('[data-role="decimals"]');

        choose('decimals', '9');
        expect(places.value).toBe('6');

        choose('decimals', '');
        expect(places.value).toBe('');
        expect(sample()[0]).toBe('1,234,567.89');

        await apply();
        expect(item('total').format).toEqual({ type: 'number' });
    });

    it('saves what was chosen on the text item, and redraws its summary', async () => {
        mount();
        designer.select({ band: 'detail', id: 'total' });
        formatButton().click();

        pickType('currency');
        choose('symbolChoice', '₹');
        choose('decimals', '0');
        await apply();

        expect(dialog()).toBeNull();
        expect(item('total').format).toEqual({ type: 'currency', decimals: 0, symbol: '₹' });
        expect(formatButton().textContent).toContain('₹1,234,568');
        expect(validateLayout(designer.layout)).toEqual([]);
    });

    it('keeps only what differs from the report defaults', async () => {
        mount(json(INDIAN_DEFAULTS));
        designer.select({ band: 'detail', id: 'tbl' });
        formatButton(2).click();

        pickType('currency');
        await apply();

        expect(item('tbl').columns[2].format).toEqual({ type: 'currency' });
    });

    it('saves a date layout, a custom one included', async () => {
        mount();
        designer.select({ band: 'detail', id: 'tbl' });
        formatButton(1).click();

        pickType('date');
        choose('pattern', '__custom__');
        expect(dialog().querySelector('[data-role="custom-row"]').hidden).toBe(false);

        dialog().querySelector('[data-role="customPattern"]').value = 'dd.MM.yy';
        dialog().querySelector('[data-role="customPattern"]')
            .dispatchEvent(new Event('input', { bubbles: true }));
        expect(sample()).toEqual(['17.06.26']);

        await apply();
        expect(item('tbl').columns[1].format).toEqual({ type: 'date', pattern: 'dd.MM.yy' });
    });

    it('takes the format away when set back to as it comes', async () => {
        const l = json();
        l.bands[0].items[0].format = { type: 'number' };
        mount(l);
        designer.select({ band: 'detail', id: 'total' });
        formatButton().click();

        pickType('text');
        await apply();

        expect(item('total')).not.toHaveProperty('format');
    });

    it('puts every choice back to the report defaults, keeping the type', async () => {
        const l = json(INDIAN_DEFAULTS);
        l.bands[0].items[0].format = { type: 'currency', symbol: '$', decimals: 0 };
        mount(l);
        designer.select({ band: 'detail', id: 'total' });
        formatButton().click();

        dialog().querySelector('[data-role="reset"]').click();
        await settle();

        expect(item('total').format).toEqual({ type: 'currency' });
    });

    it('changes nothing when cancelled', async () => {
        mount();
        designer.select({ band: 'detail', id: 'total' });
        formatButton().click();

        pickType('currency');
        dialog().querySelector('[data-role="cancel"]').click();
        await settle();

        expect(item('total')).not.toHaveProperty('format');
    });

    it('can be undone', async () => {
        mount();
        designer.select({ band: 'detail', id: 'total' });
        formatButton().click();
        pickType('percent');
        await apply();

        root().querySelector('[data-action="undo"]').click();

        expect(item('total')).not.toHaveProperty('format');
    });
});


describe("the report's own defaults", () => {
    const control = (key) => panel().querySelector(`[data-field="${key}"]`);

    it('starts neutral', () => {
        mount();

        expect(control('format.grouping').value).toBe('international');
        expect(control('format.pattern').value).toBe('yyyy-MM-dd');
        expect(control('format.symbol').value).toBe('');
    });

    it('sets Indian digit groups, the rupee and day-first dates in one click', () => {
        mount();

        panel().querySelector('[data-action="format-india"]').click();

        expect(designer.layout.format).toEqual(INDIAN_DEFAULTS);
        expect(control('format.grouping').value).toBe('indian');
        expect(control('format.pattern').value).toBe('dd/MM/yyyy');
        expect(validateLayout(designer.layout)).toEqual([]);
    });

    it('sets one default at a time', () => {
        mount();

        control('format.grouping').value = 'indian';
        control('format.grouping').dispatchEvent(new Event('change', { bubbles: true }));

        expect(designer.layout.format).toEqual({ grouping: 'indian' });
    });
});


describe('formatting from the right-click menu', () => {
    const menu = () => root().querySelector('[data-role="menu"]');

    function rightClick(node) {
        node.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 2
        }));
        return menu();
    }

    const drawn = (id) => root().querySelector(`[data-item-id="${id}"]`);
    const cellOf = (row, column) =>
        drawn('tbl').querySelectorAll('tbody tr')[row].children[column];
    const entry = () => menu().querySelector('[data-action="edit-format"]');

    it('offers Format… on a text item, and opens the editor on it', async () => {
        mount();

        rightClick(drawn('total'));
        expect(entry().textContent).toContain('Format…');

        entry().click();
        expect(menu()).toBeNull();
        expect(dialog().querySelector('h2').textContent).toBe('Format: total');

        pickType('number');
        await apply();

        expect(item('total').format).toEqual({ type: 'number' });
    });

    it('formats the column of the cell that was right-clicked, named in the menu', async () => {
        mount();

        rightClick(cellOf(1, 2));
        expect(entry().textContent).toContain('Format "Price" column…');

        entry().click();
        expect(dialog().querySelector('h2').textContent).toBe('Format: Price');

        pickType('currency');
        await apply();

        expect(item('tbl').columns[2].format).toEqual({ type: 'currency' });
        expect(item('tbl').columns[0]).not.toHaveProperty('format');
    });

    it('formats a column from its heading too', () => {
        mount();

        rightClick(drawn('tbl').querySelectorAll('thead th')[1]);

        expect(entry().textContent).toContain('Format "Qty" column…');
    });

    it('offers no Format for a box, or for several items at once', () => {
        const l = json();
        l.bands[0].items.push({ id: 'b1', type: 'box', x: 0, y: 400, w: 100, h: 40 });
        mount(l);

        rightClick(drawn('b1'));
        expect(entry()).toBeNull();

        designer.select([{ band: 'detail', id: 'total' }, { band: 'detail', id: 'b1' }]);
        rightClick(drawn('total'));
        expect(entry()).toBeNull();
    });

    it('names every action in the menu', () => {
        mount();

        rightClick(drawn('total'));

        expect([...menu().querySelectorAll('.dz-menu-label')].map(l => l.textContent))
            .toEqual(['Format…', 'Highlight…', 'Duplicate', 'Copy', 'Paste', 'Delete']);
    });

    it('moves through the menu with the arrow keys, without nudging the item', () => {
        mount();
        const before = { ...item('total') };

        rightClick(drawn('total'));
        const press = (key) => document.activeElement.dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

        expect(document.activeElement.dataset.action).toBe('edit-format');

        press('ArrowDown');
        expect(document.activeElement.dataset.action).toBe('edit-highlight');

        press('ArrowDown');
        expect(document.activeElement.dataset.action).toBe('duplicate-item');

        press('End');
        expect(document.activeElement.dataset.action).toBe('delete-item');

        press('ArrowDown');
        expect(document.activeElement.dataset.action).toBe('edit-format');

        expect(item('total').x).toBe(before.x);
        expect(item('total').y).toBe(before.y);
    });
});


describe('choosing a currency symbol', () => {
    const symbolSelect = () => dialog().querySelector('[data-role="symbolChoice"]');
    const customRow = () => dialog().querySelector('[data-role="symbol-row"]');

    function openOn(format, defaults) {
        const l = json(defaults);
        if (format) l.bands[0].items[0].format = format;
        mount(l);
        designer.select({ band: 'detail', id: 'total' });
        formatButton().click();
    }

    it('offers the usual symbols in a dropdown, None and Custom… with them', () => {
        openOn({ type: 'currency' });

        const values = [...symbolSelect().options].map(o => o.value);
        expect(values.slice(0, 4)).toEqual(['', '₹', 'Rs.', '$']);
        expect(values.at(-1)).toBe('__custom__');
        expect(customRow().hidden).toBe(true);
    });

    it('shows the symbol the format has, or the report defaults give it', () => {
        openOn({ type: 'currency' }, INDIAN_DEFAULTS);

        expect(symbolSelect().value).toBe('₹');
        expect(sample()[0]).toBe('₹12,34,567.89');
    });

    it('saves a symbol picked from the list', async () => {
        openOn({ type: 'currency' });

        choose('symbolChoice', '€');
        expect(sample()[0]).toBe('€1,234,567.89');

        await apply();
        expect(item('total').format).toEqual({ type: 'currency', symbol: '€' });
    });

    it('takes any other symbol through Custom…', async () => {
        openOn({ type: 'currency' });

        choose('symbolChoice', '__custom__');
        expect(customRow().hidden).toBe(false);

        const box = dialog().querySelector('[data-role="symbol"]');
        box.value = 'CHF ';
        box.dispatchEvent(new Event('input', { bubbles: true }));
        expect(sample()[0]).toBe('CHF1,234,567.89');

        await apply();
        expect(item('total').format).toEqual({ type: 'currency', symbol: 'CHF' });
    });

    it('opens on Custom… for a symbol that is not listed', () => {
        openOn({ type: 'currency', symbol: 'CHF' });

        expect(symbolSelect().value).toBe('__custom__');
        expect(customRow().hidden).toBe(false);
        expect(dialog().querySelector('[data-role="symbol"]').value).toBe('CHF');
    });
});


describe("the report's currency symbol", () => {
    const select = () => panel().querySelector('select[data-field="format.symbol"]');
    const box = () => panel().querySelector('input[data-field="format.symbol"][data-custom]');

    it('is a dropdown, with its custom box hidden', () => {
        mount();

        expect(select().value).toBe('');
        expect(box().hidden).toBe(true);
    });

    it('sets a listed symbol from the dropdown', () => {
        mount();

        select().value = '$';
        select().dispatchEvent(new Event('change', { bubbles: true }));

        expect(designer.layout.format).toEqual({ symbol: '$' });
    });

    it('shows the box for Custom…, writing nothing until something is typed', () => {
        mount();

        select().value = '__custom__';
        select().dispatchEvent(new Event('change', { bubbles: true }));

        expect(box().hidden).toBe(false);
        expect(designer.layout.format).toBeUndefined();

        box().value = 'CHF';
        box().dispatchEvent(new Event('input', { bubbles: true }));

        expect(designer.layout.format).toEqual({ symbol: 'CHF' });
    });

    it('shows a custom symbol already in the report as Custom… and its box', () => {
        mount(json({ symbol: 'CHF' }));

        expect(select().value).toBe('__custom__');
        expect(box().hidden).toBe(false);
        expect(box().value).toBe('CHF');
    });
});

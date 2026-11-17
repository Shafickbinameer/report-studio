/**
 * @vitest-environment jsdom
 *
 * Highlight rules from the designer: the summary on a column's card, a text
 * item's rail and a table's, the right-click entries, and the rule editor
 * behind them. What the engine does with the rules is in highlight.test.js.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDesigner } from '../src/designer/designer.js';
import { validateLayout } from '../src/engine/validate.js';
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
    bands: [band('detail', [
        text('total', { y: 0, value: '{sum(price)}' }),
        { ...table({ id: 'tbl', y: 60 }) }
    ])]
});

function mount(l = json()) {
    designer = createDesigner({ mount: '#report-designer', layout: l });
    return designer;
}

const root = () => document.getElementById('report-designer');
const panel = () => root().querySelector('.dz-panel');
const dialog = () => root().querySelector('[data-role="highlight-dialog"]');
const item = (id) => designer.layout.bands[0].items.find(i => i.id === id);
const ruleCards = () => [...dialog().querySelectorAll('.dz-hl-rule')];

const button = (action, index) => panel().querySelector(index == null
    ? `[data-action="${action}"]:not([data-index])`
    : `[data-action="${action}"][data-index="${index}"]`);

/** set a rule's control the way a person does */
function set(n, key, value) {
    const node = ruleCards()[n].querySelector(`[data-key="${key}"]`);
    node.value = value;
    node.dispatchEvent(new Event('input', { bubbles: true }));
}

const press = (n, action) => ruleCards()[n].querySelector(`[data-rule-action="${action}"]`).click();

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

async function apply() {
    dialog().querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
}

function openOnColumn(index = 2) {
    mount();
    designer.select({ band: 'detail', id: 'tbl' });
    button('edit-highlight', index).click();
}


describe('highlight on the rail', () => {
    it('shows each column its rules, none to start with', () => {
        const l = json();
        l.bands[0].items[1].columns[2].highlight = [{ when: { op: '<', value: 0 }, style: { color: '#f00' } }];
        mount(l);
        designer.select({ band: 'detail', id: 'tbl' });

        expect(button('edit-highlight', 0).textContent).toContain('None');
        expect(button('edit-highlight', 2).textContent).toContain('1 rule');
        expect(button('edit-row-highlight')).not.toBeNull();
    });

    it('offers a text item its own', () => {
        mount();
        designer.select({ band: 'detail', id: 'total' });

        expect(button('edit-highlight').textContent).toContain('None');
    });
});


describe('the rule editor', () => {
    it('starts a column with one rule: red when the value is below zero', () => {
        openOnColumn();

        expect(ruleCards()).toHaveLength(1);
        expect(ruleCards()[0].querySelector('[data-key="field"]').value).toBe('');
        expect(ruleCards()[0].querySelector('[data-key="op"]').value).toBe('<');
        expect(ruleCards()[0].querySelector('[data-key="value"]').value).toBe('0');
    });

    it('saves the rule, numbers as numbers', async () => {
        openOnColumn();
        set(0, 'value', '100');
        await apply();

        expect(item('tbl').columns[2].highlight).toEqual([
            { when: { op: '<', value: 100 }, style: { color: '#b3261e' } }
        ]);
        expect(validateLayout(designer.layout)).toEqual([]);
        expect(button('edit-highlight', 2).textContent).toContain('1 rule');
    });

    it('tests another column, with text compared as text', async () => {
        openOnColumn();
        set(0, 'field', 'name');
        set(0, 'op', '=');
        set(0, 'value', 'Cable');
        await apply();

        expect(item('tbl').columns[2].highlight[0].when).toEqual({ field: 'name', op: '=', value: 'Cable' });
    });

    it('asks for a second value for between, and none for empty', () => {
        openOnColumn();

        set(0, 'op', 'between');
        expect(ruleCards()[0].querySelector('[data-key="to"]')).not.toBeNull();

        set(0, 'op', 'empty');
        expect(ruleCards()[0].querySelector('[data-key="value"]')).toBeNull();
        expect(ruleCards()[0].querySelector('[data-key="to"]')).toBeNull();
    });

    it('sets the style: colours, fill, bold and italic, shown in the sample', async () => {
        openOnColumn();

        set(0, 'background', '#ffff00');
        press(0, 'bold');
        press(0, 'italic');

        const sample = ruleCards()[0].querySelector('[data-role="preview"]').getAttribute('style');
        expect(sample).toContain('background:#ffff00');
        expect(sample).toContain('font-weight:bold');

        press(0, 'italic');
        await apply();

        expect(item('tbl').columns[2].highlight[0].style)
            .toEqual({ color: '#b3261e', background: '#ffff00', fontWeight: 'bold' });
    });

    it('takes a colour off with its clear button', async () => {
        openOnColumn();

        ruleCards()[0].querySelector('[data-rule-action="clear"][data-key="color"]').click();
        set(0, 'background', '#ffff00');
        await apply();

        expect(item('tbl').columns[2].highlight[0].style).toEqual({ background: '#ffff00' });
    });

    it('adds, orders and removes rules - the first that holds is used', async () => {
        openOnColumn();

        dialog().querySelector('[data-rule-action="add"]').click();
        expect(ruleCards()).toHaveLength(2);
        set(1, 'op', '>');
        set(1, 'value', '1000');

        press(1, 'up');
        expect(ruleCards()[0].querySelector('[data-key="op"]').value).toBe('>');

        dialog().querySelector('[data-rule-action="add"]').click();
        press(2, 'remove');
        await apply();

        expect(item('tbl').columns[2].highlight.map(r => r.when.op)).toEqual(['>', '<']);
    });

    it('drops a rule left without a value to compare with', async () => {
        openOnColumn();
        set(0, 'value', '');
        await apply();

        expect(item('tbl').columns[2]).not.toHaveProperty('highlight');
    });

    it('takes the rules away when every one is removed', async () => {
        const l = json();
        l.bands[0].items[1].columns[2].highlight = [{ when: { op: '<', value: 0 }, style: { color: '#f00' } }];
        mount(l);
        designer.select({ band: 'detail', id: 'tbl' });
        button('edit-highlight', 2).click();

        press(0, 'remove');
        await apply();

        expect(item('tbl').columns[2]).not.toHaveProperty('highlight');
    });

    it('changes nothing when cancelled', async () => {
        openOnColumn();
        set(0, 'value', '5');
        dialog().querySelector('[data-role="cancel"]').click();
        await settle();

        expect(item('tbl').columns[2]).not.toHaveProperty('highlight');
    });

    it('can be undone', async () => {
        openOnColumn();
        await apply();

        root().querySelector('[data-action="undo"]').click();

        expect(item('tbl').columns[2]).not.toHaveProperty('highlight');
    });
});


describe('row highlight', () => {
    it('tests a field of the row, never the value - a row has none', async () => {
        mount();
        designer.select({ band: 'detail', id: 'tbl' });
        button('edit-row-highlight').click();

        const subjects = [...ruleCards()[0].querySelectorAll('[data-key="field"] option')].map(o => o.value);
        expect(subjects).toEqual(['name', 'qty', 'price']);

        set(0, 'field', 'qty');
        set(0, 'op', '>');
        set(0, 'value', '3');
        set(0, 'background', '#fdecec');
        ruleCards()[0].querySelector('[data-rule-action="clear"][data-key="color"]').click();
        await apply();

        expect(item('tbl').rowHighlight).toEqual([
            { when: { field: 'qty', op: '>', value: 3 }, style: { background: '#fdecec' } }
        ]);
        expect(validateLayout(designer.layout)).toEqual([]);
    });
});


describe('highlight from the right-click menu', () => {
    const menu = () => root().querySelector('[data-role="menu"]');
    const drawn = (id) => root().querySelector(`[data-item-id="${id}"]`);

    function rightClick(node) {
        node.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 2
        }));
        return menu();
    }

    const labels = () => [...menu().querySelectorAll('.dz-menu-label')].map(l => l.textContent);

    it('offers a text item Highlight… beside Format…', () => {
        mount();
        rightClick(drawn('total'));

        expect(labels().slice(0, 2)).toEqual(['Format…', 'Highlight…']);
    });

    it('offers a table cell its column, and the rows', () => {
        mount();
        rightClick(drawn('tbl').querySelectorAll('tbody tr')[0].children[2]);

        expect(labels().slice(0, 3))
            .toEqual(['Format "Price" column…', 'Highlight "Price" column…', 'Highlight rows…']);
    });

    it('opens the editor on the column that was right-clicked', async () => {
        mount();
        rightClick(drawn('tbl').querySelectorAll('tbody tr')[0].children[1]);
        menu().querySelector('[data-action="edit-highlight"]').click();

        expect(dialog().querySelector('h2').textContent).toBe('Highlight: Qty');
        await apply();

        expect(item('tbl').columns[1].highlight).toHaveLength(1);
    });

    it('opens the row editor from Highlight rows…', () => {
        mount();
        rightClick(drawn('tbl').querySelectorAll('tbody tr')[0].children[0]);
        menu().querySelector('[data-action="edit-row-highlight"]').click();

        expect(dialog().querySelector('h2').textContent).toBe('Highlight: tbl rows');
    });
});


describe('the editor drawn as a design tool draws a dialog', () => {
    const trigger = (n, key) => ruleCards()[n].querySelector(`[data-key="${key}"]`)
        .closest('.dz-choice').querySelector('.dz-choice-trigger');
    const openList = () => [...root().querySelectorAll('.dz-listbox')].find(l => !l.hidden);

    it('closes from the × in its title bar, keeping the rules as they were', async () => {
        openOnColumn();
        set(0, 'value', '5');

        const close = dialog().querySelector('[data-role="close"]');
        expect(close.getAttribute('aria-label')).toBe('Close');

        close.click();
        await settle();

        expect(dialog()).toBeNull();
        expect(item('tbl').columns[2].highlight).toBeUndefined();
    });

    it('opens a test from the shared list, and the rule takes it', () => {
        openOnColumn();

        trigger(0, 'op').click();
        expect(openList()).toBeDefined();
        expect(openList().classList.contains('is-roomy')).toBe(true);

        [...openList().querySelectorAll('[role="option"]')]
            .find(o => o.textContent.trim() === 'is between').click();

        expect(ruleCards()[0].querySelector('[data-key="op"]').value).toBe('between');
        expect(ruleCards()[0].querySelector('[data-key="to"]')).not.toBeNull();
        expect(trigger(0, 'op').textContent.trim()).toBe('is between');
    });

    it('hands the focus from the hidden select to the button standing for it', () => {
        openOnColumn();

        /** what the editor does after redrawing a rule for a new test */
        set(0, 'op', 'empty');

        expect(document.activeElement).toBe(trigger(0, 'op'));
    });

    it('takes its list with it when it closes', async () => {
        openOnColumn();
        const before = root().querySelectorAll('.dz-listbox').length;

        dialog().querySelector('[data-role="close"]').click();
        await settle();

        expect(root().querySelectorAll('.dz-listbox').length).toBe(before - 1);
    });
});

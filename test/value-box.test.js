/**
 * @vitest-environment jsdom
 *
 * The value box: the button that writes the braces, and the layer that marks
 * them.
 *
 * A textarea cannot style its own contents, so the placeholders are drawn on a
 * layer behind it. The tests that matter are the ones keeping the two in step -
 * a marking layer that falls behind the text is worse than none, because it
 * marks the wrong characters rather than no characters.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDesigner } from '../src/designer/designer.js';
import { markPlaceholders, insertBraces } from '../src/designer/panel.js';
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

const json = (value = 'Total') => layout({
    bands: [band('detail', [
        text('t1', { x: 0, y: 0, w: 200, h: 40, value }),
        table({ id: 'tbl' })
    ])]
});

function mount(l = json()) {
    designer = createDesigner({ mount: '#report-designer', layout: l });
    return designer;
}

const root = () => document.getElementById('report-designer');
const drawn = (id) => root().querySelector(`[data-item-id="${id}"]`);
const box = () => root().querySelector('.dz-panel textarea[data-field="value"]');
const marks = () => root().querySelector('.dz-panel [data-role="marks"]');
const brace = () => root().querySelector('.dz-panel [data-action="insert-brace"]');

function select(id) {
    const event = new MouseEvent('pointerdown', {
        bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0
    });
    event.pointerId = 1;
    drawn(id).dispatchEvent(event);
}

function click(node) {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function type(value) {
    const node = box();
    node.value = value;
    node.dispatchEvent(new Event('input', { bubbles: true }));
}


describe('markPlaceholders', () => {
    it('marks a placeholder', () => {
        expect(markPlaceholders('{page}'))
            .toContain('<mark class="dz-mark">{page}</mark>');
    });

    it('leaves the words around it alone', () => {
        const out = markPlaceholders('Page {page} of {totalPages}');

        expect(out).toContain('Page <mark');
        expect((out.match(/<mark/g) || [])).toHaveLength(2);
    });

    it('marks an aggregate, brackets and all', () => {
        expect(markPlaceholders('{sum(amount)}'))
            .toContain('>{sum(amount)}<');
    });

    it('does not mark a half-typed one', () => {
        /** a placeholder is only a placeholder once both braces are there */
        expect(markPlaceholders('{page')).not.toContain('<mark');
        expect(markPlaceholders('page}')).not.toContain('<mark');
    });

    it('escapes what the user typed, so it cannot become markup', () => {
        const out = markPlaceholders('<img src=x onerror=alert(1)>');

        expect(out).not.toContain('<img');
        expect(out).toContain('&lt;img');
    });

    it('escapes inside a placeholder too', () => {
        expect(markPlaceholders('{<b>x</b>}')).not.toContain('<b>');
    });

    it('keeps a line for a trailing newline, as a textarea does', () => {
        /** otherwise the layer comes up short and the marks drift off the text */
        expect(markPlaceholders('a\n')).toBe('a\n\n');
    });

    it('copes with nothing at all', () => {
        expect(() => markPlaceholders(null)).not.toThrow();
        expect(() => markPlaceholders(undefined)).not.toThrow();
    });
});


describe('insertBraces', () => {
    const field = (value, start, end = start) => {
        const node = document.createElement('textarea');
        node.value = value;
        document.body.appendChild(node);
        node.setSelectionRange(start, end);
        return node;
    };

    it('inserts a pair where the caret is', () => {
        const node = field('Total: ', 7);
        insertBraces(node);

        expect(node.value).toBe('Total: {}');
    });

    it('leaves the caret between them, ready for a field name', () => {
        const node = field('Total: ', 7);
        insertBraces(node);

        expect(node.selectionStart).toBe(8);
        expect(node.selectionEnd).toBe(8);
    });

    it('wraps the selected text instead', () => {
        /** how a word already typed becomes a field, without retyping it */
        const node = field('Total: amount', 7, 13);
        insertBraces(node);

        expect(node.value).toBe('Total: {amount}');
    });

    it('leaves the caret after what it wrapped', () => {
        const node = field('amount', 0, 6);
        insertBraces(node);

        expect(node.selectionStart).toBe(7);
    });

    it('inserts in the middle without disturbing either end', () => {
        const node = field('ab', 1);
        insertBraces(node);

        expect(node.value).toBe('a{}b');
    });

    it('reports the change the way typing would', () => {
        const node = field('', 0);
        const heard = [];
        node.addEventListener('input', () => heard.push(node.value));

        insertBraces(node);

        expect(heard).toEqual(['{}']);
    });
});


describe('the value box in the rail', () => {
    it('offers the button beside the label', () => {
        mount();
        select('t1');

        expect(brace()).not.toBeNull();
        expect(root().querySelector('.dz-field-top label').textContent)
            .toBe('Value');
    });

    it('offers it on the value field and nowhere else', () => {
        mount();
        select('t1');

        expect(root().querySelectorAll('[data-action="insert-brace"]'))
            .toHaveLength(1);
    });

    it('marks the placeholders already in the value', () => {
        mount(json('Due {invoice.date}'));
        select('t1');

        expect(marks().innerHTML).toContain('<mark class="dz-mark">{invoice.date}</mark>');
    });

    it('writes the braces into the layout when the button is pressed', () => {
        const d = mount(json('Total: '));
        select('t1');

        box().setSelectionRange(7, 7);
        click(brace());

        expect(d.layout.bands[0].items[0].value).toBe('Total: {}');
    });

    it('wraps what was selected in the box', () => {
        const d = mount(json('Total: amount'));
        select('t1');

        box().setSelectionRange(7, 13);
        click(brace());

        expect(d.layout.bands[0].items[0].value).toBe('Total: {amount}');
    });

    it('marks what the button just inserted', () => {
        mount(json('Total: amount'));
        select('t1');

        box().setSelectionRange(7, 13);
        click(brace());

        expect(marks().innerHTML).toContain('>{amount}<');
    });

    it('keeps the marks in step with typing', () => {
        mount();
        select('t1');

        type('Region: {region}');

        expect(marks().innerHTML).toContain('>{region}<');
        expect(marks().textContent).toContain('Region: {region}');
    });

    it('unmarks a placeholder as its brace is deleted', () => {
        mount(json('{page}'));
        select('t1');

        expect(marks().innerHTML).toContain('<mark');

        type('{page');
        expect(marks().innerHTML).not.toContain('<mark');
    });

    it('leaves the focus in the box, so typing carries straight on', () => {
        mount(json('Total: '));
        select('t1');

        box().setSelectionRange(7, 7);
        click(brace());

        expect(document.activeElement).toBe(box());
    });

    it('keeps the marks under the text after a value changed elsewhere', () => {
        /**
         * A drag refreshes the rail's controls in place rather than rebuilding
         * them - the caret may be in one - so the layer has to be repainted
         * there too, or it would still be marking the old value.
         */
        const d = mount(json('{page}'));
        select('t1');

        d.layout.bands[0].items[0].value = '{totalPages}';

        /** a drag, which commits and syncs the rail */
        const canvas = root().querySelector('.dz-canvas');
        const down = new MouseEvent('pointerdown', {
            bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0
        });
        down.pointerId = 1;
        drawn('t1').dispatchEvent(down);

        for (const kind of ['pointermove', 'pointerup']) {
            const event = new MouseEvent(kind, {
                bubbles: true, cancelable: true, clientX: 40, clientY: 0, button: 0
            });
            event.pointerId = 1;
            canvas.dispatchEvent(event);
        }

        expect(box().value).toBe('{totalPages}');
        expect(marks().innerHTML).toContain('>{totalPages}<');
    });

    it('gives a table no value box at all', () => {
        mount();
        select('tbl');

        expect(box()).toBeNull();
        expect(brace()).toBeNull();
    });
});

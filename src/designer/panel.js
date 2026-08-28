/**
 * panel.js draws the properties rail and reports what was done to it.
 *
 * Like select.js, it decides nothing: which fields exist, what a value coerces
 * to, and what adding a band or a column means are all fields.js and
 * structure.js. This turns descriptors into controls and controls back into
 * calls.
 *
 * The rail shows one of two things. With an item selected, that item's
 * properties. With nothing selected, the report's own - name, page, margins and
 * which bands exist - because those have to be editable somewhere and "nothing
 * selected" is otherwise a wasted screen.
 *
 * It is redrawn when the *selection* changes and never while someone is typing
 * in it: rebuilding an input under a cursor takes the focus and the caret with
 * it, and typing "120" into a width becomes "1". Values that changed elsewhere,
 * such as x and y during a drag, are synced onto the existing controls instead.
 */

import {
    fieldsFor, allFields, reportFields, allReportFields,
    COLUMN_FIELDS, readField, writeField
} from './fields.js';
import { BAND_TYPES, BAND_NOTES, hasBand, findBand } from './structure.js';
import { esc } from '../render/items.js';


/**
 * The rail describes what a thing is; what you can do to it lives in the pill
 * that opens on a right-click, beside the item rather than at the edge of the
 * screen. See menu.js.
 */


/**
 * The rail for a selected item.
 * @param {object} item
 * @returns {string} markup
 */
export function drawPanel(item) {
    return `
    <div class="dz-panel-head">
        <span class="dz-panel-type">${esc(item.type)}</span>
        <span class="dz-panel-id">${esc(item.id)}</span>
    </div>
    ${sections(item, fieldsFor(item))}
    ${item.type === 'table' ? columns(item) : ''}`;
}


/**
 * The rail with several items selected.
 *
 * No property controls: writing one width onto six items is a different edit
 * from the one the controls describe, and offering a box that means "all of
 * them" where it has always meant "this one" is how a designer loses somebody's
 * layout. What a group genuinely shares is that it can be moved and deleted,
 * so that is what it offers.
 *
 * @param {object[]} items
 * @returns {string} markup
 */
export function drawManyPanel(items) {
    return `
    <div class="dz-panel-head">
        <span class="dz-panel-type">${items.length} items</span>
    </div>

    <section class="dz-section">
        <ul class="dz-selected">
            ${items.map(item => `
                <li>
                    <span class="dz-selected-type">${esc(item.type)}</span>
                    <span class="dz-selected-id">${esc(item.id)}</span>
                </li>`).join('')}
        </ul>

        <p class="dz-hint">
            Drag to move them together, or use the arrow keys.
            Select one on its own to change its properties.
        </p>
    </section>`;
}


/**
 * The rail with nothing selected: the report itself.
 * @param {object} layout
 * @returns {string} markup
 */
export function drawReportPanel(layout) {
    return `
    <div class="dz-panel-head">
        <span class="dz-panel-type">report</span>
        <span class="dz-panel-id">${esc(layout.name ?? 'Untitled')}</span>
    </div>
    ${sections(layout, reportFields(layout))}
    ${bands(layout)}`;
}


function sections(target, list) {
    return list.map(section => `
        <section class="dz-section">
            <h3>${esc(section.title)}</h3>
            ${section.fields.map(field => control(target, field)).join('')}
        </section>`).join('');
}


function control(target, field, extra = '') {
    const value = readField(target, field);
    const id = `dz-f-${field.key.replace(/\./g, '-')}${extra ? `-${extra}` : ''}`;
    const bind = extra
        ? `data-field="${esc(field.key)}" data-column="${esc(extra)}"`
        : `data-field="${esc(field.key)}"`;

    /**
     * The value box gets a button that writes the braces for you. Typing them
     * by hand is the one part of this format nobody should have to do twice -
     * and a placeholder is only a placeholder if both braces are there.
     */
    const label = field.type === 'textarea'
        ? `<span class="dz-field-top">
               <label for="${id}">${esc(field.label)}</label>
               <button type="button" class="dz-brace" data-action="insert-brace"
                       data-for="${esc(field.key)}"
                       title="Wrap the selected text in braces, or insert a pair"
                       aria-label="Insert a placeholder">{&nbsp;}</button>
           </span>`
        : `<label for="${id}">${esc(field.label)}</label>`;

    return `
    <div class="dz-field dz-field-${field.type}">
        ${label}
        ${input(id, bind, field, value)}
        ${field.hint ? `<p class="dz-hint">${esc(field.hint)}</p>` : ''}
    </div>`;
}


function input(id, bind, field, value) {
    switch (field.type) {
        case 'textarea':
            /**
             * A textarea cannot style its own contents, so the placeholders are
             * marked on a layer behind it and the box itself is given
             * transparent text and a visible caret. The two are laid out
             * identically - same font, padding and wrapping - so the marks sit
             * exactly under the characters they belong to.
             */
            return `
            <div class="dz-value">
                <div class="dz-value-marks" data-role="marks" aria-hidden="true"
                    >${markPlaceholders(value ?? '')}</div>
                <textarea id="${id}" ${bind} rows="2"
                    spellcheck="false">${esc(value ?? '')}</textarea>
            </div>`;

        case 'choice':
            return `<select id="${id}" ${bind}>${field.options.map(o =>
                `<option value="${esc(o.value)}"${o.value === value ? ' selected' : ''}
                    >${esc(o.label)}</option>`).join('')}</select>`;

        case 'color':
            /**
             * A colour input cannot hold null, and several style fields are
             * legitimately absent - so the swatch falls back to black and the
             * value is only written once someone actually picks one.
             */
            return `<input type="color" id="${id}" ${bind}
                value="${esc(value ?? '#000000')}">`;

        case 'toggle':
            return `<input type="checkbox" id="${id}" ${bind}
                ${value ? 'checked' : ''}>`;

        case 'text':
            return `<input type="text" id="${id}" ${bind}
                value="${esc(value ?? '')}" spellcheck="false">`;

        default:
            return `<input type="number" id="${id}" ${bind}
                value="${esc(value ?? '')}"
                ${field.min != null ? `min="${field.min}"` : ''}
                ${field.max != null ? `max="${field.max}"` : ''} step="1">`;
    }
}


/**
 * A table's columns, one card each. Four controls on one row would be 60px wide
 * apiece in a rail this narrow, so they stack and the card carries the number.
 */
function columns(table) {
    const list = table.columns || [];

    return `
    <section class="dz-section dz-columns">
        <h3>Columns</h3>
        ${list.map((column, index) => `
            <div class="dz-column">
                <div class="dz-column-head">
                    <span>${index + 1}</span>
                    ${list.length > 1 ? `
                        <button type="button" class="dz-icon"
                                data-action="remove-column" data-index="${index}"
                                title="Remove this column"
                                aria-label="Remove column ${index + 1}">&times;</button>` : ''}
                </div>
                ${COLUMN_FIELDS.map(field =>
                    control(column, field, String(index))).join('')}
            </div>`).join('')}
        <button type="button" class="dz-add-row" data-action="add-column">
            Add column</button>
    </section>`;
}


/**
 * Which bands the report has.
 *
 * A checkbox each, in page order, rather than a list that can be reordered -
 * validate.js allows one band of each type and regions.js decides where each
 * sits, so there is no order here for anyone to choose.
 */
function bands(layout) {
    return `
    <section class="dz-section dz-bands">
        <h3>Bands</h3>
        ${BAND_TYPES.map(type => {
            const band = findBand(layout, type);
            const on = hasBand(layout, type);

            return `
            <div class="dz-band-row${on ? ' is-on' : ''}">
                <label class="dz-band-name">
                    <input type="checkbox" data-band="${esc(type)}" ${on ? 'checked' : ''}>
                    <span>${esc(type)}</span>
                </label>
                ${on && type !== 'detail'
                    ? `<input type="text" class="dz-band-height"
                             data-band-height="${esc(type)}"
                             value="${esc(band.height ?? '')}"
                             placeholder="auto" spellcheck="false"
                             aria-label="${esc(type)} height">`
                    : `<span class="dz-band-height-none">${
                        type === 'detail' ? 'what is left' : ''}</span>`}
                <p class="dz-hint">${esc(BAND_NOTES[type] ?? '')}</p>
            </div>`;
        }).join('')}
    </section>`;
}


/**
 * Wires one delegated listener set onto the rail. The rail element survives a
 * redraw of its contents, so these are attached once and never rebound.
 *
 * @param {object} options
 * @param {Element} options.panel
 * @param {() => {target: object, fields: object[]}|null} options.getTarget what the
 *   plain fields are bound to - the selected item, or the layout
 * @param {() => object|null} options.getItem the selected item, for column edits
 * @param {(key: string) => void} options.changed called when an edit lands, with
 *   a key naming the control - consecutive edits from the same one are one step
 * @param {(action: string, data: DOMStringMap) => void} options.act a button was pressed
 * @param {(type: string, on: boolean) => void} options.toggleBand
 * @param {(type: string, height: string) => void} options.setBandHeight
 * @returns {() => void} detaches
 */
export function attachPanel({
    panel, getTarget, getItem, changed, act, toggleBand, setBandHeight
}) {
    /** keeps the marking layer under the text it belongs to */
    function repaint(node) {
        const box = node.closest?.('.dz-value');
        const marks = box?.querySelector('[data-role="marks"]');

        if (marks) marks.innerHTML = markPlaceholders(node.value);
    }


    function onInput(event) {
        const node = event.target.closest?.('[data-field], [data-band], [data-band-height]');
        if (!node) return;

        if (node.tagName === 'TEXTAREA') repaint(node);

        if (node.dataset.band != null) {
            toggleBand(node.dataset.band, node.checked);
            return;
        }

        if (node.dataset.bandHeight != null) {
            setBandHeight(node.dataset.bandHeight, node.value);
            return;
        }

        /** a column control is bound to the column, not to the item */
        if (node.dataset.column != null) {
            const item = getItem();
            const column = item?.columns?.[Number(node.dataset.column)];
            if (!column) return;

            const field = COLUMN_FIELDS.find(f => f.key === node.dataset.field);
            if (field && writeField(column, field, node.value)) {
                changed(`column:${node.dataset.column}:${field.key}`);
            }
            return;
        }

        const bound = getTarget();
        if (!bound) return;

        const field = bound.fields.find(f => f.key === node.dataset.field);
        if (!field) return;

        const raw = field.type === 'toggle' ? node.checked : node.value;

        if (writeField(bound.target, field, raw)) changed(`field:${field.key}`);
    }

    function onClick(event) {
        const node = event.target.closest?.('[data-action]');
        if (!node) return;

        event.preventDefault();

        /**
         * Handled here rather than passed out: it needs the caret, which is a
         * fact about this textarea and about nothing else in the designer.
         */
        if (node.dataset.action === 'insert-brace') {
            const box = node.closest('.dz-field')?.querySelector('textarea');
            if (box) insertBraces(box);
            return;
        }

        act(node.dataset.action, node.dataset);
    }

    /**
     * A long value scrolls inside the box, and the layer behind it must scroll
     * by the same amount or the marks part company with the characters.
     */
    function onScroll(event) {
        const node = event.target;
        if (node.tagName !== 'TEXTAREA') return;

        const marks = node.closest('.dz-value')?.querySelector('[data-role="marks"]');
        if (marks) marks.scrollTop = node.scrollTop;
    }

    panel.addEventListener('scroll', onScroll, true);
    panel.addEventListener('input', onInput);
    /** a <select> and a colour picker report on change, not input */
    panel.addEventListener('change', onInput);
    panel.addEventListener('click', onClick);

    return function detach() {
        panel.removeEventListener('scroll', onScroll, true);
        panel.removeEventListener('input', onInput);
        panel.removeEventListener('change', onInput);
        panel.removeEventListener('click', onClick);
    };
}


/**
 * Refreshes the controls from their object without rebuilding them - for values
 * changed somewhere else, such as x and y after a drag.
 *
 * The focused control is skipped: writing to an input while it has the caret
 * moves the caret to the end, so a drag that happened to run while a field was
 * focused would reorder the digits in it.
 *
 * @param {Element} panel
 * @param {object|null} item the selected item, or null for the report rail
 * @param {object} layout
 */
export function syncPanel(panel, item, layout) {
    const target = item ?? layout;
    if (!target) return;

    const fields = item ? allFields(item) : allReportFields(layout);

    for (const node of panel.querySelectorAll('[data-field]')) {
        /** the panel's own document: a designer in its own window has another */
        if (node === node.ownerDocument.activeElement) continue;

        const isColumn = node.dataset.column != null;
        const source = isColumn
            ? item?.columns?.[Number(node.dataset.column)]
            : target;

        if (!source) continue;

        const list = isColumn ? COLUMN_FIELDS : fields;
        const field = list.find(f => f.key === node.dataset.field);
        if (!field) continue;

        const value = readField(source, field);

        if (field.type === 'toggle') {
            node.checked = Boolean(value);
        } else if (value != null) {
            node.value = String(value);

            if (node.tagName === 'TEXTAREA') {
                const marks = node.closest('.dz-value')
                    ?.querySelector('[data-role="marks"]');

                if (marks) marks.innerHTML = markPlaceholders(node.value);
            }
        }
    }
}


/**
 * The value, with every `{placeholder}` wrapped so it can be coloured.
 *
 * Escaped first and marked second: `esc` leaves braces alone, so the pattern
 * still matches, and nothing the user typed can become markup on the way.
 *
 * @param {string} text
 * @returns {string} markup for the layer behind the textarea
 */
export function markPlaceholders(text) {
    const safe = esc(String(text ?? ''));

    const marked = safe.replace(/\{[^{}]*\}/g,
        match => `<mark class="dz-mark">${match}</mark>`);

    /**
     * A textarea keeps a line for a trailing newline and a div does not, so
     * without this the layer comes up short and the marks drift off the text.
     */
    return `${marked}\n`;
}


/**
 * Wraps the selection in braces, or inserts an empty pair.
 *
 * With text selected it becomes `{that text}` - which is how someone turns a
 * word they have already typed into a field without retyping it. With nothing
 * selected the caret lands between the braces, ready for the field name.
 *
 * @param {HTMLTextAreaElement} field
 */
export function insertBraces(field) {
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;

    const inner = field.value.slice(start, end);
    const before = field.value.slice(0, start);
    const after = field.value.slice(end);

    field.value = `${before}{${inner}}${after}`;

    const caret = start + 1 + inner.length;
    field.focus();
    field.setSelectionRange(caret, caret);

    /** through the ordinary write path, so the layout and the layer both follow */
    field.dispatchEvent(new Event('input', { bubbles: true }));
}

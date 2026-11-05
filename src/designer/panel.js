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
    COLUMN_FIELDS, readField, writeField, clearField
} from './fields.js';
import { BAND_NOTES, hasBand, findBand, railBands } from './structure.js';
import {
    parseBandKey, bandLabel, groupBandKey, groupedTables, setGroupBy, setGroupOption, GROUP_KINDS
} from './grouping.js';
import { levelsOf, MAX_GROUP_LEVELS } from '../engine/tables.js';
import { describeFormat } from '../engine/format.js';
import { describeHighlight } from '../engine/highlight.js';
import { esc, imageSrc } from '../render/items.js';


/**
 * The rail describes what a thing is; what you can do to it lives in the pill
 * that opens on a right-click, beside the item rather than at the edge of the
 * screen. See menu.js.
 */


/**
 * The rail for a selected item.
 * @param {object} item
 * @param {object} [layout] the report it is in, which a grouped table's own
 *   group band controls need - the other grouped tables, to copy a design from
 * @returns {string} markup
 */
export function drawPanel(item, layout = null) {
    return `
    <div class="dz-panel-head">
        <span class="dz-panel-type">${esc(item.type)}</span>
        <span class="dz-panel-id">${esc(item.id)}</span>
    </div>
    ${sections(item, fieldsFor(item))}
    ${item.type === 'text' ? `
        <section class="dz-section">
            <h3>Format</h3>
            <div class="dz-field dz-field-format">
                <label>Values</label>
                ${formatButton(item, layout)}
            </div>
            <div class="dz-field dz-field-format">
                <label>Highlight</label>
                ${highlightButton(item.highlight, 'edit-highlight')}
            </div>
        </section>` : ''}
    ${item.type === 'table' ? `
        <section class="dz-section">
            <h3>Row highlight</h3>
            <div class="dz-field dz-field-format">
                <label>Rows</label>
                ${highlightButton(item.rowHighlight, 'edit-row-highlight')}
            </div>
        </section>` : ''}
    ${item.type === 'table' ? grouping(item, layout) : ''}
    ${item.type === 'table' ? columns(item, layout) : ''}`;
}


/**
 * A grouped table's own group bands, switched on and off and sized here as
 * well as in the report's band list - this is where somebody who has just set
 * *Group by* is looking.
 *
 * And, when another table is grouped too, a way to give this one the same
 * header and footer: each grouping is a table's own, so two that should look
 * alike are made alike by copying.
 *
 * @param {object} table
 * @param {object|null} layout
 * @returns {string} markup, empty for a table that is not grouped
 */
function grouping(table, layout) {
    const levels = levelsOf(table);
    if (!levels.length) return '';

    /** the table alone is enough to find its own bands */
    const scope = layout ?? { bands: [{ type: 'detail', items: [table] }] };

    const others = layout
        ? groupedTables(layout).filter(g => g.table !== table.id)
        : [];

    return `
    <section class="dz-section dz-bands dz-grouping">
        <h3>Grouping</h3>
        ${levels.map((level, n) => groupLevel(scope, table, level, n, levels.length)).join('')}
        ${levels.length < MAX_GROUP_LEVELS ? `
            <button type="button" class="dz-add-row" data-action="add-group-level"
                    title="Split each group of this table again, by another field">
                Group within each group</button>` : ''}
        ${others.map(g => `
            <button type="button" class="dz-add-row" data-action="copy-grouping"
                    data-from="${esc(g.table)}"
                    title="Replace this table's group header and footer with copies of ${esc(g.table)}'s">
                Copy group design from ${esc(g.table)}</button>`).join('')}
    </section>`;
}


/**
 * One level of a table's grouping: its band switches and, for a table grouped
 * at more than one level, which field it groups by and the controls that move
 * and remove it.
 *
 * The outermost level's field is the table's *Group by*, up with the table's
 * other properties, so a table grouped once shows nothing here but its bands -
 * as it always has.
 *
 * @param {object} scope a layout holding the table
 * @param {object} table
 * @param {object} level
 * @param {number} n
 * @param {number} depth how many levels the table has
 * @returns {string} markup
 */
function groupLevel(scope, table, level, n, depth) {
    const by = typeof level?.by === 'string' ? level.by : '';
    const bands = levelBands(scope, table, by, n);

    if (depth === 1) return `${levelOptions(level, n)}${bands}`;

    const id = `dz-f-group-level-${n}`;

    return `
    <div class="dz-group-level" data-level="${n}">
        <div class="dz-group-level-head">
            <span class="dz-group-level-name">Level ${n + 1}${by ? ` · <b>${esc(by)}</b>` : ''}</span>
            <span class="dz-group-level-actions">
                ${n > 0 ? `
                    <button type="button" class="dz-icon" data-action="move-group-level-out"
                            data-level="${n}"
                            title="Group by this before the level above it"
                            aria-label="Move level ${n + 1} out">&uarr;</button>` : ''}
                <button type="button" class="dz-icon" data-action="remove-group-level"
                        data-level="${n}"
                        title="Stop grouping by this, and remove its header and footer"
                        aria-label="Remove level ${n + 1}">&times;</button>
            </span>
        </div>
        ${n > 0 ? `
            <div class="dz-field dz-field-text">
                <label for="${id}">Then group by</label>
                <input type="text" id="${id}" data-group-level="${n}"
                       value="${esc(by)}" spellcheck="false">
                <p class="dz-hint">A field to group each group above by</p>
            </div>` : ''}
        ${levelOptions(level, n)}
        ${bands}
    </div>`;
}


/**
 * A level's header and footer switches, named for what they are inside the
 * table's own section - "Header, before each region" - rather than by the key
 * the report's band list needs.
 */
function levelBands(scope, table, by, n) {
    const what = by || 'group';

    return GROUP_KINDS.map(kind => bandRow(scope, groupBandKey(kind, table.id, n),
        kind === 'groupHeader'
            ? { label: 'Group header', note: `Before each ${what}` }
            : { label: 'Group footer', note: `After each ${what}` })).join('');
}


/** the orders a level's groups can be put in, as the rail offers them */
const SORT_CHOICES = [
    { value: '', label: 'As they come' },
    { value: 'asc', label: 'A to Z, 0 to 9' },
    { value: 'desc', label: 'Z to A, 9 to 0' }
];


/**
 * How one level's groups are ordered, and whether each starts a page.
 * @param {object} level
 * @param {number} n
 * @returns {string} markup
 */
function levelOptions(level, n) {
    const sort = typeof level?.sort === 'string' ? level.sort : '';
    const id = `dz-f-group-${n}`;

    return `
    <div class="dz-field dz-field-choice">
        <label for="${id}-sort">Order groups</label>
        <select id="${id}-sort" data-group-option="sort" data-level="${n}">
            ${SORT_CHOICES.map(o => `<option value="${o.value}"${o.value === sort ? ' selected' : ''}
                >${esc(o.label)}</option>`).join('')}
        </select>
    </div>
    <div class="dz-field dz-field-toggle">
        <label for="${id}-page">New page for each group</label>
        <input type="checkbox" id="${id}-page" data-group-option="newPage" data-level="${n}"
               ${level?.newPage === true ? 'checked' : ''}>
        <p class="dz-hint">Every group but the first starts at the top of a page</p>
    </div>`;
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
            ${(section.actions ?? []).map(a => `
                <button type="button" class="dz-add-row dz-section-action"
                        data-action="${esc(a.action)}" title="${esc(a.title ?? '')}">
                    ${esc(a.label)}</button>`).join('')}
        </section>`).join('');
}


/**
 * How a text item's values print: one line saying so, and the button that
 * opens the Format Editor. The editor is a dialog rather than controls here -
 * a currency alone is five choices, and the rail has only just got its room
 * back.
 *
 * @param {object} owner a text item, or a column
 * @param {object|null} layout for the report's defaults the summary shows through
 * @param {string} [index] the column's place in its table, for a column
 * @returns {string} markup
 */
function formatButton(owner, layout, index) {
    const summary = describeFormat(owner?.format, layout?.format);

    return `
    <button type="button" class="dz-format" data-action="edit-format"
            ${index != null ? `data-index="${esc(index)}"` : ''}
            title="${esc(summary)} - click to change how values print">
        <span class="dz-format-summary">${esc(summary)}</span>
        <span class="dz-format-edit">Edit</span>
    </button>`;
}


/**
 * The same summary-and-Edit button for highlight rules: how many there are,
 * and the editor they are changed in.
 *
 * @param {object[]|null|undefined} rules
 * @param {string} action the designer action that opens the editor
 * @param {string} [index] a column's place, for a column's rules
 * @returns {string} markup
 */
function highlightButton(rules, action, index) {
    const summary = describeHighlight(rules);

    return `
    <button type="button" class="dz-format" data-action="${esc(action)}"
            ${index != null ? `data-index="${esc(index)}"` : ''}
            title="${esc(summary)} - click to style values by what they are">
        <span class="dz-format-summary">${esc(summary)}</span>
        <span class="dz-format-edit">Edit</span>
    </button>`;
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
            return field.custom ? customChoice(id, bind, field, value) : `<select id="${id}" ${bind}>${field.options.map(o =>
                `<option value="${esc(o.value)}"${o.value === value ? ' selected' : ''}
                    >${esc(o.label)}</option>`).join('')}</select>`;

        case 'color':
            return colorInput(id, bind, field, value);

        case 'toggle':
            return `<input type="checkbox" id="${id}" ${bind}
                ${value ? 'checked' : ''}>`;

        case 'image':
            /**
             * Buttons rather than a bound input: a picture arrives through a
             * file dialog, which the designer opens, and the rail is rebuilt
             * once it lands. No data-field, so syncPanel has nothing here to
             * write a data: URI into.
             */
            return `
            <div class="dz-image" id="${id}">
                ${value
                    ? `<img class="dz-image-thumb" src="${esc(imageSrc(value))}" alt="">`
                    : '<span class="dz-image-none">No image stored</span>'}
                <div class="dz-image-actions">
                    <button type="button" class="dz-add-row"
                            data-action="upload-image">${value ? 'Replace' : 'Upload'}</button>
                    ${value ? `<button type="button" class="dz-add-row"
                            data-action="clear-image">Remove</button>` : ''}
                </div>
            </div>`;

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
 * A group band's background: the same swatch a colour field has - "none" with
 * a slash through it until one is picked, and a button to take it off again.
 */
function bandFill(type, band, label) {
    const color = typeof band?.background === 'string' && band.background ? band.background : null;

    return `
    <span class="dz-swatch dz-band-fill${color ? '' : ' is-none'}"
          title="${esc(label)} background">
        <span class="dz-swatch-well">
            <input type="color" data-band-fill="${esc(type)}" value="${esc(color ?? '#ffffff')}"
                   aria-label="${esc(label)} background">
        </span>
        <button type="button" class="dz-icon dz-swatch-clear" data-action="clear-band-fill"
                data-fill-for="${esc(type)}" title="No background"
                aria-label="Remove ${esc(label)} background">&times;</button>
    </span>`;
}


/** what a choice's Custom… option says, which no real value can */
const CUSTOM_CHOICE = '__custom__';


/**
 * A choice of the usual values, and Custom… for any other - the currency
 * symbol, where ₹ and $ cover most reports and CHF still has to be possible.
 *
 * The select and the box are both bound to the field. The select writes what
 * it is set to, except Custom…, which only shows the box; the box writes what
 * is typed into it. A value that is none of the options shows as Custom…,
 * with the box holding it.
 */
function customChoice(id, bind, field, value) {
    const listed = field.options.some(o => o.value === (value ?? ''));
    const selected = listed ? (value ?? '') : CUSTOM_CHOICE;

    return `
    <span class="dz-choice-custom">
        <select id="${id}" ${bind}>${[...field.options, { value: CUSTOM_CHOICE, label: 'Custom…' }]
            .map(o => `<option value="${esc(o.value)}"${o.value === selected ? ' selected' : ''}
                >${esc(o.label)}</option>`).join('')}</select>
        <input type="text" ${bind} data-custom="true" value="${esc(listed ? '' : value ?? '')}"
               spellcheck="false" maxlength="6" aria-label="${esc(field.label)}, custom"
               placeholder="such as CHF"${listed ? ' hidden' : ''}>
    </span>`;
}


/**
 * A colour, or none.
 *
 * A colour input cannot hold null, and several style fields are legitimately
 * absent - a box with no fill, text in the stylesheet's colour. Drawn as the
 * input's black, an absent colour looked like a chosen one. So the input sits
 * under a "none" swatch while there is no colour, and still opens the picker
 * when clicked; the value is only written once someone actually picks one.
 * A chosen colour gets a button that takes it off again.
 *
 * Whether it is none is a class on the wrapper, which the input and syncPanel
 * keep up to date - rebuilding the rail while the picker is open would close it.
 */
function colorInput(id, bind, field, value) {
    const none = value == null || value === '';

    return `
    <span class="dz-swatch${none ? ' is-none' : ''}">
        <span class="dz-swatch-well">
            <input type="color" id="${id}" ${bind} value="${esc(none ? '#000000' : value)}">
        </span>
        <span class="dz-swatch-none" aria-hidden="true">None</span>
        <button type="button" class="dz-icon dz-swatch-clear" data-action="clear-color"
                data-for="${esc(field.key)}"
                title="No colour" aria-label="Remove ${esc(field.label)} colour">&times;</button>
    </span>`;
}


/** shows a colour control as none, or as its colour */
function markSwatch(node, none) {
    node.closest?.('.dz-swatch')?.classList.toggle('is-none', none);
}


/**
 * A table's columns, one card each. Four controls on one row would be 60px wide
 * apiece in a rail this narrow, so they stack and the card carries the number.
 */
function columns(table, layout) {
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
                <div class="dz-field dz-field-format">
                    <label>Format</label>
                    ${formatButton(column, layout, String(index))}
                </div>
                <div class="dz-field dz-field-format">
                    <label>Highlight</label>
                    ${highlightButton(column.highlight, 'edit-highlight', String(index))}
                </div>
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
 * sits, so there is no order here for anyone to choose. Each grouped table's
 * own header and footer are listed with the report's, named for their table.
 */
function bands(layout) {
    return `
    <section class="dz-section dz-bands">
        <h3>Bands</h3>
        ${railBands(layout).map(type => bandRow(layout, type)).join('')}
    </section>`;
}


/** what a band row says under its name */
function bandNote(type) {
    const parsed = parseBandKey(type);
    if (!parsed) return BAND_NOTES[type] ?? '';

    const whose = parsed.level > 0
        ? `level ${parsed.level + 1} group of ${parsed.table}`
        : `group of ${parsed.table}`;

    return parsed.kind === 'groupHeader' ? `Before each ${whose}` : `After each ${whose}`;
}


/**
 * One band's switch and height, by key.
 *
 * The report's band list names a table's group band in full - whose it is and
 * which level - because it sits among every other band. Inside the table's own
 * grouping section both are already said by where it is, so that section
 * passes a shorter name and note of its own.
 *
 * @param {object} layout
 * @param {string} type a band type, or a table's group band key
 * @param {{label?: string, note?: string}} [names]
 * @returns {string} markup
 */
function bandRow(layout, type, names = {}) {
    const band = findBand(layout, type);
    const on = hasBand(layout, type);
    const label = names.label ?? bandLabel(type);
    const note = names.note ?? bandNote(type);

    /** a table's group band, switched on, can be shaded */
    const fillable = on && parseBandKey(type) != null;

    return `
    <div class="dz-band-row${on ? ' is-on' : ''}${fillable ? ' has-fill' : ''}">
        <label class="dz-band-name">
            <input type="checkbox" data-band="${esc(type)}" ${on ? 'checked' : ''}>
            <span>${esc(label)}</span>
        </label>
        ${fillable ? bandFill(type, band, label) : ''}
        ${on && type !== 'detail'
            ? `<input type="text" class="dz-band-height"
                     data-band-height="${esc(type)}"
                     value="${esc(band.height ?? '')}"
                     placeholder="auto" spellcheck="false"
                     aria-label="${esc(label)} height">`
            : `<span class="dz-band-height-none">${
                type === 'detail' ? 'what is left' : ''}</span>`}
        ${note ? `<p class="dz-hint">${esc(note)}</p>` : ''}
    </div>`;
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
 * @param {(key: string, options?: {rebuild?: boolean}) => void} options.changed
 *   called when an edit lands, with a key naming the control - consecutive edits
 *   from the same one are one step. `rebuild` says the rail's controls have to
 *   be built again, because which ones there are has changed
 * @param {(action: string, data: DOMStringMap) => void} options.act a button was pressed
 * @param {(type: string, on: boolean) => void} options.toggleBand
 * @param {(type: string, height: string) => void} options.setBandHeight
 * @param {(type: string, color: string|null) => void} [options.setBandFill] a
 *   group band's background, null for none
 * @returns {() => void} detaches
 */
export function attachPanel({
    panel, getTarget, getItem, changed, act, toggleBand, setBandHeight, setBandFill = () => { }
}) {
    /** keeps the marking layer under the text it belongs to */
    function repaint(node) {
        const box = node.closest?.('.dz-value');
        const marks = box?.querySelector('[data-role="marks"]');

        if (marks) marks.innerHTML = markPlaceholders(node.value);
    }


    function onInput(event) {
        const node = event.target.closest?.(
            '[data-field], [data-band], [data-band-height], [data-band-fill], [data-group-level], [data-group-option]');
        if (!node) return;

        if (node.tagName === 'TEXTAREA') repaint(node);

        /** how one level's groups are ordered and placed, on the selected table */
        if (node.dataset.groupOption != null) {
            const item = getItem();
            const level = Number(node.dataset.level);
            const option = node.dataset.groupOption;
            const value = node.type === 'checkbox' ? node.checked : node.value;

            if (item?.type === 'table' && setGroupOption(item, level, option, value)) {
                changed(`group-option:${level}:${option}`);
            }
            return;
        }

        /** an inner level's field, on the selected table */
        if (node.dataset.groupLevel != null) {
            const item = getItem();
            const level = Number(node.dataset.groupLevel);

            if (item?.type === 'table' && setGroupBy(item, node.value.trim(), level)) {
                changed(`group-level:${level}`);
            }
            return;
        }

        if (node.dataset.band != null) {
            toggleBand(node.dataset.band, node.checked);
            return;
        }

        if (node.dataset.bandHeight != null) {
            setBandHeight(node.dataset.bandHeight, node.value);
            return;
        }

        /** a colour picked is no longer none */
        if (node.dataset.bandFill != null) {
            markSwatch(node, false);
            setBandFill(node.dataset.bandFill, node.value);
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

        if (node.tagName === 'SELECT' && node.value === CUSTOM_CHOICE) {
            const box = node.parentElement?.querySelector('[data-custom]');
            if (box) {
                box.hidden = false;
                box.focus();
            }
            return;
        }

        const raw = field.type === 'toggle' ? node.checked : node.value;

        /** a colour picked is no longer none, even one picked as black */
        if (field.type === 'color') markSwatch(node, false);

        /**
         * A field may say which reading of its object decides the rail's
         * shape, rather than that every edit to it does - *Group by* changes
         * the controls only when it turns grouping on or off, not on every
         * letter of the field name.
         */
        const shape = typeof field.rebuilds === 'function' ? field.rebuilds : null;
        const before = shape ? shape(bound.target) : null;

        if (writeField(bound.target, field, raw)) {
            /**
             * Some fields change which fields there are - choosing a named
             * sheet takes the width and height boxes away, and Custom brings
             * them back. The caller is told, because it owns the rail.
             */
            const rebuild = shape
                ? shape(bound.target) !== before
                : Boolean(field.rebuilds);

            changed(`field:${field.key}`, { rebuild });
        }
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

        /** a group band's background, back to none */
        if (node.dataset.action === 'clear-band-fill') {
            markSwatch(node, true);
            setBandFill(node.dataset.fillFor, null);
            return;
        }

        /** handled here too: it is bound to a field, as the colour beside it is */
        if (node.dataset.action === 'clear-color') {
            const bound = getTarget();
            const field = bound?.fields.find(f => f.key === node.dataset.for);

            if (field && clearField(bound.target, field)) {
                markSwatch(node, true);
                changed(`field:${field.key}`);
            }
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

        /** an undo can take a colour off, or put one back */
        if (field.type === 'color') markSwatch(node, value == null || value === '');

        /** a choice with Custom…: the select says which, the box holds any other */
        if (field.custom) {
            const listed = field.options.some(o => o.value === (value ?? ''));

            if (node.dataset.custom) {
                node.value = listed ? '' : String(value ?? '');
                node.hidden = listed;
            } else {
                node.value = listed ? String(value ?? '') : CUSTOM_CHOICE;
            }
            continue;
        }

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

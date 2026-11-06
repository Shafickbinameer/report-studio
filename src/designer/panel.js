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
import { icon } from './icons.js';
import { choiceBox, showChoice, refreshChoices, attachChoices } from './choice.js';


/**
 * The rail describes what a thing is; what you can do to it lives in the pill
 * that opens on a right-click, beside the item rather than at the edge of the
 * screen. See menu.js.
 *
 * It is laid out the way a design tool's inspector is: sections divided by a
 * rule rather than boxed, a two-column grid that pairs X with Y and W with H,
 * borderless boxes that only outline themselves on hover, and the label inside
 * the box wherever a letter says enough. Every number's label can be dragged
 * sideways to change it, as in Figma.
 */


/**
 * The row across the top of the rail: what is selected, by its glyph and id.
 * @param {string} type shown under the id, and what the tests read
 * @param {string} [name]
 * @param {string} [glyph] markup for the icon
 * @returns {string} markup
 */
function panelHead(type, name, glyph = '') {
    return `
    <div class="dz-panel-head">
        ${glyph ? `<span class="dz-panel-icon">${glyph}</span>` : ''}
        ${name != null ? `<span class="dz-panel-id">${esc(name)}</span>` : ''}
        <span class="dz-panel-type">${esc(type)}</span>
    </div>`;
}


/**
 * A section's title, with any buttons that act on the section as a whole on
 * the right of it - where the + that adds a row sits in a design tool.
 * @param {string} title
 * @param {string} [actions] markup
 * @returns {string} markup
 */
function sectionHead(title, actions = '') {
    return `
    <div class="dz-section-head">
        <h3>${esc(title)}</h3>
        ${actions ? `<span class="dz-section-tools">${actions}</span>` : ''}
    </div>`;
}


/** a + drawn rather than typed, so it sits on the same grid as the glyphs */
const PLUS = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none"
    stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
    aria-hidden="true" focusable="false"><path d="M8 3.5v9M3.5 8h9"/></svg>`;


/**
 * The rail for a selected item.
 * @param {object} item
 * @param {object} [layout] the report it is in, which a grouped table's own
 *   group band controls need - the other grouped tables, to copy a design from
 * @returns {string} markup
 */
export function drawPanel(item, layout = null) {
    return `
    ${panelHead(item.type, item.id, icon(item.type))}
    ${sections(item, fieldsFor(item))}
    ${item.type === 'text' ? `
        <section class="dz-section">
            ${sectionHead('Format')}
            <div class="dz-field dz-field-format">
                <label class="dz-label">Values</label>
                ${formatButton(item, layout)}
            </div>
            <div class="dz-field dz-field-format">
                <label class="dz-label">Highlight</label>
                ${highlightButton(item.highlight, 'edit-highlight')}
            </div>
        </section>` : ''}
    ${item.type === 'table' ? `
        <section class="dz-section">
            ${sectionHead('Row highlight')}
            <div class="dz-field dz-field-format">
                <label class="dz-label">Rows</label>
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
        ${sectionHead('Grouping')}
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
                <label class="dz-label" for="${id}">Then group by</label>
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
        <label class="dz-label" id="${id}-sort-label" for="${id}-sort">Order groups</label>
        ${choiceBox(`${id}-sort`, `data-group-option="sort" data-level="${n}"`, SORT_CHOICES, sort)}
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
    ${panelHead(`${items.length} items`)}

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
    ${panelHead('report', layout.name ?? 'Untitled', icon('open'))}
    ${sections(layout, reportFields(layout))}
    ${bands(layout)}`;
}


function sections(target, list) {
    return list.map(section => `
        <section class="dz-section">
            ${sectionHead(section.title)}
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
    /**
     * A number with a short label carries it inside the box, and the label
     * proper is kept for screen readers and the tests that read it. Any
     * number's visible label - inside or above - is the handle that scrubs it.
     */
    const inside = field.type === 'number' && field.short;
    const scrub = field.type === 'number' ? ' dz-scrub' : '';

    const label = field.type === 'textarea'
        ? `<span class="dz-field-top">
               <label class="dz-label" for="${id}">${esc(field.label)}</label>
               <button type="button" class="dz-brace" data-action="insert-brace"
                       data-for="${esc(field.key)}"
                       title="Wrap the selected text in braces, or insert a pair"
                       aria-label="Insert a placeholder">{&nbsp;}</button>
           </span>`
        /**
         * A row of glyph buttons is named by its radiogroup instead: a label
         * for its first button would choose Left whenever "Align" was clicked.
         */
        : `<label class="dz-label${inside ? ' dz-sr' : scrub}" id="${id}-label"${field.segmented ? '' : ` for="${id}"`}
                  ${scrub ? 'title="Drag sideways to change"' : ''}>${esc(field.label)}</label>`;

    const half = field.half || field.type === 'number' || field.type === 'color';

    const box = inside
        ? `<span class="dz-input">
               <span class="dz-input-prefix dz-scrub" aria-hidden="true"
                     title="${esc(field.label)} - drag sideways to change">${esc(field.short)}</span>
               ${input(id, bind, field, value)}
           </span>`
        : input(id, bind, field, value);

    return `
    <div class="dz-field dz-field-${field.type}${half ? ' is-half' : ''}">
        ${label}
        ${box}
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
            if (field.segmented) return segmented(id, bind, field, value);

            return field.custom
                ? customChoice(id, bind, field, value)
                : choiceBox(id, bind, field.options, value);

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
        ${choiceBox(id, bind, [...field.options, { value: CUSTOM_CHOICE, label: 'Custom…' }], selected)}
        <input type="text" ${bind} data-custom="true" value="${esc(listed ? '' : value ?? '')}"
               spellcheck="false" maxlength="6" aria-label="${esc(field.label)}, custom"
               placeholder="such as CHF"${listed ? ' hidden' : ''}>
    </span>`;
}


/**
 * A short choice as a row of glyph buttons - text alignment, which way a line
 * runs, which way up the page is - as a design tool draws them.
 *
 * Radio buttons under the glyphs rather than buttons that act: a radio is
 * already a choice of one, reports through the same change event a select
 * does, and brings the arrow keys with it. The first carries the id, so the
 * field's label still names the group.
 *
 * @returns {string} markup
 */
function segmented(id, bind, field, value) {
    const name = id;

    return `
    <span class="dz-segmented" role="radiogroup" aria-label="${esc(field.label)}">
        ${field.options.map((o, n) => `
            <label class="dz-seg" title="${esc(o.label)}">
                <input type="radio" ${n === 0 ? `id="${id}"` : ''} name="${esc(name)}" ${bind}
                       value="${esc(o.value)}"${o.value === value ? ' checked' : ''}
                       aria-label="${esc(o.label)}">
                <span class="dz-seg-glyph">${icon(o.icon) || esc(o.label)}</span>
            </label>`).join('')}
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

    /**
     * Beside the chip, the colour as hex - which is also a box it can be typed
     * into, as a fill is in a design tool. It is not bound to the field itself:
     * half a hex code is not a colour, so it writes through the picker once
     * what is typed is one. See onHex.
     */
    return `
    <span class="dz-swatch dz-input${none ? ' is-none' : ''}">
        <span class="dz-swatch-well">
            <input type="color" id="${id}" ${bind} value="${esc(none ? '#000000' : value)}">
        </span>
        <input type="text" class="dz-hex" data-hex="${esc(field.key)}"
               value="${esc(none ? '' : hexText(value))}" placeholder="None"
               maxlength="7" spellcheck="false" autocomplete="off"
               aria-label="${esc(field.label)}, as hex">
        <button type="button" class="dz-icon dz-swatch-clear" data-action="clear-color"
                data-for="${esc(field.key)}"
                title="No colour" aria-label="Remove ${esc(field.label)} colour">&times;</button>
    </span>`;
}


/** a colour as the hex box shows it: no hash, upper case */
function hexText(value) {
    const text = String(value ?? '');
    return text.startsWith('#') ? text.slice(1).toUpperCase() : text;
}


/**
 * What was typed into a hex box, as the picker's #rrggbb - or null while it is
 * not a colour yet. Three digits only count once the box is left, since "ff9"
 * is as likely to be the start of "ff9c4b" as it is #ffff99.
 *
 * @param {string} text
 * @param {boolean} final whether the box has been left or Enter pressed
 * @returns {string|null}
 */
export function parseHex(text, final = false) {
    const bare = String(text ?? '').trim().replace(/^#/, '').toLowerCase();

    if (/^[0-9a-f]{6}$/.test(bare)) return `#${bare}`;
    if (final && /^[0-9a-f]{3}$/.test(bare)) return `#${[...bare].map(c => c + c).join('')}`;

    return null;
}


/** a column's closed row, kept saying what the column now is */
function summarise(node, column) {
    if (!node) return;

    const name = node.querySelector('.dz-column-name');
    const width = node.querySelector('.dz-column-width');

    if (name) name.textContent = column.label || column.field || '';
    if (width) width.textContent = String(column.width ?? '');
}


/** shows a colour control as none, or as its colour */
function markSwatch(node, none) {
    node.closest?.('.dz-swatch')?.classList.toggle('is-none', none);
}


/**
 * Puts the colour a control now holds into its hex box - unless that box is
 * the one being typed in, which would move the caret under the typist.
 */
function showHex(node, value) {
    const hex = node.closest?.('.dz-swatch')?.querySelector('.dz-hex');
    if (!hex || hex === hex.ownerDocument.activeElement) return;

    hex.value = value == null || value === '' ? '' : hexText(value);
}


/**
 * Which columns are open, by the column object itself.
 *
 * A table of ten columns, all open, is a rail ten screens long - so a column
 * is a row that opens, as a layer is. The rail is rebuilt often (a column
 * added, the selection changed and changed back), and a column somebody had
 * open should still be open when it is drawn again, so the state is kept here
 * rather than in the markup.
 *
 * Weak, and keyed by object, so nothing has to be cleaned up: an undo hands
 * the designer a fresh copy of the layout, whose columns simply start closed.
 */
const openColumns = new WeakMap();

/** tables whose columns have been drawn at least once */
const drawnTables = new WeakSet();


/**
 * Whether a column is drawn open. One that has been opened or closed keeps
 * that. One never seen before is closed - unless its table has been drawn
 * already, in which case it has just been added, and is opened to be filled in.
 */
function isOpen(table, column) {
    if (openColumns.has(column)) return openColumns.get(column);

    const open = drawnTables.has(table);
    openColumns.set(column, open);
    return open;
}


/**
 * A table's columns, a row each that opens onto the rail's two-column grid -
 * field and label side by side, then width and alignment. Closed, the row
 * still says which column it is, what it shows and how wide it is. Adding one
 * is the + on the section's title, where a design tool puts it.
 */
function columns(table, layout) {
    const list = table.columns || [];

    const add = `
        <button type="button" class="dz-icon" data-action="add-column"
                title="Add column" aria-label="Add column">${PLUS}</button>`;

    const markup = `
    <section class="dz-section dz-columns">
        ${sectionHead('Columns', add)}
        ${list.map((column, index) => `
            <details class="dz-column" data-index="${index}"${isOpen(table, column) ? ' open' : ''}>
                <summary class="dz-column-head">
                    <span class="dz-column-caret" aria-hidden="true"></span>
                    <span class="dz-column-number">${index + 1}</span>
                    <span class="dz-column-name">${esc(column.label || column.field || '')}</span>
                    <span class="dz-column-width">${esc(column.width ?? '')}</span>
                    ${list.length > 1 ? `
                        <button type="button" class="dz-icon"
                                data-action="remove-column" data-index="${index}"
                                title="Remove this column"
                                aria-label="Remove column ${index + 1}">&times;</button>` : ''}
                </summary>
                <div class="dz-column-body">
                ${COLUMN_FIELDS.map(field =>
                    control(column, field, String(index))).join('')}
                <div class="dz-field dz-field-format is-half">
                    <label class="dz-label">Format</label>
                    ${formatButton(column, layout, String(index))}
                </div>
                <div class="dz-field dz-field-format is-half">
                    <label class="dz-label">Highlight</label>
                    ${highlightButton(column.highlight, 'edit-highlight', String(index))}
                </div>
                </div>
            </details>`).join('')}
    </section>`;

    drawnTables.add(table);
    return markup;
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
        ${sectionHead('Bands')}
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


    /**
     * A hex box writes through the picker beside it, once what is typed is a
     * colour - so a colour typed and a colour picked are the same edit, and
     * the field, the swatch and the history all hear about it one way.
     */
    function onHex(node, final) {
        const hex = parseHex(node.value, final);
        if (!hex) return;

        const picker = node.closest('.dz-swatch')?.querySelector('input[type="color"]');
        if (!picker) return;

        const none = node.closest('.dz-swatch').classList.contains('is-none');
        if (picker.value === hex && !none) return;

        picker.value = hex;
        picker.dispatchEvent(new Event('input', { bubbles: true }));
    }


    function onInput(event) {
        if (event.target.dataset?.hex != null) {
            onHex(event.target, event.type === 'change');
            return;
        }

        const node = event.target.closest?.(
            '[data-field], [data-band], [data-band-height], [data-band-fill], [data-group-level], [data-group-option]');
        if (!node) return;

        if (node.tagName === 'TEXTAREA') repaint(node);

        /** a choice's button shows what its select holds, however it was set */
        if (node.tagName === 'SELECT') showChoice(node);

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
                summarise(node.closest('.dz-column'), column);
                changed(`column:${node.dataset.column}:${field.key}`);
            }
            return;
        }

        const bound = getTarget();
        if (!bound) return;

        const field = bound.fields.find(f => f.key === node.dataset.field);
        if (!field) return;

        if (node.tagName === 'SELECT' && node.value === CUSTOM_CHOICE) {
            const box = node.closest('.dz-choice-custom')?.querySelector('[data-custom]');
            if (box) {
                box.hidden = false;
                box.focus();
            }
            return;
        }

        const raw = field.type === 'toggle' ? node.checked : node.value;

        /** a colour picked is no longer none, even one picked as black */
        if (field.type === 'color') {
            markSwatch(node, false);
            showHex(node, node.value);
        }

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
                showHex(node, null);
                changed(`field:${field.key}`);
            }
            return;
        }

        act(node.dataset.action, node.dataset);
    }

    /**
     * A column opened or closed stays that way through the next rebuild.
     * `toggle` does not bubble, so this listens on the way down.
     */
    function onToggle(event) {
        const node = event.target;
        if (!node.classList?.contains('dz-column')) return;

        const column = getItem()?.columns?.[Number(node.dataset.index)];
        if (column) openColumns.set(column, node.open);
    }

    /**
     * A hex box left holding something that is not a colour goes back to the
     * colour the field has - as a number box does to its last good value.
     */
    function onLeave(event) {
        const node = event.target;
        if (node.dataset?.hex == null) return;

        const swatch = node.closest('.dz-swatch');
        const picker = swatch?.querySelector('input[type="color"]');
        if (!picker) return;

        node.value = swatch.classList.contains('is-none') ? '' : hexText(picker.value);
    }

    /** Enter in a hex box settles it, three-digit shorthand included */
    function onKey(event) {
        if (event.key !== 'Enter' || event.target.dataset?.hex == null) return;

        event.preventDefault();
        onHex(event.target, true);
        event.target.blur();
    }

    /**
     * Scrubbing: drag a number's label sideways to change it, a unit for every
     * two pixels and ten with Shift held - Figma's gesture.
     *
     * Each step is written into the box and announced as ordinary input, so
     * the write path, the clamping and the history's merging of one control's
     * edits into one step all apply without a second route in. A press that
     * never moves is a click, and puts the caret in the box as a label does.
     */
    function onPress(event) {
        const handle = event.target.closest?.('.dz-scrub');
        if (!handle || event.button !== 0) return;

        const box = handle.closest('.dz-field')?.querySelector('input[type="number"]');
        if (!box) return;

        event.preventDefault();

        const startX = event.clientX;
        const start = Number(box.value) || 0;
        const min = box.min !== '' ? Number(box.min) : -Infinity;
        const max = box.max !== '' ? Number(box.max) : Infinity;
        let moved = false;

        handle.setPointerCapture?.(event.pointerId);

        function move(e) {
            const dx = e.clientX - startX;
            if (!moved && Math.abs(dx) < 3) return;

            if (!moved) {
                moved = true;
                panel.classList.add('is-scrubbing');
            }

            const step = e.shiftKey ? 10 : 1;
            const next = Math.min(max, Math.max(min, start + Math.round(dx / 2) * step));

            if (String(next) === box.value) return;

            box.value = String(next);
            box.dispatchEvent(new Event('input', { bubbles: true }));
        }

        function end() {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', end);
            handle.removeEventListener('pointercancel', end);
            panel.classList.remove('is-scrubbing');

            if (!moved) {
                box.focus();
                box.select?.();
                return;
            }

            /**
             * The label is a <label>, whose click would put the caret in the
             * box at the end of a drag. One click is swallowed, and only the
             * one that ends this drag.
             */
            handle.addEventListener('click', (e) => e.preventDefault(), { once: true, capture: true });
        }

        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
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
    panel.addEventListener('focusout', onLeave);
    panel.addEventListener('keydown', onKey);
    panel.addEventListener('pointerdown', onPress);
    panel.addEventListener('toggle', onToggle, true);

    /** the choices open the shared list rather than the operating system's */
    const detachChoices = attachChoices(panel);

    return function detach() {
        detachChoices();
        panel.removeEventListener('toggle', onToggle, true);
        panel.removeEventListener('scroll', onScroll, true);
        panel.removeEventListener('input', onInput);
        panel.removeEventListener('change', onInput);
        panel.removeEventListener('click', onClick);
        panel.removeEventListener('focusout', onLeave);
        panel.removeEventListener('keydown', onKey);
        panel.removeEventListener('pointerdown', onPress);
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

    /** a closed column's row says its name and width, which an undo can change */
    for (const node of panel.querySelectorAll('.dz-column')) {
        const column = item?.columns?.[Number(node.dataset.index)];
        if (column) summarise(node, column);
    }

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
        if (field.type === 'color') {
            markSwatch(node, value == null || value === '');
            showHex(node, value);
        }

        /** a row of glyph buttons: each one only says whether it is the one */
        if (node.type === 'radio') {
            node.checked = node.value === String(value ?? '');
            continue;
        }

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

    /** every choice's button says what its select now holds */
    refreshChoices(panel);
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

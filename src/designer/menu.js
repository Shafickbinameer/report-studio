/**
 * menu.js is the pill that opens where you right-click.
 *
 * Duplicate, copy, paste and delete used to live in the properties rail and the
 * tool strip - which meant a round trip to the edge of the screen to act on the
 * thing under the cursor, and a rail that was only drawn for a selection could
 * never offer paste at all. They belong at the pointer, on the item they act on.
 *
 * What it offers is a pure function of what is selected and what is on the
 * clipboard, and where it lands is arithmetic - so both are specified here,
 * without a browser. What is left in designer.js is measuring the pill and
 * putting it on the page.
 */

import { icon } from './icons.js';
import { esc } from '../render/items.js';


/** the gap kept between the pill and the edge it would otherwise cross */
export const MENU_EDGE_GAP = 8;


/**
 * What the menu offers.
 *
 * Paste is always listed, disabled when there is nothing to paste: a right
 * click that opens an empty pill says the menu is broken, while one that opens
 * a greyed Paste says the clipboard is empty, which is the true answer.
 *
 * @param {object} options
 * @param {number} [options.count] how many items are selected
 * @param {boolean} [options.canPaste] whether the clipboard holds anything
 * @param {boolean} [options.canDuplicate] false when a copy of the selection
 *   would be one the report cannot hold - a second table, today
 * @returns {object[]} entries, in the order they are drawn
 */
export function menuActions({
    count = 0, canPaste = false, canDuplicate = true
} = {}) {
    const many = count > 1 ? ` ${count} items` : '';

    const paste = {
        action: 'paste-items',
        glyph: 'paste',
        label: 'Paste',
        hint: 'ctrl+V',
        disabled: !canPaste
    };

    if (count < 1) return [paste];

    return [
        {
            action: 'duplicate-item',
            glyph: 'duplicate',
            label: canDuplicate
                ? `Duplicate${many}`
                : 'A report holds one table',
            hint: 'ctrl+D, or alt-drag',
            disabled: !canDuplicate
        },
        {
            action: 'copy-items',
            glyph: 'copy',
            label: `Copy${many}`,
            hint: 'ctrl+C'
        },
        paste,
        { separator: true },
        {
            action: 'delete-item',
            glyph: 'delete',
            label: `Delete${many}`,
            hint: 'del',
            tone: 'danger'
        }
    ];
}


/**
 * The pill's markup. Icon-only, like the bar and the tool strip: the label is
 * on the button for a screen reader and in the tooltip for everyone else, so
 * the pill stays small enough to open over the page without covering it.
 *
 * @param {object[]} actions from menuActions
 * @returns {string} markup
 */
export function drawMenu(actions) {
    const entry = (one) => one.separator
        ? '<span class="dz-menu-sep" aria-hidden="true"></span>'
        : `<button type="button" role="menuitem"
                   class="dz-menu-item${one.tone ? ` is-${esc(one.tone)}` : ''}"
                   data-action="${esc(one.action)}"
                   title="${esc(one.label)} (${esc(one.hint)})"
                   aria-label="${esc(one.label)}"
                   ${one.disabled ? 'disabled' : ''}
            >${icon(one.glyph)}</button>`;

    return `<div class="dz-menu" data-role="menu" role="menu"
                 aria-label="Item actions">${actions.map(entry).join('')}</div>`;
}


/**
 * Where the pill sits, in the coordinates of the area it is drawn into.
 *
 * Clamped rather than flipped: a pill is a strip a few buttons wide, so sliding
 * it back inside the edge keeps it beside the pointer, where flipping it would
 * throw it to the far side of whatever was clicked.
 *
 * @param {{x: number, y: number}} point the pointer, relative to `bounds`
 * @param {{width: number, height: number}} size the pill, as measured
 * @param {{width: number, height: number}} bounds the area it must stay inside
 * @param {number} [gap]
 * @returns {{left: number, top: number}}
 */
export function menuPosition(point, size, bounds, gap = MENU_EDGE_GAP) {
    const fit = (at, extent, limit) =>
        Math.min(Math.max(gap, at), Math.max(gap, limit - extent - gap));

    return {
        left: fit(point.x, size.width, bounds.width),
        top: fit(point.y, size.height, bounds.height)
    };
}

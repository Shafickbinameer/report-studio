/**
 * measure.js computes the rendered height of every band and every item in it.
 *
 * Spec 4.3:
 *   text  - canvas measureText, greedy wrap
 *   table - headerHeight + rows x rowHeight
 *   band  - the fixed `height` field, or the computed height where it holds a table
 */

import { textHeight } from './text-metrics.js';


export function measure(json) {
    const measureJson = structuredClone(json);
    const grouped = measureJson.groupBy != null;

    for (const band of measureJson.bands) {
        if (!band.items) continue;
        measureBand(band, grouped, measureJson);
    }

    return measureJson;
}


/**
 * Items are absolutely positioned inside their band, so the band's content
 * height is the lowest edge any item reaches - max(y + height). That is order
 * independent, and handles items side by side on the same row as well as items
 * separated by a gap, neither of which a running total can express.
 * @param {object} band
 * @param {boolean} grouped
 * @param {object} json
 * @returns {object} the same band, measured
 */
function measureBand(band, grouped, json) {
    let contentHeight = 0;

    for (const item of band.items) {
        item.measuredHeight = measureItem(item, grouped, json);
        contentHeight = Math.max(contentHeight, (item.y ?? 0) + item.measuredHeight);
    }

    /**
     * A declared band height is the design intent, so it wins - but it can only
     * grow to fit content, never clip it. A band holding a table has no useful
     * declared height; the row count decides.
     */
    band.contentHeight = contentHeight;
    band.measuredHeight = holdsTable(band)
        ? contentHeight
        : Math.max(band.height ?? 0, contentHeight);

    return band;
}


function holdsTable(band) {
    return band.items.some(item => item.type === 'table');
}


function measureItem(item, grouped, json) {
    switch (item.type) {
        case 'text':
            return measureTextItem(item);
        case 'table':
            return measureTableItem(item, grouped, json);
        case 'line':
            return measureLineItem(item);
        case 'box':
            return item.h ?? 0;
        default:
            console.warn(`Unknown item type "${item.type}" on item "${item.id}"; treating as zero height.`);
            return 0;
    }
}


/**
 * A declared `h` is the design intent and is honoured, but text that wraps past
 * it grows the item rather than being clipped. Placeholders are already
 * resolved at this point, so what is measured is what will be drawn.
 * @param {object} item
 * @returns {number}
 */
function measureTextItem(item) {
    const declared = item.h ?? 0;
    const wrapped = textHeight(item.text ?? item.value ?? '', item.w ?? 0, item.style);
    return Math.max(declared, wrapped);
}


/**
 * The box a line occupies, which is its declared `h` - the rule is drawn inside
 * that box rather than being it, so that a hairline is still something the
 * designer can get hold of.
 *
 * A rule thicker than its box grows the box, for the same reason wrapped text
 * grows a text item: what is drawn is never quietly clipped.
 *
 * @param {object} item
 * @returns {number}
 */
function measureLineItem(item) {
    const declared = item.h ?? 0;

    /** only a horizontal rule's thickness is a height; a vertical one's is a width */
    if (item.orientation === 'vertical') return declared;

    return Math.max(declared, item.style?.thickness ?? 0);
}


/**
 * headerHeight + rows x rowHeight. When the report is grouped, each group also
 * carries its own header and footer band, and a table header that repeats per
 * group - all of which occupy real space and were previously unaccounted for.
 * @param {object} item
 * @param {boolean} grouped
 * @param {object} json
 * @returns {number}
 */
function measureTableItem(item, grouped, json) {
    const headerHgt = item.showHeader ? (item.headerHeight ?? 0) : 0;

    if (!grouped) {
        const rowCount = item.row?.length ?? 0;
        return headerHgt + (rowCount * item.rowHeight);
    }

    const groups = item.groups ?? [];
    const grpHeaderHgt = bandHeight(json, 'groupHeader');
    const grpFooterHgt = bandHeight(json, 'groupFooter');

    let height = 0;

    for (const group of groups) {
        height += headerHgt
            + grpHeaderHgt
            + (group.rows.length * item.rowHeight)
            + grpFooterHgt;
    }

    return height;
}


/**
 * Height of a template band that never flows on its own (groupHeader /
 * groupFooter). It is measured here rather than read raw so a group band whose
 * text wraps is still accounted for.
 * @param {object} json
 * @param {string} type
 * @returns {number}
 */
function bandHeight(json, type) {
    const band = json.bands.find(b => b.type === type);
    if (!band?.items) return 0;

    let contentHeight = 0;
    for (const item of band.items) {
        const height = item.type === 'text' ? measureTextItem(item) : 0;
        contentHeight = Math.max(contentHeight, (item.y ?? 0) + height);
    }

    return Math.max(band.height ?? 0, contentHeight);
}

/**
 * canvas.js draws the design-time page.
 *
 * The preview draws a *paginated* report: many pages, bands placed by the
 * engine, real data. The designer draws one page, unpaginated, with no data -
 * so it cannot reuse render.js. What it does reuse is everything below the
 * band: items.js draws the text boxes and tables, and report.css styles them,
 * so what is designed looks like what is printed (spec 5.2).
 *
 * Band geometry is not guessed either - pageRegions() is the same function the
 * engine uses at print time, called with isFirstPage and isLastPage both true
 * so the canvas shows every band at once. Move a band's height here and the
 * printed page moves with it, because it is one calculation, not two.
 *
 *   +-------------------------+
 *   |  pageHeader             |   anchored zones, from pageRegions()
 *   |  reportHeader           |
 *   |  - - - - - - - - - - -  |
 *   |    groupHeader          |   the repeating unit, stacked inside
 *   |    detail               |   whatever the detail region has left
 *   |    groupFooter          |
 *   |  - - - - - - - - - - -  |
 *   |  reportFooter           |
 *   |  pageFooter             |   pinned to the bottom edge
 *   +-------------------------+
 */

import { pageRegions, bandZoneHeight } from '../engine/regions.js';
import { items, esc } from '../render/items.js';
import {
    SAMPLE_ROWS, designHeight, itemBox, resizableAxes, handlesFor
} from './geometry.js';


/** zones that own a strip of the page, drawn top to bottom */
const PAGE_ZONES = ['pageHeader', 'reportHeader', 'reportFooter', 'pageFooter'];


/**
 * A table at design time has no data, so it is given its own column names as
 * cell values. Blank rows would be a table-shaped hole; the field names say
 * which column is which without having to read the header twice.
 */
function sampleRows(columns) {
    return Array.from({ length: SAMPLE_ROWS }, () =>
        Object.fromEntries((columns || []).map(c => [c.field, c.field])));
}


/**
 * items.js expects what the engine produces - resolved text, real rows. This
 * supplies the design-time equivalent: the placeholder string shown verbatim,
 * because that is the thing being edited, and sample rows for a table.
 */
function designItem(item) {
    if (item.type === 'text') {
        return { ...item, text: item.value };
    }

    if (item.type === 'table') {
        return {
            ...item,
            row: sampleRows(item.columns),
            measuredHeight: designHeight(item)
        };
    }

    return item;
}


/**
 * Where every band sits on the design page, in printable-area coordinates.
 *
 * groupHeader and groupFooter own no zone of their own - at print time they are
 * drawn inside the detail table, once per group. Here they are stacked at the
 * top and bottom of the detail region, which is where they land on the page and
 * makes the repeating unit legible.
 *
 * @param {object} layout
 * @returns {object[]} `{ type, top, height, band }`, in draw order
 */
export function designZones(layout) {
    const { page } = layout;
    const contentHeight = page.height - page.margin.top - page.margin.bottom;

    const byType = Object.fromEntries(
        (layout.bands || []).map(b => [b.type, b]));

    const regions = pageRegions({
        bands: byType,
        contentHeight,
        isFirstPage: true,
        isLastPage: true
    });

    const zones = [];

    for (const type of PAGE_ZONES) {
        const region = regions[type];
        if (region && byType[type]) {
            zones.push({ type, ...region, band: byType[type] });
        }
    }

    const detail = regions.detail;
    const groupHeader = byType.groupHeader;
    const groupFooter = byType.groupFooter;

    const headHeight = groupHeader ? bandZoneHeight(groupHeader, contentHeight) : 0;
    const footHeight = groupFooter ? bandZoneHeight(groupFooter, contentHeight) : 0;

    if (groupHeader) {
        zones.push({
            type: 'groupHeader', top: detail.top,
            height: headHeight, band: groupHeader
        });
    }

    if (byType.detail) {
        zones.push({
            type: 'detail',
            top: detail.top + headHeight,
            height: Math.max(detail.height - headHeight - footHeight, 0),
            band: byType.detail
        });
    }

    if (groupFooter) {
        zones.push({
            type: 'groupFooter',
            top: detail.top + detail.height - footHeight,
            height: footHeight, band: groupFooter
        });
    }

    return zones;
}


/**
 * An absolutely positioned child anchors to its ancestor's *padding* box, and
 * the page draws its margins as padding - so the margins are added back here,
 * exactly as render.js does it, or every band would sit inside them.
 */
function zone(z, margin) {
    const drawn = (z.band.items || []).map(designItem);

    return `
    <div class="band dz-zone" data-band-type="${esc(z.type)}"
         style="position:absolute;top:${z.top + margin.top}px;left:${margin.left}px;right:${margin.right}px;height:${z.height}px">
        ${items(drawn)}
    </div>`;
}


/** the band name, in the gutter beside the page rather than over the design */
function tag(z, margin) {
    return `<span class="dz-tag" data-band-tag="${esc(z.type)}"
                  style="top:${z.top + margin.top}px">${esc(z.type)}</span>`;
}



/**
 * The selected item's box in page coordinates - margins included, so it can be
 * dropped straight into the page box beside the zones.
 *
 * @param {object} layout
 * @param {{band: string, id: string}|null} selection
 * @returns {object|null} `{ item, box }`, or null when nothing is selected
 */
export function selectionBox(layout, selection) {
    if (!selection) return null;

    const margin = layout.page.margin;
    const zone = designZones(layout).find(z => z.type === selection.band);
    if (!zone) return null;

    const item = (zone.band.items || []).find(i => i.id === selection.id);
    if (!item) return null;

    const box = itemBox(item);

    return {
        item,
        box: {
            ...box,
            x: box.x + margin.left,
            y: box.y + zone.top + margin.top
        }
    };
}


/**
 * Spec 5.2: the canvas is the preview's drawing plus selection chrome on top.
 * The outline is a sibling of the bands rather than something added inside the
 * item, so items.js keeps producing exactly what the preview produces - the
 * moment selection has to be drawn *into* an item, the two paths have parted.
 */
function overlay(found, { withHandles = true, primary = true } = {}) {
    const { box, item } = found;

    /**
     * Handles only on a lone selection. Dragging the south edge of six items at
     * once has no single answer - do they all become that tall, or does the
     * group scale? - and a handle that has to ask is worse than one that is not
     * offered.
     */
    const handles = withHandles
        ? handlesFor(resizableAxes(item))
            .map(h => `<span class="dz-handle dz-handle-${h}" data-handle="${h}"></span>`)
            .join('')
        : '';

    return `
    <div class="dz-select${primary ? '' : ' is-secondary'}" data-role="select"
         data-select-id="${esc(item.id)}"
         style="top:${box.y}px;left:${box.x}px;width:${box.w}px;height:${box.h}px">
        ${handles}
    </div>`;
}


/**
 * Every selected item's box, in the order they were selected.
 *
 * @param {object} layout
 * @param {object[]} selections
 * @returns {object[]} `{ item, box }`, skipping any that have since gone
 */
export function selectionBoxes(layout, selections) {
    return (selections || [])
        .map(one => selectionBox(layout, one))
        .filter(Boolean);
}

/**
 * The whole sheet: a gutter of band names, and the page itself.
 * @param {object} layout a validated layout
 * @param {object|object[]|null} [selection] the item or items to outline
 * @returns {string} markup
 */
export function drawSheet(layout, selection = null) {
    const { page } = layout;
    const margin = page.margin;
    const zones = designZones(layout);

    /** one or many: the canvas draws an outline per selected item either way */
    const list = selection == null ? [] : [].concat(selection);
    const found = selectionBoxes(layout, list);

    const pageBox =
        `width:${page.width}px;height:${page.height}px;` +
        `padding-top:${margin.top}px;padding-right:${margin.right}px;` +
        `padding-bottom:${margin.bottom}px;padding-left:${margin.left}px;`;

    return `
    <div class="dz-sheet" style="--page-height:${page.height}px">
        <div class="dz-gutter">
            ${zones.map(z => tag(z, margin)).join('')}
        </div>
        <div class="page dz-page" style="${pageBox}">
            ${zones.map(z => zone(z, margin)).join('')}
            ${found.map((one, i) => overlay(one, {
                withHandles: found.length === 1,
                primary: i === found.length - 1
            })).join('')}
        </div>
    </div>`;
}


/**
 * The printable-area y of a point inside a band.
 *
 * Bands hold items in their own coordinates (spec 3.3), so comparing one item's
 * position with another band's means lifting it out of its band first.
 *
 * @param {object} layout
 * @param {string} bandType
 * @param {number} y a band-relative offset
 * @returns {number|null} null when the report has no such band
 */
export function absoluteTop(layout, bandType, y) {
    const zone = designZones(layout).find(z => z.type === bandType);
    return zone ? zone.top + y : null;
}


/**
 * Which band a printable-area y falls in.
 *
 * The zones tile the page - whatever a missing band would have taken is
 * absorbed by the detail (see regions.js) - so any point on the sheet is in
 * exactly one of them. A point off the top or bottom is clamped to the nearest
 * rather than returned as nothing, because dragging an item slightly past the
 * edge is a gesture towards that band, not a gesture at nothing.
 *
 * @param {object} layout
 * @param {number} top
 * @returns {string|null} a band type, or null for a report with no bands
 */
export function bandAtOffset(layout, top) {
    const zones = designZones(layout);
    if (!zones.length) return null;

    const ordered = [...zones].sort((a, b) => a.top - b.top);

    for (const zone of ordered) {
        if (top >= zone.top && top < zone.top + zone.height) return zone.type;
    }

    return top < ordered[0].top ? ordered[0].type : ordered.at(-1).type;
}


/**
 * Where an item would land if it were dropped where it currently sits.
 *
 * @param {object} layout
 * @param {string} bandType the band it is in now
 * @param {object} item
 * @returns {string|null} the band type under it
 */
export function bandUnder(layout, bandType, item) {
    const top = absoluteTop(layout, bandType, item?.y ?? 0);
    return top === null ? null : bandAtOffset(layout, top);
}

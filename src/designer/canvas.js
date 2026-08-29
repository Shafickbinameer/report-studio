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
import { ticksFor, guidesOf } from './rulers.js';


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
    /**
     * Top to bottom, which is the order paginate.js places a band's items in
     * and therefore the order they are painted in the report. Drawing them in
     * file order instead put a box added last over the things it was drawn to
     * frame - on the canvas only, so the design and the print disagreed.
     */
    const drawn = [...(z.band.items || [])]
        .sort((a, b) => (a.y ?? 0) - (b.y ?? 0))
        .map(designItem);

    return `
    <div class="band dz-zone" data-band-type="${esc(z.type)}"
         style="position:absolute;top:${z.top + margin.top}px;left:${margin.left}px;right:${margin.right}px;height:${z.height}px">
        ${items(drawn)}
    </div>`;
}


/**
 * The two rulers and the corner between them.
 *
 * They measure the printable area rather than the paper, so the number under an
 * item is the `x` the properties rail shows for it. Anything else would be a
 * second coordinate system for someone to convert between, and the margins are
 * already drawn - the ruler starting where they end says how wide they are
 * without a number for that too.
 *
 * @param {object} layout
 * @param {{w: number, h: number}} paper the printable area
 * @returns {string} markup
 */
function rulerFrame(layout, paper) {
    const guides = guidesOf(layout);

    const marks = (length, axis) => ticksFor(length).map(tick => `
        <span class="dz-tick${tick.major ? ' is-major' : ''}"
              style="${axis === 'x' ? 'left' : 'top'}:${tick.at}px"
            >${tick.major ? `<i>${tick.at}</i>` : ''}</span>`).join('');

    /**
     * The guides get a container of their own inside each ruler, so a drag can
     * replace them without touching the ticks - which never change, and there
     * are two hundred of them.
     */
    const nubs = (axis) => `
        <span class="dz-ruler-guides" data-role="ruler-guides"
              data-axis="${axis}">${guideNubs(layout, axis)}</span>`;

    return `
    <div class="dz-ruler-corner" data-role="ruler-corner"></div>

    <div class="dz-ruler dz-ruler-x" data-role="ruler" data-axis="x"
         style="width:${paper.w}px" aria-hidden="true">
        ${marks(paper.w, 'x')}${nubs('x')}
    </div>

    <div class="dz-ruler dz-ruler-y" data-role="ruler" data-axis="y"
         style="height:${paper.h}px" aria-hidden="true">
        ${marks(paper.h, 'y')}${nubs('y')}
    </div>`;
}


/**
 * Where each guide meets its ruler, so one dragged off the page is still
 * findable - and so the ruler says what it is carrying.
 *
 * @param {object} layout
 * @param {'x'|'y'} axis
 * @returns {string} markup
 */
export function guideNubs(layout, axis) {
    return guidesOf(layout)[axis].map(at => `
        <span class="dz-ruler-guide"
              style="${axis === 'x' ? 'left' : 'top'}:${at}px"></span>`).join('');
}


/**
 * The guides themselves, drawn over the page.
 *
 * In the page's coordinates rather than the printable area's, because that is
 * the box they are drawn in - the same conversion every other overlay on this
 * sheet makes, and for the same reason.
 *
 * @param {object} layout
 * @returns {string} markup, the contents of the .dz-rules layer
 */
export function guideLines(layout) {
    const margin = layout.page.margin;
    const guides = guidesOf(layout);

    const across = guides.x.map(at => `
        <span class="dz-rule dz-rule-v" data-role="guide" data-axis="x"
              data-at="${at}" style="left:${at + margin.left}px"></span>`);

    const down = guides.y.map(at => `
        <span class="dz-rule dz-rule-h" data-role="guide" data-axis="y"
              data-at="${at}" style="top:${at + margin.top}px"></span>`);

    return [...across, ...down].join('');
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
 * @param {object} [options]
 * @param {boolean} [options.rulers] draw the rulers and the guides on them
 * @returns {string} markup
 */
export function drawSheet(layout, selection = null, { rulers = false } = {}) {
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

    /** the printable area, which is what the rulers measure and guides sit in */
    const paper = {
        w: page.width - margin.left - margin.right,
        h: page.height - margin.top - margin.bottom
    };

    return `
    <div class="dz-sheet${rulers ? ' has-rulers' : ''}"
         style="--page-height:${page.height}px;--dz-margin-left:${margin.left}px;
                --dz-margin-top:${margin.top}px">
        ${rulers ? rulerFrame(layout, paper) : ''}
        <div class="dz-gutter">
            ${zones.map(z => tag(z, margin)).join('')}
        </div>
        <div class="page dz-page" style="${pageBox}">
            <div class="dz-rules" data-role="rules"
                 >${rulers ? guideLines(layout) : ''}</div>
            ${zones.map(z => zone(z, margin)).join('')}
            ${found.map((one, i) => overlay(one, {
                withHandles: found.length === 1,
                primary: i === found.length - 1
            })).join('')}
            <div class="dz-guides" data-role="guides"></div>
        </div>
    </div>`;
}


/**
 * A band's box: where it starts on the page, and how big it is in its own
 * coordinates.
 *
 * Two coordinate systems in one object because the two callers want different
 * halves of it - the guides are worked out in band coordinates and drawn in
 * page ones, and the conversion between them is exactly `left` and `top`.
 *
 * @param {object} layout
 * @param {string} bandType
 * @returns {{left: number, top: number, w: number, h: number}|null}
 */
export function bandBox(layout, bandType) {
    const zone = designZones(layout).find(z => z.type === bandType);
    if (!zone) return null;

    const margin = layout.page.margin;

    return {
        left: margin.left,
        top: zone.top + margin.top,
        w: layout.page.width - margin.left - margin.right,
        h: zone.height,

        /**
         * Where the band starts inside the printable area, which is what the
         * rulers measure and therefore what a guide's position means. `originX`
         * is zero and stays in the object anyway: a caller converting one axis
         * and not the other is the bug this is here to make impossible.
         */
        originX: 0,
        originY: zone.top
    };
}


/**
 * The guides, as markup for the layer drawSheet leaves empty.
 *
 * Everything arrives in band coordinates and is drawn in page ones, so the
 * band's own origin is added to all of it here - the one place that knows both.
 *
 * @param {object} band the bandBox the guides were worked out against
 * @param {object[]} lines
 * @param {object[]} gaps
 * @returns {string} markup
 */
export function drawGuides(band, lines = [], gaps = []) {
    if (!band) return '';

    const across = (n) => n + band.left;
    const down = (n) => n + band.top;

    const drawnLines = lines.map(line => line.axis === 'x'
        ? `<span class="dz-guide dz-guide-v${line.centre ? ' is-centre' : ''}"
                 style="left:${across(line.at)}px;top:${down(line.from)}px;
                        height:${Math.max(line.to - line.from, 0)}px"></span>`
        : `<span class="dz-guide dz-guide-h${line.centre ? ' is-centre' : ''}"
                 style="top:${down(line.at)}px;left:${across(line.from)}px;
                        width:${Math.max(line.to - line.from, 0)}px"></span>`);

    const drawnGaps = gaps.map(gap => {
        const length = Math.max(gap.to - gap.from, 0);
        const label = `<i>${Math.round(gap.distance)}</i>`;
        const band_ = gap.toBand ? ' is-band' : '';

        return gap.axis === 'y'
            ? `<span class="dz-gap dz-gap-v${band_}"
                     style="left:${across(gap.at)}px;top:${down(gap.from)}px;
                            height:${length}px">${label}</span>`
            : `<span class="dz-gap dz-gap-h${band_}"
                     style="top:${down(gap.at)}px;left:${across(gap.from)}px;
                            width:${length}px">${label}</span>`;
    });

    return [...drawnLines, ...drawnGaps].join('');
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

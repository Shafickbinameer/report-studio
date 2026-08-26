/**
 * regions.js decides where each band sits on a page.
 *
 * Bands do not flow. A page is divided into fixed zones, the way a sheet of
 * headed paper is: a strip at the top for the page and report headers, a strip
 * at the bottom for the report and page footers, and the detail in between.
 *
 * The point of anchoring rather than stacking: a page whose detail band ran out
 * of rows must still print its footer on the bottom edge. Stacking pulls the
 * footer up under the last row, which is not where a footer belongs.
 *
 *   +--------------------+  <- content top
 *   |   pageHeader       |  10%
 *   |   reportHeader     |  10%   (first page only)
 *   |                    |
 *   |   detail           |  whatever is left - 60% when every band is present
 *   |                    |
 *   |   reportFooter     |  10%   (last page only)
 *   |   pageFooter       |  10%   pinned to the bottom edge
 *   +--------------------+  <- content bottom
 *
 * Every figure is a default the layout may override, per band, in px or in
 * percent of the printable height.
 */


/**
 * Spec 3.2 gives band order but no sizes, so these are the sheet-of-paper
 * defaults a report gets before anyone opens the designer. groupHeader and
 * groupFooter are absent on purpose: they are drawn inside the detail band, not
 * given a zone of their own.
 */
export const DEFAULT_BAND_HEIGHTS = {
    pageHeader: '10%',
    reportHeader: '10%',
    reportFooter: '10%',
    pageFooter: '10%'
};

/** bands that own a zone, top to bottom */
const HEADER_ZONE = ['pageHeader', 'reportHeader'];
const FOOTER_ZONE = ['reportFooter', 'pageFooter'];


/**
 * A band height as written in the layout: a number of pixels, or a percentage
 * of the printable height. Anything unusable falls back to the default.
 *
 * @param {number|string|undefined} value the band's `height`
 * @param {number} contentHeight the printable height of the page
 * @param {number|string|undefined} fallback used when value is absent or unusable
 * @returns {number} pixels
 */
export function resolveHeight(value, contentHeight, fallback) {
    const px = toPixels(value, contentHeight);
    if (px !== null) return px;

    const backup = toPixels(fallback, contentHeight);
    return backup ?? 0;
}


function toPixels(value, contentHeight) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return value;
    }

    if (typeof value === 'string') {
        const percent = value.trim().match(/^(-?[\d.]+)\s*%$/);
        if (percent) {
            const ratio = Number(percent[1]);
            if (Number.isFinite(ratio) && ratio >= 0) {
                return (ratio / 100) * contentHeight;
            }
            return null;
        }

        const plain = Number(value.trim().replace(/px$/i, ''));
        if (Number.isFinite(plain) && plain >= 0) return plain;
    }

    return null;
}


/**
 * The zone height a band should occupy. The declared height is the design
 * intent, but content is never clipped to it - a band whose text wrapped past
 * its zone grows, and says so.
 *
 * @param {object|null} band
 * @param {number} contentHeight
 * @returns {number}
 */
export function bandZoneHeight(band, contentHeight) {
    if (!band) return 0;

    const declared = resolveHeight(
        band.height,
        contentHeight,
        DEFAULT_BAND_HEIGHTS[band.type]
    );

    const measured = band.measuredHeight ?? 0;

    if (measured > declared) {
        console.warn(
            `Band "${band.type}" needs ${Math.ceil(measured)}px but its zone is ` +
            `${Math.round(declared)}px; the zone has been grown to fit.`
        );
        return measured;
    }

    return declared;
}


/**
 * Where every band sits on one page, in coordinates relative to the printable
 * area - so (0, 0) is inside the margins, not the paper edge.
 *
 * @param {object} options
 * @param {object} options.bands the band templates, keyed by type
 * @param {number} options.contentHeight page height less the top and bottom margins
 * @param {boolean} options.isFirstPage the report header only appears here
 * @param {boolean} options.isLastPage and the report footer only here
 * @returns {object} a zone per band type, plus the detail zone
 */
export function pageRegions({ bands, contentHeight, isFirstPage, isLastPage }) {
    const regions = {};

    const shows = (type) => {
        if (type === 'reportHeader') return isFirstPage;
        if (type === 'reportFooter') return isLastPage;
        return true;
    };

    /* headers, downward from the top */
    let top = 0;

    for (const type of HEADER_ZONE) {
        const band = bands[type];
        if (!band || !shows(type)) continue;

        const height = bandZoneHeight(band, contentHeight);
        regions[type] = { top, height };
        top += height;
    }

    const detailTop = top;

    /* footers, upward from the bottom, so the page footer lands on the edge */
    let bottom = contentHeight;

    for (const type of [...FOOTER_ZONE].reverse()) {
        const band = bands[type];
        if (!band || !shows(type)) continue;

        const height = bandZoneHeight(band, contentHeight);
        bottom -= height;
        regions[type] = { top: bottom, height };
    }

    /**
     * The detail takes what the two zones leave. With the default 10/10/10/10
     * that is the 60% in the middle; change any band's height and the detail
     * absorbs the difference rather than the footer drifting off the edge.
     */
    regions.detail = {
        top: detailTop,
        height: Math.max(bottom - detailTop, 0)
    };

    return regions;
}

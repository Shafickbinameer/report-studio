/**
 * The engine's public surface.
 *
 * Spec 4: buildPages(layout, data) -> PageList, in four ordered stages, each a
 * pure function over plain objects. Nothing here imports React, and nothing
 * here touches the DOM beyond the offscreen canvas used for text measurement.
 */

import { resolve } from './resolve.js';
import { group } from './group.js';
import { measure } from './measure.js';
import { paginate } from './paginate.js';

export { resolve } from './resolve.js';
export { group } from './group.js';
export { measure } from './measure.js';
export { paginate } from './paginate.js';
export { validateLayout, ReportError } from './validate.js';
export { search, searchPages } from './search.js';
export { pageRegions, bandZoneHeight, resolveHeight, DEFAULT_BAND_HEIGHTS } from './regions.js';
export { toCSV, toReportCSV, reportFilename } from './csv.js';
export { measureText, wrapLines, textHeight, LINE_HEIGHT_RATIO } from './text-metrics.js';


/**
 * Turns a layout file plus a data payload into a page list.
 * @param {object} layout the report layout file
 * @param {object} data the host application's data, keyed by dataset name
 * @returns {object} the layout, with a `pages` array of positioned bands
 * @throws {ReportError} when the layout or data cannot be used
 */
export function buildPages(layout, data) {
    return paginate(measure(group(resolve(layout, data), data)));
}

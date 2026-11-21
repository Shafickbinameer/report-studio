/**
 * The engine's public surface.
 *
 * Spec 4: buildPages(layout, data) -> PageList, in four ordered stages, each a
 * pure function over plain objects. Nothing here imports React, and nothing
 * here touches the DOM beyond the offscreen canvas used for text measurement.
 */

import { resolve } from './resolve.js';
import { group } from './group.js';
import { measureInPlace } from './measure.js';
import { paginateInPlace } from './paginate.js';

export { resolve } from './resolve.js';
export { group } from './group.js';
export { measure } from './measure.js';
export { paginate } from './paginate.js';
export { validateLayout, ReportError } from './validate.js';
export { search, searchPages } from './search.js';
export { pageRegions, bandZoneHeight, resolveHeight, DEFAULT_BAND_HEIGHTS } from './regions.js';
export { toCSV, toReportCSV, reportFilename, reportTables } from './csv.js';
export { toXLSX, toXLSXAsync, reportImageSources, XLSX_MIME } from './xlsx.js';
export {
    tablesOf, datasetOf, groupingOf, groupingsOf, groupBandsOf, levelsOf, isGrouped, normalizeGrouping,
    fragmentBandsOf, MAX_GROUP_LEVELS
} from './tables.js';
export {
    measureText, wrapLines, textHeight, LINE_HEIGHT_RATIO, fitText, graphemes, TEXT_OVERFLOWS
} from './text-metrics.js';
export { mm, toMM, pageSize, PAPER, PX_PER_MM, PT_PER_PX } from './units.js';
export { toPDF, pdfImage, PDF_MIME } from './pdf.js';
export {
    formatValue, describeFormat, excelNumberFormat, DEFAULT_FORMAT, INDIAN_DEFAULTS
} from './format.js';
export { highlightFor, cellHighlight, describeHighlight } from './highlight.js';


/**
 * Turns a layout file plus a data payload into a page list.
 * @param {object} layout the report layout file
 * @param {object} data the host application's data, keyed by dataset name
 * @returns {object} the layout, with a `pages` array of positioned bands
 * @throws {ReportError} when the layout or data cannot be used
 *
 * The layout is not changed. The data is not changed either, and is not
 * copied: the rows on the pages are the rows that were passed in (or copies
 * of them, for a table with calculated columns), so a large report is not
 * paid for twice in memory.
 */
export function buildPages(layout, data) {
    /**
     * resolve and group each hand back a layout of their own, so the stages
     * after them can work on it in place rather than copy every row again.
     */
    return paginateInPlace(measureInPlace(group(resolve(layout, data), data)));
}

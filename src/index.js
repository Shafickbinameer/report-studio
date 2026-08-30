/**
 * report-studio - the package's main entry point.
 *
 * The engine and the viewer, and nothing that touches the document on import -
 * so an application that only builds pages, or only renders them on a server,
 * pays for nothing it does not use.
 *
 * The designer is a separate entry (`report-studio/designer`) because it is the
 * larger half and most applications ship the reports rather than the tool that
 * drew them. Each screen has a stylesheet of its own to link beside it:
 * `report-studio/viewer.css` and `report-studio/designer.css`, or
 * `report-studio/report.css` alone to draw a report with no chrome at all.
 */

export {
    buildPages,
    resolve,
    group,
    measure,
    paginate,
    validateLayout,
    ReportError,
    search,
    searchPages,
    toCSV,
    toReportCSV,
    reportFilename,
    measureText,
    wrapLines,
    textHeight,
    LINE_HEIGHT_RATIO
} from './engine/index.js';

export { render } from './render/render.js';

/**
 * The viewer: paging, zoom, search, print and CSV over a page list.
 *
 * It takes one empty element and builds the rest, the same way createDesigner
 * does. Link `report-studio/viewer.css` beside it - the report's own stylesheet
 * is included there, so that one file is enough.
 */
export { createViewer, openViewerWindow } from './preview/viewer.js';

/**
 * Opens a blank window with the host's stylesheets in it, ready to be mounted
 * into - for a host that wants a screen of its own without using one of the
 * two helpers above.
 */
export { openWindow } from './shared/window.js';

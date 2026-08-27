/**
 * report-studio - the framework-free entry point.
 *
 * Spec 7.4: consumers import the engine from here and the screens from
 * report-studio/react, so an application using only the engine never downloads
 * the React code. Nothing in this module touches the document on import.
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
export { createViewer } from './preview/viewer.js';

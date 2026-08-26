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

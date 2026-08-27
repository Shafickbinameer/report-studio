/**
 * blank.js is what a new report starts as.
 *
 * The designer is handed a layout by the host, and "I made an empty file" is
 * the ordinary way to start one - so `{}` has to mean "a new report", not a
 * wall of validation errors about a missing page object.
 *
 * These values are a decision, not a placeholder: A4 at 794x1123 is spec 6.2's
 * pixel size, 40px margins match the fixtures, and the three bands are the
 * smallest set that prints something sensible - a header, the rows, a footer.
 * Heights are declared in pixels rather than left to the 10% defaults in
 * regions.js, because a tenth of the page is a lot of header to be given
 * without asking for it.
 */


/** @returns {object} a fresh, valid, empty report */
export function blankLayout() {
    return {
        version: 1,
        name: 'Untitled report',
        page: {
            width: 794,
            height: 1123,
            margin: { top: 40, right: 40, bottom: 40, left: 40 }
        },
        dataset: null,
        groupBy: null,
        bands: [
            { type: 'pageHeader', height: 60, items: [] },
            { type: 'detail', items: [] },
            { type: 'pageFooter', height: 40, items: [] }
        ]
    };
}


/**
 * Whether the host handed us "nothing" rather than a layout.
 *
 * Deliberately narrow: null, undefined, and an object with no keys are a new
 * report. Anything else is a layout the user meant to write, so a mistake in it
 * must be reported rather than quietly replaced with a blank page - losing
 * someone's file to a typo is not a recoverable kind of helpful.
 *
 * @param {*} layout
 * @returns {boolean}
 */
export function isEmptyLayout(layout) {
    if (layout == null) return true;
    if (typeof layout !== 'object' || Array.isArray(layout)) return false;
    return Object.keys(layout).length === 0;
}

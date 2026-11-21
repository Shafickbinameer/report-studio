/**
 * units.js converts the sizes paper and labels are sold in to the pixels a
 * layout is written in.
 *
 * A layout's lengths are CSS pixels, 96 to the inch. Labels are sold in
 * millimetres - 50 x 25, 38 x 25 - and a sheet of them is described in
 * millimetres too, so a host building a label layout needs the one conversion,
 * written down once.
 */


/** CSS pixels in one millimetre: 96 to the inch, 25.4 mm to the inch */
export const PX_PER_MM = 96 / 25.4;

/** PDF points in one CSS pixel: 72 to the inch against 96 */
export const PT_PER_PX = 72 / 96;


/**
 * Millimetres as layout pixels.
 * @param {number} value
 * @returns {number}
 */
export function mm(value) {
    return Number(value) * PX_PER_MM;
}


/**
 * Layout pixels as millimetres.
 * @param {number} value
 * @returns {number}
 */
export function toMM(value) {
    return Number(value) / PX_PER_MM;
}


/** paper sizes, portrait, in millimetres */
export const PAPER = Object.freeze({
    A4: Object.freeze({ width: 210, height: 297 }),
    A5: Object.freeze({ width: 148, height: 210 }),
    A6: Object.freeze({ width: 105, height: 148 }),
    Letter: Object.freeze({ width: 215.9, height: 279.4 }),
    Legal: Object.freeze({ width: 215.9, height: 355.6 })
});


/**
 * A layout's `page` block for a paper size or a label size.
 *
 * @param {string|{width: number, height: number}} size a PAPER name, or a size
 *   in millimetres
 * @param {object} [options]
 * @param {'portrait'|'landscape'} [options.orientation]
 * @param {number|{top?: number, right?: number, bottom?: number, left?: number}} [options.margin]
 *   millimetres, one for every side or each side its own
 * @returns {{width: number, height: number, margin: {top: number, right: number, bottom: number, left: number}}}
 */
export function pageSize(size, { orientation = 'portrait', margin = 0 } = {}) {
    const paper = typeof size === 'string' ? PAPER[size] : size;

    if (!paper || !(Number(paper.width) > 0) || !(Number(paper.height) > 0)) {
        throw new RangeError(`pageSize: "${typeof size === 'string' ? size : JSON.stringify(size)}" is not a paper size`);
    }

    const short = Math.min(paper.width, paper.height);
    const long = Math.max(paper.width, paper.height);

    /** a size given as an object keeps the way round it was given, unless asked */
    let [w, h] = typeof size === 'string' ? [short, long] : [paper.width, paper.height];
    if (orientation === 'landscape') [w, h] = [long, short];

    const m = typeof margin === 'number' ? { top: margin, right: margin, bottom: margin, left: margin } : (margin ?? {});

    return {
        width: round(mm(w)),
        height: round(mm(h)),
        margin: {
            top: round(mm(m.top ?? 0)),
            right: round(mm(m.right ?? 0)),
            bottom: round(mm(m.bottom ?? 0)),
            left: round(mm(m.left ?? 0))
        }
    };
}


/** to a hundredth of a pixel - enough for any printer, and stable in JSON */
function round(n) {
    return Math.round(n * 100) / 100;
}

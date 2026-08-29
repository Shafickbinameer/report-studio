/**
 * rulers.js is the arithmetic behind the rulers and the guides dragged off them.
 *
 * The alignment guides in guides.js answer "what is this level with?" while
 * something is moving. A ruler answers a different question: where is 240, and
 * can I have a line there. It is the tool for a layout that has to line up with
 * something outside the report - a window in an envelope, a pre-printed form, a
 * column the last six reports used - which nothing already on the page can be
 * aligned to because it is not on the page.
 *
 * Guides live on the layout rather than in the designer's head, so they are
 * saved with the report and come back with it: a column grid worked out once is
 * not something to work out again on Monday. The engine has never read a key it
 * was not looking for, and validate.js does not object to one, so they travel
 * with the file and are ignored by everything that prints it.
 *
 * Coordinates are the printable area's: (0, 0) is inside the margins, which is
 * where an item's own x and y are measured from and therefore what the numbers
 * in the properties rail mean. A ruler that disagreed with the rail would be
 * worse than no ruler.
 */


/** the fine ticks, matching the 10px grid a drag already snaps to */
export const MINOR = 10;

/** and the ones that carry a number */
export const MAJOR = 50;

/**
 * How near the pointer has to be to a guide to pick it up rather than the item
 * under it. A guide is one pixel wide, which nobody can hit.
 */
export const GRAB = 4;


/**
 * The marks on a ruler of a given length.
 *
 * Both ends are included: the last tick is the edge of the printable area, and
 * a ruler that stopped short of it would be saying the page does.
 *
 * @param {number} length in px
 * @param {object} [options]
 * @param {number} [options.minor] the fine spacing
 * @param {number} [options.major] the labelled spacing; must be a multiple of minor
 * @returns {{at: number, major: boolean}[]}
 */
export function ticksFor(length, { minor = MINOR, major = MAJOR } = {}) {
    const ticks = [];

    if (!(length > 0) || !(minor > 0)) return ticks;

    for (let at = 0; at <= length; at += minor) {
        ticks.push({ at, major: at % major === 0 });
    }

    /** a length that is not a whole number of ticks still ends where it ends */
    const last = ticks.at(-1);
    if (last && last.at !== length) ticks.push({ at: length, major: true });

    return ticks;
}


/**
 * The guides a layout carries, always as two arrays.
 *
 * Read through here rather than off the object, because a layout written by
 * hand - or saved before guides existed - has no `guides` key at all, and every
 * caller having to remember that is how a designer ends up throwing on somebody
 * else's file.
 *
 * @param {object} layout
 * @returns {{x: number[], y: number[]}} sorted, and safe to read
 */
export function guidesOf(layout) {
    const found = layout?.guides;

    /**
     * Number(null) is 0, and so is Number('') - so what is not a number has to
     * be dropped before the coercion, or a null in a hand-edited file becomes a
     * guide down the left edge that nobody put there and nobody can explain.
     */
    const axis = (list) => (Array.isArray(list) ? list : [])
        .filter(usable)
        .map(Number)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

    return { x: axis(found?.x), y: axis(found?.y) };
}


/** something that could be a position, as opposed to something Number() pities */
function usable(value) {
    if (typeof value === 'number') return true;

    return typeof value === 'string' && value.trim() !== '';
}


/** the layout's guides object, created on the layout if it has none yet */
function guideStore(layout) {
    if (!layout.guides || typeof layout.guides !== 'object') {
        layout.guides = { x: [], y: [] };
    }

    for (const axis of ['x', 'y']) {
        if (!Array.isArray(layout.guides[axis])) layout.guides[axis] = [];
    }

    return layout.guides;
}


/**
 * Puts a guide on an axis.
 *
 * Rounded to the pixel, because a guide dragged to 240.3 is a guide at 240 that
 * nothing will ever quite line up with. Duplicates are dropped rather than
 * stacked: two guides on one line are indistinguishable on screen and the
 * second one can only be deleted by accident.
 *
 * @param {object} layout mutated in place, as the rest of structure.js does
 * @param {'x'|'y'} axis
 * @param {number} at
 * @returns {number|null} where it landed, or null if it was not a usable number
 */
export function addGuide(layout, axis, at) {
    if (!usable(at)) return null;

    const value = Math.round(Number(at));
    if (!Number.isFinite(value)) return null;

    const store = guideStore(layout);

    if (!store[axis].includes(value)) {
        store[axis].push(value);
        store[axis].sort((a, b) => a - b);
    }

    return value;
}


/**
 * Takes one off.
 *
 * @param {object} layout
 * @param {'x'|'y'} axis
 * @param {number} at the guide's current position
 * @returns {boolean} whether there was one there
 */
export function removeGuide(layout, axis, at) {
    const store = guideStore(layout);
    const index = store[axis].indexOf(Math.round(Number(at)));

    if (index === -1) return false;

    store[axis].splice(index, 1);
    return true;
}


/**
 * Moves one, which is a remove and an add - so a guide dragged onto another
 * merges with it rather than hiding it.
 *
 * @param {object} layout
 * @param {'x'|'y'} axis
 * @param {number} from
 * @param {number} to
 * @returns {number|null} where it ended up
 */
export function moveGuide(layout, axis, from, to) {
    removeGuide(layout, axis, from);
    return addGuide(layout, axis, to);
}


/**
 * The guide nearest a point on an axis, if one is close enough to have been
 * meant. What makes a guide draggable at all: it is one pixel wide.
 *
 * @param {object} layout
 * @param {'x'|'y'} axis
 * @param {number} at
 * @param {number} [within]
 * @returns {number|null} the guide's position
 */
export function guideNear(layout, axis, at, within = GRAB) {
    let best = null;

    for (const guide of guidesOf(layout)[axis]) {
        const distance = Math.abs(guide - at);

        if (distance <= within && (best === null || distance < Math.abs(best - at))) {
            best = guide;
        }
    }

    return best;
}


/**
 * The guides that apply inside one band, in that band's own coordinates.
 *
 * A vertical guide needs no conversion - a band's x origin is the printable
 * area's. A horizontal one does: the same guide is a different `y` in every
 * band, which is the whole reason bands hold their items in their own
 * coordinates in the first place.
 *
 * @param {object} layout
 * @param {{originY: number, h: number}} band from canvas.bandBox
 * @returns {{x: number[], y: number[]}}
 */
export function guidesInBand(layout, band) {
    const all = guidesOf(layout);

    if (!band) return { x: all.x, y: [] };

    return {
        x: all.x,
        /** only the ones that actually cross this band; the rest are elsewhere */
        y: all.y
            .map(at => at - (band.originY ?? 0))
            .filter(at => at >= 0 && at <= (band.h ?? 0))
    };
}

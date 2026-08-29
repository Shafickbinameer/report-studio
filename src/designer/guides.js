/**
 * guides.js is the arithmetic behind the alignment guides.
 *
 * Dragging on a 10px grid lines an item up with the grid, which is not the
 * thing anyone is trying to line it up with. What they want is the item beside
 * it, the middle of the band, the left edge of the paragraph above - and no
 * amount of squinting at a grid finds those. So while an item is being dragged
 * this works out what it is nearly level with, pulls it the rest of the way,
 * and says what it snapped to; and separately measures the space left around
 * it, so the gaps can be read off rather than guessed at.
 *
 * All of it is pure - boxes in, boxes out - so what a guide does in the awkward
 * cases is specified without a browser, the same way geometry.js is. Nothing
 * here knows that a box is an item, that a band is a band, or that any of it
 * ends up as a line on a screen.
 *
 * Every number is in the band's own coordinates. Turning those into somewhere
 * on the page is the canvas's job, and doing it here would tie the arithmetic
 * to one way of drawing it.
 */


/**
 * How close, in page pixels, an edge has to be before it is taken as meaning
 * the same thing as the edge beside it.
 *
 * Bigger than the 10px grid step would make the grid unreachable - every drag
 * would be captured by a neighbour and the grid would only apply where there
 * was nothing to align to. Smaller than about four and the snap is too hard to
 * land on to be worth having.
 */
export const SNAP = 6;

/** floating point: two edges a thousandth of a pixel apart are the same edge */
const EPSILON = 0.01;


/**
 * The three vertical lines a box can be lined up on: its two sides and its
 * middle. Ordered left to right, and `centre` marks the middle one - a guide
 * drawn through two centres reads differently from one drawn down two edges,
 * and the caller is the one that has to say so.
 *
 * @param {{x: number, w: number}} box
 * @returns {{at: number, centre: boolean}[]}
 */
export function railsX(box) {
    return [
        { at: box.x, centre: false },
        { at: box.x + (box.w ?? 0) / 2, centre: true },
        { at: box.x + (box.w ?? 0), centre: false }
    ];
}


/**
 * The same three, horizontally: top, middle, bottom.
 *
 * @param {{y: number, h: number}} box
 * @returns {{at: number, centre: boolean}[]}
 */
export function railsY(box) {
    return [
        { at: box.y, centre: false },
        { at: box.y + (box.h ?? 0) / 2, centre: true },
        { at: box.y + (box.h ?? 0), centre: false }
    ];
}


/**
 * The smallest box holding all of them, so a group of items is aligned as the
 * one shape it looks like rather than each member finding its own line.
 *
 * @param {object[]} boxes
 * @returns {object|null} null for an empty group, which has no shape
 */
export function unionBox(boxes) {
    if (!boxes?.length) return null;

    const left = Math.min(...boxes.map(b => b.x));
    const top = Math.min(...boxes.map(b => b.y));
    const right = Math.max(...boxes.map(b => b.x + (b.w ?? 0)));
    const bottom = Math.max(...boxes.map(b => b.y + (b.h ?? 0)));

    return { x: left, y: top, w: right - left, h: bottom - top };
}


/**
 * Everything the moving box could line up against on one axis.
 *
 * Three kinds, in the order a tie between them should be settled:
 *
 *   a ruler guide - somebody put it there on purpose, so it outranks anything
 *     that merely happens to be nearby;
 *   the other items;
 *   the band, whose middle is the alignment people reach for most and the one
 *     thing a grid can never help with.
 *
 * A target with no box has its guide drawn across the whole band rather than
 * only as far as a neighbour, which is true of both the band's own lines and a
 * ruler guide.
 *
 * @param {object[]} others the boxes already in the band
 * @param {{w: number, h: number}} band its size, in its own coordinates
 * @param {'x'|'y'} axis
 * @param {number[]} [guides] ruler guides, in the band's coordinates
 * @returns {{at: number, centre: boolean, box: object|null}[]}
 */
export function targetsOn(others, band, axis, guides = []) {
    const rails = axis === 'x' ? railsX : railsY;

    const fromGuides = (guides || [])
        .filter(Number.isFinite)
        .map(at => ({ at, centre: false, box: null }));

    const fromItems = (others || []).flatMap(box =>
        rails(box).map(rail => ({ ...rail, box })));

    const span = axis === 'x' ? (band?.w ?? 0) : (band?.h ?? 0);

    const fromBand = band
        ? rails({ x: 0, y: 0, w: span, h: span }).map(rail => ({ ...rail, box: null }))
        : [];

    return [...fromGuides, ...fromItems, ...fromBand];
}


/**
 * The pull one axis of the moving box feels.
 *
 * The nearest match wins, and a tie goes to the first found - so the band's own
 * edges, which are last in the list, never beat an item the pointer is actually
 * near. What comes back is the distance to travel, not the destination, because
 * the caller has a whole group to move by it.
 *
 * @param {{at: number}[]} rails the moving box's three lines on this axis
 * @param {{at: number}[]} targets what it might line up with
 * @param {number} snap how close is close enough
 * @returns {{delta: number, at: number}|null} null when nothing is near
 */
export function pullTowards(rails, targets, snap = SNAP) {
    let best = null;

    for (const rail of rails) {
        for (const target of targets) {
            const delta = target.at - rail.at;
            if (Math.abs(delta) > snap) continue;

            if (!best || Math.abs(delta) < Math.abs(best.delta) - EPSILON) {
                best = { delta, at: target.at };
            }
        }
    }

    return best;
}


/**
 * The guides to draw for one axis, once the box has been pulled into line.
 *
 * A guide is only worth drawing if it says which things agree, so it is drawn
 * from the top of the highest of them to the bottom of the lowest - the line
 * touches everything it is claiming about and nothing else. A line that ran the
 * whole band would be true of the band, not of the two items.
 *
 * @param {object} moved the moving box, already snapped
 * @param {{at: number, centre: boolean, box: object|null}[]} targets
 * @param {number} at the line everything agreed on
 * @param {'x'|'y'} axis
 * @param {{w: number, h: number}} band
 * @returns {{axis: string, at: number, from: number, to: number, centre: boolean}[]}
 */
export function lineFor(moved, targets, at, axis, band) {
    const matched = targets.filter(t => Math.abs(t.at - at) < EPSILON);
    if (!matched.length) return [];

    /** across the band when the band itself is what it lined up with */
    const toBand = matched.some(t => t.box === null);
    const boxes = matched.map(t => t.box).filter(Boolean);

    const along = axis === 'x'
        ? (b) => [b.y, b.y + (b.h ?? 0)]
        : (b) => [b.x, b.x + (b.w ?? 0)];

    const span = axis === 'x' ? (band?.h ?? 0) : (band?.w ?? 0);

    const ends = [...along(moved), ...boxes.flatMap(along)];

    return [{
        axis,
        at,
        from: toBand ? 0 : Math.min(...ends),
        to: toBand ? span : Math.max(...ends),
        centre: matched.every(t => t.centre)
    }];
}


/**
 * Pulls a box into line with whatever it is nearly level with.
 *
 * The two axes are decided separately, because an item is very often lined up
 * with one thing horizontally and a different thing vertically, and asking for
 * a single winner would throw one of them away.
 *
 * @param {object} moving the box as the pointer has left it
 * @param {object[]} others the other boxes in the band
 * @param {{w: number, h: number}} band
 * @param {object} [options]
 * @param {number} [options.snap]
 * @param {{x: number[], y: number[]}} [options.guides] ruler guides, in the
 *   band's own coordinates
 * @returns {{dx: number, dy: number, lines: object[]}} the correction to apply,
 *   and the guides that explain it
 */
export function alignBox(moving, others, band, { snap = SNAP, guides } = {}) {
    if (!moving) return { dx: 0, dy: 0, lines: [] };

    const acrossTargets = targetsOn(others, band, 'x', guides?.x);
    const downTargets = targetsOn(others, band, 'y', guides?.y);

    const across = pullTowards(railsX(moving), acrossTargets, snap);
    const down = pullTowards(railsY(moving), downTargets, snap);

    const dx = across?.delta ?? 0;
    const dy = down?.delta ?? 0;

    const moved = { ...moving, x: moving.x + dx, y: moving.y + dy };

    return {
        dx,
        dy,
        lines: [
            ...(across ? lineFor(moved, acrossTargets, across.at, 'x', band) : []),
            ...(down ? lineFor(moved, downTargets, down.at, 'y', band) : [])
        ]
    };
}


/** do two boxes share any of this axis, so that one is above the other at all */
function overlaps(a, b, axis) {
    const [pos, size] = axis === 'x' ? ['x', 'w'] : ['y', 'h'];

    return a[pos] < b[pos] + (b[size] ?? 0)
        && a[pos] + (a[size] ?? 0) > b[pos];
}


/**
 * The space on one side of the box, and what is on the other side of it.
 *
 * Only a box that is actually across from this one counts: a caption off in the
 * right margin is not what the gap above is measured to, however high up it is.
 * When nothing is across from it the gap is to the band's own edge, which is
 * the answer people want anyway - it is the margin they are setting.
 *
 * @param {object} box the moving box
 * @param {object[]} others
 * @param {{w: number, h: number}} band
 * @param {'up'|'down'|'left'|'right'} side
 * @returns {object|null} the measurement, or null when the box is already past
 *   the edge it is being measured to
 */
export function gapOn(box, others, band, side) {
    const vertical = side === 'up' || side === 'down';

    const axis = vertical ? 'y' : 'x';
    const across = vertical ? 'x' : 'y';

    const [pos, size] = vertical ? ['y', 'h'] : ['x', 'w'];
    const near = box[pos];
    const far = box[pos] + (box[size] ?? 0);
    const before = side === 'up' || side === 'left';

    const facing = (others || []).filter(other => {
        if (!overlaps(box, other, across)) return false;

        return before
            ? other[pos] + (other[size] ?? 0) <= near
            : other[pos] >= far;
    });

    const bandEnd = vertical ? (band?.h ?? 0) : (band?.w ?? 0);

    /** the nearest thing on that side, or the band's edge when there is none */
    const edge = facing.length
        ? (before
            ? Math.max(...facing.map(o => o[pos] + (o[size] ?? 0)))
            : Math.min(...facing.map(o => o[pos])))
        : (before ? 0 : bandEnd);

    const distance = before ? near - edge : edge - far;

    /** an item dragged past the top of its band has no gap above it to report */
    if (!(distance >= 0)) return null;

    /**
     * Down the middle of what the two have in common, so the measurement sits
     * between the boxes it is measuring rather than off beside them.
     */
    const neighbour = facing.find(o => Math.abs(
        (before ? o[pos] + (o[size] ?? 0) : o[pos]) - edge) < EPSILON);

    const shared = neighbour
        ? [
            Math.max(box[across], neighbour[across]),
            Math.min(
                box[across] + (box[vertical ? 'w' : 'h'] ?? 0),
                neighbour[across] + (neighbour[vertical ? 'w' : 'h'] ?? 0))
        ]
        : [box[across], box[across] + (box[vertical ? 'w' : 'h'] ?? 0)];

    return {
        side,
        axis,
        at: (shared[0] + shared[1]) / 2,
        from: before ? edge : far,
        to: before ? near : edge,
        distance,
        toBand: facing.length === 0
    };
}


/**
 * The space on all four sides.
 *
 * @param {object} box
 * @param {object[]} others
 * @param {{w: number, h: number}} band
 * @returns {object[]} the ones that could be measured
 */
export function gapsAround(box, others, band) {
    if (!box) return [];

    return ['up', 'down', 'left', 'right']
        .map(side => gapOn(box, others, band, side))
        .filter(Boolean);
}


/**
 * Everything the canvas needs to draw while one drag frame is on screen: the
 * correction to apply to the items, the guides that explain it, and the space
 * left around them once it has been applied.
 *
 * @param {object[]} moving the boxes being dragged
 * @param {object[]} others the boxes staying put
 * @param {{w: number, h: number}} band
 * @param {object} [options]
 * @param {number} [options.snap]
 * @param {{x: number[], y: number[]}} [options.guides] ruler guides, in the
 *   band's own coordinates
 * @returns {{dx: number, dy: number, lines: object[], gaps: object[]}}
 */
export function guidesFor(moving, others, band, options = {}) {
    const bounds = unionBox(moving);

    if (!bounds) return { dx: 0, dy: 0, lines: [], gaps: [] };

    const { dx, dy, lines } = alignBox(bounds, others, band, options);
    const settled = { ...bounds, x: bounds.x + dx, y: bounds.y + dy };

    return { dx, dy, lines, gaps: gapsAround(settled, others, band) };
}

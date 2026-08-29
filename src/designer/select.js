/**
 * select.js turns pointer events into calls on geometry.js.
 *
 * Spec 6: drag and resize are written by hand. The logic is genuinely small -
 * record the box on pointerdown, apply the delta on move, commit on up - and
 * the libraries in this space are 50KB, impose their own DOM, and fight you
 * over the thing users judge the product on.
 *
 * One listener set, attached to the canvas and never removed. The canvas
 * survives a redraw; everything inside it does not, so per-item handlers would
 * have to be rebound on every change and would leak the ones that were not.
 *
 * Nothing here does arithmetic. It reads a box, hands it to geometry.js, and
 * writes back what comes out - so the awkward cases are specified in a suite
 * that needs no browser.
 */

import {
    itemBox, moveTo, resizeBy, applyBox, resizableAxes, GRID
} from './geometry.js';
import { bandUnder, bandBox } from './canvas.js';
import { guidesFor, gapsAround, unionBox } from './guides.js';
import {
    addGuide, moveGuide, removeGuide, guideNear, guidesInBand
} from './rulers.js';


/**
 * Wires selection, dragging and resizing onto a designer canvas.
 *
 * @param {object} options
 * @param {Element} options.canvas the scroll container; survives redraws
 * @param {() => object} options.getLayout
 * @param {() => object|null} options.getSelection
 * @param {(selection: object|null, options?: {add?: boolean}) => void}
 *   options.select called when the selection changes; `add` is a shift-click,
 *   which adds to the selection rather than replacing it
 * @param {() => void} [options.remove] delete the selected item
 * @param {() => boolean} [options.duplicate] copy the selection in place and
 *   leave the copies selected; answers whether anything was copied
 * @param {() => void} options.commit called when an edit finishes
 * @param {() => number} [options.getZoom] page pixels per screen pixel
 * @param {() => boolean} [options.enabled] false while the canvas is showing
 *   something that is not the design, such as a rendered report
 * @param {(bands: string[]|null) => void} [options.onTarget] the bands the
 *   items being dragged are over, or null while none has left its own
 * @param {(guides: object|null) => void} [options.onGuides] what the selection
 *   has lined up with, and - while alt is held - the space around it; null when
 *   there is nothing to show
 * @param {() => boolean} [options.rulers] whether the rulers are showing, which
 *   is the only time a guide can be dragged off one
 * @returns {() => void} detaches every listener
 */
export function attachEditing({
    canvas, getLayout, getSelection, select, commit,
    remove = () => { }, duplicate = () => false,
    getZoom = () => 1, enabled = () => true, onTarget = () => { },
    onGuides = () => { }, rulers = () => false
}) {
    /** the drag in progress, or null */
    let drag = null;

    /**
     * A serial number for guide gestures.
     *
     * history.js collapses consecutive edits that share a key, which is what
     * makes a whole drag one undo step. Every guide gesture sharing the *same*
     * key made every guide edit of the whole session one undo step, so one undo
     * took away the lot. The key has to be per gesture, not per kind of gesture.
     */
    let gesture = 0;

    /**
     * Whether alt is down, which is the gesture for "show me the distances".
     *
     * Held rather than toggled, and off by default, because a measurement is
     * something you ask for at the moment you want it. Four numbers on screen
     * for the whole of every drag is a heads-up display, and the report being
     * designed is the thing someone is trying to look at.
     *
     * The same key duplicates when it is already down as the drag starts (see
     * onPointerDown). That is not a clash - it is the pair of gestures alt has
     * in every design tool, and which one you get is decided by whether the
     * pointer was already down.
     */
    let measuring = false;

/**
 * The document the screen is mounted in, which is not always this one: a
 * designer or a viewer opened in its own window lives in that window's
 * document, and a listener put on the opener's would never hear it.
 */
    const doc = canvas.ownerDocument;

    /**
     * The pointer's position in the printable area's coordinates - the ones the
     * rulers are marked in, and therefore the ones a guide is stored in.
     *
     * Measured off the page element rather than computed from the layout: the
     * sheet is centred in a scrolling canvas, so where it actually is on screen
     * is a fact only the browser has.
     *
     * @param {PointerEvent} event
     * @returns {{x: number, y: number}|null} null when the page is not drawn
     */
    function paperPoint(event) {
        const page = canvas.querySelector('.dz-page');
        if (!page) return null;

        const box = page.getBoundingClientRect();
        const zoom = getZoom() || 1;

        /**
         * The page draws its margins as padding, and an item's origin is inside
         * them - so the padding is what turns a point on the paper into a point
         * in the printable area.
         */
        const style = doc.defaultView?.getComputedStyle(page);

        return {
            x: (event.clientX - box.left) / zoom - parseFloat(style?.paddingLeft || 0),
            y: (event.clientY - box.top) / zoom - parseFloat(style?.paddingTop || 0)
        };
    }


    function bandOf(el) {
        return el?.closest('[data-band-type]')?.dataset.bandType ?? null;
    }

    function itemAt(el) {
        const node = el?.closest('[data-item-id]');
        if (!node) return null;

        const band = bandOf(node);
        if (!band) return null;

        return { band, id: node.dataset.itemId, node };
    }

    /** the layout item behind one `{ band, id }`, or null if it has since gone */
    function lookup(one) {
        if (!one) return null;

        const band = (getLayout().bands || []).find(b => b.type === one.band);
        return (band?.items || []).find(i => i.id === one.id) ?? null;
    }


    /**
     * Every box in a band except the ones being dragged - what the drag can
     * line itself up against.
     *
     * @param {string} bandType
     * @param {object[]} moving the drag group, whose members align to nothing
     * @returns {object[]} boxes, in band coordinates
     */
    function neighbours(bandType, moving) {
        const band = (getLayout().bands || []).find(b => b.type === bandType);
        const dragged = new Set(moving.map(entry => entry.where.id));

        return (band?.items || [])
            .filter(item => !dragged.has(item.id))
            .map(itemBox);
    }


    /** everything currently selected, as `{ where, item }` */
    function chosen() {
        return (getSelection() || [])
            .map(where => ({ where, item: lookup(where) }))
            .filter(entry => entry.item);
    }


    /** the one the handles belong to - the most recently selected */
    function head() {
        return chosen().at(-1) ?? null;
    }

    function onPointerDown(event) {
        if (!enabled() || event.button !== 0) return;

        /**
         * A ruler and a guide are asked about first, and a guide before the item
         * under it: a guide is one pixel of line lying on top of the design, and
         * anything that grabbed the item instead would make it impossible to
         * pick up. The ruler is not part of the page at all.
         */
        if (rulers() && beginGuide(event)) return;

        const handle = event.target.closest?.('[data-handle]');

        /**
         * A handle belongs to the current selection, not to whatever is drawn
         * underneath it - the outline overlaps its neighbours by design.
         */
        if (handle) {
            const entry = head();
            if (!entry) return;

            begin(event, {
                mode: 'resize',
                handle: handle.dataset.handle,
                item: entry.item
            });
            return;
        }

        const hit = itemAt(event.target);

        if (!hit) {
            select(null);
            return;
        }

        const where = { band: hit.band, id: hit.id };
        const already = (getSelection() || [])
            .some(one => one.band === where.band && one.id === where.id);

        if (event.shiftKey) {
            /**
             * Shift adds, and takes out again what was already in - so a
             * mis-click is undone with the same gesture rather than by starting
             * the whole selection over.
             */
            select(where, { add: true });
            return;
        }

        /**
         * Alt drags a copy and leaves the original where it is - the gesture
         * every design tool has. Checked after shift so that shift-alt still
         * extends the selection, and before the drag begins so that what the
         * pointer carries away is the copy.
         */
        if (event.altKey) {
            if (!already) select(where);

            if (duplicate()) {
                begin(event, { mode: 'move', collapseTo: null });
                return;
            }
        }

        /**
         * Clicking one of several already-selected items keeps the group for
         * now, so the group can be picked up by grabbing any of its members.
         *
         * If the pointer then goes up without moving, it was a click and not a
         * drag, and it collapses to the one item - which is how a group is
         * broken up, and how its properties are reached.
         */
        if (!already) select(where);

        begin(event, { mode: 'move', collapseTo: already ? where : null });
    }

    /**
     * Starts a guide gesture, if the pointer went down on one or on a ruler.
     *
     * Dragging off a ruler makes a guide; dragging one already on the page moves
     * it; dragging one off the page throws it away, which is the gesture every
     * tool with rulers has and the only one nobody has to be taught.
     *
     * @param {PointerEvent} event
     * @returns {boolean} whether it took the gesture
     */
    function beginGuide(event) {
        const ruler = event.target.closest?.('[data-role="ruler"]');
        const point = paperPoint(event);

        if (!point) return false;

        if (ruler) {
            const axis = ruler.dataset.axis;

            /**
             * Created on the way down rather than on release, so what is being
             * dragged is a real guide from the first pixel - and letting go
             * without moving leaves one where it was pressed, which is a
             * legitimate way to place one exactly.
             */
            const at = addGuide(getLayout(), axis, point[axis]);
            if (at === null) return false;

            drag = {
                mode: 'guide', axis, at, created: true, moved: false,
                key: `guide:${++gesture}`
            };

            capture(event);
            commit({ live: true, key: drag.key });
            return true;
        }

        /**
         * On the page. The line itself is the handle, but a one-pixel target is
         * no target - guideNear is what gives it something to grab.
         */
        if (!event.target.closest?.('.dz-page')) return false;

        for (const axis of ['x', 'y']) {
            const at = guideNear(getLayout(), axis, point[axis]);
            if (at === null) continue;

            drag = {
                mode: 'guide', axis, at, created: false, moved: false,
                key: `guide:${++gesture}`
            };

            capture(event);
            return true;
        }

        return false;
    }


    /** the pointer plumbing every gesture shares */
    function capture(event) {
        canvas.setPointerCapture?.(event.pointerId);
        canvas.classList.add('is-dragging');
        event.preventDefault();
    }


    function begin(event, what) {
        /**
         * Every selected item's starting box, so the whole group moves by one
         * delta rather than each item accumulating its own rounding.
         */
        const group = what.mode === 'move'
            ? chosen().map(entry => ({ ...entry, box: itemBox(entry.item) }))
            : [];

        drag = {
            ...what,
            group,
            band: head()?.where.band ?? null,
            target: null,
            startX: event.clientX,
            startY: event.clientY,
            box: what.item ? itemBox(what.item) : null,
            moved: false
        };

        /**
         * Capture on the canvas, so a pointer that leaves the page - or the
         * window - keeps reporting. Without it a fast drag ends wherever the
         * cursor crossed the edge and the item is left mid-gesture.
         */
        capture(event);
    }

    function onPointerMove(event) {
        if (!drag) return;

        if (drag.mode === 'guide') {
            const point = paperPoint(event);
            if (!point) return;

            drag.moved = true;
            drag.at = moveGuide(getLayout(), drag.axis, drag.at, point[drag.axis]);

            /**
             * Live, so the sheet is not rebuilt sixty times a second for a line
             * that moved - the same reason an item drag patches. Under a key of
             * its own, so the whole gesture is one undo step and it does not
             * merge with the item move that may have come before it.
             */
            commit({ live: true, key: drag.key });
            return;
        }

        const zoom = getZoom() || 1;
        const dx = (event.clientX - drag.startX) / zoom;
        const dy = (event.clientY - drag.startY) / zoom;

        setMeasuring(event.altKey);

        if (!drag.moved && Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        drag.moved = true;

        if (drag.mode === 'resize') {
            applyBox(drag.item, resizeBy(
                drag.handle, drag.box, dx, dy, resizableAxes(drag.item)));

            commit({ live: true });
            return;
        }

        /**
         * Every item moves by the same delta from its own starting box, so a
         * group keeps its shape - applying the delta to wherever each item has
         * got to would let rounding pull them apart over a long drag.
         */
        for (const entry of drag.group) {
            applyBox(entry.item, { ...entry.box, ...moveTo(entry.box, dx, dy) });
        }

        /**
         * Then the correction, from whatever the group has come to rest nearly
         * level with. It is applied on top of the grid rather than instead of
         * it: the grid is what a drag does in open space, and an item beside
         * something is being lined up with the something, not with the grid.
         *
         * Worked out from the boxes rather than from the pointer, and applied
         * to the whole group as one delta, so the group keeps its shape here
         * too - and because the move above always starts from `entry.box`, a
         * snap can be dragged out of again without it accumulating.
         */
        showGuides(drag.group);

        /**
         * Which band each is over now. Worked out from the items' own positions
         * rather than the pointer's, so it needs no measurement of the page and
         * agrees exactly with where they are drawn.
         */
        const layout = getLayout();
        const over = new Set();

        for (const entry of drag.group) {
            const to = bandUnder(layout, entry.where.band, entry.item);
            if (to && to !== entry.where.band) over.add(to);
        }

        drag.target = over.size ? [...over] : null;
        onTarget(drag.target);

        commit({ live: true });
    }

    /**
     * Lines the dragged group up with its neighbours and says what it found.
     *
     * The guides themselves are always drawn: they are the explanation for the
     * item having jumped the last few pixels on its own, and a snap nobody can
     * see is a drag that will not go where it is put. The measurements are the
     * ones alt asks for.
     *
     * @param {object[]} group the drag's entries, already moved by the pointer
     */
    function showGuides(group) {
        const band = drag?.band ? bandBox(getLayout(), drag.band) : null;

        if (!band || !group.length) {
            onGuides(null);
            return;
        }

        const others = neighbours(drag.band, group);

        const found = guidesFor(
            group.map(entry => itemBox(entry.item)), others, band,
            { guides: rulers() ? guidesInBand(getLayout(), band) : undefined });

        if (found.dx || found.dy) {
            for (const entry of group) {
                applyBox(entry.item, {
                    ...itemBox(entry.item),
                    x: (entry.item.x ?? 0) + found.dx,
                    y: (entry.item.y ?? 0) + found.dy
                });
            }
        }

        onGuides({
            band: drag.band,
            lines: found.lines,
            gaps: measuring ? found.gaps : []
        });
    }


    /**
     * The distances around the selection, without touching it.
     *
     * This is alt held over something already placed - the question is how far
     * it is from its neighbours, not where it should go - so nothing is snapped
     * and no alignment guide is drawn. Measuring a thing must not move it.
     */
    function measureSelection() {
        const group = chosen();
        const where = group.at(-1)?.where ?? null;
        const band = where ? bandBox(getLayout(), where.band) : null;

        if (!band || !group.length) {
            onGuides(null);
            return;
        }

        const boxes = group.map(entry => itemBox(entry.item));

        onGuides({
            band: where.band,
            lines: [],
            gaps: gapsAround(unionBox(boxes), neighbours(where.band, group), band)
        });
    }


    /**
     * Redraws whatever the gesture in progress is entitled to show. Called
     * whenever alt changes, from either side of a drag: during one the group is
     * what is being measured, and outside one the selection is.
     */
    function refreshGuides() {
        if (drag?.mode === 'move') {
            showGuides(drag.group);
            return;
        }

        if (measuring) {
            measureSelection();
            return;
        }

        onGuides(null);
    }


    /**
     * Records whether alt is down.
     *
     * It is read off the pointer as well as off the keyboard: a key pressed
     * while the pointer is captured does not reliably arrive as a keystroke on
     * the document, and every pointer event carries the modifier anyway - so
     * the pointer is the better source during a drag, and the keyboard covers
     * the case where the pointer is not moving.
     *
     * @param {boolean} held
     * @returns {boolean} whether it changed
     */
    function setMeasuring(held) {
        if (held === measuring) return false;

        measuring = held;
        return true;
    }


    function onPointerUp(event) {
        if (!drag) return;

        canvas.releasePointerCapture?.(event.pointerId);
        canvas.classList.remove('is-dragging');

        if (drag.mode === 'guide') {
            const { axis, at, key } = drag;
            drag = null;

            /**
             * Off the printable area is how a guide is thrown away - dragged
             * back over the ruler it came from, or past the far edge. A guide
             * outside the page cannot line anything up with anything.
             */
            const span = paperSpan(axis);

            if (at === null || at < 0 || (span !== null && at > span)) {
                removeGuide(getLayout(), axis, at);
            }

            commit({ live: false, key });
            return;
        }

        const moved = drag.moved;
        const landing = drag.target;
        const collapseTo = drag.collapseTo;
        drag = null;

        onTarget(null);
        setMeasuring(event.altKey);

        if (moved) {
            commit({ live: false, band: landing });
        } else if (collapseTo) {
            /** a click on a member of a group, that turned out not to be a drag */
            select(collapseTo);
        }

        /**
         * Last, because both of those redraw the sheet and the guides live in a
         * layer of it. Alt still being down is still a question being asked -
         * the mouse came up, the key did not - so the answer is drawn again for
         * whatever the selection has become.
         */
        refreshGuides();
    }

    /**
     * How far the printable area runs on one axis, for deciding whether a guide
     * has been dragged off it.
     *
     * @param {'x'|'y'} axis
     * @returns {number|null} null when the page is not drawn
     */
    function paperSpan(axis) {
        const page = getLayout()?.page;
        if (!page?.margin) return null;

        return axis === 'x'
            ? page.width - page.margin.left - page.margin.right
            : page.height - page.margin.top - page.margin.bottom;
    }


    /**
     * Nudge. A designer without arrow keys feels broken the first time someone
     * wants a box one pixel over, and the grid step is what the drag uses, so
     * the two agree.
     */
    function onKeyDown(event) {
        if (!enabled()) return;

        /**
         * A keystroke aimed at the properties rail is not aimed at the canvas.
         * Checked first, and for escape too: dropping the selection while
         * someone is typing into it would take the rail out from under them.
         */
        if (event.target.closest?.('input, textarea, select')) return;

        /**
         * Alt on its own asks to see the distances rather than to do anything,
         * so the keystroke is swallowed - Windows would otherwise read it as a
         * reach for the browser's menu bar and take the focus off the canvas.
         */
        if (event.key === 'Alt') {
            if (setMeasuring(true)) refreshGuides();
            event.preventDefault();
            return;
        }

        if (event.key === 'Escape') {
            select(null);
            return;
        }

        if (event.key === 'Delete' || event.key === 'Backspace') {
            if (!chosen().length) return;

            event.preventDefault();
            remove();
            return;
        }

        const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!step) return;

        const group = chosen();
        if (!group.length) return;

        const scale = event.shiftKey ? GRID : 1;

        for (const { item } of group) {
            item.x = (item.x ?? 0) + step[0] * scale;
            item.y = (item.y ?? 0) + step[1] * scale;
        }

        event.preventDefault();
        commit({ live: false });
    }

    function onKeyUp(event) {
        if (event.key !== 'Alt') return;

        if (setMeasuring(false)) refreshGuides();
    }


    /**
     * A window that loses the focus never sees the key come up - alt-tab is the
     * obvious way to lose it - and the measurements would be left on screen
     * with nobody holding anything down.
     */
    function onBlur() {
        if (setMeasuring(false)) refreshGuides();
    }


    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    doc.addEventListener('keydown', onKeyDown);
    doc.addEventListener('keyup', onKeyUp);
    doc.defaultView?.addEventListener('blur', onBlur);

    return function detach() {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        doc.removeEventListener('keydown', onKeyDown);
        doc.removeEventListener('keyup', onKeyUp);
        doc.defaultView?.removeEventListener('blur', onBlur);
    };
}

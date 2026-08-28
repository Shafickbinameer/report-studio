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
import { bandUnder } from './canvas.js';


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
 * @returns {() => void} detaches every listener
 */
export function attachEditing({
    canvas, getLayout, getSelection, select, commit,
    remove = () => { }, duplicate = () => false,
    getZoom = () => 1, enabled = () => true, onTarget = () => { }
}) {
    /** the drag in progress, or null */
    let drag = null;

/**
 * The document the screen is mounted in, which is not always this one: a
 * designer or a viewer opened in its own window lives in that window's
 * document, and a listener put on the opener's would never hear it.
 */
    const doc = canvas.ownerDocument;

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
        canvas.setPointerCapture?.(event.pointerId);
        canvas.classList.add('is-dragging');
        event.preventDefault();
    }

    function onPointerMove(event) {
        if (!drag) return;

        const zoom = getZoom() || 1;
        const dx = (event.clientX - drag.startX) / zoom;
        const dy = (event.clientY - drag.startY) / zoom;

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

    function onPointerUp(event) {
        if (!drag) return;

        canvas.releasePointerCapture?.(event.pointerId);
        canvas.classList.remove('is-dragging');

        const moved = drag.moved;
        const landing = drag.target;
        const collapseTo = drag.collapseTo;
        drag = null;

        onTarget(null);

        if (moved) {
            commit({ live: false, band: landing });
            return;
        }

        /** a click on a member of a group, that turned out not to be a drag */
        if (collapseTo) select(collapseTo);
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

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    doc.addEventListener('keydown', onKeyDown);

    return function detach() {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        doc.removeEventListener('keydown', onKeyDown);
    };
}

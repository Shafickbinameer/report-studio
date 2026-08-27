/**
 * history.js is undo and redo: an array of layout snapshots and an index into
 * it. Spec 6 chose this over a state library, and it is the right size for the
 * job - the layout is one small plain object, so a snapshot is a clone.
 *
 * The one thing that needs thought is typing. The rail's controls are bound
 * live, so "250" typed into a width arrives as three edits, and three undo
 * steps to get back past one number is not undo, it is punishment. Consecutive
 * edits carrying the same `coalesce` key replace the top snapshot instead of
 * stacking on it, so a burst of typing is one step and moving to another
 * control starts the next.
 *
 * Coalescing on a key rather than on elapsed time is deliberate: it needs no
 * timer, behaves the same however fast someone types, and can be specified.
 */


/** far more than anyone reaches for, and small enough to hold clones of */
const LIMIT = 100;


const clone = (value) => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);


/**
 * @param {object} initial the layout as it stands now
 * @param {object} [options]
 * @param {number} [options.limit] how many steps to keep
 * @returns {object} the history
 */
export function createHistory(initial, { limit = LIMIT } = {}) {
    let stack = [clone(initial)];
    let index = 0;
    /** what produced the entry on top, so a burst can be recognised */
    let topKey = null;

    return {
        /**
         * Records a change.
         *
         * @param {object} layout the layout as it now is
         * @param {string|null} [key] edits sharing a key coalesce into one step
         * @returns {boolean} whether a step was recorded
         */
        push(layout, key = null) {
            if (same(layout, stack[index])) return false;

            /**
             * A new change abandons whatever was redoable - the future it led
             * to is not reachable from here any more.
             */
            if (index < stack.length - 1) {
                stack = stack.slice(0, index + 1);
                topKey = null;
            }

            if (key != null && key === topKey) {
                stack[index] = clone(layout);
                return true;
            }

            stack.push(clone(layout));
            index++;
            topKey = key;

            if (stack.length > limit) {
                stack.shift();
                index--;
            }

            return true;
        },

        /**
         * @returns {object|null} the layout to go back to, or null at the start
         */
        undo() {
            if (index === 0) return null;

            index--;
            /** the burst is over; the next edit starts its own step */
            topKey = null;

            return clone(stack[index]);
        },

        /**
         * @returns {object|null} the layout to go forward to, or null at the end
         */
        redo() {
            if (index >= stack.length - 1) return null;

            index++;
            topKey = null;

            return clone(stack[index]);
        },

        get canUndo() { return index > 0; },
        get canRedo() { return index < stack.length - 1; },

        /** how many steps are held, for the specs to look at */
        get length() { return stack.length; },

        /** a different report is a different history, not a continuation */
        reset(layout) {
            stack = [clone(layout)];
            index = 0;
            topKey = null;
        }
    };
}

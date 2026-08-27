/**
 * Undo and redo: an array of snapshots and an index into it. No DOM - the
 * designer's wiring is specified in save.test.js.
 */

import { describe, it, expect } from 'vitest';
import { createHistory } from '../src/designer/history.js';

const at = (n) => ({ name: 'r', value: n });


describe('recording', () => {
    it('starts with nowhere to go', () => {
        const history = createHistory(at(0));

        expect(history.canUndo).toBe(false);
        expect(history.canRedo).toBe(false);
    });

    it('records a change', () => {
        const history = createHistory(at(0));

        expect(history.push(at(1))).toBe(true);
        expect(history.canUndo).toBe(true);
    });

    it('ignores a push that changed nothing', () => {
        /** a drag that ended where it started is not a step to undo */
        const history = createHistory(at(0));

        expect(history.push(at(0))).toBe(false);
        expect(history.canUndo).toBe(false);
    });

    it('snapshots rather than holding the object', () => {
        const layout = at(0);
        const history = createHistory(layout);

        layout.value = 99;
        history.push(at(1));

        expect(history.undo()).toEqual(at(0));
    });

    it('hands back a copy, so the caller cannot edit the past', () => {
        const history = createHistory(at(0));
        history.push(at(1));

        const restored = history.undo();
        restored.value = 42;

        expect(history.redo()).toEqual(at(1));
        expect(history.undo()).toEqual(at(0));
    });
});


describe('stepping', () => {
    const three = () => {
        const history = createHistory(at(0));
        history.push(at(1));
        history.push(at(2));
        return history;
    };

    it('walks back one step at a time', () => {
        const history = three();

        expect(history.undo()).toEqual(at(1));
        expect(history.undo()).toEqual(at(0));
    });

    it('stops at the beginning', () => {
        const history = three();
        history.undo();
        history.undo();

        expect(history.undo()).toBeNull();
        expect(history.canUndo).toBe(false);
    });

    it('walks forward again', () => {
        const history = three();
        history.undo();
        history.undo();

        expect(history.redo()).toEqual(at(1));
        expect(history.redo()).toEqual(at(2));
    });

    it('stops at the end', () => {
        const history = three();

        expect(history.redo()).toBeNull();
        expect(history.canRedo).toBe(false);
    });

    it('drops the redoable future when a new change is made', () => {
        /** the future it led to is not reachable from here any more */
        const history = three();
        history.undo();

        expect(history.canRedo).toBe(true);
        history.push(at(9));

        expect(history.canRedo).toBe(false);
        expect(history.undo()).toEqual(at(1));
    });
});


describe('coalescing', () => {
    it('folds consecutive edits from the same control into one step', () => {
        /**
         * Typing "250" into a width arrives as three edits. Three undo presses
         * to get back past one number is not undo, it is punishment.
         */
        const history = createHistory(at(0));

        history.push(at(2), 'field:w');
        history.push(at(25), 'field:w');
        history.push(at(250), 'field:w');

        expect(history.undo()).toEqual(at(0));
        expect(history.canUndo).toBe(false);
    });

    it('keeps the latest value of the burst when redone', () => {
        const history = createHistory(at(0));

        history.push(at(2), 'field:w');
        history.push(at(250), 'field:w');
        history.undo();

        expect(history.redo()).toEqual(at(250));
    });

    it('starts a new step when the control changes', () => {
        const history = createHistory(at(0));

        history.push(at(1), 'field:w');
        history.push(at(2), 'field:h');

        expect(history.undo()).toEqual(at(1));
        expect(history.undo()).toEqual(at(0));
    });

    it('does not coalesce edits with no key', () => {
        const history = createHistory(at(0));

        history.push(at(1));
        history.push(at(2));

        expect(history.undo()).toEqual(at(1));
    });

    it('will not fold a burst into a step that was undone past', () => {
        const history = createHistory(at(0));

        history.push(at(1), 'field:w');
        history.undo();
        history.push(at(5), 'field:w');

        expect(history.undo()).toEqual(at(0));
    });
});


describe('the limit', () => {
    it('drops the oldest steps rather than growing without end', () => {
        const history = createHistory(at(0), { limit: 5 });

        for (let n = 1; n <= 20; n++) history.push(at(n));

        expect(history.length).toBe(5);
        expect(history.canUndo).toBe(true);
    });

    it('still walks back through what it kept', () => {
        const history = createHistory(at(0), { limit: 3 });

        for (let n = 1; n <= 5; n++) history.push(at(n));

        expect(history.undo()).toEqual(at(4));
        expect(history.undo()).toEqual(at(3));
        expect(history.undo()).toBeNull();
    });
});


describe('reset', () => {
    it('starts over, because another report is not a continuation of this one', () => {
        const history = createHistory(at(0));
        history.push(at(1));

        history.reset(at(100));

        expect(history.canUndo).toBe(false);
        expect(history.canRedo).toBe(false);
        expect(history.length).toBe(1);
    });
});

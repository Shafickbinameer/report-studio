/**
 * @vitest-environment jsdom
 *
 * Margins that can be switched off - all at once or a side at a time - and a
 * lock that makes the four one number.
 *
 * Off is stored as 0 in page.margin, with the old value kept in
 * page.marginOff, so everything that prints reads page.margin as it always
 * did. These specs pin that down at three levels: the pure functions, the
 * validator, and the rail in a running designer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    reportFields, readField, writeField, marginIsOn,
    setMarginOn, setMarginsOn, setMarginValue, setMarginLinked
} from '../src/designer/fields.js';
import { validateLayout } from '../src/engine/validate.js';
import { createDesigner } from '../src/designer/designer.js';
import { layout, text, band } from './helpers/layout.js';

const page = (margin = { top: 40, right: 30, bottom: 20, left: 10 }, extra = {}) =>
    ({ width: 794, height: 1123, margin: { ...margin }, ...extra });

const marginFields = (l) => reportFields(l).find(s => s.title === 'Margins').fields;
const field = (l, key) => marginFields(l).find(f => f.key === key);


describe('margins - switching a side off and on', () => {
    it('prints a side switched off as 0 and keeps what it was', () => {
        const p = page();

        expect(setMarginOn(p, 'left', false)).toBe(true);

        expect(p.margin.left).toBe(0);
        expect(p.marginOff).toEqual({ left: 10 });
        expect(marginIsOn(p, 'left')).toBe(false);
        expect(marginIsOn(p, 'top')).toBe(true);
    });

    it('puts the old value back when switched on, and leaves no trace', () => {
        const p = page();
        setMarginOn(p, 'left', false);

        expect(setMarginOn(p, 'left', true)).toBe(true);

        expect(p.margin.left).toBe(10);
        expect(p).not.toHaveProperty('marginOff');
    });

    it('reports no change when the side is already that way', () => {
        const p = page();
        expect(setMarginOn(p, 'top', true)).toBe(false);

        setMarginOn(p, 'top', false);
        expect(setMarginOn(p, 'top', false)).toBe(false);
        expect(p.marginOff).toEqual({ top: 40 });
    });
});


describe('margins - all of them at once', () => {
    it('switches every side off, keeping each one', () => {
        const p = page();

        expect(setMarginsOn(p, false)).toBe(true);

        expect(p.margin).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
        expect(p.marginOff).toEqual({ top: 40, right: 30, bottom: 20, left: 10 });
    });

    it('brings every side back with its own value', () => {
        const p = page();
        setMarginsOn(p, false);
        setMarginsOn(p, true);

        expect(p.margin).toEqual({ top: 40, right: 30, bottom: 20, left: 10 });
        expect(p).not.toHaveProperty('marginOff');
    });

    it('reads as on while any side is, and clears the rest when switched off', () => {
        const l = { page: page() };
        const all = field(l, 'page.marginsOn');

        setMarginOn(l.page, 'top', false);
        expect(readField(l, all)).toBe(true);

        writeField(l, all, false);
        expect(readField(l, all)).toBe(false);
        expect(l.page.marginOff).toEqual({ top: 40, right: 30, bottom: 20, left: 10 });
    });
});


describe('margins - a side\'s number', () => {
    it('writes a side that is on straight onto the page', () => {
        const p = page();

        expect(setMarginValue(p, 'right', 50)).toBe(true);
        expect(p.margin.right).toBe(50);
    });

    it('keeps the number for a side that is off, and still prints 0', () => {
        const p = page();
        setMarginOn(p, 'right', false);

        setMarginValue(p, 'right', 50);

        expect(p.margin.right).toBe(0);
        expect(p.marginOff.right).toBe(50);

        setMarginOn(p, 'right', true);
        expect(p.margin.right).toBe(50);
    });

    it('shows a side that is off with the number it comes back as', () => {
        const l = { page: page() };
        setMarginOn(l.page, 'bottom', false);

        expect(readField(l, field(l, 'page.margin.bottom'))).toBe(20);
    });

    it('marks the box of a side that is off as not editable', () => {
        const l = { page: page() };
        setMarginOn(l.page, 'bottom', false);

        expect(field(l, 'page.margin.bottom').disabled).toBe(true);
        expect(field(l, 'page.margin.top').disabled).toBe(false);
    });

    it('refuses an empty box and floors at 0, as every number does', () => {
        const l = { page: page() };
        const top = field(l, 'page.margin.top');

        expect(writeField(l, top, '')).toBe(false);

        writeField(l, top, '-5');
        expect(l.page.margin.top).toBe(0);
    });
});


describe('margins - the lock', () => {
    it('makes the four sides the first one that prints', () => {
        const p = page();

        expect(setMarginLinked(p, true)).toBe(true);

        expect(p.marginLinked).toBe(true);
        expect(p.margin).toEqual({ top: 40, right: 40, bottom: 40, left: 40 });
    });

    it('takes its number from the first side that is on', () => {
        const p = page();
        setMarginOn(p, 'top', false);

        setMarginLinked(p, true);

        /** right was 30; top is off, so it keeps 30 for when it comes back */
        expect(p.margin).toEqual({ top: 0, right: 30, bottom: 30, left: 30 });
        expect(p.marginOff).toEqual({ top: 30 });
    });

    it('writes a number typed into one side to all four while locked', () => {
        const p = page();
        setMarginLinked(p, true);
        setMarginOn(p, 'left', false);

        setMarginValue(p, 'top', 24);

        expect(p.margin).toEqual({ top: 24, right: 24, bottom: 24, left: 0 });
        expect(p.marginOff).toEqual({ left: 24 });
    });

    it('leaves the sides alone when unlocked, and takes the key off the page', () => {
        const p = page();
        setMarginLinked(p, true);

        expect(setMarginLinked(p, false)).toBe(true);
        expect(p).not.toHaveProperty('marginLinked');

        setMarginValue(p, 'top', 12);
        expect(p.margin).toEqual({ top: 12, right: 40, bottom: 40, left: 40 });
    });
});


describe('margins - the validator', () => {
    const withPage = (extra, margin) => {
        const l = layout({ bands: [band('detail', [])] });
        l.page = { ...l.page, ...extra, ...(margin ? { margin } : {}) };
        return l;
    };

    it('accepts margins switched off and the lock', () => {
        expect(validateLayout(withPage(
            { marginOff: { left: 40 }, marginLinked: true },
            { top: 40, right: 40, bottom: 40, left: 0 }
        ))).toEqual([]);
    });

    it('accepts a page with neither key, as every report before them had', () => {
        expect(validateLayout(withPage({}))).toEqual([]);
    });

    it('catches a side said to be off that still prints a margin', () => {
        const issues = validateLayout(withPage({ marginOff: { left: 40 } }));

        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatch(/margin\.left must be 0/);
    });

    it('catches a side that is not a side, and a value that is not pixels', () => {
        const issues = validateLayout(withPage(
            { marginOff: { middle: 4, top: 'wide' } },
            { top: 0, right: 40, bottom: 40, left: 40 }
        ));

        expect(issues.some(i => /marginOff\.middle is not a side/.test(i))).toBe(true);
        expect(issues.some(i => /marginOff\.top must be a number/.test(i))).toBe(true);
    });

    it('catches a lock that is not true or false', () => {
        expect(validateLayout(withPage({ marginLinked: 'yes' })))
            .toEqual(['layout.page.marginLinked must be true or false']);
    });
});


describe('margins - in the rail', () => {
    let designer = null;

    beforeEach(() => {
        vi.spyOn(console, 'debug').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        document.body.innerHTML = '<div id="report-designer"></div>';

        designer = createDesigner({
            mount: '#report-designer',
            layout: layout({ bands: [band('detail', [text('t1', { x: 0, y: 0, w: 100, h: 20 })])] })
        });
    });

    afterEach(() => {
        designer?.destroy();
        designer = null;
        vi.restoreAllMocks();
    });

    const root = () => document.getElementById('report-designer');
    const control = (key) => root().querySelector(`.dz-panel [data-field="${key}"]`);
    const sheet = () => root().querySelector('.dz-page');

    function flip(key, on) {
        const box = control(key);
        box.checked = on;
        box.dispatchEvent(new Event('change', { bubbles: true }));
    }

    it('shows a switch for all margins, the lock, and one per side', () => {
        expect(control('page.marginsOn').checked).toBe(true);
        expect(control('page.marginLinked').checked).toBe(false);

        for (const side of ['top', 'right', 'bottom', 'left']) {
            expect(control(`page.marginOn.${side}`).checked).toBe(true);
            expect(control(`page.margin.${side}`).disabled).toBe(false);
        }
    });

    it('switching a side off takes it off the page and greys its box', () => {
        flip('page.marginOn.left', false);

        expect(designer.layout.page.margin.left).toBe(0);
        expect(sheet().getAttribute('style')).toContain('padding-left:0px');

        expect(control('page.margin.left').disabled).toBe(true);
        expect(control('page.margin.left').value).toBe('40');
    });

    it('switching all off and on again restores every side', () => {
        flip('page.marginsOn', false);

        expect(designer.layout.page.margin).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
        expect(control('page.marginOn.top').checked).toBe(false);

        flip('page.marginsOn', true);
        expect(designer.layout.page.margin).toEqual({ top: 40, right: 40, bottom: 40, left: 40 });
    });

    it('a number typed into one side goes to all four while locked', () => {
        flip('page.marginLinked', true);

        const top = control('page.margin.top');
        top.focus();
        top.value = '16';
        top.dispatchEvent(new Event('input', { bubbles: true }));

        expect(designer.layout.page.margin).toEqual({ top: 16, right: 16, bottom: 16, left: 16 });

        /**
         * And the other three boxes say so. They used to keep showing the old
         * number - the page had all four at 16 while the rail said 16, 40, 40,
         * 40 - so the lock looked as if it had done nothing.
         */
        for (const side of ['right', 'bottom', 'left']) {
            expect(control(`page.margin.${side}`).value).toBe('16');
        }

        /** the box being typed in keeps the focus, so the next digit lands */
        expect(document.activeElement).toBe(control('page.margin.top'));
    });

    it('undo brings a side back, switch and all', () => {
        flip('page.marginOn.top', false);
        root().querySelector('[data-action="undo"]').click();

        expect(designer.layout.page.margin.top).toBe(40);
        expect(designer.layout.page).not.toHaveProperty('marginOff');
        expect(control('page.marginOn.top').checked).toBe(true);
        expect(control('page.margin.top').disabled).toBe(false);
    });
});

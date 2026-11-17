/**
 * @vitest-environment jsdom
 *
 * The zoom control is a listbox rather than a <select>, because option items
 * are drawn by the operating system and cannot take the report's palette. That
 * means the behaviour a <select> gave for free is now ours to get right.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDropdown } from '../src/shared/dropdown.js';
import { chrome } from '../src/preview/chrome.js';

/**
 * The zoom control's real markup, taken from the chrome the viewer builds - so
 * these specs cannot drift from the thing that ships. It used to be sliced out
 * of preview/index.html, which is now one empty div.
 */
const HTML = chrome();

const MARKUP = HTML.slice(
    HTML.indexOf('<div class="dropdown"'),
    HTML.indexOf('</div>', HTML.indexOf('</ul>')) + '</div>'.length
);

let dropdown;

const trigger = () => document.querySelector('.dropdown-trigger');
const menu = () => document.querySelector('.dropdown-menu');
const items = () => [...document.querySelectorAll('.dropdown-item')];
const item = (value) => document.querySelector(`.dropdown-item[data-value="${value}"]`);
const label = () => document.querySelector('.dropdown-value').textContent.trim();
const selected = () => document.querySelector('.dropdown-item[aria-selected="true"]');

function mount() {
    document.body.innerHTML = MARKUP;
    dropdown = createDropdown(document.querySelector('.dropdown'));
    return dropdown;
}

const key = (target, k, opts = {}) =>
    target.dispatchEvent(new KeyboardEvent('keydown',
        { key: k, bubbles: true, cancelable: true, ...opts }));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
    dropdown?.destroy();
    dropdown = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('dropdown - markup', () => {
    it('picks up every option from the page', () => {
        mount();
        expect(items().map(i => i.dataset.value))
            .toEqual(['fit', '0.5', '0.75', '1', '1.25', '1.5', '2', '3']);
    });

    it('starts on the option marked selected', () => {
        mount();
        expect(dropdown.value).toBe('1');
        expect(label()).toBe('100%');
        expect(selected()).toBe(item('1'));
    });

    it('starts closed', () => {
        mount();
        expect(dropdown.isOpen).toBe(false);
        expect(menu().hidden).toBe(true);
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
    });
});

describe('dropdown - opening and closing', () => {
    it('opens on the trigger', () => {
        mount();
        trigger().click();

        expect(dropdown.isOpen).toBe(true);
        expect(menu().hidden).toBe(false);
        expect(trigger().getAttribute('aria-expanded')).toBe('true');
    });

    it('closes on a second click', () => {
        mount();
        trigger().click();
        trigger().click();

        expect(dropdown.isOpen).toBe(false);
    });

    it('closes on Escape and hands focus back to the trigger', () => {
        mount();
        trigger().click();
        key(menu(), 'Escape');

        expect(dropdown.isOpen).toBe(false);
        expect(document.activeElement).toBe(trigger());
    });

    it('closes on a click outside', () => {
        mount();
        trigger().click();

        /** the opening click must not close it again on its way up */
        vi.runAllTimers();
        expect(dropdown.isOpen).toBe(true);

        document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(dropdown.isOpen).toBe(false);
    });

    it('stays open when the click is inside the menu', () => {
        mount();
        trigger().click();
        vi.runAllTimers();

        menu().dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(dropdown.isOpen).toBe(true);
    });

    it('opens on ArrowDown from the trigger', () => {
        mount();
        trigger().focus();
        key(trigger(), 'ArrowDown');

        expect(dropdown.isOpen).toBe(true);
    });
});

describe('dropdown - choosing', () => {
    it('selects on click and closes', () => {
        mount();
        trigger().click();
        item('1.5').click();

        expect(dropdown.value).toBe('1.5');
        expect(label()).toBe('150%');
        expect(dropdown.isOpen).toBe(false);
    });

    it('moves the selected mark with the choice', () => {
        mount();
        trigger().click();
        item('2').click();

        expect(selected()).toBe(item('2'));
        expect(document.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
    });

    it('tells listeners once, and only on a real change', () => {
        mount();
        const onChange = vi.fn();
        dropdown.addEventListener('change', onChange);

        trigger().click();
        item('2').click();
        expect(onChange).toHaveBeenCalledOnce();

        trigger().click();
        item('2').click();
        expect(onChange).toHaveBeenCalledOnce();
    });

    it('does not tell listeners when set from code', () => {
        mount();
        const onChange = vi.fn();
        dropdown.addEventListener('change', onChange);

        dropdown.value = '3';

        expect(dropdown.value).toBe('3');
        expect(label()).toBe('300%');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('ignores a value it does not offer', () => {
        mount();
        dropdown.value = '99';
        expect(dropdown.value).toBe('1');
    });
});

describe('dropdown - keyboard', () => {
    it('opens on the option already chosen, the way a select does', () => {
        mount();
        trigger().click();
        expect(document.activeElement).toBe(item('1'));
    });

    it('walks the options with the arrows', () => {
        mount();
        trigger().click();

        key(menu(), 'ArrowDown');
        expect(document.activeElement).toBe(item('1.25'));

        key(menu(), 'ArrowUp');
        expect(document.activeElement).toBe(item('1'));
    });

    it('wraps at both ends', () => {
        mount();
        trigger().click();

        key(menu(), 'Home');
        expect(document.activeElement).toBe(item('fit'));

        key(menu(), 'ArrowUp');
        expect(document.activeElement).toBe(item('3'));
    });

    it('jumps to the ends with Home and End', () => {
        mount();
        trigger().click();

        key(menu(), 'End');
        expect(document.activeElement).toBe(item('3'));
    });

    it('chooses the focused option on Enter', () => {
        mount();
        trigger().click();
        key(menu(), 'ArrowDown');
        key(menu(), 'Enter');

        expect(dropdown.value).toBe('1.25');
        expect(dropdown.isOpen).toBe(false);
    });

    it('closes on Tab without swallowing the key', () => {
        mount();
        trigger().click();

        const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        menu().dispatchEvent(event);

        expect(dropdown.isOpen).toBe(false);
        expect(event.defaultPrevented).toBe(false);
    });

    it('keeps its arrow keys to itself, so the report does not page', () => {
        mount();
        const onDocumentKey = vi.fn();
        document.addEventListener('keydown', onDocumentKey);

        trigger().click();
        key(menu(), 'ArrowDown');

        expect(onDocumentKey).not.toHaveBeenCalled();
        document.removeEventListener('keydown', onDocumentKey);
    });
});

/**
 * jsdom does no layout, so the boxes are given. The trigger is 100 x 32 at
 * (40, top); the menu reports a height and starts with its frame at 0,0.
 */
function layout({ top = 100, menuHeight = 200, winHeight = 800 } = {}) {
    vi.spyOn(trigger(), 'getBoundingClientRect').mockReturnValue({
        top, bottom: top + 32, left: 40, right: 140, width: 100, height: 32
    });
    vi.spyOn(menu(), 'getBoundingClientRect').mockReturnValue({
        top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0
    });
    vi.spyOn(menu(), 'offsetHeight', 'get').mockReturnValue(menuHeight);
    vi.spyOn(menu(), 'offsetWidth', 'get').mockReturnValue(100);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(winHeight);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200);
}

describe('dropdown - placing, inside something that scrolls', () => {
    it('opens under the trigger, at least as wide as it', () => {
        mount();
        layout();
        trigger().click();

        expect(menu().style.top).toBe('136px');
        expect(menu().style.left).toBe('40px');
        expect(menu().style.getPropertyValue('--dropdown-trigger-width')).toBe('100px');
        expect(menu().style.maxHeight).toBe('');
    });

    it('opens above the trigger when there is more room there', () => {
        mount();
        layout({ top: 700, menuHeight: 200 });
        trigger().click();

        /** 700 - 4 - 200 */
        expect(menu().style.top).toBe('496px');
    });

    it('is cut to the room it has, rather than running off the window', () => {
        mount();
        layout({ top: 100, menuHeight: 900, winHeight: 400 });
        trigger().click();

        /** 400 - 132 - 4 - 8 below beats 100 - 4 - 8 above */
        expect(menu().style.top).toBe('136px');
        expect(menu().style.maxHeight).toBe('256px');
    });

    it('focuses the chosen item without scrolling what is around it', () => {
        mount();
        const focus = vi.spyOn(item('1'), 'focus');
        trigger().click();

        expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it('closes when something around it scrolls, as a select does', () => {
        mount();
        const card = document.createElement('div');
        document.body.appendChild(card);
        trigger().click();

        card.dispatchEvent(new Event('scroll'));
        expect(dropdown.isOpen).toBe(false);
    });

    it('stays open while its own long list scrolls', () => {
        mount();
        trigger().click();

        menu().dispatchEvent(new Event('scroll'));
        expect(dropdown.isOpen).toBe(true);
    });

    it('closes when the window is resized', () => {
        mount();
        trigger().click();

        window.dispatchEvent(new Event('resize'));
        expect(dropdown.isOpen).toBe(false);
    });

    it('stops listening for scrolls once closed', () => {
        mount();
        const remove = vi.spyOn(document, 'removeEventListener');
        trigger().click();
        key(menu(), 'Escape');

        expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function), true);
    });
});

describe('dropdown - teardown', () => {
    it('drops its outside-click listener', () => {
        mount();
        trigger().click();
        vi.runAllTimers();

        dropdown.destroy();
        dropdown = null;

        /** nothing should throw once the handler is gone */
        expect(() => document.dispatchEvent(new Event('pointerdown', { bubbles: true })))
            .not.toThrow();
    });
});

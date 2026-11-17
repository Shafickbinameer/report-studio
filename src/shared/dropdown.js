/**
 * dropdown.js is a listbox that can actually be styled.
 *
 * A native <select> draws its options through the operating system, so the
 * items cannot be given the report's palette, spacing or selected state - which
 * is why this exists rather than more CSS on a <select>.
 *
 * It keeps the two members of the select API the viewer used - `value` and
 * addEventListener('change') - so swapping it in changed almost nothing there.
 *
 * The menu is fixed to the window and placed under its trigger when it opens,
 * not hung off the wrapper. A dialog's card scrolls, and a menu absolutely
 * positioned inside it was clipped by the card and stretched it instead - a
 * scrollbar on the card, another on the menu, and the wheel and the arrow keys
 * scrolling the dialog out from under the list. choice.js places its lists the
 * same way for the same reason.
 */


/** the space kept between the menu and the window's edges */
const EDGE = 8;

/** the space between the trigger and the menu */
const OFFSET = 4;


/**
 * @param {HTMLElement} root the .dropdown wrapper
 * @returns {object} a select-shaped handle over the listbox
 */
export function createDropdown(root) {
    const trigger = root.querySelector('.dropdown-trigger');
    const label = root.querySelector('.dropdown-value');
    const menu = root.querySelector('.dropdown-menu');
    const items = [...menu.querySelectorAll('.dropdown-item')];

    const listeners = new Set();

    /**
     * The document the dropdown is in, read when it is needed rather than kept:
     * a menu built before its host is attached has no owner yet, and one inside
     * a designer opened in its own window has a different one from this module.
     */
    const doc = () => trigger.ownerDocument;
    const view = () => doc().defaultView;

    let value = items.find(i => i.dataset.selected === 'true')?.dataset.value
        ?? items[0]?.dataset.value
        ?? '';
    let active = Math.max(items.findIndex(i => i.dataset.value === value), 0);

    /* ---------------- state ---------------- */

    function paint() {
        items.forEach((item, i) => {
            const selected = item.dataset.value === value;
            item.setAttribute('aria-selected', String(selected));
            item.classList.toggle('is-active', i === active);
        });

        const current = items.find(i => i.dataset.value === value);
        if (current) label.textContent = current.textContent.trim();
    }

    function setValue(next, { notify = false } = {}) {
        const item = items.find(i => i.dataset.value === String(next));
        if (!item) return;

        const changed = item.dataset.value !== value;
        value = item.dataset.value;
        active = items.indexOf(item);
        paint();

        if (notify && changed) for (const fn of listeners) fn();
    }

    /* ---------------- placing ---------------- */

    /**
     * Under the trigger, as wide as it at least, and inside the window: above
     * the trigger when there is more room there, and cut to a scrolling height
     * when neither side has room for all of it.
     */
    function place() {
        const box = trigger.getBoundingClientRect();
        const win = view();
        const { style } = menu;

        style.top = '0px';
        style.left = '0px';
        style.maxHeight = '';
        style.setProperty('--dropdown-trigger-width', `${box.width}px`);

        /**
         * Where 0,0 actually landed. A transformed ancestor - the designer's
         * floating foot is one - becomes a fixed element's frame instead of
         * the window, and this is how far that frame is from the window's.
         */
        const origin = menu.getBoundingClientRect();
        const height = menu.offsetHeight;
        const width = menu.offsetWidth;

        const below = win.innerHeight - box.bottom - OFFSET - EDGE;
        const above = box.top - OFFSET - EDGE;

        let top;
        if (height <= below || below >= above) {
            top = box.bottom + OFFSET;
            if (height > below) style.maxHeight = `${Math.max(below, 0)}px`;
        } else {
            if (height > above) style.maxHeight = `${above}px`;
            top = box.top - OFFSET - Math.min(height, above);
        }

        const left = Math.max(Math.min(box.left, win.innerWidth - width - EDGE), EDGE);

        style.top = `${Math.round(top - origin.top)}px`;
        style.left = `${Math.round(left - origin.left)}px`;
    }

    /**
     * Focus the item without the browser scrolling every box around it to
     * show it, then scroll the menu - and only the menu - so it is in view.
     */
    function reveal(item) {
        if (!item) return;

        item.focus({ preventScroll: true });

        const top = item.offsetTop;
        const bottom = top + item.offsetHeight;

        if (top < menu.scrollTop) menu.scrollTop = top;
        else if (bottom > menu.scrollTop + menu.clientHeight) {
            menu.scrollTop = bottom - menu.clientHeight;
        }
    }

    /* ---------------- opening ---------------- */

    const isOpen = () => !menu.hidden;

    function open() {
        if (isOpen()) return;

        menu.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');

        active = Math.max(items.findIndex(i => i.dataset.value === value), 0);
        paint();
        place();
        reveal(items[active]);

        /**
         * Registered on the next tick, or the click that opened the menu would
         * bubble up to this same handler and close it again straight away.
         */
        setTimeout(() => {
            if (isOpen()) doc().addEventListener('pointerdown', onOutside);
        }, 0);

        /**
         * The menu is fixed to the window, so anything that moves the trigger
         * - the dialog scrolling, the window resizing - would leave it behind.
         * It closes instead, as a native select does.
         */
        doc().addEventListener('scroll', onAway, true);
        view().addEventListener('resize', onAway);
    }

    function unlisten() {
        doc().removeEventListener('pointerdown', onOutside);
        doc().removeEventListener('scroll', onAway, true);
        view()?.removeEventListener('resize', onAway);
    }

    function close({ focusTrigger = true } = {}) {
        if (!isOpen()) return;

        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        unlisten();

        if (focusTrigger) trigger.focus();
    }

    function onOutside(event) {
        if (!root.contains(event.target)) close({ focusTrigger: false });
    }

    /** a long list scrolling inside itself is not the trigger moving */
    function onAway(event) {
        if (event.type === 'scroll' && menu.contains(event.target)) return;
        close({ focusTrigger: false });
    }

    function move(to) {
        active = (to + items.length) % items.length;
        paint();
        reveal(items[active]);
    }

    /* ---------------- events ---------------- */

    function onTriggerKey(event) {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
            event.preventDefault();
            /** the viewer pages the report on arrows; this one is ours */
            event.stopPropagation();
            open();
        }
    }

    function onMenuKey(event) {
        const handled = {
            ArrowDown: () => move(active + 1),
            ArrowUp: () => move(active - 1),
            Home: () => move(0),
            End: () => move(items.length - 1),
            Escape: () => close(),
            Enter: () => { setValue(items[active].dataset.value, { notify: true }); close(); },
            ' ': () => { setValue(items[active].dataset.value, { notify: true }); close(); },
            Tab: () => close({ focusTrigger: false })
        }[event.key];

        if (!handled) return;

        if (event.key !== 'Tab') {
            event.preventDefault();
            event.stopPropagation();
        }
        handled();
    }

    trigger.addEventListener('click', () => (isOpen() ? close() : open()));
    trigger.addEventListener('keydown', onTriggerKey);
    menu.addEventListener('keydown', onMenuKey);

    for (const item of items) {
        item.addEventListener('click', () => {
            setValue(item.dataset.value, { notify: true });
            close();
        });
    }

    paint();

    return {
        get value() { return value; },
        set value(next) { setValue(next); },

        /** the only event the viewer ever asked a <select> for */
        addEventListener(type, fn) {
            if (type === 'change') listeners.add(fn);
        },

        open,
        close,
        get isOpen() { return isOpen(); },

        destroy() {
            unlisten();
            listeners.clear();
        }
    };
}

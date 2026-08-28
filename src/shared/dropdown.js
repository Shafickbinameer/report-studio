/**
 * dropdown.js is a listbox that can actually be styled.
 *
 * A native <select> draws its options through the operating system, so the
 * items cannot be given the report's palette, spacing or selected state - which
 * is why this exists rather than more CSS on a <select>.
 *
 * It keeps the two members of the select API the viewer used - `value` and
 * addEventListener('change') - so swapping it in changed almost nothing there.
 */


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

    /* ---------------- opening ---------------- */

    const isOpen = () => !menu.hidden;

    function open() {
        if (isOpen()) return;

        menu.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');

        active = Math.max(items.findIndex(i => i.dataset.value === value), 0);
        paint();
        items[active]?.focus();

        /**
         * Registered on the next tick, or the click that opened the menu would
         * bubble up to this same handler and close it again straight away.
         */
        setTimeout(() => doc().addEventListener('pointerdown', onOutside), 0);
    }

    function close({ focusTrigger = true } = {}) {
        if (!isOpen()) return;

        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        doc().removeEventListener('pointerdown', onOutside);

        if (focusTrigger) trigger.focus();
    }

    function onOutside(event) {
        if (!root.contains(event.target)) close({ focusTrigger: false });
    }

    function move(to) {
        active = (to + items.length) % items.length;
        paint();
        items[active]?.focus();
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
            doc().removeEventListener('pointerdown', onOutside);
            listeners.clear();
        }
    };
}

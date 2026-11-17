/**
 * choice.js is a choice that can be styled: the box a design tool draws, over
 * a <select> that is still the control.
 *
 * A native select opens its list through the operating system, which no
 * stylesheet reaches - so the list was the one part of the designer that could
 * not look like the rest of it. The select stays, out of sight, and remains
 * what the code around it reads and listens to: its value is the value, and a
 * change is reported on it exactly as the select would report one. The button
 * in front only shows what it holds, and opens the shared menu (dropdown.css)
 * to choose from.
 *
 * Used by the properties rail and by the dialogs, so every choice in the
 * designer opens the same list.
 */

import { esc } from '../render/items.js';


/**
 * @param {string|null} id the button's id - what a <label for> points at. The
 *   label, when there is one, is expected at `${id}-label`
 * @param {string} attrs the select's own attributes: its binding, its role
 * @param {{value: string, label: string}[]} options
 * @param {*} value
 * @param {object} [names]
 * @param {string} [names.label] an accessible name, for a choice no label names
 * @returns {string} markup
 */
export function choiceBox(id, attrs, options, value, { label = '' } = {}) {
    const current = options.find(o => String(o.value) === String(value ?? '')) ?? options[0];

    const valueId = id ? `${id}-value` : '';

    /**
     * Named by its label and then its value, so a screen reader says "Font,
     * Helvetica" as it did for the select. A choice with no label element
     * says what it is from its own aria-label instead.
     */
    const naming = id && !label
        ? `aria-labelledby="${id}-label ${valueId}"`
        : `aria-label="${esc(label)}"`;

    return `
    <span class="dz-choice">
        <select class="dz-choice-native" ${attrs} tabindex="-1" aria-hidden="true">${options.map(o =>
            `<option value="${esc(o.value)}"${o === current ? ' selected' : ''}
                >${esc(o.label)}</option>`).join('')}</select>
        <button type="button" class="dz-choice-trigger"${id ? ` id="${id}"` : ''}
                aria-haspopup="listbox" aria-expanded="false" ${naming}>
            <span class="dz-choice-value"${valueId ? ` id="${valueId}"` : ''}
                >${esc(current?.label ?? '')}</span>
        </button>
    </span>`;
}


/**
 * Puts what a choice's select now holds onto the button in front of it.
 * @param {HTMLSelectElement} select
 */
export function showChoice(select) {
    const shown = select.closest?.('.dz-choice')?.querySelector('.dz-choice-value');
    if (!shown) return;

    shown.textContent = select.selectedOptions?.[0]?.textContent.trim() ?? '';
}


/**
 * Every choice's button in a container, brought up to date with its select -
 * for code that sets a select, or rewrites its options, without a change.
 * @param {Element} container
 */
export function refreshChoices(container) {
    for (const select of container.querySelectorAll('.dz-choice select')) showChoice(select);
}


/**
 * Wires the choices in a container: their buttons open the list, and the
 * list sets the select. Delegated, so choices drawn into the container later -
 * a rail rebuilt, a rule added - work without being wired again.
 *
 * The list is one element for the container, outside it: a container that
 * scrolls would clip a menu inside it, and scroll it away. It sits in the
 * designer instead - where the palette's custom properties still reach it -
 * fixed to the window, and closes on anything that would move the button out
 * from under it.
 *
 * @param {Element} container
 * @returns {() => void} detaches, and takes the list away
 */
export function attachChoices(container) {
    const doc = container.ownerDocument;
    const view = doc.defaultView;
    const host = container.closest('.report-designer') ?? container.parentElement ?? doc.body;

    const list = doc.createElement('ul');
    list.className = 'dropdown-menu dz-listbox';

    /** a dialog's list is drawn at the dialog's size */
    if (container.classList.contains('modal')) list.classList.add('is-roomy');
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    host.appendChild(list);

    /** the button the list is open for, and the item the keys are on */
    let opener = null;
    let active = 0;

    const items = () => [...list.children];

    function paint() {
        items().forEach((item, i) => item.classList.toggle('is-active', i === active));

        const current = items()[active];
        if (current) {
            current.focus({ preventScroll: true });
            current.scrollIntoView?.({ block: 'nearest' });
        }
    }

    function open(trigger) {
        const select = trigger.closest('.dz-choice')?.querySelector('select');
        if (!select) return;

        if (opener) close(false);
        opener = trigger;

        active = Math.max(select.selectedIndex, 0);

        list.innerHTML = [...select.options].map((o, i) => `
            <li class="dropdown-item" role="option" tabindex="-1" data-index="${i}"
                aria-selected="${i === select.selectedIndex}">${esc(o.textContent.trim())}</li>`).join('');

        if (trigger.id) list.setAttribute('aria-labelledby', `${trigger.id}-label`);
        else list.removeAttribute('aria-labelledby');

        list.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');

        place(trigger);
        paint();

        /**
         * On the next tick, or the press that opened the list would reach
         * this listener on its way up and close it again.
         */
        view.setTimeout(() => {
            if (opener === trigger) doc.addEventListener('pointerdown', onOutside, true);
        }, 0);

        container.addEventListener('scroll', onAway, true);
        view.addEventListener('resize', onAway);
    }

    /**
     * As a design tool places a menu: the chosen item over the button, so the
     * pointer is already on it - and the whole list kept inside the window.
     */
    function place(trigger) {
        const box = trigger.getBoundingClientRect();
        const chosen = items()[active];

        list.style.minWidth = `${Math.round(box.width) + 8}px`;
        list.style.left = '0px';
        list.style.top = '0px';

        const height = list.offsetHeight;
        const width = list.offsetWidth;
        const gap = 8;

        let top = chosen
            ? box.top - chosen.offsetTop + (box.height - chosen.offsetHeight) / 2
            : box.bottom + 4;
        top = Math.min(Math.max(top, gap), Math.max(gap, view.innerHeight - height - gap));

        let left = box.left - 4;
        left = Math.min(Math.max(left, gap), Math.max(gap, view.innerWidth - width - gap));

        list.style.top = `${Math.round(top)}px`;
        list.style.left = `${Math.round(left)}px`;
    }

    function close(refocus = true) {
        if (!opener) return;

        const trigger = opener;
        opener = null;

        list.hidden = true;
        list.innerHTML = '';
        trigger.setAttribute('aria-expanded', 'false');

        doc.removeEventListener('pointerdown', onOutside, true);
        container.removeEventListener('scroll', onAway, true);
        view.removeEventListener('resize', onAway);

        if (refocus && trigger.isConnected) trigger.focus();
    }

    /**
     * Sets the select and reports it as a select would - input, then change -
     * so the code around it takes it from there.
     *
     * That code may redraw what the choice was in: a rail rebuilt for a new
     * paper size, a rule redrawn for a new test. Whatever it then focused is
     * left alone; if it focused nothing, the focus goes to the button of the
     * same id, or back to this one if it is still there.
     */
    function choose(index) {
        const trigger = opener;
        const select = trigger?.closest('.dz-choice')?.querySelector('select');
        close(false);
        if (!select) return;

        const id = trigger.id;

        if (select.selectedIndex !== index) {
            select.selectedIndex = index;
            showChoice(select);
            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const focused = doc.activeElement;
        if (focused && focused !== doc.body && container.contains(focused)) return;

        const again = id ? doc.getElementById(id) : null;
        if (again && container.contains(again)) again.focus();
        else if (trigger.isConnected) trigger.focus();
    }

    function onOutside(event) {
        if (list.contains(event.target) || opener?.contains(event.target)) return;
        close(false);
    }

    function onAway() {
        close(false);
    }

    function onListClick(event) {
        const item = event.target.closest?.('.dropdown-item');
        if (item) choose(Number(item.dataset.index));
    }

    /** the pointer and the keys share one highlight, as a menu's do */
    function onListHover(event) {
        const item = event.target.closest?.('.dropdown-item');
        if (!item) return;

        active = Number(item.dataset.index);
        items().forEach((one, i) => one.classList.toggle('is-active', i === active));
    }

    /**
     * The list's keys. Every one it handles stops here: the designer reads
     * arrows as a nudge and Escape as "select nothing" - and a dialog reads
     * Escape as "cancel" - and none of those is meant.
     * A letter jumps to the next item that starts with it.
     */
    function onListKey(event) {
        const count = items().length;
        const to = (at) => () => { active = Math.min(Math.max(at, 0), count - 1); paint(); };

        const handled = {
            ArrowDown: to(active + 1),
            ArrowUp: to(active - 1),
            Home: to(0),
            End: to(count - 1),
            PageDown: to(active + 8),
            PageUp: to(active - 8),
            Enter: () => choose(active),
            ' ': () => choose(active),
            Escape: () => close(true),
            Tab: () => close(true)
        }[event.key];

        if (handled) {
            event.preventDefault();
            event.stopPropagation();
            handled();
            return;
        }

        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;

        event.preventDefault();
        event.stopPropagation();

        const letter = event.key.toLowerCase();
        const all = items();

        for (let step = 1; step <= all.length; step++) {
            const at = (active + step) % all.length;

            if (all[at].textContent.trim().toLowerCase().startsWith(letter)) {
                active = at;
                paint();
                return;
            }
        }
    }

    function onClick(event) {
        const trigger = event.target.closest?.('.dz-choice-trigger');
        if (!trigger || !container.contains(trigger)) return;

        event.preventDefault();

        if (opener === trigger) close(true);
        else open(trigger);
    }

    /**
     * A choice's button behaves as the select it stands in for: the arrows,
     * Enter and Space open it, and nothing else typed at it goes further - a
     * native select swallowed Backspace, and here it would otherwise reach
     * the designer and delete the item being edited.
     */
    function onKey(event) {
        const trigger = event.target.closest?.('.dz-choice-trigger');
        if (!trigger) return;

        if (event.key === 'Tab' || event.ctrlKey || event.metaKey) return;

        /**
         * Escape included: on the rail it would otherwise drop the selection.
         * A dialog still closes on it - it listens on the way down, before
         * this ever sees the key.
         */
        event.stopPropagation();

        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
            event.preventDefault();
            open(trigger);
        }
    }

    /**
     * Code written for the select may still focus it - a dialog putting the
     * caret back where it was after a redraw. The select is out of sight, so
     * the focus is handed on to the button that stands for it.
     */
    function onFocus(event) {
        const node = event.target;
        if (!node.classList?.contains('dz-choice-native')) return;

        node.closest('.dz-choice')?.querySelector('.dz-choice-trigger')?.focus();
    }

    list.addEventListener('click', onListClick);
    list.addEventListener('pointermove', onListHover);
    list.addEventListener('keydown', onListKey);
    container.addEventListener('click', onClick);
    container.addEventListener('keydown', onKey);
    container.addEventListener('focusin', onFocus);

    return function detach() {
        close(false);
        list.remove();
        container.removeEventListener('click', onClick);
        container.removeEventListener('keydown', onKey);
        container.removeEventListener('focusin', onFocus);
    };
}

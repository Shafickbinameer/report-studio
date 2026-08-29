/**
 * designer.js is the package's designer entry point.
 *
 *     createDesigner({ mount: '#report-designer', layout })
 *
 * The host supplies one empty element and nothing else - the designer builds
 * its own chrome inside it. Asking a consumer to copy a screenful of toolbar
 * markup is how the preview playground works, and it is not an API.
 *
 * Nothing here imports React, and nothing here touches the filesystem: reading
 * and writing report files is the dev server's job (phase 5), reached over
 * fetch. This module knows about a layout object and a DOM node.
 */

import { validateLayout } from '../engine/validate.js';
import { allFields, allReportFields, fieldsFor, reportFields } from './fields.js';
import { blankLayout, isEmptyLayout } from './blank.js';
import {
    drawSheet, selectionBox, selectionBoxes, bandUnder, bandBox, drawGuides,
    guideLines, guideNubs
} from './canvas.js';
import { attachEditing } from './select.js';
import {
    drawPanel, drawReportPanel, drawManyPanel, attachPanel, syncPanel
} from './panel.js';
import { icon } from './icons.js';
import { createDropdown } from '../shared/dropdown.js';
import { menuActions, drawMenu, menuPosition } from './menu.js';
import { openWindow, closeWithOpener } from '../shared/window.js';
import {
    openViewerWindow, ZOOM_STEPS, MIN_ZOOM, MAX_ZOOM
} from '../preview/viewer.js';
import { buildPages } from '../engine/index.js';
import { drawProblems, sameIssues } from './toast.js';
import { askColumns, askReport, askName, askData, askToken } from './dialog.js';
import { sampleData } from './sample-data.js';
import { drawPreview } from './preview.js';
import { createHistory } from './history.js';
import { createStore, StoreError, toId } from '../shared/store.js';
import {
    addBand, removeBand, findBand, addItem, removeItem, duplicateItem, pasteItems,
    moveItemToBand, createText, createTable, createLine, createBox, addColumn,
    removeColumn, targetBand, canAddTable
} from './structure.js';


/**
 * Mounts the designer.
 *
 * @param {object} options
 * @param {Element|string} options.mount the element to take over, or a selector
 * @param {object} [options.layout] the report to edit; empty or absent starts a new one
 * @param {string} [options.id] the report's filename stem, when it has one
 * @param {object} [options.store] where reports are read and written; the dev
 *   server's routes by default
 * @returns {object} a handle: the current layout, redraw, and destroy
 */
/**
 * Opens the designer in a window of its own.
 *
 * The same designer, mounted in a window this opens rather than in an element
 * the host supplies - a report is a page-shaped thing, and a page suits a
 * window better than a panel in somebody's application. The host's stylesheets
 * are carried across, so it looks the same either way.
 *
 * Call it from a click or a keystroke, or the browser blocks it; a blocked
 * window is null rather than a throw, so a host can fall back to the page.
 *
 * @param {object} options what createDesigner takes, less `mount`
 * @param {number} [options.width]
 * @param {number} [options.height]
 * @param {string} [options.features] passed to window.open as given
 * @returns {object|null} the designer handle, with `window`; null if blocked
 */
export function openDesignerWindow({
    width, height, features, ...rest
} = {}) {
    const opened = openWindow({
        title: rest.layout?.name ? `${rest.layout.name} - Designer` : 'Report designer',
        width, height, features
    });

    if (!opened) return null;

    const designer = createDesigner({ ...rest, mount: opened.mount });

    /** what is being edited is held in memory, so it goes when the opener does */
    const unwatch = closeWithOpener(globalThis, opened.window, designer.destroy);

    return {
        ...designer,
        window: opened.window,

        destroy() {
            unwatch();
            designer.destroy();
            opened.close();
        }
    };
}


export function createDesigner({ mount, layout, id = null, store } = {}) {
    const root = typeof mount === 'string'
        ? document.querySelector(mount)
        : mount;

    if (!root) {
        throw new Error(
            `createDesigner: no element for mount ${JSON.stringify(mount)}. ` +
            `Add <div id="report-designer"></div> to the page first.`
        );
    }

/**
 * The document the screen is mounted in, which is not always this one: a
 * designer or a viewer opened in its own window lives in that window's
 * document, and a listener put on the opener's would never hear it.
 */
    const doc = root.ownerDocument;

    const files = store ?? createStore();

    const state = {
        /** page pixels per screen pixel; 1 until somebody says otherwise */
        zoom: 1,

        /** whether the zoom is being recomputed from the viewport on resize */
        fitWidth: false,

        /**
         * Whether the rulers are showing. A view preference, not part of the
         * report - the guides dragged off them are saved with the file, but
         * whether somebody has the rulers up while they work is theirs.
         */
        rulers: false,

        layout: isEmptyLayout(layout) ? blankLayout() : layout,
        /**
         * The selected items, oldest first, as `{ band, id }` - the band type
         * and the item id, because ids are only unique within a band
         * (validate.js does not require more).
         *
         * A list rather than one, so several can be moved together. The last is
         * the primary: it is the one the rail describes and the one whose
         * handles are drawn, because resizing six things at once has no single
         * answer.
         */
        selection: [],
        /** the filename stem this report is saved under, or null if never saved */
        id,
        /** whether there are changes the disk has not seen */
        dirty: false,
        /**
         * What ctrl+C took, as `{ band, item }` - the item deep-copied, so a
         * later edit to the original does not reach back into the clipboard,
         * and the band it came from, which a paste elsewhere needs to know to
         * reposition it.
         *
         * The designer's own, not the system's: reading the platform clipboard
         * needs a permission prompt, and nothing outside this screen can use a
         * layout item anyway.
         */
        clipboard: [],
        /** 'design' arranges the bands; 'preview' runs the report */
        mode: 'design',
        /**
         * The problems the author has already been shown and closed, so the
         * toast does not reopen on every keystroke. It comes back the moment
         * what is wrong changes - see sameIssues in toast.js.
         */
        dismissed: null
    };

    const history = createHistory(state.layout);

    root.classList.add('report-designer');

    /**
     * The designer has to be able to hold the focus.
     *
     * Its shortcuts are bound per designer rather than to the document, so a
     * second one on the page does not answer for this one - which only works if
     * the focus can get in here, and a div cannot take it without being told.
     * -1 rather than 0: it is reachable by clicking, not by tabbing to it, so
     * it never becomes a stop on the way to the controls inside it.
     */
    root.tabIndex = -1;
    root.innerHTML = chrome(state.layout);

    const canvas = root.querySelector('[data-role="canvas"]');
    const stage = root.querySelector('[data-role="stage"]');
    /** everything drawn lives in here, so the scale has one thing to act on */
    const surface = root.querySelector('[data-role="zoom-layer"]');
    const panel = root.querySelector('[data-role="panel"]');
    const bar = root.querySelector('[data-role="bar"]');
    const foot = root.querySelector('[data-role="foot"]');
    /** the pill is drawn into the page area, which is the box it must stay inside */
    const main = root.querySelector('.dz-main');
    const toasts = root.querySelector('[data-role="toasts"]');
    const pages = root.querySelector('[data-role="pages"]');


    /** the most recently selected `{ band, id }`, or null */
    function primary() {
        return state.selection.at(-1) ?? null;
    }


    /** the layout item behind a `{ band, id }`, or null if it has since gone */
    function itemAt(one) {
        if (!one) return null;

        const band = findBand(state.layout, one.band);
        return (band?.items || []).find(i => i.id === one.id) ?? null;
    }


    /** the item the rail describes */
    function selected() {
        return itemAt(primary());
    }


    /** every selected item, skipping any that have since been removed */
    function selectedItems() {
        return state.selection.map(itemAt).filter(Boolean);
    }


    function draw() {
        /**
         * Spec 9.1: a layout is hand-written as often as it is designed, so a
         * broken one is named field by field rather than drawn as a blank page
         * and left to look like the library is broken.
         *
         * The issues are said in the corner rather than drawn over the
         * design, because most of them are survivable - setting groupBy before
         * adding a group band is one keystroke, and pushing the page down the
         * canvas to say so is a punishment. Only a layout that cannot be drawn
         * at all leaves nothing behind it.
         */
        const issues = validateLayout(state.layout);

        if (state.mode === 'preview') {
            const run = drawPreview(state.layout, state.data);

            surface.innerHTML = run.markup;
            pages.textContent = run.error
                ? ''
                : `${run.pageCount} page${run.pageCount === 1 ? '' : 's'}`;

            /** the preview says what stopped it in the page itself */
            showProblems(issues);
            applyZoom();
            return issues;
        }

        pages.textContent = '';

        let sheet = '';

        try {
            sheet = drawSheet(state.layout, state.selection,
                { rulers: state.rulers });
        } catch {
            sheet = '';
        }

        surface.innerHTML = sheet;
        showProblems(issues);

        /** what was drawn may be a different size; the stage has to match it */
        applyZoom();

        return issues;
    }


    /**
     * Puts the validator's findings in the corner, or takes them away again.
     *
     * Never while the report is being previewed: the run says what stopped it in
     * the page itself, and two accounts of one fault is one too many.
     *
     * @param {string[]} issues
     */
    function showProblems(issues) {
        const hidden = state.mode !== 'design'
            || issues.length === 0
            || sameIssues(issues, state.dismissed);

        toasts.innerHTML = hidden ? '' : drawProblems(issues);

        /** a layout that validates forgets the dismissal, so the next fault is announced */
        if (issues.length === 0) state.dismissed = null;
    }


    /**
     * A drag redraws sixty times a second, and rebuilding the page's markup that
     * often is how a hand-written drag ends up feeling worse than the library it
     * replaced. While the pointer is down only the two boxes that moved are
     * touched; the full redraw happens once, when it is let go.
     */
    function patch() {
        patchRules();

        const boxes = selectionBoxes(state.layout, state.selection);

        for (const [index, { item, box }] of boxes.entries()) {
            const where = state.selection[index];

            const outline = canvas.querySelector(
                `[data-role="select"][data-select-id="${cssEscape(item.id)}"]`);

            if (outline) {
                Object.assign(outline.style, {
                    top: `${box.y}px`, left: `${box.x}px`,
                    width: `${box.w}px`, height: `${box.h}px`
                });
            }

            const drawn = canvas.querySelector(
                `[data-band-type="${cssEscape(where.band)}"] ` +
                `[data-item-id="${cssEscape(item.id)}"]`);

            if (!drawn) continue;

            Object.assign(drawn.style, {
                top: `${item.y}px`, left: `${item.x}px`, width: `${item.w}px`
            });
            /** a table's height is its rows', so it is never written here */
            if (item.type !== 'table') drawn.style.height = `${item.h}px`;
        }
    }


    /**
     * The ruler guides, redrawn without rebuilding the sheet.
     *
     * Two small containers rather than the whole page: the ticks never move and
     * there are two hundred of them, and a guide being dragged is the same sixty
     * frames a second an item drag is.
     */
    function patchRules() {
        const rules = canvas.querySelector('[data-role="rules"]');
        if (rules) rules.innerHTML = state.rulers ? guideLines(state.layout) : '';

        for (const host of canvas.querySelectorAll('[data-role="ruler-guides"]')) {
            host.innerHTML = guideNubs(state.layout, host.dataset.axis);
        }
    }


    function drawRail() {
        /** a rendered report has no item to describe and no report to restructure */
        if (state.mode === 'preview') return;

        const many = state.selection.length;

        panel.innerHTML = many > 1
            ? drawManyPanel(selectedItems())
            : (selected() ? drawPanel(selected()) : drawReportPanel(state.layout));
    }


    const sameOne = (a, b) => a?.band === b?.band && a?.id === b?.id;


    /**
     * Sets or extends the selection.
     *
     * @param {object|object[]|null} next
     * @param {object} [options]
     * @param {boolean} [options.add] shift-click: add it, or take it out again
     *   if it was already in - toggling is what makes a mis-click recoverable
     *   without starting the whole selection over
     */
    function setSelection(next, { add = false } = {}) {
        const wanted = next == null ? [] : [].concat(next);

        let list;

        if (!add) {
            list = wanted;
        } else {
            list = [...state.selection];

            for (const one of wanted) {
                const at = list.findIndex(s => sameOne(s, one));

                if (at === -1) list.push(one);
                else list.splice(at, 1);
            }
        }

        const unchanged = list.length === state.selection.length
            && list.every((one, i) => sameOne(one, state.selection[i]));

        if (unchanged) return;

        state.selection = list;
        draw();
        drawRail();
    }


    /**
     * Records a step and marks the report as unsaved.
     *
     * Edits sharing a key coalesce into one undo step - typing "250" into a
     * width arrives as three edits, and three undo presses to get back past one
     * number is not undo but punishment.
     */
    function record(key = null) {
        if (history.push(state.layout, key)) {
            state.dirty = true;
            refreshBar();
        }
    }


    /** a change that alters the rail's own shape, not just its values */
    function restructured(key = null) {
        draw();
        drawRail();
        record(key);
    }


    function refreshBar() {
        bar.querySelector('[data-role="name"]').textContent = state.layout.name ?? '';

        /**
         * The preview screen reads the report off disk, so it can only show one
         * that has been saved. Rather than opening it to an error, the link is
         * inert until there is a file for it to open, and says why.
         */
        bar.querySelector('[data-role="undo"]').disabled = !history.canUndo;
        bar.querySelector('[data-role="redo"]').disabled = !history.canRedo;

        /** a toggle, so it says which way it is set rather than what it does */
        const size = bar.querySelector('[data-role="size"]');

        if (size && state.layout.page) {
            size.innerHTML =
                `${state.layout.page.width} &times; ${state.layout.page.height}`;
        }

        const rulers = bar.querySelector('[data-role="rulers"]');

        rulers.setAttribute('aria-pressed', String(state.rulers));
        rulers.classList.toggle('is-on', state.rulers);

        /** greyed rather than absent: it says the tool exists and why it cannot be used */
        const addTable = foot.querySelector('[data-role="add-table"]');

        addTable.disabled = !canAddTable(state.layout);
        addTable.title = addTable.disabled
            ? 'A report binds one table'
            : 'Add a table';
        bar.dataset.dirty = String(state.dirty);

        const saved = bar.querySelector('[data-role="status"]');
        saved.textContent = state.dirty
            ? 'Unsaved changes'
            : (state.id ? `Saved as ${state.id}.json` : 'Not saved yet');
    }


    /**
     * Replaces the whole layout, as undo, redo and opening all do.
     *
     * The selection is dropped rather than carried over: the item it named may
     * not exist in the layout being restored, and a selection pointing at
     * nothing draws an outline round empty space.
     */
    function replaceLayout(next, { id: nextId, dirty }) {
        state.layout = next;
        state.selection = [];

        /** another report is another design; its pages have not been run yet */
        state.mode = 'design';
        state.data = null;

        if (nextId !== undefined) state.id = nextId;
        if (dirty !== undefined) state.dirty = dirty;

        drawMode();
    }


    /** puts a new item on a band and leaves it selected, rail and all */
    function place(bandType, item) {
        addItem(state.layout, bandType, item);

        state.selection = [{ band: bandType, id: item.id }];
        restructured(`add:${item.id}`);

        /**
         * The band is lit for a moment afterwards. Where an inserted item lands
         * is a decision the designer made rather than the user, so it says
         * where - a page number appearing somewhere unexpected is otherwise
         * found by hunting for it.
         */
        flashBand(bandType);
    }


    /** which band is lit, and why - a drop target, or somewhere just inserted */
    function markTarget(types) {
        /** one band or several: a group can straddle a boundary */
        const lit = new Set(types == null ? [] : [].concat(types));

        for (const zone of canvas.querySelectorAll('[data-band-type]')) {
            zone.classList.toggle('is-target', lit.has(zone.dataset.bandType));
        }

        /** the name in the gutter lights too, so the band is named not just lit */
        for (const tag of canvas.querySelectorAll('[data-band-tag]')) {
            tag.classList.toggle('is-target', lit.has(tag.dataset.bandTag));
        }
    }


    /**
     * Draws the alignment guides, or takes them away.
     *
     * Into a layer of its own rather than into the outlines, for the reason the
     * outlines are a layer of their own: a guide belongs to the gesture, not to
     * an item, and an item that is redrawn mid-drag would take its guides with
     * it. The layer survives patch() because patch() only touches boxes.
     *
     * @param {{band: string, lines: object[], gaps: object[]}|null} found
     */
    function drawAlignment(found) {
        const layer = canvas.querySelector('[data-role="guides"]');
        if (!layer) return;

        layer.innerHTML = found
            ? drawGuides(bandBox(state.layout, found.band), found.lines, found.gaps)
            : '';
    }


    /* ---------------- zoom ---------------- */

    /**
     * Scales the drawing rather than the numbers in it.
     *
     * The same choice the viewer makes, and for the same reason: re-computing
     * type at 150% would re-wrap the text and stop matching what the engine
     * paginated, so what is on screen would no longer be what would print.
     *
     * A transform does not affect layout, so the stage is given the scaled
     * footprint explicitly - measured off the drawing rather than worked out
     * from the page, because the gutter and the rulers are part of what has to
     * fit and only the browser knows how wide they came out.
     */
    function applyZoom() {
        surface.style.transformOrigin = 'top left';
        surface.style.transform = `scale(${state.zoom})`;

        const width = surface.offsetWidth;
        const height = surface.offsetHeight;

        /** jsdom lays nothing out, and neither does a canvas nobody has drawn yet */
        if (width && height) {
            stage.style.width = `${width * state.zoom}px`;
            stage.style.height = `${height * state.zoom}px`;
        }

        refreshZoom();
    }


    function refreshZoom() {
        /**
         * Fit width has no step to light, and setFitWidth has already said so -
         * writing a percentage over it here would take the label away from the
         * mode that is actually on.
         */
        if (zoomPicker && !state.fitWidth) {
            const exact = ZOOM_STEPS.find(
                step => Math.abs(step - state.zoom) < 1e-9);

            zoomPicker.value = exact !== undefined ? String(exact) : 'fit';
        }

        bar.querySelector('[data-role="zoom-out"]').disabled =
            !state.fitWidth && state.zoom <= MIN_ZOOM;
        bar.querySelector('[data-role="zoom-in"]').disabled =
            !state.fitWidth && state.zoom >= MAX_ZOOM;
    }


    function setZoom(next) {
        state.fitWidth = false;
        state.zoom = Math.min(Math.max(next, MIN_ZOOM), MAX_ZOOM);
        applyZoom();
    }


    /** the widest scale that still fits the canvas, less its own padding */
    function setFitWidth() {
        state.fitWidth = true;
        if (zoomPicker) zoomPicker.value = 'fit';

        const available = canvas.clientWidth - 48;
        const natural = surface.offsetWidth;

        if (available > 0 && natural > 0) {
            state.zoom = Math.min(Math.max(available / natural, MIN_ZOOM), MAX_ZOOM);
        }

        applyZoom();
    }


    /** to the neighbouring preset rather than a blind multiply */
    function stepZoom(direction) {
        const from = state.zoom;

        const next = direction > 0
            ? ZOOM_STEPS.find(step => step > from + 1e-9)
            : [...ZOOM_STEPS].reverse().find(step => step < from - 1e-9);

        setZoom(next ?? from);
    }


    function flashBand(type) {
        clearTimeout(flashBand.timer);
        markTarget(type);

        flashBand.timer = setTimeout(() => markTarget(null), 1200);
    }


    /* ---------------- the right-click pill ---------------- */

    /** the open menu, or null */
    let menu = null;


    function closeMenu() {
        menu?.remove();
        menu = null;
    }


    /**
     * Opens the pill at a point on screen.
     *
     * Drawn first and measured second: what it offers decides how wide it is,
     * and it cannot be kept inside the page area without knowing that.
     *
     * @param {number} clientX
     * @param {number} clientY
     */
    function openMenu(clientX, clientY) {
        closeMenu();

        main.insertAdjacentHTML('beforeend', drawMenu(menuActions({
            count: state.selection.length,
            canPaste: state.clipboard.length > 0,
            /** a copy of a table would be the second one this report cannot hold */
            canDuplicate: !selectedItems().some(item => item.type === 'table')
        })));

        menu = main.querySelector('[data-role="menu"]');

        /**
         * Bound to the pill, not to the page area: a delegated listener out
         * there answers for the tool strip as well, and every add would run
         * twice.
         */
        menu.addEventListener('click', onMenuClick);

        const bounds = main.getBoundingClientRect();
        const box = menu.getBoundingClientRect();

        const at = menuPosition(
            { x: clientX - bounds.left, y: clientY - bounds.top },
            { width: box.width, height: box.height },
            { width: bounds.width, height: bounds.height }
        );

        menu.style.left = `${at.left}px`;
        menu.style.top = `${at.top}px`;

        /** so escape and the arrow keys have somewhere to be aimed */
        menu.querySelector('button:not([disabled])')?.focus();
    }


    /**
     * A right click acts on what is under it. An item that is not selected
     * becomes the selection first - otherwise Delete would take whatever
     * happened to be selected elsewhere, which is how a layout gets lost.
     */
    function onContextMenu(event) {
        if (state.mode !== 'design') return;

        event.preventDefault();

        const node = event.target.closest?.('[data-item-id]');
        const bandType = node?.closest('[data-band-type]')?.dataset.bandType ?? null;

        if (node && bandType) {
            const where = { band: bandType, id: node.dataset.itemId };
            const already = state.selection
                .some(one => one.band === where.band && one.id === where.id);

            if (!already) setSelection(where);
        } else {
            setSelection(null);
        }

        openMenu(event.clientX, event.clientY);
    }


    function onMenuClick(event) {
        const node = event.target.closest?.('[data-action]');
        if (!node || node.disabled) return;

        event.preventDefault();

        /** closed first: what follows redraws, and a stale pill would outlive it */
        closeMenu();
        act(node.dataset.action, node.dataset);
    }


    /** anything that is not the pill closes it */
    function onDocumentDown(event) {
        if (menu && !menu.contains(event.target)) closeMenu();
    }


    function onMenuKey(event) {
        if (menu && event.key === 'Escape') closeMenu();
    }


    function act(action, data) {
        const item = selected();

        switch (action) {
            case 'add-text': {
                const type = targetBand(state.layout, primary());
                if (!type) return;

                place(type, createText(state.layout, findBand(state.layout, type)));
                return;
            }

            case 'add-box': {
                const type = targetBand(state.layout, primary());
                if (!type) return;

                place(type, createBox(state.layout, findBand(state.layout, type)));
                return;
            }

            case 'add-line': {
                const type = targetBand(state.layout, primary());
                if (!type) return;

                place(type, createLine(
                    state.layout, findBand(state.layout, type), data?.orientation));
                return;
            }

            case 'add-field': {
                /**
                 * Unlike text and table, this chooses its own band - a total
                 * belongs in a footer, and the alternative is inserting it into
                 * the detail band and asking the user to drag it somewhere it
                 * will actually resolve.
                 */
                askToken(root, state.layout, primary()?.band ?? null).then(chosen => {
                    if (!chosen) return;

                    const band = findBand(state.layout, chosen.band);
                    if (!band) return;

                    const made = createText(state.layout, band);

                    made.value = chosen.value;
                    made.w = chosen.w;
                    made.style.align = chosen.align;

                    place(chosen.band, made);
                });
                return;
            }

            case 'add-table': {
                const type = targetBand(state.layout, primary());
                if (!type) return;

                /**
                 * The engine binds the dataset to one table (validate.js says
                 * so). Refused here as well as there, so the answer arrives
                 * when the tool is pressed rather than as a problem in the
                 * corner after the table has been drawn.
                 */
                if (!canAddTable(state.layout)) {
                    flashStatus(
                        'This report already has a table - a report binds one',
                        { ms: 3000 }
                    );
                    return;
                }

                /**
                 * A table is asked about first: how many columns it starts with
                 * is the one thing that cannot be dragged into place afterwards
                 * without a trip through the rail for each of them.
                 */
                askColumns(root).then(columns => {
                    if (columns == null) return;

                    place(type, createTable(
                        state.layout, findBand(state.layout, type), columns));
                });
                return;
            }

            case 'duplicate-item': {
                if (!state.selection.length) return;

                /**
                 * Read the selection before adding anything: duplicateItem
                 * appends to the same band, and a copy made from a copy would
                 * cascade down the page for as long as the loop ran.
                 */
                const sources = [...state.selection];
                const copies = [];

                for (const one of sources) {
                    const made = duplicateItem(state.layout, one.band, one.id);
                    if (made) copies.push({ band: one.band, id: made.id });
                }

                if (!copies.length) {
                    if (sources.some(one => itemAt(one)?.type === 'table')) {
                        flashStatus(
                            'A report binds one table, so it cannot be copied',
                            { ms: 3000 }
                        );
                    }
                    return;
                }

                /**
                 * The copies are what is selected afterwards, not the originals:
                 * the next thing anyone does to a duplicate is move it, and
                 * leaving the original selected would move the wrong one.
                 */
                state.selection = copies;
                restructured(`duplicate:${copies.map(c => c.id).join(',')}`);

                flashBand([...new Set(copies.map(c => c.band))]);
                return;
            }

            case 'dismiss-problems': {
                state.dismissed = validateLayout(state.layout);
                toasts.innerHTML = '';
                return;
            }

            case 'copy-items': {
                if (!state.selection.length) return;

                const taken = state.selection
                    .map(one => ({ band: one.band, item: itemAt(one) }))
                    .filter(entry => entry.item)
                    .map(entry => ({
                        band: entry.band,
                        item: structuredClone(entry.item)
                    }));

                if (!taken.length) return;

                state.clipboard = taken;

                /**
                 * Nothing on screen changes when a copy is taken, so the bar
                 * says it did - otherwise ctrl+C is a keystroke with no answer.
                 */
                flashStatus(
                    taken.length > 1 ? `Copied ${taken.length} items` : 'Copied',
                    { ms: 2000 }
                );
                return;
            }

            case 'paste-items': {
                if (!state.clipboard.length) return;

                /** onto the band being worked in, which is where a paste is expected */
                const type = targetBand(state.layout, primary());
                if (!type) return;

                const made = pasteItems(state.layout, type, state.clipboard);
                if (!made.length) return;

                /**
                 * The clipboard now holds where these landed, so pressing paste
                 * again steps down from the last copy rather than putting a
                 * second one exactly on top of it.
                 */
                state.clipboard = made.map(item => ({
                    band: type,
                    item: structuredClone(item)
                }));

                state.selection = made.map(item => ({ band: type, id: item.id }));
                restructured(`paste:${made.map(i => i.id).join(',')}`);

                flashBand(type);
                return;
            }

            case 'delete-item': {
                if (!state.selection.length) return;

                const gone = state.selection.map(one => one.id).join(',');

                for (const one of state.selection) {
                    removeItem(state.layout, one.band, one.id);
                }

                state.selection = [];
                restructured(`delete:${gone}`);
                return;
            }

            case 'add-column':
                if (item?.type !== 'table') return;
                addColumn(item);
                restructured(`column:add:${item.id}`);
                return;

            case 'remove-column':
                if (item?.type !== 'table') return;
                if (removeColumn(item, Number(data.index))) {
                    restructured(`column:remove:${item.id}`);
                }
                return;

            case 'undo': {
                const previous = history.undo();
                if (previous) replaceLayout(previous, { dirty: true });
                return;
            }

            case 'redo': {
                const next = history.redo();
                if (next) replaceLayout(next, { dirty: true });
                return;
            }

            case 'open': return openReport();
            case 'save': return saveReport();
            case 'data': return editData();
            case 'open-window': return openInWindow();

            case 'zoom-in': return stepZoom(1);
            case 'zoom-out': return stepZoom(-1);

            case 'toggle-rulers': {
                state.rulers = !state.rulers;
                draw();
                refreshBar();
                return;
            }
            case 'toggle-preview': return togglePreview();
        }
    }


    /**
     * Opens another report.
     *
     * The list comes from the server, so this is also where the designer finds
     * out there is no server - and says so in terms of what to do about it,
     * rather than letting a failed fetch surface as nothing happening.
     */
    async function openReport() {
        let reports;

        try {
            reports = await files.list();
        } catch (error) {
            return complain(error);
        }

        const chosen = await askReport(root, reports);
        if (!chosen) return;

        if (chosen.blank) {
            replaceLayout(blankLayout(), { id: null, dirty: false });
            history.reset(state.layout);
            refreshBar();
            return;
        }

        try {
            const loaded = await files.load(chosen.id);

            replaceLayout(loaded, { id: chosen.id, dirty: false });
            history.reset(state.layout);
            refreshBar();
        } catch (error) {
            complain(error);
        }
    }


    /**
     * Saves the report, asking what to call it the first time.
     *
     * An invalid layout is saved anyway - a report half-designed is legitimately
     * invalid, and refusing to keep somebody's work in progress is not a safety
     * feature. The problems banner is already saying what is wrong.
     */
    async function saveReport() {
        let saveId = state.id;

        if (!saveId) {
            const named = await askName(root, state.layout.name ?? '');
            if (!named) return;

            saveId = named.id;
            state.layout.name = named.name;
        }

        try {
            await files.save(saveId, state.layout);

            state.id = saveId;
            state.dirty = false;
            refreshBar();

            await seedData(saveId);
        } catch (error) {
            complain(error);
        }
    }


    /**
     * Writes a sample data file for a report that has none.
     *
     * Only when there is none. Once someone has put real figures in that file,
     * every later save must leave it exactly alone - a designer that quietly
     * replaced the host application's data with "Customer 1" would be worse
     * than one that never offered to help.
     */
    async function seedData(saveId) {
        if (!files.loadData || !files.saveData) return;

        try {
            const existing = await files.loadData(saveId);
            if (existing) return;

            await files.saveData(saveId, sampleData(state.layout));
        } catch {
            /**
             * A report that saved but whose sample data did not is a working
             * report. Complaining about the convenience would bury the fact
             * that the thing being asked for succeeded.
             */
        }
    }


    /**
     * Shows what data the report is asking for.
     *
     * Loaded from disk if it is there, and otherwise derived from the layout -
     * so a report that has never been saved can still answer "what do I have to
     * supply?", which is the question this exists for.
     */
    async function editData() {
        let current = null;

        if (state.id && files.loadData) {
            try {
                current = await files.loadData(state.id);
            } catch (error) {
                return complain(error);
            }
        }

        const generated = current == null;
        const edited = await askData(root, current ?? sampleData(state.layout), {
            id: state.id, generated
        });

        if (!edited) return;

        if (!state.id) {
            return complain(new Error(
                'Save the report first - its data file is named after it.'));
        }

        try {
            await files.saveData(state.id, edited);
        } catch (error) {
            complain(error);
        }
    }


    /**
     * Runs the report, or goes back to arranging it.
     *
     * The data is fetched each time rather than cached, so a report previewed
     * after its data file was edited shows the edit. It is the report's real
     * data when there is some and the derived sample when there is not, which
     * makes the preview work for a report nobody has supplied data for yet -
     * the case it is most needed in.
     */
    /**
     * Runs the report and opens it in a window of its own.
     *
     * This used to be a link to the preview screen, which reads the report off
     * the disk - so it did nothing until the report had been saved, which is
     * the wrong answer to "show me this". The window is built here from the
     * design as it currently stands, so it works on the first keystroke of a
     * report that has never been named.
     */
    function openInWindow() {
        let paginated;

        try {
            paginated = buildPages(state.layout, state.data ?? sampleData(state.layout));
        } catch (error) {
            complain(error);
            return;
        }

        const opened = openViewerWindow({
            paginated,
            title: state.layout?.name || 'Report'
        });

        /** a browser that refused the window says nothing itself, so this does */
        if (!opened) {
            flashStatus(
                'The browser blocked the report window - allow pop-ups for this page',
                { problem: true, ms: 6000 }
            );
            return;
        }

        windows.add(opened);
    }


    /** the report windows this designer opened, so they go when it does */
    const windows = new Set();

    /** the zoom menu, built once the bar exists */
    let zoomPicker = null;


    async function togglePreview() {
        if (state.mode === 'preview') {
            state.mode = 'design';
            state.data = null;
            drawMode();
            return;
        }

        let data = null;

        if (state.id && files.loadData) {
            try {
                data = await files.loadData(state.id);
            } catch {
                /** a preview on sample data beats no preview at all */
            }
        }

        state.data = data ?? sampleData(state.layout);
        state.mode = 'preview';

        /** an outline over a paginated page points at nothing */
        state.selection = [];
        drawMode();
    }


    /** everything that differs between arranging a report and running it */
    function drawMode() {
        root.dataset.mode = state.mode;

        const button = bar.querySelector('[data-action="toggle-preview"]');
        const running = state.mode === 'preview';

        button.innerHTML = icon(running ? 'design' : 'preview');
        button.title = running ? 'Back to the design (ctrl+E)' : 'Run the report (ctrl+E)';
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-pressed', String(running));

        draw();
        drawRail();
        refreshBar();
    }


    /** the server's own words, where the user is looking */
    /**
     * Says something in the bar for a moment, then puts the saved state back.
     *
     * Shared with complain() so there is one place that owns the status line -
     * two timers writing to it independently is how a message ends up cleared
     * by an error that arrived before it.
     *
     * @param {string} message
     * @param {object} [options]
     * @param {boolean} [options.problem] draws it as a failure
     * @param {number} [options.ms] how long it stands
     */
    function flashStatus(message, { problem = false, ms = 6000 } = {}) {
        const note = bar.querySelector('[data-role="status"]');

        note.textContent = message;
        if (problem) note.dataset.problem = 'true';
        else delete note.dataset.problem;

        clearTimeout(complain.timer);
        complain.timer = setTimeout(() => {
            delete note.dataset.problem;
            refreshBar();
        }, ms);
    }


    function complain(error) {
        const message = error instanceof StoreError
            ? error.message
            : `Something went wrong: ${error?.message ?? error}`;

        flashStatus(message, { problem: true });
    }


    function toggleBand(type, on) {
        if (on) addBand(state.layout, type);
        else {
            removeBand(state.layout, type);
            /** the selection may have been standing on it */
            state.selection = state.selection.filter(one => one.band !== type);
        }

        restructured(`band:${type}`);
    }


    function setBandHeight(type, raw) {
        const band = findBand(state.layout, type);
        if (!band) return;

        const trimmed = String(raw).trim();

        if (trimmed === '') delete band.height;
        else if (/^-?[\d.]+\s*%$/.test(trimmed)) band.height = trimmed;
        else if (Number.isFinite(Number(trimmed))) band.height = Number(trimmed);
        else return;

        /** the rail is not rebuilt - the box being typed into is in it */
        draw();
        record(`band-height:${type}`);
    }


    root.dataset.mode = state.mode;

    zoomPicker = createDropdown(bar.querySelector('[data-role="zoom-dropdown"]'));

    zoomPicker.addEventListener('change', () => {
        if (zoomPicker.value === 'fit') setFitWidth();
        else setZoom(Number(zoomPicker.value));
    });

    /** fit width is a reading of the viewport, so it is taken again when it changes */
    const onViewportResize = () => { if (state.fitWidth) setFitWidth(); };
    const view = doc.defaultView ?? globalThis;

    view.addEventListener('resize', onViewportResize);

    draw();
    drawRail();
    refreshBar();

    const detach = attachEditing({
        canvas,
        getLayout: () => state.layout,
        getSelection: () => state.selection,
        select: setSelection,
        remove: () => act('delete-item'),

        /**
         * Alt-drag. The copies become the selection, so the drag that follows
         * carries them and leaves the originals where they were put.
         */
        duplicate: () => {
            const before = state.selection.map(one => one.id).join(',');
            act('duplicate-item');

            return state.selection.map(one => one.id).join(',') !== before;
        },
        /**
         * render.js emits the same data-item-id attributes items.js gives the
         * canvas - which is the point of one drawing path, and also means a
         * click on a rendered page would otherwise select and drag the item
         * behind it.
         */
        enabled: () => state.mode === 'design',

        /**
         * Screen pixels are page pixels divided by this. Without it a drag at
         * 200% moves an item twice as far as the pointer went.
         */
        getZoom: () => state.zoom,

        /** no rulers, no guides to drag off them and nothing to snap to */
        rulers: () => state.rulers,
        /**
         * A drag moves x and y, which the rail is showing - so the controls are
         * refreshed rather than rebuilt. Rebuilding them under a cursor takes
         * the focus and the caret with it.
         */
        onTarget: markTarget,

        /**
         * What the drag has lined up with. Drawn straight rather than through
         * draw(), because it changes sixty times a second and rebuilding the
         * sheet that often is what patch() exists to avoid.
         */
        onGuides: drawAlignment,

        commit: ({ live, band, key = null }) => {
            /**
             * A drag that ended over another band moves the item into it. Until
             * now the item followed the pointer across the boundary and stayed
             * in the band it started in, which is the sort of thing that is only
             * noticed once the report prints in the wrong place.
             */
            /**
             * Each selected item goes to the band it actually landed in, rather
             * than to one band chosen for the whole group - what you see on the
             * page is where they end up.
             */
            if (!live && band?.length) {
                let moved = false;

                state.selection = state.selection.map(one => {
                    const item = itemAt(one);
                    const to = item ? bandUnder(state.layout, one.band, item) : null;

                    if (to && to !== one.band
                        && moveItemToBand(state.layout, one.band, to, one.id)) {
                        moved = true;
                        return { band: to, id: one.id };
                    }

                    return one;
                });

                if (moved) drawRail();
            }

            live ? patch() : draw();
            syncPanel(panel, selected(), state.layout);

            /**
             * Only the finished gesture is a step. A drag reports sixty times a
             * second, and each of those as an undo step would bury the edit
             * before it.
             */
            if (!live) {
                record(key ?? `move:${state.selection.map(o => o.id).join(',')}`);
            }
        }
    });

    const detachPanel = attachPanel({
        panel,
        getTarget: () => {
            const item = selected();
            return item
                ? { target: item, fields: allFields(item) }
                : { target: state.layout, fields: allReportFields(state.layout) };
        },
        getItem: selected,
        /**
         * A typed edit redraws the page but never the rail: the control being
         * typed into is in it.
         *
         * Unless the edit changed which controls there are - picking a named
         * paper size puts the width and height boxes away - in which case the
         * rail is rebuilt. Safe here because the control that asked for it is a
         * dropdown, not something anyone is mid-word in.
         */
        changed: (key, { rebuild = false } = {}) => {
            draw();
            if (rebuild) drawRail();
            record(key);
        },
        act,
        toggleBand,
        setBandHeight
    });

    /** the bar and the footer both carry actions; the rail wires its own */
    function onChromeClick(event) {
        const node = event.target.closest?.('[data-action]');
        if (!node) return;

        event.preventDefault();
        act(node.dataset.action, node.dataset);
    }

    /**
     * Whether a keystroke belongs to this designer.
     *
     * Anything aimed inside it, plainly. And anything aimed at nothing at all -
     * the page has just loaded, or a click landed on the canvas, and the body
     * has the focus by default. Without that second case the shortcuts were
     * dead until somebody happened to click a button, because a click on the
     * design itself focuses nothing and the keystroke never reached this
     * element to begin with.
     *
     * @param {KeyboardEvent} event
     * @returns {boolean}
     */
    function ours(event) {
        if (root.contains(event.target)) return true;

        return event.target === doc.body || event.target === doc.documentElement;
    }


    /**
     * Takes the focus when a click lands on something that cannot hold it.
     *
     * The canvas is a div, so clicking the design leaves the caret wherever it
     * was - which, after a trip to the properties rail, is a text box. Then `z`
     * types a z instead of zooming, which is correct of the shortcut and
     * surprising to everyone.
     *
     * @param {PointerEvent} event
     */
    function takeFocus(event) {
        const holder = event.target.closest?.(
            'input, textarea, select, button, a, label, [tabindex]');

        /**
         * Root itself carries a tabindex now, so it matches that selector - and
         * it is the thing being focused, not a reason not to. A browser does
         * this walk on its own for a container that can hold focus; this is
         * here so the behaviour is the designer's rather than the browser's.
         */
        if (holder && holder !== root) return;

        root.focus({ preventScroll: true });
    }


    /**
     * The shortcuts everyone tries first. Bound on the document so they are
     * heard wherever the focus is, and answered only for this designer - see
     * `ours` - so a second one on the same page keeps its own.
     */
    function onShortcut(event) {
        if (!ours(event)) return;

        const key = event.key.toLowerCase();

        /**
         * Zoom is one key: z in, alt+z out.
         *
         * Before the ctrl guard because it is not a ctrl shortcut - and it must
         * stay out of ctrl's way, or it would take undo. Held back while a
         * field has the caret, for the same reason copy is: the rail is full of
         * boxes people type the letter z into.
         */
        if (key === 'z' && !event.ctrlKey && !event.metaKey) {
            if (event.target.closest?.('input, textarea, select')) return;

            event.preventDefault();
            stepZoom(event.altKey ? -1 : 1);
            return;
        }

        if (!(event.ctrlKey || event.metaKey)) return;

        /**
         * Copy and paste stay the browser's while a field has the caret, or
         * while there is text selected. Taking them would break copying a value
         * out of the rail, which people do far more often than they copy an
         * item - and a shortcut that works everywhere except where you need it
         * is worse than one that was never bound.
         */
        if (key === 'c' || key === 'v') {
            if (event.target.closest?.('input, textarea, select')) return;
            if (key === 'c' && String(globalThis.getSelection?.() ?? '')) return;

            event.preventDefault();
            act(key === 'c' ? 'copy-items' : 'paste-items');
            return;
        }

        if (key === 's') {
            event.preventDefault();
            act('save');
            return;
        }

        if (key === 'o') {
            event.preventDefault();
            act('open');
            return;
        }

        if (key === 'e') {
            event.preventDefault();
            act('toggle-preview');
            return;
        }

        /**
         * ctrl+0 is the way back to 100% from wherever the z key has got to.
         * The stepping itself is z's; ctrl +/- is left to the browser here,
         * which is not something the viewer next door does - a report being
         * arranged is scrolled and dragged far more than one being read, and a
         * modifier on every zoom is one modifier too many for that.
         */
        if (key === '0') {
            event.preventDefault();
            setZoom(1);
            return;
        }

        if (key === 'z') {
            event.preventDefault();
            act(event.shiftKey ? 'redo' : 'undo');
            return;
        }

        if (key === 'y') {
            event.preventDefault();
            act('redo');
            return;
        }

        if (key === 'd') {
            event.preventDefault();
            act('duplicate-item');
        }
    }

    bar.addEventListener('click', onChromeClick);
    foot.addEventListener('click', onChromeClick);
    toasts.addEventListener('click', onChromeClick);
    root.addEventListener('pointerdown', takeFocus);
    doc.addEventListener('keydown', onShortcut);

    canvas.addEventListener('contextmenu', onContextMenu);
    /** the pill is pinned to the page area, so a scroll leaves it behind */
    canvas.addEventListener('scroll', closeMenu);
    doc.addEventListener('pointerdown', onDocumentDown);
    doc.addEventListener('keydown', onMenuKey);

    return {
        /** the layout as it currently stands - the thing onSave will be given */
        get layout() { return state.layout; },

        /** 'design' or 'preview' */
        get mode() { return state.mode; },

        /** run the report, or go back to arranging it */
        togglePreview,

        /** the data the report is asking for, derived from the layout */
        get sampleData() { return sampleData(state.layout); },

        /** the item being edited, as `{ band, id }`, or null */
        /** the item the rail describes - the most recently selected */
        get selection() { return primary(); },

        /** every selected item, oldest first */
        get selections() { return [...state.selection]; },

        select: setSelection,

        /** the filename stem this report is saved under, or null */
        get id() { return state.id; },

        /** whether there are changes the disk has not seen */
        get dirty() { return state.dirty; },

        /** swap the report being edited */
        open(next, openId = null) {
            replaceLayout(
                isEmptyLayout(next) ? blankLayout() : next,
                { id: openId, dirty: false });

            history.reset(state.layout);
            refreshBar();

            return validateLayout(state.layout);
        },

        /** save it where it came from, asking for a name the first time */
        save: saveReport,

        redraw: draw,

        destroy() {
            detach();
            detachPanel();
            bar.removeEventListener('click', onChromeClick);
            foot.removeEventListener('click', onChromeClick);
            toasts.removeEventListener('click', onChromeClick);
            root.removeEventListener('pointerdown', takeFocus);
            doc.removeEventListener('keydown', onShortcut);
            canvas.removeEventListener('contextmenu', onContextMenu);
            canvas.removeEventListener('scroll', closeMenu);
            doc.removeEventListener('pointerdown', onDocumentDown);
            doc.removeEventListener('keydown', onMenuKey);
            (doc.defaultView ?? globalThis)
                .removeEventListener('resize', onViewportResize);
            zoomPicker?.destroy();
            closeMenu();
            clearTimeout(complain.timer);
            clearTimeout(flashBand.timer);
            /** a report window shows what was passed to it; it cannot outlive this */
            for (const opened of windows) opened.destroy();
            windows.clear();

            root.innerHTML = '';
            root.classList.remove('report-designer');
        }
    };
}


function chrome(layout) {
    const size = layout.page
        ? `${layout.page.width} &times; ${layout.page.height}`
        : '';

    return `
    <header class="dz-bar" data-role="bar">
        <span class="dz-brand">Report Studio</span>

        <span class="dz-title">
            <span class="dz-name" data-role="name">${escapeText(layout.name ?? '')}</span>
            <span class="dz-status" data-role="status">Not saved yet</span>
        </span>

        <div class="dz-bar-group">
            <button type="button" class="dz-tool" data-role="undo" data-action="undo"
                    title="Undo (ctrl+Z)" aria-label="Undo" disabled
                >${icon('undo')}</button>
            <button type="button" class="dz-tool" data-role="redo" data-action="redo"
                    title="Redo (ctrl+shift+Z)" aria-label="Redo" disabled
                >${icon('redo')}</button>
        </div>

        <div class="dz-bar-group">
            <button type="button" class="dz-tool" data-action="open"
                    title="Open a report (ctrl+O)" aria-label="Open a report"
                >${icon('open')}</button>
            <button type="button" class="dz-tool" data-action="save"
                    title="Save (ctrl+S)" aria-label="Save"
                >${icon('save')}</button>
            <button type="button" class="dz-tool" data-action="data"
                    title="The data this report needs" aria-label="Report data"
                >${icon('data')}</button>
        </div>

        <div class="dz-bar-group">
            <button type="button" class="dz-tool" data-role="rulers"
                    data-action="toggle-rulers"
                    title="Rulers and guides - drag off a ruler to place one"
                    aria-label="Rulers and guides" aria-pressed="false"
                >${icon('ruler')}</button>
            <button type="button" class="dz-tool" data-action="toggle-preview"
                    title="Run the report (ctrl+E)" aria-label="Run the report"
                    aria-pressed="false"
                >${icon('preview')}</button>

            <!--
                A button, not a link: the window is built from the design as it
                stands rather than fetched from a URL, so it works on a report
                that has never been saved - which a link to the preview screen
                could not, because that screen reads the report off the disk.
            -->
            <button type="button" class="dz-tool" data-role="open-preview"
                    data-action="open-window"
                    title="Open the report in its own window"
                    aria-label="Open the report in its own window"
                >${icon('external')}</button>
        </div>

        <span class="dz-pages" data-role="pages"></span>
        <span class="dz-size" data-role="size">${size}</span>

        <!--
            The same three controls the viewer has, in the same order and with
            the same shortcuts. A designer and a preview of the same report
            should not zoom differently.
        -->
        <div class="dz-bar-group dz-zoom-group">
            <button type="button" class="dz-tool" data-role="zoom-out"
                    data-action="zoom-out"
                    title="Zoom out (alt+Z)" aria-label="Zoom out">&#8722;</button>

            <div class="dropdown" data-role="zoom-dropdown">
                <button type="button" class="dropdown-trigger" data-role="zoom"
                        aria-haspopup="listbox" aria-expanded="false"
                        aria-label="Zoom level">
                    <span class="dropdown-value">100%</span>
                    <span class="dropdown-caret" aria-hidden="true"></span>
                </button>

                <ul class="dropdown-menu" data-role="zoom-menu" role="listbox"
                    aria-label="Zoom level" hidden>
                    <li class="dropdown-item" role="option" tabindex="-1"
                        data-value="fit">Fit width</li>
                    ${ZOOM_STEPS.map(step => `
                    <li class="dropdown-item" role="option" tabindex="-1"
                        data-value="${step}"${step === 1 ? ' data-selected="true"' : ''}
                        >${Math.round(step * 100)}%</li>`).join('')}
                </ul>
            </div>

            <button type="button" class="dz-tool" data-role="zoom-in"
                    data-action="zoom-in"
                    title="Zoom in (Z)" aria-label="Zoom in">&#43;</button>
        </div>
    </header>

    <div class="dz-body">
        <div class="dz-main">
            <div class="dz-canvas" data-role="canvas">
                <!--
                    Two boxes for one job. The inner one is scaled, and a
                    transform changes nothing about layout - so at 200% there
                    would be nothing to scroll. The outer one is given the
                    scaled size in px, and is what the canvas scrolls.
                -->
                <div class="dz-stage" data-role="stage">
                    <div class="dz-zoom-layer" data-role="zoom-layer"></div>
                </div>
            </div>

            <!--
                The tools sit under the page rather than in the bar: the bar is
                about the report as a whole, and these act on the band you are
                looking at. Icon-only, so the strip stays out of the way of the
                thing being designed - the label lives on the button for a
                screen reader and in the tooltip for everyone else.
            -->
            <footer class="dz-foot" data-role="foot">
                <button type="button" class="dz-tool" data-action="add-text"
                        title="Add a text box" aria-label="Add a text box"
                    >${icon('text')}</button>
                <button type="button" class="dz-tool" data-role="add-table"
                        data-action="add-table"
                        title="Add a table" aria-label="Add a table"
                    >${icon('table')}</button>
                <button type="button" class="dz-tool" data-action="add-line"
                        title="Add a line" aria-label="Add a line"
                    >${icon('line')}</button>
                <button type="button" class="dz-tool" data-action="add-box"
                        title="Add a box" aria-label="Add a box"
                    >${icon('box')}</button>
                <button type="button" class="dz-tool" data-action="add-field"
                        title="Insert a page number, date or total"
                        aria-label="Insert a field"
                    >${icon('field')}</button>
            </footer>

            <!--
                The corner messages, in the page area rather than the window.
                Pinned to the window they would hang over the properties rail -
                which is where the band switches are, and so where most of what
                the validator complains about is actually fixed.
            -->
            <div class="dz-toasts" data-role="toasts"></div>
        </div>

        <aside class="dz-panel" data-role="panel" aria-label="Properties"></aside>
    </div>`;
}


/**
 * The validator already writes in the user's terms - "bands[2].items[0].value
 * must be a string" - so this only has to show the list rather than translate it.
 */
/**
 * An item id comes from a hand-written layout file, so it can hold anything.
 * CSS.escape is absent in some test environments, hence the fallback.
 */
function cssEscape(value) {
    const text = String(value);
    return globalThis.CSS?.escape ? CSS.escape(text) : JSON.stringify(text).slice(1, -1);
}


function escapeText(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

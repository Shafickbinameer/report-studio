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
import { drawSheet, selectionBox, selectionBoxes, bandUnder } from './canvas.js';
import { attachEditing } from './select.js';
import {
    drawPanel, drawReportPanel, drawManyPanel, attachPanel, syncPanel
} from './panel.js';
import { icon } from './icons.js';
import { askColumns, askReport, askName, askData, askToken } from './dialog.js';
import { sampleData } from './sample-data.js';
import { drawPreview } from './preview.js';
import { createHistory } from './history.js';
import { createStore, StoreError, toId } from '../shared/store.js';
import {
    addBand, removeBand, findBand, addItem, removeItem, moveItemToBand,
    createText, createTable, addColumn, removeColumn, targetBand
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

    const files = store ?? createStore();

    const state = {
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
        /** 'design' arranges the bands; 'preview' runs the report */
        mode: 'design'
    };

    const history = createHistory(state.layout);

    root.classList.add('report-designer');
    root.innerHTML = chrome(state.layout);

    const canvas = root.querySelector('[data-role="canvas"]');
    const panel = root.querySelector('[data-role="panel"]');
    const bar = root.querySelector('[data-role="bar"]');
    const foot = root.querySelector('[data-role="foot"]');
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
         * The issues are a banner rather than a replacement, because most of
         * them are survivable - setting groupBy before adding a group band is
         * one keystroke, and blanking the canvas for it would be a punishment.
         * Only a layout that cannot be drawn at all leaves nothing behind it.
         */
        const issues = validateLayout(state.layout);

        if (state.mode === 'preview') {
            const run = drawPreview(state.layout, state.data);

            canvas.innerHTML = run.markup;
            pages.textContent = run.error
                ? ''
                : `${run.pageCount} page${run.pageCount === 1 ? '' : 's'}`;

            return issues;
        }

        pages.textContent = '';

        let sheet = '';

        try {
            sheet = drawSheet(state.layout, state.selection);
        } catch {
            sheet = '';
        }

        canvas.innerHTML = (issues.length ? problems(issues) : '') + sheet;
        return issues;
    }


    /**
     * A drag redraws sixty times a second, and rebuilding the page's markup that
     * often is how a hand-written drag ends up feeling worse than the library it
     * replaced. While the pointer is down only the two boxes that moved are
     * touched; the full redraw happens once, when it is let go.
     */
    function patch() {
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
        const link = bar.querySelector('[data-role="open-preview"]');

        if (state.id) {
            link.href = `../preview/?report=${encodeURIComponent(state.id)}`;
            link.removeAttribute('aria-disabled');
            link.title = 'Open in the preview screen';
        } else {
            link.removeAttribute('href');
            link.setAttribute('aria-disabled', 'true');
            link.title = 'Save the report first - the preview screen reads it from disk';
        }

        bar.querySelector('[data-role="undo"]').disabled = !history.canUndo;
        bar.querySelector('[data-role="redo"]').disabled = !history.canRedo;
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


    function flashBand(type) {
        clearTimeout(flashBand.timer);
        markTarget(type);

        flashBand.timer = setTimeout(() => markTarget(null), 1200);
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
    function complain(error) {
        const message = error instanceof StoreError
            ? error.message
            : `Something went wrong: ${error?.message ?? error}`;

        const note = bar.querySelector('[data-role="status"]');

        note.textContent = message;
        note.dataset.problem = 'true';

        clearTimeout(complain.timer);
        complain.timer = setTimeout(() => {
            delete note.dataset.problem;
            refreshBar();
        }, 6000);
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
         * render.js emits the same data-item-id attributes items.js gives the
         * canvas - which is the point of one drawing path, and also means a
         * click on a rendered page would otherwise select and drag the item
         * behind it.
         */
        enabled: () => state.mode === 'design',
        /**
         * A drag moves x and y, which the rail is showing - so the controls are
         * refreshed rather than rebuilt. Rebuilding them under a cursor takes
         * the focus and the caret with it.
         */
        onTarget: markTarget,

        commit: ({ live, band }) => {
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
            if (!live) record(`move:${state.selection.map(o => o.id).join(',')}`);
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
         */
        changed: (key) => {
            draw();
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
     * The shortcuts everyone tries first. Bound on the root rather than on
     * document, so a second designer on the same page does not answer for this
     * one, and so they go when it does.
     */
    function onShortcut(event) {
        if (!(event.ctrlKey || event.metaKey)) return;

        const key = event.key.toLowerCase();

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

        if (key === 'z') {
            event.preventDefault();
            act(event.shiftKey ? 'redo' : 'undo');
            return;
        }

        if (key === 'y') {
            event.preventDefault();
            act('redo');
        }
    }

    bar.addEventListener('click', onChromeClick);
    foot.addEventListener('click', onChromeClick);
    root.addEventListener('keydown', onShortcut);

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
            root.removeEventListener('keydown', onShortcut);
            clearTimeout(complain.timer);
            clearTimeout(flashBand.timer);
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
            <button type="button" class="dz-tool" data-action="toggle-preview"
                    title="Run the report (ctrl+E)" aria-label="Run the report"
                    aria-pressed="false"
                >${icon('preview')}</button>

            <!--
                A link, not a button: it goes to the other screen, and a link is
                what a browser lets you middle-click, bookmark and open beside
                this one. The href is relative, so it resolves wherever the two
                pages happen to be mounted.
            -->
            <a class="dz-tool" data-role="open-preview" target="_blank"
               rel="noopener" title="Open in the preview screen"
               aria-label="Open in the preview screen"
                >${icon('external')}</a>
        </div>

        <span class="dz-pages" data-role="pages"></span>
        <span class="dz-size">${size}</span>
    </header>

    <div class="dz-body">
        <div class="dz-main">
            <div class="dz-canvas" data-role="canvas"></div>

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
                <button type="button" class="dz-tool" data-action="add-table"
                        title="Add a table" aria-label="Add a table"
                    >${icon('table')}</button>
                <button type="button" class="dz-tool" data-action="add-field"
                        title="Insert a page number, date or total"
                        aria-label="Insert a field"
                    >${icon('field')}</button>
            </footer>
        </div>

        <aside class="dz-panel" data-role="panel" aria-label="Properties"></aside>
    </div>`;
}


/**
 * The validator already writes in the user's terms - "bands[2].items[0].value
 * must be a string" - so this only has to show the list rather than translate it.
 */
function problems(issues) {
    return `
    <div class="dz-problems" role="alert">
        <h2>This report will not render yet</h2>
        <ul>${issues.map(i => `<li>${escapeText(i)}</li>`).join('')}</ul>
    </div>`;
}


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

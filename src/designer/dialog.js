/**
 * dialog.js is the designer's modal, and the one it currently needs: how many
 * columns a new table starts with.
 *
 * Hand-written rather than <dialog>, matching the preview - that element is
 * still unimplemented in the environment the specs run in, and a stubbed
 * showModal would test the stub instead of the behaviour. The shell's
 * appearance is shared/modal.css, so both screens' dialogs are the same object.
 *
 * It resolves a promise rather than taking a callback: `const n = await
 * askColumns(root)` reads as the question it is, and cancelling is one `null`
 * rather than a second branch to wire.
 */

import { DEFAULT_COLUMNS } from './structure.js';
import { bandLabel } from './grouping.js';
import { toId } from '../shared/store.js';
import { esc } from '../render/items.js';
import { createDropdown } from '../shared/dropdown.js';
import {
    effectiveFormat, formatValue, toNumber, DATE_PATTERNS, DATETIME_PATTERNS, MAX_DECIMALS,
    CURRENCY_SYMBOLS
} from '../engine/format.js';
import { UNARY_OPS } from '../engine/highlight.js';
import {
    TOKENS, findToken, needsField, resolvesIn, tokenItem, aggregateScope,
    availableFields, bandChoices, defaultBand
} from './tokens.js';


/** the same ceiling the rail can comfortably list back to you */
const MAX_COLUMNS = 20;


/**
 * Asks how many columns a new table should have.
 *
 * @param {Element} root the designer's own element, so the dialog is torn down
 *   with it rather than left on document.body
 * @returns {Promise<number|null>} the count, or null if it was cancelled
 */
export function askColumns(root) {
    return open(root, 'column-dialog', columnsMarkup(), (host, done) => {
        const field = host.querySelector('[data-role="count"]');

        /** focus and select, so typing a different number replaces it */
        field.focus();
        field.select();

        host.querySelector('form').addEventListener('submit', event => {
            event.preventDefault();

            const count = Math.round(Number(field.value));
            done(Number.isFinite(count) && count > 0
                ? Math.min(count, MAX_COLUMNS)
                : DEFAULT_COLUMNS);
        });
    });
}


/**
 * Asks which report to open.
 *
 * The list is what the server found on disk, so a report that will not parse is
 * still offered - it is the one most in need of opening. It is marked, and
 * loading it will fail with the server's own words rather than silently.
 *
 * @param {Element} root
 * @param {object[]} reports `{ id, name, updatedAt, readable }`
 * @returns {Promise<{id: string}|{blank: true}|null>}
 */
export function askReport(root, reports) {
    const list = reports || [];

    return open(root, 'open-dialog', reportsMarkup(list), (host, done) => {
        host.querySelector('[data-role="new"]')
            ?.addEventListener('click', () => done({ blank: true }));

        const wrapper = host.querySelector('[data-role="report-dropdown"]');
        const confirm = host.querySelector('[data-role="confirm"]');

        if (!wrapper || !list.length) {
            host.querySelector('[data-role="new"]')?.focus();
            return;
        }

        const picker = createDropdown(wrapper);
        const meta = host.querySelector('[data-role="report-meta"]');

        /**
         * The name is what someone is choosing by; the filename and the date
         * are what they check they picked the right one with. A dropdown shows
         * one line, so the rest goes underneath it rather than being lost.
         */
        const describe = () => {
            const chosen = list.find(r => r.id === picker.value) ?? list[0];
            if (!chosen) return;

            meta.textContent = `${chosen.id}.json${
                chosen.readable === false ? ' - will not parse' : ''
            }${when(chosen.updatedAt)}`;

            meta.toggleAttribute('data-unreadable', chosen.readable === false);
        };

        picker.addEventListener('change', describe);
        describe();

        confirm.addEventListener('click', () => done({ id: picker.value }));
        confirm.focus();

        /** the dropdown listens on document while it is open */
        host.addEventListener('dz-closing', () => picker.destroy());
    });
}


/**
 * Asks what to call a report that has not been saved before.
 *
 * The id is shown as it is typed, because the id is the filename and someone
 * naming a report "Sales / June" should see `sales-june` before it is written
 * rather than wonder later where the file went.
 *
 * @param {Element} root
 * @param {string} [suggested] the report's current name
 * @returns {Promise<{id: string, name: string}|null>}
 */
export function askName(root, suggested = '') {
    return open(root, 'save-dialog', nameMarkup(suggested), (host, done) => {
        const field = host.querySelector('[data-role="report-name"]');
        const shown = host.querySelector('[data-role="filename"]');
        const confirm = host.querySelector('[data-role="confirm"]');

        const refresh = () => {
            const id = toId(field.value);

            shown.textContent = id ? `${id}.json` : 'needs a letter or a digit';
            confirm.disabled = !id;
        };

        field.addEventListener('input', refresh);
        refresh();

        field.focus();
        field.select();

        host.querySelector('form').addEventListener('submit', event => {
            event.preventDefault();

            const id = toId(field.value);
            if (id) done({ id, name: field.value.trim() || id });
        });
    });
}


/**
 * Asks whether to leave a report with changes the disk has not seen.
 *
 * Answered `false` by everything except the discard button - escape, the
 * backdrop, the close of the dialog. Somebody who dismisses a question about
 * losing work has not agreed to lose it, and the safe answer is the one that
 * costs a second click rather than an afternoon.
 *
 * Keeping is the primary button and takes the focus for the same reason: enter
 * is what a dialog gets pressed at, and enter here means "not that".
 *
 * @param {Element} root
 * @param {string} [name] the report's name, so the question says which
 * @returns {Promise<boolean>} true only when discard was chosen
 */
export function askDiscard(root, name = '') {
    return open(root, 'discard-dialog', discardMarkup(name), (host, done) => {
        host.querySelector('[data-role="discard"]')
            .addEventListener('click', () => done(true));

        host.querySelector('[data-role="cancel"]').focus();
    }).then(answer => answer === true);
}


/**
 * The shell every dialog shares: mount, focus, wire cancel, resolve once.
 *
 * @param {Element} root
 * @param {string} role
 * @param {string} body
 * @param {(host: Element, done: (value: any) => void) => void} wire
 * @returns {Promise<any>} whatever `done` was given, or null if cancelled
 */
function open(root, role, body, wire) {
    return new Promise(resolve => {
        /** created in the document the designer is mounted in, not always this one */
        const host = root.ownerDocument.createElement('div');
        host.className = 'modal';
        host.dataset.role = role;
        host.innerHTML = body;

        root.appendChild(host);

        let settled = false;

        function close(value) {
            if (settled) return;

            settled = true;
            /** so a dropdown inside can drop its document listener */
            host.dispatchEvent(new CustomEvent('dz-closing'));
            host.remove();
            resolve(value);
        }

        /**
         * Listened for on the dialog itself, not on document.
         *
         * A document listener outlives the element: destroying the designer
         * takes the dialog out of the DOM without ever calling close, and the
         * listener stays behind swallowing every later escape. On the host it
         * goes when the host goes, and there is nothing to remember to clean up.
         *
         * Captured, and stopped, because select.js listens for escape too and
         * would drop the selection behind the dialog being cancelled.
         */
        function onKey(event) {
            if (event.key !== 'Escape') return;

            event.stopPropagation();
            event.preventDefault();
            close(null);
        }

        for (const node of host.querySelectorAll('[data-role="cancel"], [data-role="backdrop"]')) {
            node.addEventListener('click', () => close(null));
        }

        host.addEventListener('keydown', onKey, true);

        wire(host, close);
    });
}


function columnsMarkup() {
    return `
    <div class="modal-backdrop" data-role="backdrop"></div>

    <div class="modal-card" role="dialog" aria-modal="true"
         aria-labelledby="dz-columns-title">
        <h2 id="dz-columns-title">Add table</h2>

        <form>
            <div class="dz-field dz-field-count">
                <label for="dz-columns">Columns</label>
                <input type="number" id="dz-columns" data-role="count"
                       value="${DEFAULT_COLUMNS}" min="1" max="${MAX_COLUMNS}"
                       step="1" required>
            </div>

            <p class="modal-summary">
                Each column starts 50px wide. Rows come from your data, so there
                is no count to set here.
            </p>

            <div class="modal-actions">
                <button type="button" data-role="cancel">Cancel</button>
                <button type="submit" class="is-primary" data-role="confirm">Add</button>
            </div>
        </form>
    </div>`;
}


/**
 * The report list.
 *
 * Names, not filenames - "Sales summary" is how someone thinks of a report, and
 * the id underneath it is only interesting when it is about to become a file.
 */
function reportsMarkup(reports) {
    const list = reports || [];

    const options = list.map((report, index) => `
        <li class="dropdown-item" role="option" tabindex="-1"
            data-value="${esc(report.id)}"
            ${index === 0 ? 'data-selected="true"' : ''}
            >${esc(report.name || report.id)}</li>`).join('');

    const picker = `
        <div class="dz-field dz-field-picker">
            <label id="dz-open-label">Report</label>

            <div class="dropdown" data-role="report-dropdown">
                <button type="button" class="dropdown-trigger"
                        aria-haspopup="listbox" aria-expanded="false"
                        aria-labelledby="dz-open-label">
                    <span class="dropdown-value"></span>
                    <span class="dropdown-caret" aria-hidden="true"></span>
                </button>

                <ul class="dropdown-menu" role="listbox"
                    aria-labelledby="dz-open-label" hidden>${options}</ul>
            </div>
        </div>

        <p class="dz-report-meta" data-role="report-meta" aria-live="polite"></p>`;

    return `
    <div class="modal-backdrop" data-role="backdrop"></div>

    <div class="modal-card is-roomy" role="dialog" aria-modal="true"
         aria-labelledby="dz-open-title">
        <h2 id="dz-open-title">Open report</h2>

        ${list.length ? picker : `<p class="modal-summary">
            No reports saved yet. Start a new one and save it.</p>`}

        <div class="modal-actions">
            <button type="button" data-role="cancel">Cancel</button>
            <button type="button" data-role="new">New report</button>
            ${list.length
            ? `<button type="button" class="is-primary" data-role="confirm">Open</button>`
            : ''}
        </div>
    </div>`;
}


/**
 * A date, said the way a person would. Exact times are noise for a file that
 * was touched this afternoon, and wrong for one touched last year.
 */
function when(iso) {
    if (!iso) return '';

    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return '';

    return ` - ${at.toLocaleDateString(undefined, {
        day: 'numeric', month: 'short', year: 'numeric'
    })}`;
}


function nameMarkup(suggested) {
    return `
    <div class="modal-backdrop" data-role="backdrop"></div>

    <div class="modal-card" role="dialog" aria-modal="true"
         aria-labelledby="dz-save-title">
        <h2 id="dz-save-title">Save report</h2>

        <form>
            <div class="dz-field dz-field-text">
                <label for="dz-save-name">Name</label>
                <input type="text" id="dz-save-name" data-role="report-name"
                       value="${esc(suggested)}" spellcheck="false" required>
            </div>

            <p class="modal-summary">
                Saved as <code data-role="filename"></code>
            </p>

            <div class="modal-actions">
                <button type="button" data-role="cancel">Cancel</button>
                <button type="submit" class="is-primary" data-role="confirm">Save</button>
            </div>
        </form>
    </div>`;
}


/**
 * The unsaved-changes question.
 *
 * Discard sits on the left as the plain button and keeping takes the accent,
 * because the accent is where the eye goes and the eye should not be led to the
 * one that throws work away.
 */
function discardMarkup(name) {
    const subject = name ? `<strong>${esc(name)}</strong>` : 'This report';

    return `
    <div class="modal-backdrop" data-role="backdrop"></div>

    <div class="modal-card" role="dialog" aria-modal="true"
         aria-labelledby="dz-discard-title">
        <h2 id="dz-discard-title">Unsaved changes</h2>

        <p class="modal-summary">
            ${subject} has changes that have not been saved. Opening another
            report closes this one, and the changes go with it.
        </p>

        <div class="modal-actions">
            <button type="button" class="is-danger" data-role="discard">Discard changes</button>
            <button type="button" class="is-primary" data-role="cancel">Keep editing</button>
        </div>
    </div>`;
}


/**
 * Shows the data the report is asking for, and lets it be replaced.
 *
 * This is the answer to a real question a layout does not otherwise answer:
 * *what do I have to supply?* The keys are read off the layout - every
 * placeholder, every column field, the dataset and the grouping field - so the
 * payload shown is the exact shape the engine will look for. Filling in real
 * values over the samples is then a matter of typing, not of guessing.
 *
 * @param {Element} root
 * @param {object} data the payload to show
 * @param {object} [options]
 * @param {string|null} [options.id] the report's id, for naming the file
 * @param {boolean} [options.generated] whether this was derived rather than loaded
 * @returns {Promise<object|null>} the edited payload, or null if cancelled
 */
export function askData(root, data, { id = null, generated = false } = {}) {
    return open(root, 'data-dialog', dataMarkup(data, id, generated), (host, done) => {
        const field = host.querySelector('[data-role="payload"]');
        const problem = host.querySelector('[data-role="parse-error"]');
        const confirm = host.querySelector('[data-role="confirm"]');

        /**
         * Checked as it is typed rather than on submit: a payload someone has
         * pasted and broken should say so beside the box, not after the click
         * that was meant to save it.
         */
        const check = () => {
            try {
                const parsed = JSON.parse(field.value);
                const usable = parsed != null && typeof parsed === 'object'
                    && !Array.isArray(parsed);

                problem.textContent = usable
                    ? ''
                    : 'The payload must be a JSON object keyed by dataset name.';
                confirm.disabled = !usable;
            } catch (error) {
                problem.textContent = error.message;
                confirm.disabled = true;
            }
        };

        field.addEventListener('input', check);
        check();

        field.focus();

        confirm.addEventListener('click', () => {
            try {
                done(JSON.parse(field.value));
            } catch {
                /* the box already says why; leave the dialog open */
            }
        });
    });
}


function dataMarkup(data, id, generated) {
    const file = id ? `${id}.data.json` : 'a .data.json beside the report';

    return `
    <div class="modal-backdrop" data-role="backdrop"></div>

    <div class="modal-card is-wide" role="dialog" aria-modal="true"
         aria-labelledby="dz-data-title">
        <h2 id="dz-data-title">Report data</h2>

        <p class="modal-summary">
            ${generated
            ? `These keys were read off the report - every placeholder, every
               column, and the field it groups by. Replace the sample values
               with real ones.`
            : `The data this report is currently previewed with.`}
            Saved as <code>${esc(file)}</code>.
        </p>

        <textarea class="dz-payload" data-role="payload" rows="16"
                  spellcheck="false" aria-label="Report data"
            >${esc(JSON.stringify(data, null, 2))}</textarea>

        <p class="dz-parse-error" data-role="parse-error" aria-live="polite"></p>

        <div class="modal-actions">
            <button type="button" data-role="cancel">Cancel</button>
            <button type="button" class="is-primary" data-role="confirm">Save data</button>
        </div>
    </div>`;
}


/**
 * Asks which field to insert, and where.
 *
 * The list is spec 3.4's placeholder table made clickable. Each row shows the
 * text it will insert, so the syntax is learned by using it rather than looked
 * up - and the two things that are easy to get wrong, the field name inside an
 * aggregate and the band it has to sit in to resolve at all, are picked from
 * what the report actually has rather than typed.
 *
 * @param {Element} root
 * @param {object} layout
 * @param {string|null} [current] the band the selection is on
 * @returns {Promise<{value: string, band: string, align: string, w: number}|null>}
 */
export function askToken(root, layout, current = null) {
    const fields = availableFields(layout);

    return open(root, 'token-dialog', tokenMarkup(layout, fields, current),
        (host, done) => {
            const fieldRow = host.querySelector('[data-role="field-row"]');
            const warning = host.querySelector('[data-role="token-warning"]');
            const confirm = host.querySelector('[data-role="confirm"]');

            const fieldPicker = fields.length
                ? createDropdown(host.querySelector('[data-role="field-dropdown"]'))
                : null;

            const bandWrapper = host.querySelector('[data-role="band-dropdown"]');
            let bandPicker = null;

            const chosen = () => findToken(
                host.querySelector('[name="dz-token"]:checked')?.value);

            /**
             * The band list is rebuilt per token, not merely re-selected: an
             * aggregate has fewer places it can go than a page number does, and
             * leaving the others listed offers a choice that prints nothing.
             *
             * The whole wrapper is replaced rather than just the menu, because
             * createDropdown binds to the trigger - reusing it would leave the
             * old listeners attached and every click would toggle twice.
             */
            function rebuildBands(token) {
                bandPicker?.destroy();

                const choices = bandChoices(layout, token);
                const wanted = defaultBand(layout, token, current);

                bandWrapper.innerHTML = listbox('band',
                    choices.map(b => ({ value: b, label: bandLabel(b) })), wanted);

                bandPicker = createDropdown(bandWrapper);
                bandPicker.addEventListener('change', () => refresh());
            }

            function refresh({ retarget = false } = {}) {
                const token = chosen();
                if (!token) return;

                fieldRow.hidden = !needsField(token);

                if (retarget) rebuildBands(token);

                const band = bandPicker.value;
                const ok = resolvesIn(token, band);
                const note = ok ? scopeNote(token, band) : aggregateNote(token, band);

                warning.textContent = note;
                warning.hidden = !note;
                warning.classList.toggle('is-note', ok);

                /**
                 * Not disabled. It is the author's report, and an item placed
                 * somewhere it prints nothing today may be somewhere it prints
                 * tomorrow - the warning is what they need, not a refusal.
                 */
                confirm.textContent = ok ? 'Insert' : 'Insert anyway';
            }

            for (const radio of host.querySelectorAll('[name="dz-token"]')) {
                radio.addEventListener('change', () => refresh({ retarget: true }));
            }

            /** rebuildBands attaches the change listener each time it runs */
            refresh({ retarget: true });

            confirm.addEventListener('click', () => {
                const token = chosen();
                if (!token) return;

                const field = needsField(token)
                    ? (fieldPicker?.value || 'field')
                    : undefined;

                done({ ...tokenItem(token, field), band: bandPicker.value });
            });

            host.querySelector('[name="dz-token"]')?.focus();

            host.addEventListener('dz-closing', () => {
                fieldPicker?.destroy();
                bandPicker?.destroy();
            });
        });
}


function aggregateNote(token, band) {
    return `${token.label} prints nothing in a ${bandLabel(band)}.`;
}


/**
 * What the chosen band means for an aggregate.
 *
 * An aggregate resolves wherever it is put, so there is nothing left to warn
 * about - but `{sum(price)}` is a different number in a group footer and in a
 * report footer, and both of them are right. Which one is being asked for is
 * the thing worth saying, and the dialog is the last moment anyone will be
 * looking at the question.
 */
function scopeNote(token, band) {
    const scope = aggregateScope(token, band);

    if (scope === 'group') {
        return `In a ${bandLabel(band)}, ${token.label.toLowerCase()} is worked out over ` +
            `each group's own rows, once per group.`;
    }

    if (scope === 'report') {
        return `In a ${bandLabel(band)}, ${token.label.toLowerCase()} is worked out over ` +
            `every row in the report.`;
    }

    return '';
}


function tokenMarkup(layout, fields, current) {
    const first = TOKENS[0];

    const rows = TOKENS.map((token, index) => `
        <label class="dz-token">
            <input type="radio" name="dz-token" value="${esc(token.id)}"
                ${index === 0 ? 'checked' : ''}>
            <span class="dz-token-body">
                <span class="dz-token-name">${esc(token.label)}</span>
                <code class="dz-token-syntax">${esc(token.value)}</code>
                ${token.note ? `<span class="dz-token-note">${esc(token.note)}</span>` : ''}
            </span>
        </label>`).join('');

    return `
    <div class="modal-backdrop" data-role="backdrop"></div>

    <div class="modal-card is-roomy" role="dialog" aria-modal="true"
         aria-labelledby="dz-token-title">
        <h2 id="dz-token-title">Insert field</h2>

        <div class="dz-tokens" role="radiogroup" aria-labelledby="dz-token-title">
            ${rows}
        </div>

        ${picker('field', 'Field', fields.map(f => ({ value: f, label: f })),
        fields[0], { hidden: !needsField(first), empty: 'No fields yet - add a table first' })}

        ${picker('band', 'Band',
            bandChoices(layout, first).map(b => ({ value: b, label: bandLabel(b) })),
            defaultBand(layout, first, current))}

        <p class="dz-token-warning" data-role="token-warning" aria-live="polite" hidden></p>

        <div class="modal-actions">
            <button type="button" data-role="cancel">Cancel</button>
            <button type="button" class="is-primary" data-role="confirm">Insert</button>
        </div>
    </div>`;
}


/** one labelled listbox, the shape createDropdown expects */
function picker(role, label, options, selected, { hidden = false, empty = '' } = {}) {
    if (!options.length) {
        return `<p class="modal-summary">${esc(empty)}</p>`;
    }

    return `
    <div class="dz-field dz-field-picker" data-role="${role}-row"${hidden ? ' hidden' : ''}>
        <label id="dz-${role}-label">${esc(label)}</label>

        <div class="dropdown" data-role="${role}-dropdown">
            ${listbox(role, options, selected)}
        </div>
    </div>`;
}


/**
 * The trigger and the menu, without the wrapper - so the contents can be
 * replaced on their own when the options change.
 */
function listbox(role, options, selected) {
    return `
    <button type="button" class="dropdown-trigger"
            aria-haspopup="listbox" aria-expanded="false"
            aria-labelledby="dz-${role}-label">
        <span class="dropdown-value"></span>
        <span class="dropdown-caret" aria-hidden="true"></span>
    </button>

    <ul class="dropdown-menu" role="listbox"
        aria-labelledby="dz-${role}-label" hidden>
        ${options.map(o => `
            <li class="dropdown-item" role="option" tabindex="-1"
                data-value="${esc(o.value)}"
                ${o.value === selected ? 'data-selected="true"' : ''}
                >${esc(o.label)}</li>`).join('')}
    </ul>`;
}


/* ---------------- the format editor ---------------- */


/** the types the editor offers, in the order a person thinks of them */
const FORMAT_CHOICES = [
    { value: 'text', label: 'As it comes' },
    { value: 'number', label: 'Number' },
    { value: 'currency', label: 'Currency' },
    { value: 'percent', label: 'Percent' },
    { value: 'date', label: 'Date' },
    { value: 'datetime', label: 'Date & time' }
];

/** the values the sample line shows, per type: a big one, a negative, a zero */
const SAMPLES = {
    number: [1234567.891, -1500, 0],
    currency: [1234567.891, -1500, 0],
    percent: [0.1234, -0.05, 0],
    date: ['2026-06-17'],
    datetime: ['2026-06-17T15:04:00']
};

const CUSTOM = '__custom__';


/**
 * Asks how a text item's or a column's values should print - Crystal's Format
 * Editor, cut to what the engine does: the type, and for a number its places,
 * digit groups, negatives and zero, and for money its symbol; for a date its
 * layout. A sample line shows the result as it is chosen.
 *
 * What comes back says only what differs from the report's own defaults, so a
 * report switched to Indian digit groups later takes every format with it that
 * never asked for anything else.
 *
 * @param {Element} root
 * @param {object|null} current the format as it stands
 * @param {object|null} defaults the report's `layout.format`
 * @param {{title?: string}} [options]
 * @returns {Promise<{format: object|null}|null>} the new format - null for
 *   "as it comes" - or null when cancelled
 */
export function askFormat(root, current, defaults, { title = 'Format' } = {}) {
    const start = effectiveFormat(current, defaults)
        ?? { ...effectiveFormat({ type: 'number' }, defaults), type: 'text' };

    return open(root, 'format-dialog', formatMarkup(start, title), (host, done) => {
        const form = host.querySelector('form');
        const value = (role) => host.querySelector(`[data-role="${role}"]`)?.value;

        /** the format the controls describe, every key filled in */
        const read = () => {
            const type = host.querySelector('[name="format-type"]:checked')?.value ?? 'text';
            const chosen = value('pattern');

            return {
                type,
                decimals: decimalsFrom(value('decimals'), start.decimals),
                grouping: value('grouping'),
                negative: value('negative'),
                zero: value('zero'),
                symbol: value('symbolChoice') === CUSTOM ? (value('symbol') ?? '').trim() : (value('symbolChoice') ?? ''),
                symbolPosition: value('symbolPosition'),
                pattern: chosen === CUSTOM ? (value('customPattern') || start.pattern) : chosen
            };
        };

        const refresh = () => {
            const f = read();
            const isNumber = ['number', 'currency', 'percent'].includes(f.type);
            const isDate = f.type === 'date' || f.type === 'datetime';

            /** a date & time pattern list for a date & time, a date one for a date */
            if (isDate) syncPatterns(host, f.type, f.pattern);

            host.querySelector('[data-role="number-options"]').hidden = !isNumber;
            host.querySelector('[data-role="currency-options"]').hidden = f.type !== 'currency';
            host.querySelector('[data-role="date-options"]').hidden = !isDate;
            host.querySelector('[data-role="custom-row"]').hidden = value('pattern') !== CUSTOM;
            host.querySelector('[data-role="symbol-row"]').hidden = value('symbolChoice') !== CUSTOM;

            const shown = read();

            /** a number past the ends shows as the end it was held to; an empty box is left to be typed in */
            const places = host.querySelector('[data-role="decimals"]');
            if (places.value !== '' && Number(places.value) !== shown.decimals) {
                places.value = String(shown.decimals);
            }

            /** zero prints with the places chosen: 0, 0.00, 0.000 */
            const zero = host.querySelector('[data-role="zero"] option[value="zero"]');
            if (zero) zero.textContent = zeroLabel(shown.decimals);
            host.querySelector('[data-role="sample"]').innerHTML = shown.type === 'text'
                ? '<span>Printed as the data has it</span>'
                : (SAMPLES[shown.type] ?? []).map(v =>
                    `<span>${esc(formatValue(v, shown) || '(blank)')}</span>`).join('');
        };

        form.addEventListener('input', refresh);
        form.addEventListener('change', refresh);

        host.querySelector('[data-role="reset"]').addEventListener('click', () => {
            const type = read().type;
            done({ format: type === 'text' ? null : { type } });
        });

        form.addEventListener('submit', event => {
            event.preventDefault();
            done({ format: overrides(read(), defaults) });
        });

        refresh();
        host.querySelector('[name="format-type"]:checked')?.focus();
    });
}


/**
 * The places typed into the Decimals box, kept to what a format can hold - a
 * box cleared on the way to typing a new number keeps the last good one.
 * @param {string|undefined} raw
 * @param {number} fallback
 * @returns {number}
 */
function decimalsFrom(raw, fallback) {
    const n = Math.round(Number(raw));
    if (raw === '' || raw == null || !Number.isFinite(n)) return fallback;
    return Math.min(MAX_DECIMALS, Math.max(0, n));
}


/** what "zero as zero" prints with this many places */
function zeroLabel(decimals) {
    return (0).toFixed(decimals);
}


/**
 * A format as the layout should keep it: its type, and only the choices that
 * differ from what the report would give it anyway - the keys that belong to
 * its type, nothing a date has no use for.
 */
function overrides(chosen, defaults) {
    if (chosen.type === 'text') return null;

    const inherited = effectiveFormat({ type: chosen.type }, defaults);
    const keys = chosen.type === 'date' || chosen.type === 'datetime'
        ? ['pattern']
        : ['decimals', 'grouping', 'negative', 'zero',
            ...(chosen.type === 'currency' ? ['symbol', 'symbolPosition'] : [])];

    const format = { type: chosen.type };
    for (const key of keys) {
        if (chosen[key] !== inherited[key]) format[key] = chosen[key];
    }

    return format;
}


/** the pattern list for the type chosen, keeping what is selected if it can */
function syncPatterns(host, type, pattern) {
    const select = host.querySelector('[data-role="pattern"]');
    if (select.dataset.for === type) return;

    const list = type === 'datetime' ? DATETIME_PATTERNS : DATE_PATTERNS;
    const selected = list.includes(pattern) ? pattern : list[0];

    select.innerHTML = patternOptions(list, type, selected);
    select.dataset.for = type;
}


function patternOptions(list, type, selected) {
    const sample = SAMPLES[type][0];

    return [
        ...list.map(p => `<option value="${esc(p)}"${p === selected ? ' selected' : ''}
            >${esc(formatValue(sample, { type, pattern: p }))}  (${esc(p)})</option>`),
        `<option value="${CUSTOM}"${list.includes(selected) ? '' : ' selected'}>Custom…</option>`
    ].join('');
}


function formatMarkup(f, title) {
    const option = (current) => (o) => `<option value="${esc(o.value)}"
        ${o.value === current ? 'selected' : ''}>${esc(o.label)}</option>`;

    const select = (role, label, options, current) => `
        <div class="dz-field">
            <label for="dz-format-${role}">${esc(label)}</label>
            <select id="dz-format-${role}" data-role="${role}">
                ${options.map(option(current)).join('')}
            </select>
        </div>`;

    const dateType = f.type === 'datetime' ? 'datetime' : 'date';
    const patterns = dateType === 'datetime' ? DATETIME_PATTERNS : DATE_PATTERNS;
    const isCustom = !patterns.includes(f.pattern);
    const knownSymbol = CURRENCY_SYMBOLS.some(o => o.value === f.symbol);

    return `
    <div class="modal-backdrop" data-role="backdrop"></div>

    <div class="modal-card dz-format-card" role="dialog" aria-modal="true"
         aria-labelledby="dz-format-title">
        <h2 id="dz-format-title">${esc(title)}</h2>

        <form>
            <fieldset class="dz-format-types">
                <legend>Type</legend>
                ${FORMAT_CHOICES.map(o => `
                    <label class="dz-format-type">
                        <input type="radio" name="format-type" value="${o.value}"
                               ${o.value === f.type ? 'checked' : ''}>
                        <span>${esc(o.label)}</span>
                    </label>`).join('')}
            </fieldset>

            <div class="dz-format-group" data-role="number-options">
                <div class="dz-field">
                    <label for="dz-format-decimals">Decimals</label>
                    <input type="number" id="dz-format-decimals" data-role="decimals"
                           value="${f.decimals}" min="0" max="${MAX_DECIMALS}" step="1">
                </div>
                ${select('grouping', 'Digit groups', [
                    { value: 'international', label: '1,234,567' },
                    { value: 'indian', label: '12,34,567 (Indian)' },
                    { value: 'none', label: '1234567' }
                ], f.grouping)}
                ${select('negative', 'Negative', [
                    { value: 'minus', label: '-1,234' },
                    { value: 'brackets', label: '(1,234)' },
                    { value: 'trailing', label: '1,234-' }
                ], f.negative)}
                ${select('zero', 'Zero shows as', [
                    { value: 'zero', label: zeroLabel(f.decimals) },
                    { value: 'dash', label: '-' },
                    { value: 'blank', label: 'Nothing' }
                ], f.zero)}
            </div>

            <div class="dz-format-group" data-role="currency-options">
                ${select('symbolChoice', 'Symbol', [
                    ...CURRENCY_SYMBOLS,
                    { value: CUSTOM, label: 'Custom…' }
                ], knownSymbol ? f.symbol : CUSTOM)}
                ${select('symbolPosition', 'Symbol goes', [
                    { value: 'before', label: 'Before ₹100' },
                    { value: 'after', label: 'After 100 ₹' }
                ], f.symbolPosition)}
                <div class="dz-field" data-role="symbol-row"${knownSymbol ? ' hidden' : ''}>
                    <label for="dz-format-symbol">Custom symbol</label>
                    <input type="text" id="dz-format-symbol" data-role="symbol"
                           value="${esc(knownSymbol ? '' : f.symbol)}" maxlength="6"
                           spellcheck="false" placeholder="such as CHF">
                </div>
            </div>

            <div class="dz-format-group" data-role="date-options">
                <div class="dz-field">
                    <label for="dz-format-pattern">Layout</label>
                    <select id="dz-format-pattern" data-role="pattern" data-for="${dateType}">
                        ${patternOptions(patterns, dateType, isCustom ? CUSTOM : f.pattern)}
                    </select>
                </div>
                <div class="dz-field" data-role="custom-row"${isCustom ? '' : ' hidden'}>
                    <label for="dz-format-custom">Pattern</label>
                    <input type="text" id="dz-format-custom" data-role="customPattern"
                           value="${esc(isCustom ? f.pattern : '')}" spellcheck="false"
                           placeholder="dd/MM/yyyy">
                </div>
                <p class="modal-summary">
                    yyyy year · MM month · MMM Jun · dd day · HH hour · hh 12-hour ·
                    mm minute · a AM/PM
                </p>
            </div>

            <div class="dz-format-sample">
                <span class="dz-format-sample-label">Sample</span>
                <span class="dz-format-sample-values" data-role="sample"></span>
            </div>

            <div class="modal-actions">
                <button type="button" data-role="reset"
                        title="Keep the type, and take everything else from the report's own settings">
                    Report defaults</button>
                <button type="button" data-role="cancel">Cancel</button>
                <button type="submit" class="is-primary" data-role="confirm">Apply</button>
            </div>
        </form>
    </div>`;
}


/* ---------------- the highlight editor ---------------- */


/** a rule's tests, as the editor offers them */
const OP_CHOICES = [
    { value: '=', label: 'equals' },
    { value: '!=', label: 'is not' },
    { value: '<', label: 'is less than' },
    { value: '<=', label: 'is at most' },
    { value: '>', label: 'is more than' },
    { value: '>=', label: 'is at least' },
    { value: 'between', label: 'is between' },
    { value: 'contains', label: 'contains' },
    { value: 'startsWith', label: 'starts with' },
    { value: 'empty', label: 'is empty' },
    { value: 'notEmpty', label: 'is not empty' }
];

/** what "the value being drawn" is called in the subject choice */
const THIS_VALUE = '';

/** a rule's colour when it is first added: the report's own red */
const NEW_RULE_COLOR = '#b3261e';


/**
 * Asks for the highlight rules of a column, a table's rows or a text item -
 * Crystal's Highlighting Expert: a list of conditions, each with the style it
 * gives, the first that holds being the one used.
 *
 * Each rule reads as a sentence - "When this value is less than 0" - with its
 * style beside it: text colour, fill, bold, italic, and a sample drawn in it.
 *
 * @param {Element} root
 * @param {object[]|null} current the rules as they stand
 * @param {object} options
 * @param {string} [options.title]
 * @param {string[]} [options.fields] the fields a rule may test besides the value
 * @param {boolean} [options.rows] a table's row rules, which have no value of
 *   their own - every rule tests a field
 * @param {object|null} [options.format] how the value prints, for the sample
 * @returns {Promise<{rules: object[]|null}|null>} the rules - null for none -
 *   or null when cancelled
 */
export function askHighlight(root, current, { title = 'Highlight', fields = [], rows = false, format = null } = {}) {
    const rules = structuredClone(Array.isArray(current) ? current : []);

    /** a field a rule already tests is offered even if the report no longer names it */
    const subjects = [...new Set([...fields, ...rules.map(r => r.when?.field).filter(Boolean)])];

    const fresh = () => ({
        when: rows
            ? { field: subjects[0] ?? '', op: '=', value: '' }
            : { op: '<', value: 0 },
        style: { color: NEW_RULE_COLOR }
    });

    if (rules.length === 0) rules.push(fresh());

    return open(root, 'highlight-dialog', highlightMarkup(title), (host, done) => {
        const list = host.querySelector('[data-role="rules"]');

        const draw = () => {
            list.innerHTML = rules.map((rule, n) =>
                ruleMarkup(rule, n, rules.length, subjects, rows, format)).join('');
        };

        /** a typed value as the rule keeps it: a number when it is plainly one */
        const operand = (raw) => {
            const number = toNumber(raw);
            return number === null ? raw : number;
        };

        host.addEventListener('input', event => {
            const node = event.target.closest('[data-key]');
            const n = Number(node?.closest('[data-n]')?.dataset.n);
            const rule = rules[n];
            if (!rule) return;

            const key = node.dataset.key;

            if (key === 'field') {
                if (node.value === THIS_VALUE) delete rule.when.field;
                else rule.when.field = node.value;
            } else if (key === 'op') {
                rule.when.op = node.value;
                if (UNARY_OPS.includes(node.value)) {
                    delete rule.when.value;
                    delete rule.when.to;
                }
                /** which value boxes there are has changed */
                draw();
                list.querySelector(`[data-n="${n}"] [data-key="op"]`)?.focus();
                return;
            } else if (key === 'value' || key === 'to') {
                rule.when[key] = operand(node.value);
            } else if (key === 'color' || key === 'background') {
                rule.style[key] = node.value;
                node.closest('.dz-swatch')?.classList.remove('is-none');
            }

            refreshPreview(list, n, rule, format);
        });

        /** a <select> reports on change only in some browsers */
        host.addEventListener('change', event => {
            if (event.target.tagName === 'SELECT') {
                event.target.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        host.addEventListener('click', event => {
            const button = event.target.closest('[data-rule-action]');
            if (!button) return;

            event.preventDefault();

            const n = Number(button.closest('[data-n]')?.dataset.n);
            const action = button.dataset.ruleAction;

            if (action === 'add') {
                rules.push(fresh());
                draw();
                list.querySelector(`[data-n="${rules.length - 1}"] select, [data-n="${rules.length - 1}"] input`)?.focus();
                return;
            }

            const rule = rules[n];
            if (!rule) return;

            if (action === 'remove') rules.splice(n, 1);
            if (action === 'up' && n > 0) rules.splice(n - 1, 0, ...rules.splice(n, 1));
            if (action === 'clear') delete rule.style[button.dataset.key];
            if (action === 'bold') toggle(rule.style, 'fontWeight', 'bold');
            if (action === 'italic') toggle(rule.style, 'fontStyle', 'italic');

            draw();
        });

        host.querySelector('form').addEventListener('submit', event => {
            event.preventDefault();
            const kept = rules.filter(complete);
            done({ rules: kept.length ? kept : null });
        });

        draw();
        list.querySelector('select, input')?.focus();
    });
}


/** a style key set to `on`, or taken off when it already is */
function toggle(style, key, on) {
    if (style[key] === on) delete style[key];
    else style[key] = on;
}


/**
 * Whether a rule can ever hold: a test that compares has something to compare
 * with, and a row rule names its field. One left half-made is dropped on the
 * way out rather than saved as a layout validate.js would complain about.
 */
function complete(rule) {
    const { when } = rule;
    if (!when || !OP_CHOICES.some(o => o.value === when.op)) return false;
    if (UNARY_OPS.includes(when.op)) return true;

    const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
    return when.op === 'between' ? has(when.value) && has(when.to) : has(when.value);
}


/** the sample a rule shows: its own value in the column's format, drawn in its style */
function preview(rule, format) {
    const value = rule.when?.value;
    const shown = value === undefined || value === '' ? 'Sample' : formatValue(value, format) || 'Sample';
    const style = rule.style ?? {};

    const css = [
        style.color ? `color:${style.color}` : '',
        style.background ? `background:${style.background}` : '',
        style.fontWeight ? `font-weight:${style.fontWeight}` : '',
        style.fontStyle ? `font-style:${style.fontStyle}` : ''
    ].filter(Boolean).join(';');

    return `<span class="dz-hl-preview" data-role="preview" style="${esc(css)}">${esc(shown)}</span>`;
}


function refreshPreview(list, n, rule, format) {
    const old = list.querySelector(`[data-n="${n}"] [data-role="preview"]`);
    if (old) old.outerHTML = preview(rule, format);
}


function ruleMarkup(rule, n, count, subjects, rows, format) {
    const when = rule.when ?? {};
    const style = rule.style ?? {};
    const unary = UNARY_OPS.includes(when.op);
    const option = (current) => (o) => `<option value="${esc(o.value)}"
        ${o.value === current ? 'selected' : ''}>${esc(o.label)}</option>`;

    const subjectChoices = [
        ...(rows ? [] : [{ value: THIS_VALUE, label: 'this value' }]),
        ...subjects.map(f => ({ value: f, label: f }))
    ];

    const swatch = (key, label) => {
        const none = !style[key];
        return `
        <span class="dz-hl-color">
            <span class="dz-hl-color-label">${esc(label)}</span>
            <span class="dz-swatch${none ? ' is-none' : ''}">
                <span class="dz-swatch-well">
                    <input type="color" data-key="${key}" value="${esc(none ? '#000000' : style[key])}"
                           aria-label="${esc(label)} colour">
                </span>
                <button type="button" class="dz-icon dz-swatch-clear" data-rule-action="clear"
                        data-key="${key}" title="No ${esc(label.toLowerCase())} colour"
                        aria-label="Remove ${esc(label.toLowerCase())} colour">&times;</button>
            </span>
        </span>`;
    };

    /**
     * Laid out on one grid for every rule - a label column, the controls, and
     * the rule's own buttons - so the dropdowns of one rule sit exactly under
     * those of the one above, whatever its label says or its test needs.
     */
    return `
    <div class="dz-hl-rule" data-n="${n}">
        <span class="dz-hl-label">${n === 0 ? 'When' : 'Else when'}</span>
        <div class="dz-hl-when">
            <select data-key="field" aria-label="What to test">
                ${subjectChoices.map(option(when.field ?? THIS_VALUE)).join('')}
            </select>
            <select data-key="op" aria-label="Test">
                ${OP_CHOICES.map(option(when.op)).join('')}
            </select>
            <span class="dz-hl-values">
                ${unary ? '<span class="dz-hl-novalue">no value needed</span>' : `
                    <input type="text" data-key="value" value="${esc(when.value ?? '')}"
                           spellcheck="false" aria-label="Value" placeholder="value">`}
                ${when.op === 'between' ? `
                    <span class="dz-hl-and">and</span>
                    <input type="text" data-key="to" value="${esc(when.to ?? '')}"
                           spellcheck="false" aria-label="Upper value" placeholder="value">` : ''}
            </span>
        </div>
        <span class="dz-hl-actions">
            ${n > 0 ? `<button type="button" class="dz-icon" data-rule-action="up"
                    title="Check this rule before the one above"
                    aria-label="Move rule ${n + 1} up">&uarr;</button>`
                : '<span class="dz-hl-slot" aria-hidden="true"></span>'}
            <button type="button" class="dz-icon" data-rule-action="remove"
                    title="Remove this rule" aria-label="Remove rule ${n + 1}">&times;</button>
        </span>

        <span class="dz-hl-label">Style</span>
        <div class="dz-hl-style">
            ${swatch('color', 'Text')}
            ${swatch('background', 'Fill')}
            <span class="dz-hl-toggles">
                <button type="button" class="dz-hl-toggle" data-rule-action="bold"
                        aria-pressed="${style.fontWeight === 'bold'}" title="Bold"
                        aria-label="Bold"><b>B</b></button>
                <button type="button" class="dz-hl-toggle" data-rule-action="italic"
                        aria-pressed="${style.fontStyle === 'italic'}" title="Italic"
                        aria-label="Italic"><i>I</i></button>
            </span>
            ${preview(rule, format)}
        </div>
    </div>`;
}


function highlightMarkup(title) {
    return `
    <div class="modal-backdrop" data-role="backdrop"></div>

    <div class="modal-card dz-highlight-card" role="dialog" aria-modal="true"
         aria-labelledby="dz-highlight-title">
        <h2 id="dz-highlight-title">${esc(title)}</h2>

        <form>
            <div class="dz-hl-rules" data-role="rules"></div>

            <button type="button" class="dz-add-row" data-rule-action="add">Add rule</button>

            <p class="modal-summary">
                Rules are checked in order, and the first one that holds is used.
            </p>

            <div class="modal-actions">
                <button type="button" data-role="cancel">Cancel</button>
                <button type="submit" class="is-primary" data-role="confirm">Apply</button>
            </div>
        </form>
    </div>`;
}

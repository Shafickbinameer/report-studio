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
import { toId } from '../shared/store.js';
import { esc } from '../render/items.js';
import { createDropdown } from '../shared/dropdown.js';
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
                    choices.map(b => ({ value: b, label: b })), wanted);

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
    return `${token.label} prints nothing in a ${band}.`;
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
        return `In a ${band}, ${token.label.toLowerCase()} is worked out over ` +
            `each group's own rows, once per group.`;
    }

    if (scope === 'report') {
        return `In a ${band}, ${token.label.toLowerCase()} is worked out over ` +
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
            bandChoices(layout, first).map(b => ({ value: b, label: b })),
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

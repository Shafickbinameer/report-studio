/**
 * sample-data.js works out what data a report is asking for, and writes a
 * payload of the right shape to fill in.
 *
 * A layout is a set of questions - `{customer.name}`, a column on `amount`,
 * grouping by `region` - and until now the only way to learn what they were was
 * to run the report and read the "unresolved placeholder" warnings. This reads
 * them off the layout instead and hands back a `.data.json` with every key in
 * place, so the host application knows exactly what it has to supply.
 *
 * The rules for what comes from the data are imported from resolve.js rather
 * than restated. A second copy of them here would drift, and it would drift in
 * the direction of asking the user for `{page}` while forgetting
 * `{customer.name}` - the two mistakes that make such a file worse than none.
 *
 * Which scope a bare `{name}` belongs to follows the engine (spec 3.4): a
 * dotted path is always the root, and a bare key is a row field inside a
 * row-scoped band and a root key anywhere else.
 */

import { PLACEHOLDER, isEngineKey, isRowScoped } from '../engine/resolve.js';
import { groupingOf, datasetOf } from '../engine/tables.js';


/** enough rows to show a group break, few enough to read at a glance */
const ROWS = 6;
const GROUPS = ['North', 'South'];

/** field names that plainly want a number rather than a word */
const NUMERIC = /(amount|amt|price|qty|quantity|total|subtotal|cost|rate|balance|discount|tax)$/i;

/** an aggregate expression, for the fields the layout takes a sum of */
const AGGREGATE = /\{\s*(\w+)\(([^)]*)\)\s*\}/g;

/** and ones that want a date */
const DATEISH = /(date|day|when)$/i;

/**
 * What a bound image previews with: a small grey PNG, stored inline.
 *
 * Inline rather than a placeholder service's URL, so a designer opened on a
 * machine with no network still previews - and so opening one does not tell a
 * third party that it has been.
 */
export const SAMPLE_IMAGE = 'data:image/png;base64,' +
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAAAAADRSSBWAAAAC0lEQVR4nGO4eRcAApIBt+wBgUAAAAAASUVORK5CYII=';


/**
 * Every placeholder key a layout asks the data for, with the scope it is read in.
 *
 * @param {object} layout
 * @returns {{root: string[], row: string[]}} paths, de-duplicated
 */
export function requiredKeys(layout) {
    const root = new Set();
    const row = new Set();

    for (const band of (Array.isArray(layout?.bands) ? layout.bands : [])) {
        const rowScoped = isRowScoped(band.type);

        for (const item of (band.items || [])) {
            if (item.type !== 'text' || typeof item.value !== 'string') continue;

            for (const [, raw] of item.value.matchAll(PLACEHOLDER)) {
                const key = raw.trim();

                /** answered by the engine, not by the payload */
                if (!key || isEngineKey(key)) continue;

                /**
                 * A dotted path is read from the root wherever it appears -
                 * `{customer.name}` in a detail band is still the customer, not
                 * a column called "customer.name".
                 */
                if (key.includes('.') || !rowScoped) root.add(key);
                else row.add(key);
            }
        }
    }

    return { root: [...root], row: [...row] };
}


/**
 * The data paths the layout's images are bound to.
 *
 * Kept apart from requiredKeys because the answer is a different kind of
 * value: a picture's URL, not a word or a figure. Always read from the root -
 * resolve.js looks an image's field up in the payload whatever band it is in.
 *
 * @param {object} layout
 * @returns {string[]} paths, de-duplicated
 */
export function imageKeys(layout) {
    const found = new Set();

    for (const band of (Array.isArray(layout?.bands) ? layout.bands : [])) {
        for (const item of (band.items || [])) {
            if (item.type !== 'image' || typeof item.field !== 'string') continue;

            const key = item.field.trim();
            if (key) found.add(key);
        }
    }

    return [...found];
}


/**
 * The dataset key rows are read from, and the fields each row needs.
 *
 * A table names its own dataset and falls back to the report's (spec 3.3), so a
 * layout with two tables over two datasets produces two arrays.
 *
 * @param {object} layout
 * @returns {Map<string, Set<string>>} dataset name to its fields
 */
export function datasets(layout) {
    const found = new Map();
    const fallback = layout?.dataset || 'rows';

    const fieldsOf = (name) => {
        if (!found.has(name)) found.set(name, new Set());
        return found.get(name);
    };

    for (const band of (Array.isArray(layout?.bands) ? layout.bands : [])) {
        for (const item of (band.items || [])) {
            if (item.type !== 'table') continue;

            const fields = fieldsOf(item.dataset || fallback);
            for (const column of (item.columns || [])) {
                if (column?.field) fields.add(column.field);
            }
        }
    }

    /**
     * A report can group and place row placeholders without ever drawing a
     * table, so the rows they read are created if anything needs them at all.
     * They are the grouped table's: a group band's `{region}` is read off the
     * rows of the table being grouped, whichever table that is.
     */
    const { row } = requiredKeys(layout);
    const grouping = groupingOf(layout);
    const by = grouping?.by ?? layout?.groupBy ?? null;

    if (row.length || by) {
        const fields = fieldsOf(
            (grouping && datasetOf(grouping.table, layout)) || fallback);

        for (const key of row) fields.add(key);
        if (by) fields.add(by);
    }

    /**
     * `{sum(payments.amount)}` names a dataset of its own, which the report
     * may total without drawing a table of it - so it needs rows as well.
     */
    for (const scoped of scopedAggregates(layout)) {
        fieldsOf(scoped.dataset).add(scoped.field);
    }

    return found;
}


/**
 * A sample payload for a layout.
 *
 * Values are chosen from the field's own name - a column called `amount` gets a
 * number and one called `date` gets a date - because a payload of `"string"`
 * everywhere tells you the shape but not whether you have the right column, and
 * a report full of the word "string" is not worth previewing.
 *
 * @param {object} layout
 * @returns {object} a data payload, ready to fill in
 */
export function sampleData(layout) {
    const data = {};
    const { root } = requiredKeys(layout);
    const summed = summedFields(layout);

    /** first, so a text placeholder on the same path does not take it as a word */
    for (const path of imageKeys(layout)) place(data, path, SAMPLE_IMAGE);

    for (const path of root) place(data, path);

    const groupedBy = groupedFieldsByDataset(layout);

    for (const [name, fields] of datasets(layout)) {
        data[name] = rowsFor([...fields], groupedBy.get(name) ?? null, summed);
    }

    return data;
}


/**
 * A data payload with whatever the layout now asks for and it lacks filled in -
 * and nothing it already has touched.
 *
 * The data file is written once, on the first save, and after that it is the
 * user's: real figures typed into it must survive every later save. But a
 * report goes on growing after that save - a second table, a new placeholder,
 * an image bound to a field - and a file that never learned about them made the
 * preview fail on a dataset "which is not present in the data". So what is
 * missing is added from the sample, and what is there is left as it is.
 *
 * "Missing" is `undefined`, walked down through plain objects. An existing
 * array is a dataset the user owns, so its rows are never added to or edited,
 * even if a column has appeared since; and a value that is present, `null`
 * included, is an answer rather than a gap.
 *
 * @param {object|null} data what is on disk, or nothing
 * @param {object} layout
 * @returns {{data: object, added: boolean}} a new object, never the one given;
 *   `added` says whether anything was filled in
 */
export function completeData(data, layout) {
    const sample = sampleData(layout);

    if (data == null || typeof data !== 'object' || Array.isArray(data)) {
        return { data: sample, added: true };
    }

    const out = structuredClone(data);
    const added = fillMissing(out, sample);

    return { data: out, added };
}


/** copies into `target` every key of `source` it lacks; says whether it did */
function fillMissing(target, source) {
    let added = false;

    for (const [key, value] of Object.entries(source)) {
        const current = target[key];

        if (current === undefined) {
            target[key] = structuredClone(value);
            added = true;
            continue;
        }

        const bothObjects = isPlainObject(current) && isPlainObject(value);
        if (bothObjects && fillMissing(current, value)) added = true;
    }

    return added;
}


function isPlainObject(value) {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}


/**
 * The fields the layout takes an aggregate over.
 *
 * A field called `amt` is not one the name heuristic recognises, so it used to
 * get the word "Amt 1" - and `{sum(amt)}` over six words is not a number, so
 * the total the report was designed around previewed blank. The layout has
 * already said what it is: you do not sum a word. That is a better answer than
 * a longer list of names, because it is the report's own.
 *
 * `count()` is left out on purpose - it takes no field, and the empty string it
 * would contribute is not one.
 *
 * @param {object} layout
 * @returns {Set<string>}
 */
export function summedFields(layout) {
    const found = new Set();

    for (const band of (Array.isArray(layout?.bands) ? layout.bands : [])) {
        for (const item of (band.items || [])) {
            if (item.type !== 'text') continue;

            for (const [, , field] of String(item.value ?? '').matchAll(AGGREGATE)) {
                const name = field.trim();
                if (!name) continue;

                found.add(name);

                /** `sales.amount` sums the `amount` of each row of sales */
                if (name.includes('.')) found.add(name.slice(name.indexOf('.') + 1));
            }
        }
    }

    return found;
}


/**
 * The field each dataset is grouped by - one at most, the grouped table's.
 * @param {object} layout
 * @returns {Map<string, string>}
 */
function groupedFieldsByDataset(layout) {
    const found = new Map();
    const grouping = groupingOf(layout);

    if (grouping) {
        found.set(datasetOf(grouping.table, layout) || layout?.dataset || 'rows', grouping.by);
    }

    return found;
}


/**
 * Aggregates that name a dataset, as `{sum(payments.amount)}`: the dataset,
 * and the field of it. The prefix is taken to be a dataset whether or not a
 * table reads it - that is what the engine does when the payload has one.
 * @param {object} layout
 * @returns {{dataset: string, field: string}[]}
 */
function scopedAggregates(layout) {
    const found = [];

    for (const band of (Array.isArray(layout?.bands) ? layout.bands : [])) {
        for (const item of (band.items || [])) {
            if (item.type !== 'text') continue;

            for (const [, , arg] of String(item.value ?? '').matchAll(AGGREGATE)) {
                const [dataset, ...rest] = arg.trim().split('.');
                const field = rest.join('.');

                if (dataset && field) found.push({ dataset, field });
            }
        }
    }

    return found;
}


/**
 * Writes a value at a dotted path, building the objects on the way down.
 * @param {object} data
 * @param {string} path
 * @param {*} [value] what to write; a value made up from the key when absent
 */
function place(data, path, value) {
    const parts = path.split('.').filter(Boolean);
    if (!parts.length) return;

    const last = parts.pop();
    let node = data;

    for (const part of parts) {
        if (node[part] == null || typeof node[part] !== 'object') node[part] = {};
        node = node[part];
    }

    if (node[last] === undefined) node[last] = value ?? valueFor(last, 0);
}


function rowsFor(fields, groupBy, summed = new Set()) {
    if (!fields.length) return [];

    return Array.from({ length: ROWS }, (_, index) => {
        const row = {};

        for (const field of fields) {
            /**
             * The grouping field repeats, or every row is its own group and the
             * sample shows nothing about how grouping looks.
             */
            row[field] = field === groupBy
                ? GROUPS[index % GROUPS.length]
                : valueFor(field, index, summed.has(field));
        }

        return row;
    });
}


function valueFor(field, index, summed = false) {
    if (summed || NUMERIC.test(field)) return (index + 1) * 250;

    if (DATEISH.test(field)) {
        /** fixed, not today's: a sample file that changes every read diffs badly */
        const day = String((index % 28) + 1).padStart(2, '0');
        return `2026-06-${day}`;
    }

    /** the field's own name, so a mis-mapped column is obvious on the page */
    return `${label(field)} ${index + 1}`;
}


/** "customerName" and "customer_name" both read back as "Customer name" */
function label(field) {
    const words = String(field)
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .trim()
        .toLowerCase();

    return words.charAt(0).toUpperCase() + words.slice(1);
}

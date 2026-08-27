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


/** enough rows to show a group break, few enough to read at a glance */
const ROWS = 6;
const GROUPS = ['North', 'South'];

/** field names that plainly want a number rather than a word */
const NUMERIC = /(amount|price|qty|quantity|total|subtotal|cost|rate|balance|discount|tax)$/i;

/** and ones that want a date */
const DATEISH = /(date|day|when)$/i;


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
     * table, so the fallback dataset is created if anything needs rows at all.
     */
    const { row } = requiredKeys(layout);

    if (row.length || layout?.groupBy) {
        const fields = fieldsOf(fallback);

        for (const key of row) fields.add(key);
        if (layout?.groupBy) fields.add(layout.groupBy);
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

    for (const path of root) place(data, path);

    for (const [name, fields] of datasets(layout)) {
        data[name] = rowsFor([...fields], layout?.groupBy);
    }

    return data;
}


/** writes a value at a dotted path, building the objects on the way down */
function place(data, path) {
    const parts = path.split('.').filter(Boolean);
    if (!parts.length) return;

    const last = parts.pop();
    let node = data;

    for (const part of parts) {
        if (node[part] == null || typeof node[part] !== 'object') node[part] = {};
        node = node[part];
    }

    if (node[last] === undefined) node[last] = valueFor(last, 0);
}


function rowsFor(fields, groupBy) {
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
                : valueFor(field, index);
        }

        return row;
    });
}


function valueFor(field, index) {
    if (NUMERIC.test(field)) return (index + 1) * 250;

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

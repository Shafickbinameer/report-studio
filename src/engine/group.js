/**
 * group.js partitions the dataset and resolves aggregate placeholders.
 *
 * Spec 3.4 scopes aggregates to two bands:
 *   groupFooter  - against that group's rows   (attached per group, filled in by paginate)
 *   reportFooter - against every row           (filled in here)
 * Any other band is left alone; an aggregate elsewhere is a layout mistake, not
 * a licence to overwrite the item.
 */

import { ReportError } from './validate.js';


const REGEX = /\{([^{}]+)\}/g;


export function group(resolvedJson, data) {
    let json = structuredClone(resolvedJson);
    const hasGroup = json.groupBy != null;
    if (hasGroup) {
        return withGroup(json, data);
    } else {
        return withoutGroup(json, data);
    }
}


function withGroup(json, data) {
    const bands = json.bands;
    const tableBand = findTableBand(bands);

    if (!tableBand) {
        throw new ReportError(
            `group: layout.groupBy is "${json.groupBy}" but no band contains a table to group`
        );
    }

    const dataset = datasetFor(tableBand, json, data);
    const groupedData = groupedRows(dataset, json.groupBy);
    const groupedAggregates = groupedAggregate(bands, groupedData);

    tableBand.groups =
        Object.entries(groupedData).map(
            ([key, rows]) => ({
                key,
                rows,
                aggregates: groupedAggregates[key]
            })
        );

    aggregate(bands, dataset);
    return json;
}


function withoutGroup(json, data) {
    const bands = json.bands;
    const tableBand = findTableBand(bands);

    /** a report of nothing but text bands is legal - there is simply nothing to bind */
    const dataset = tableBand ? datasetFor(tableBand, json, data) : [];

    if (tableBand) tableBand.row = dataset;

    aggregate(bands, dataset);
    return json;
}


/**
 * The rows a table is bound to. A missing dataset is a layout/data mismatch
 * worth naming rather than a silent empty table.
 * @param {object} tableBand the table item
 * @param {object} json
 * @param {object} data
 * @returns {object[]}
 */
function datasetFor(tableBand, json, data) {
    const key = tableBand.dataset ?? json.dataset;
    const dataset = data[key];

    if (dataset === undefined) {
        throw new ReportError(
            `group: table "${tableBand.id}" is bound to dataset "${key}", which is not present in the data`
        );
    }

    if (!Array.isArray(dataset)) {
        throw new ReportError(
            `group: dataset "${key}" must be an array of rows, got ${typeof dataset}`
        );
    }

    return dataset;
}


function findTableBand(bands) {
    for (const band of bands) {
        for (const item of band.items) {
            if (item.type == "table") {
                return item;
            }
        }
    }
}


/**
 * Report-wide aggregates. Only reportFooter is in scope - group footers are
 * resolved per group fragment during pagination, where the scope is known.
 * @param {object[]} bands
 * @param {object[]} dataset
 */
function aggregate(bands, dataset) {
    for (const band of bands) {
        if (band.type !== "reportFooter") continue;

        for (const item of band.items) {
            if (item.type != "text") continue;

            /**
             * Build on `text`, never on `value`. resolve.js has already put the
             * data placeholders in and deliberately left the aggregate tokens
             * standing; re-resolving from `value` here would discard its work
             * and leave "{authorizer}" printed literally on the report.
             */
            item.text = fillAggregates(item.text ?? item.value, dataset);
        }
    }
}


/**
 * Replaces every aggregate placeholder in a value while keeping the literal
 * text around it, so "Items: {count()}" stays "Items: 48" rather than "48".
 * Non-aggregate placeholders were already handled by resolve.js and are left
 * as they are.
 * @param {string} value
 * @param {object[]} dataset
 * @returns {string}
 */
function fillAggregates(value, dataset) {
    return value.replace(REGEX, (match, key) => {
        const expr = parseAggregate(key.trim());
        if (!expr) return match;

        const result = compute(expr, dataset);
        return result == null ? '' : String(result);
    });
}


function parseAggregate(expr) {
    const match = expr.match(/^(\w+)\((.*?)\)$/);
    if (!match) return null;
    return {
        key: match[1],
        field: match[2].trim()
    }
}


/**
 * Per-group aggregates, keyed on both dimensions that matter: the group key and
 * the field the expression targets. Dropping either makes groups overwrite each
 * other, or {sum(price)} collide with {sum(qty)}.
 * Shape: aggregates[groupKey][field] = { count, sum, avg, min, max }
 * @param {object[]} bands
 * @param {object} dataset grouped rows, keyed by group key
 * @returns {object}
 */
function groupedAggregate(bands, dataset) {
    const aggregates = {};

    /** every group gets a slot, even one no groupFooter expression touches */
    for (const key of Object.keys(dataset)) {
        aggregates[key] = {};
    }

    for (const band of bands) {
        if (band.type !== "groupFooter") continue;

        for (const item of band.items) {
            if (item.type != "text") continue;

            for (const expr of parseAll(item.value)) {
                for (const [key, rows] of Object.entries(dataset)) {
                    if (!aggregates[key][expr.field]) {
                        aggregates[key][expr.field] = {
                            count: null,
                            sum: null,
                            avg: null,
                            min: null,
                            max: null
                        };
                    }

                    aggregates[key][expr.field][expr.key] = compute(expr, rows);
                }
            }
        }
    }

    return aggregates;
}


/** every aggregate expression in a value, not just the first */
function parseAll(value) {
    const found = [];
    for (const [, key] of value.matchAll(REGEX)) {
        const expr = parseAggregate(key.trim());
        if (expr) found.push(expr);
    }
    return found;
}


function groupedRows(dataset, groupBy) {
    const grouped = {};
    for (const row of dataset) {
        const key = row[groupBy];
        if (!grouped[key]) {
            grouped[key] = [];
        }
        grouped[key].push(row);
    }
    return grouped;
}


/**
 * Runs one aggregate over one set of rows.
 * Non-numeric cells are skipped rather than counted as zero - a blank price
 * should not drag an average down, and Math.max of nothing is -Infinity, which
 * is not a number anyone wants printed on a report.
 * @param {object} expr {key, field}
 * @param {object[]} rows
 * @returns {number|null} null where the answer is undefined for these rows
 */
function compute(expr, rows) {
    if (expr.key === 'count') return rows.length;

    const values = rows
        .map(row => row?.[expr.field])
        /** Number('') is 0, so blanks have to be dropped before coercion */
        .filter(v => v !== null && v !== undefined && v !== '')
        .map(Number)
        .filter(n => Number.isFinite(n));

    switch (expr.key) {
        case 'sum':
            /** the sum of no rows is zero; the sum of no numbers is not */
            return values.length ? round(values.reduce((a, b) => a + b, 0)) : null;
        case 'avg':
            return values.length
                ? round(values.reduce((a, b) => a + b, 0) / values.length)
                : null;
        case 'max':
            return values.length ? Math.max(...values) : null;
        case 'min':
            return values.length ? Math.min(...values) : null;
        default:
            console.debug(`No aggregate function found for key: ${expr.key}`);
            return null;
    }
}


/**
 * Floating point sums produce 0.1 + 0.2 = 0.30000000000000004, which has no
 * place on a printed report. Twelve significant digits is well past any real
 * currency or quantity and short of the artefacts.
 * @param {number} n
 * @returns {number}
 */
function round(n) {
    return Number(n.toPrecision(12));
}

/**
 * group.js binds every table to its rows, partitions the grouped one, and
 * resolves aggregate placeholders.
 *
 * An aggregate has to be worked out over some set of rows, and there are only
 * two sets a band can mean:
 *
 *   groupHeader / groupFooter - that group's rows, and only that group's.
 *     They are templates rather than bands: one copy is drawn per group, so
 *     each copy has a different answer. Filled in per fragment by paginate.js,
 *     where which group is being drawn is known.
 *
 *   every other band - a whole dataset. Filled in here, once.
 *
 * Which dataset, now that a report can hold more than one table: the one the
 * expression names, as `{sum(sales.amount)}` or `{count(sales)}`, and the
 * first table's when it names none - which is what every expression written
 * before there could be a second table meant.
 */

import { ReportError } from './validate.js';
import { tablesOf, datasetOf, groupingOf } from './tables.js';


const REGEX = /\{([^{}]+)\}/g;


export function group(resolvedJson, data) {
    const json = structuredClone(resolvedJson);
    const bands = json.bands;
    const tables = tablesOf(json);

    if (json.groupBy != null && tables.length === 0) {
        throw new ReportError(
            `group: layout.groupBy is "${json.groupBy}" but no band contains a table to group`
        );
    }

    const grouping = groupingOf(json);
    const named = namedDatasets(data);

    /** the rows each table reads, bound as they are found */
    const bound = tables.map(table => {
        const rows = datasetFor(table, json, data);
        named.set(datasetOf(table, json), rows);
        return { table, rows };
    });

    for (const { table, rows } of bound) {
        if (table === grouping?.table) {
            bindGroups(table, rows, grouping.by, bands, datasetOf(table, json));
        } else {
            table.row = rows;
        }
    }

    /** a report of nothing but text bands is legal - there is simply nothing to bind */
    const scope = { rows: bound[0]?.rows ?? [], named };

    aggregate(bands, scope);
    return json;
}


/**
 * Splits the grouped table's rows into groups, each carrying its own totals.
 * @param {object} table
 * @param {object[]} rows
 * @param {string} by the field that decides which group a row is in
 * @param {object[]} bands
 * @param {string|null} dataset the table's dataset name, which a group band's
 *   aggregate may carry as a prefix
 */
function bindGroups(table, rows, by, bands, dataset) {
    const groupedData = groupedRows(rows, by);
    const groupedAggregates = groupedAggregate(bands, groupedData, dataset);

    table.groups = Object.entries(groupedData).map(([key, groupRows]) => ({
        key,
        rows: groupRows,
        aggregates: groupedAggregates[key]
    }));
}


/**
 * Every top-level array in the payload, by name - the datasets an aggregate
 * can name. Not only the ones a table is bound to: a total of payments is a
 * reasonable thing to print under an invoice that draws no table of them.
 * @param {object} data
 * @returns {Map<string, object[]>}
 */
function namedDatasets(data) {
    const found = new Map();

    for (const [name, value] of Object.entries(data ?? {})) {
        if (Array.isArray(value)) found.set(name, value);
    }

    return found;
}


/**
 * The rows a table is bound to. A missing dataset is a layout/data mismatch
 * worth naming rather than a silent empty table.
 * @param {object} table the table item
 * @param {object} json
 * @param {object} data
 * @returns {object[]}
 */
function datasetFor(table, json, data) {
    const key = datasetOf(table, json);
    const dataset = key == null ? undefined : data[key];

    if (dataset === undefined) {
        throw new ReportError(
            `group: table "${table.id}" is bound to dataset "${key}", which is not present in the data`
        );
    }

    if (!Array.isArray(dataset)) {
        throw new ReportError(
            `group: dataset "${key}" must be an array of rows, got ${typeof dataset}`
        );
    }

    return dataset;
}


/**
 * The bands whose aggregates belong to one group rather than to the report.
 *
 * They are left alone here on purpose. Filling them in with the report's totals
 * would not merely be the wrong number - it would consume the placeholder, and
 * paginate.js would find nothing left to put the group's own answer into.
 */
const GROUP_SCOPED = ['groupHeader', 'groupFooter'];


/**
 * Report-wide aggregates: every band except the two that mean a group.
 * @param {object[]} bands
 * @param {{rows: object[], named: Map<string, object[]>}} scope
 */
function aggregate(bands, scope) {
    for (const band of bands) {
        if (GROUP_SCOPED.includes(band.type)) continue;

        for (const item of band.items) {
            if (item.type != "text") continue;

            /**
             * Build on `text`, never on `value`. resolve.js has already put the
             * data placeholders in and deliberately left the aggregate tokens
             * standing; re-resolving from `value` here would discard its work
             * and leave "{authorizer}" printed literally on the report.
             */
            item.text = fillAggregates(item.text ?? item.value, scope);
        }
    }
}


/**
 * Replaces every aggregate placeholder in a value while keeping the literal
 * text around it, so "Items: {count()}" stays "Items: 48" rather than "48".
 * Non-aggregate placeholders were already handled by resolve.js and are left
 * as they are.
 * @param {string} value
 * @param {{rows: object[], named: Map<string, object[]>}} scope
 * @returns {string}
 */
function fillAggregates(value, scope) {
    return value.replace(REGEX, (match, key) => {
        const expr = parseAggregate(key.trim());
        if (!expr) return match;

        const { rows, field } = scoped(expr.field, scope);
        const result = compute({ key: expr.key, field }, rows);
        return result == null ? '' : String(result);
    });
}


/**
 * Which rows an aggregate's argument means, and which field of them.
 *
 *   count(sales)        every row of `sales`
 *   sum(sales.amount)   `amount` over the rows of `sales`
 *   sum(amount)         `amount` over the first table's rows, as ever
 *
 * A prefix is only a dataset if the payload has an array of that name. Rows are
 * flat, so a dot has never meant anything inside a row field and nothing that
 * worked before is read differently now.
 *
 * @param {string} field the expression's argument
 * @param {{rows: object[], named: Map<string, object[]>}} scope
 * @returns {{rows: object[], field: string}}
 */
function scoped(field, scope) {
    if (scope.named.has(field)) return { rows: scope.named.get(field), field: '' };

    const dot = field.indexOf('.');

    if (dot > 0) {
        const name = field.slice(0, dot);
        if (scope.named.has(name)) {
            return { rows: scope.named.get(name), field: field.slice(dot + 1) };
        }
    }

    return { rows: scope.rows, field };
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
 *
 * Both group bands are read, not just the footer. "Region A - 12 orders" is a
 * heading, and a count that worked in the footer and printed blank in the
 * header is the same fault this file exists to have stopped having.
 *
 * Keyed on the expression's argument as written, because that is what
 * paginate.js looks it up by - so `{sum(sales.amount)}` in a group footer is
 * stored under "sales.amount" and computed over the group's `amount`. A group
 * band only ever means its group's rows; naming the grouped dataset is allowed
 * because it is the same thing said in full.
 *
 * Shape: aggregates[groupKey][field] = { count, sum, avg, min, max }
 * @param {object[]} bands
 * @param {object} dataset grouped rows, keyed by group key
 * @param {string|null} name the grouped table's dataset
 * @returns {object}
 */
function groupedAggregate(bands, dataset, name) {
    const aggregates = {};

    /** every group gets a slot, even one no groupFooter expression touches */
    for (const key of Object.keys(dataset)) {
        aggregates[key] = {};
    }

    for (const band of bands) {
        if (!GROUP_SCOPED.includes(band.type)) continue;

        for (const item of band.items) {
            if (item.type != "text") continue;

            for (const expr of parseAll(item.value)) {
                const field = withoutScope(expr.field, name);

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

                    aggregates[key][expr.field][expr.key] =
                        compute({ key: expr.key, field }, rows);
                }
            }
        }
    }

    return aggregates;
}


/** `sales.amount` to `amount`, and `sales` to nothing, when sales is the dataset */
function withoutScope(field, name) {
    if (name == null) return field;
    if (field === name) return '';
    return field.startsWith(`${name}.`) ? field.slice(name.length + 1) : field;
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
            console.warn(`Unknown aggregate "${expr.key}()"; it has no value.`);
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

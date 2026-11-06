/**
 * group.js binds every table to its rows, partitions each grouped one, and
 * resolves aggregate placeholders.
 *
 * An aggregate has to be worked out over some set of rows, and there are only
 * two sets a band can mean:
 *
 *   groupHeader / groupFooter - that group's rows, and only that group's. Each
 *     grouped table has its own pair for each level it is grouped at, carried
 *     on the table as `grouping`. A region footer means the region's rows; a
 *     city footer inside it means that city's.
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
import { tablesOf, datasetOf, groupingsOf, normalizeGrouping } from './tables.js';
import { formatValue, percentFormat, toNumber } from './format.js';
import { soleKey } from './resolve.js';
import { highlightFor } from './highlight.js';
import { calculatedRows } from './calculate.js';


const REGEX = /\{([^{}]+)\}/g;


export function group(resolvedJson, data) {
    if (resolvedJson.groupBy != null && tablesOf(resolvedJson).length === 0) {
        throw new ReportError(
            `group: layout.groupBy is "${resolvedJson.groupBy}" but no band contains a table to group`
        );
    }

    /**
     * From here on grouping is said one way only - on each table - whichever
     * way the layout file said it. normalizeGrouping also makes the copy this
     * stage works on, so the layout handed in is left as it was.
     */
    const json = normalizeGrouping(resolvedJson);
    const bands = json.bands;
    const tables = tablesOf(json);

    const groupings = new Map(groupingsOf(json).map(g => [g.table, g]));
    const named = namedDatasets(data);

    /** the rows each table reads, bound as they are found */
    const bound = tables.map(table => {
        /**
         * Calculated columns first: from here on a calculated value is a field
         * of the row like any other - grouped and sorted by, totalled by
         * {sum(amount)} in any band, formatted, highlighted and exported.
         */
        const rows = calculatedRows(table, datasetFor(table, json, data));
        named.set(datasetOf(table, json), rows);
        return { table, rows };
    });

    for (const { table, rows } of bound) {
        const grouping = groupings.get(table);

        if (grouping) {
            bindGroups(table, rows, grouping, datasetOf(table, json));
        } else {
            table.row = rows;
        }
    }

    /** a report of nothing but text bands is legal - there is simply nothing to bind */
    const scope = { rows: bound[0]?.rows ?? [], table: bound[0]?.table ?? null, named, data };

    aggregate(bands, scope);
    return json;
}


/**
 * Splits one grouped table's rows into groups, each carrying its own totals.
 *
 * The totals are worked out from this table's own group bands over this
 * table's own rows. With one grouped table that was a distinction without a
 * difference; with two, reading the other table's bands is how a subtotal of
 * refunds would come to be summed over orders.
 *
 * A table grouped at more than one level - by region, and within each region
 * by city - still comes out as one flat list, of its innermost groups, in the
 * order they are drawn. Every stage after this one walks `groups` as a list,
 * and a tree would have had each of them learn to walk it. What a flat list
 * has to say instead is where each outer group starts and ends, so each
 * innermost group carries:
 *
 *   key        its own group's key, as a one-level group always has
 *   path       the key at every level, outermost first: ['North', 'Oslo']
 *   rows       its rows
 *   aggregates its own level's totals, as a one-level group always has
 *   levels     one entry per level, outermost first: { by, key, aggregates },
 *              each level's totals over that level's whole group - the
 *              region's footer sums the region, not the city it ends with
 *   opens      the outermost level whose group starts with this one; it and
 *              every level inside it print their headers here
 *   closes     the outermost level whose group ends with this one; footers
 *              print from the innermost out to it
 *
 * A one-level group opens and closes level 0, always.
 *
 * @param {object} table
 * @param {object[]} rows
 * @param {{levels: {by: string, header: object|null, footer: object|null}[]}} grouping
 * @param {string|null} dataset the table's dataset name, which a group band's
 *   aggregate may carry as a prefix
 */
function bindGroups(table, rows, grouping, dataset) {
    const levels = grouping.levels;
    const leaves = [];

    /** splits `rows` by one level, and each part by the next, down to the last */
    /** what a {percentage()} is a share of: the whole table, or the group outside */
    const all = rows;

    const split = (rows, depth, outer) => {
        const level = levels[depth];
        const bands = [level.header, level.footer].filter(Boolean);

        for (const [key, groupRows] of sortedGroups(groupedRows(rows, level.by), level.sort)) {
            const node = {
                by: level.by,
                key,
                aggregates: groupAggregates(bands, groupRows, dataset, { all, parent: rows, table })
            };
            const chain = [...outer, node];

            if (depth < levels.length - 1) {
                split(groupRows, depth + 1, chain);
                continue;
            }

            leaves.push({
                key,
                path: chain.map(n => n.key),
                rows: groupRows,
                aggregates: node.aggregates,
                levels: chain
            });
        }
    };

    split(rows, 0, []);

    /**
     * Two neighbouring groups share an outer group for as long as their chains
     * hold the same node - the same object, not merely an equal key.
     */
    leaves.forEach((leaf, n) => {
        leaf.opens = firstDifference(leaves[n - 1], leaf);
        leaf.closes = firstDifference(leaves[n + 1], leaf);
    });

    table.groups = leaves;
}


/**
 * The outermost level at which a neighbouring group is in a different group
 * from this one - 0 when there is no neighbour, as at either end of the table.
 * @param {object|undefined} other
 * @param {object} leaf
 * @returns {number}
 */
function firstDifference(other, leaf) {
    if (!other) return 0;

    const depth = leaf.levels.findIndex((node, n) => other.levels[n] !== node);
    return depth === -1 ? leaf.levels.length - 1 : depth;
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
            item.text = fillAggregates(item.text ?? item.value, scope, item);

            /**
             * Every value the item prints is known now - its placeholders were
             * filled by resolve.js, its totals just here - so its highlight
             * rules can be asked. A rule naming a field reads the data.
             */
            const lit = highlightFor(item.highlight, shownValue(item), scope.data);
            if (lit) item.highlighted = lit;
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
 * @param {object} item the text item, whose format the answer is printed in -
 *   and which keeps the answer as `raw` when it is the item's only placeholder
 * @returns {string}
 */
function fillAggregates(value, scope, item) {
    const sole = soleKey(item.value);

    return value.replace(REGEX, (match, key) => {
        const expr = parseAggregate(key.trim());
        if (!expr) return match;

        const isShare = expr.key === PERCENTAGE;
        let result;

        if (isShare) {
            /** outside a group, a share is of the whole: every scope is the dataset */
            const measure = (which, fn, field) => {
                const target = scoped(field, scope);
                return compute({ key: fn, field: target.field }, target.rows);
            };
            result = percentage(expr.field, measure, () => measureField(scope.table, scope.rows));
        } else {
            const { rows, field } = scoped(expr.field, scope);
            result = compute({ key: expr.key, field }, rows);
        }

        if (sole === key.trim()) {
            item.raw = result;
            if (isShare) item.rawFormat = percentFormat(item.format);
        }

        /** a count is a count of rows, whatever the item's format says about money */
        if (result == null) return '';
        if (isShare) return formatValue(result, percentFormat(item.format));
        return formatValue(result, expr.key === 'count' ? null : item.format);
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


/** the aggregate that is a share of a total rather than a figure of its own */
export const PERCENTAGE = 'percentage';


/**
 * {percentage(part)} or {percentage(part, of)} - a value as a share of another,
 * as a fraction: 0.5708 prints as 57.08%.
 *
 *   part   an aggregate - sum(amount), count(), avg(price) - over the rows in
 *          scope, or a plain number: 1000
 *   of     what it is a share of. Left out, it is the whole table's total: the
 *          same aggregate over every row for an aggregate part, and the sum of
 *          the table's money column for a number. Or a number - a target, such
 *          as 50000 - an aggregate over every row, or `parent`: the same over
 *          the group outside this one.
 *
 * Nothing is a share of zero or of nothing: that is blank, never Infinity%.
 *
 * @param {string} args what is inside the brackets
 * @param {(which: 'part'|'all'|'parent', fn: string, field: string) => number|null} measure
 *   an aggregate over this group's rows, the table's or the outer group's
 * @param {() => string|null} moneyField the field a plain number is a share of
 * @returns {number|null}
 */
function percentage(args, measure, moneyField) {
    const [partText, ofText] = splitArguments(args);
    const part = term(partText);
    if (!part || part.kind === 'parent') return null;

    /** what "the whole" is made of when only the part is given, or `parent` is */
    const whole = part.kind === 'aggregate'
        ? { fn: part.fn, field: part.field }
        : { fn: 'sum', field: moneyField() };

    const partValue = part.kind === 'number' ? part.value : measure('part', part.fn, part.field);

    const of = ofText === undefined ? { kind: 'all' } : term(ofText);
    if (!of) return null;

    let ofValue = null;
    if (of.kind === 'number') ofValue = of.value;
    else if (of.kind === 'aggregate') ofValue = measure('all', of.fn, of.field);
    else if (whole.fn === 'count' || whole.field) {
        ofValue = measure(of.kind === 'parent' ? 'parent' : 'all', whole.fn, whole.field);
    }

    if (partValue == null || ofValue == null || ofValue === 0) return null;
    return round(partValue / ofValue);
}


/** one argument of percentage(): a number, `parent`, or an aggregate */
function term(text) {
    const t = (text ?? '').trim();
    if (t === '') return null;
    if (t === 'parent') return { kind: 'parent' };

    const number = toNumber(t);
    if (number !== null) return { kind: 'number', value: number };

    const expr = parseAggregate(t);
    if (!expr || expr.key === PERCENTAGE) return null;
    return { kind: 'aggregate', fn: expr.key, field: expr.field };
}


/** "sum(amount), 50000" into its two arguments, a comma inside brackets being no split */
function splitArguments(args) {
    let depth = 0;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '(') depth++;
        else if (args[i] === ')') depth--;
        else if (args[i] === ',' && depth === 0) return [args.slice(0, i), args.slice(i + 1)];
    }

    return [args, undefined];
}


/**
 * The field a plain-number share is of: the table's money column - the first
 * formatted as currency, then as a number, then the last column that holds
 * numbers, totals being the right-hand column of most tables.
 * @param {object|null} table
 * @param {object[]} rows
 * @returns {string|null}
 */
function measureField(table, rows) {
    const columns = Array.isArray(table?.columns) ? table.columns : [];
    const formatted = (type) => columns.find(c => c?.format?.type === type)?.field;
    const numeric = [...columns].reverse()
        .find(c => (rows ?? []).some(row => toNumber(row?.[c?.field]) !== null));

    return formatted('currency') ?? formatted('number') ?? numeric?.field ?? null;
}


/**
 * The value a highlight rule tests for a text item: what it printed, as the
 * reader reads it - a share as its percentage, 57.08 rather than 0.5708.
 * @param {object} item
 * @returns {*}
 */
export function shownValue(item) {
    return item.rawFormat?.type === 'percent' && typeof item.raw === 'number'
        ? round(item.raw * 100)
        : item.raw;
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
 * One group's aggregates, keyed on the field the expression targets and then
 * the function, so {sum(price)} does not collide with {sum(qty)}.
 *
 * Both of the level's group bands are read, not just the footer. "Region A -
 * 12 orders" is a heading, and a count that worked in the footer and printed
 * blank in the header is the same fault this file exists to have stopped
 * having. Only that level's bands are read: a city footer's {avg(price)} is
 * not worked out for regions that never print it.
 *
 * Keyed on the expression's argument as written, because that is what
 * paginate.js looks it up by - so `{sum(sales.amount)}` in a group footer is
 * stored under "sales.amount" and computed over the group's `amount`. A group
 * band only ever means its group's rows; naming the grouped dataset is allowed
 * because it is the same thing said in full.
 *
 * Shape: aggregates[field] = { count, sum, avg, min, max }
 * @param {object[]} bands the level's own group bands
 * @param {object[]} rows the group's rows
 * @param {string|null} name the grouped table's dataset
 * @param {{all?: object[], parent?: object[], table?: object}} [around] the
 *   table's rows and the outer group's, for {percentage()} to divide by
 * @returns {object}
 */
function groupAggregates(bands, rows, name, around = {}) {
    const aggregates = {};

    const within = { part: rows, all: around.all ?? rows, parent: around.parent ?? around.all ?? rows };
    const measure = (which, fn, field) =>
        compute({ key: fn, field: withoutScope(field, name) }, within[which]);

    for (const band of bands) {
        for (const item of band.items ?? []) {
            if (item.type != "text") continue;

            for (const expr of parseAll(item.value)) {
                const field = withoutScope(expr.field, name);

                aggregates[expr.field] ??= {
                    count: null,
                    sum: null,
                    avg: null,
                    min: null,
                    max: null
                };

                aggregates[expr.field][expr.key] = expr.key === PERCENTAGE
                    ? percentage(expr.field, measure, () => measureField(around.table, within.all))
                    : compute({ key: expr.key, field }, rows);
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


/**
 * Rows split by one field, in the order each value first appears.
 *
 * A Map, not an object: an object lists integer-like keys first and in
 * ascending order whatever order they were added in, so grouping by year put
 * 2023 before 2024 even when the data ran newest first. Keys are still the
 * field's value as text, which is what they have always been.
 *
 * @param {object[]} rows
 * @param {string} by
 * @returns {Map<string, object[]>}
 */
function groupedRows(rows, by) {
    const grouped = new Map();

    for (const row of rows) {
        const key = String(row?.[by]);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(row);
    }

    return grouped;
}


/** compares group keys the way a person reads them: "Item 2" before "Item 10" */
const KEY_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });


/**
 * One level's groups in the order its `sort` asks for: as first seen, when it
 * asks for none; else by key, ascending or descending.
 *
 * Keys are compared as numbers when both are numbers - a key is the field's
 * value as text, and as text "9" sorts after "10". Otherwise they are compared
 * as words with their digits read as numbers, so an ISO date sorts by date. Two
 * keys that compare equal keep the order they were first seen in.
 *
 * @param {Map<string, object[]>} groups
 * @param {'asc'|'desc'|null|undefined} sort
 * @returns {Iterable<[string, object[]]>}
 */
function sortedGroups(groups, sort) {
    if (sort !== 'asc' && sort !== 'desc') return groups;

    const direction = sort === 'desc' ? -1 : 1;
    const numeric = (key) => key.trim() !== '' && Number.isFinite(Number(key));

    return [...groups].sort(([a], [b]) => direction * (numeric(a) && numeric(b)
        ? Number(a) - Number(b)
        : KEY_ORDER.compare(a, b)));
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

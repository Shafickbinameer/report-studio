/**
 * calculate.js works out a table's calculated columns: a column that shows the
 * result of a calculation over its row rather than a field from the data.
 *
 *   { "field": "amount", "label": "Amount", "expression": "{qty} * {price}" }
 *
 * The result is written onto a copy of each row under the column's field, once,
 * before anything else reads the rows - so a calculated column is a field like
 * any other from then on: it is formatted, highlighted, summed by {sum(amount)},
 * grouped and sorted by, measured, searched and exported without any of those
 * knowing it was calculated.
 *
 * The language is small, and read here - nothing is ever handed to eval:
 *
 *   {qty}  {customer.discount}   a field of the row
 *   12  0.18                     a number
 *   + - * / %  ( )               arithmetic, the usual precedence
 *   round(x)  round(x, 2)        to whole numbers, or to places
 *   abs(x)
 *   sum(x)  avg(x)  min(x)  max(x)  count()
 *                                over every row of the table - sum({total}),
 *                                or of a calculation, sum({qty} * {price})
 *   min(a, b, …)  max(a, b, …)   the smallest or largest of several values
 *   percentage(x)                this row's x as a share of x over every row
 *   percentage(x, group)         … of x over the rows of the row's own group
 *   percentage(x, of)            … of any other value: a target, a total
 *
 * A calculation whose inputs are not numbers - a blank, a name - is blank, as
 * is anything divided by zero. Columns are worked out left to right, so one can
 * use another's result.
 */


import { toNumber } from './format.js';
import { levelsOf } from './tables.js';


/** the functions that take every row of the table rather than this one */
const AGGREGATES = ['sum', 'avg', 'count', 'min', 'max'];

/** the functions that take values */
const FUNCTIONS = ['round', 'abs', 'min', 'max', 'percentage'];


/**
 * A calculation, read - or the reason it cannot be.
 * @param {string} expression
 * @returns {{ast: object}|{error: string}}
 */
export function parseExpression(expression) {
    if (typeof expression !== 'string' || expression.trim() === '') {
        return { error: 'is empty' };
    }

    try {
        const parser = createParser(tokenize(expression));
        const ast = parser.expression();
        parser.end();
        return { ast };
    } catch (error) {
        return { error: error.message };
    }
}


/**
 * The fields a calculation reads, for the designer's sample data and its field
 * lists - `{qty} * {price}` reads qty and price.
 * @param {string} expression
 * @returns {string[]}
 */
export function expressionFields(expression) {
    const found = new Set();
    for (const [, name] of String(expression ?? '').matchAll(/\{([^{}]+)\}/g)) {
        found.add(name.trim());
    }
    return [...found];
}


/**
 * Whether a column is calculated.
 * @param {object} column
 * @returns {boolean}
 */
export function isCalculated(column) {
    return typeof column?.expression === 'string' && column.expression.trim() !== '';
}


/**
 * A table's rows with its calculated columns filled in.
 *
 * The rows given are the host's data, and are not touched: a table with a
 * calculated column reads copies, and one without reads the rows themselves,
 * as it always has.
 *
 * @param {object} table
 * @param {object[]} rows
 * @returns {object[]}
 */
export function calculatedRows(table, rows) {
    const columns = (Array.isArray(table?.columns) ? table.columns : []).filter(isCalculated);
    if (columns.length === 0 || !Array.isArray(rows)) return rows;

    let current = rows.map(row => ({ ...row }));

    for (const column of columns) {
        const parsed = parseExpression(column.expression);

        /** validate.js says what is wrong; here the column is only left blank */
        if (parsed.error) {
            for (const row of current) row[column.field] = null;
            continue;
        }

        const context = createContext(table, current);
        const values = current.map(row => evaluate(parsed.ast, row, context));
        current.forEach((row, n) => { row[column.field] = values[n]; });

        current = [...current];
    }

    return current;
}


/* ---------------- reading ---------------- */


/**
 * The calculation in pieces: numbers, fields, names, and the marks between.
 * @param {string} source
 * @returns {{type: string, value: *, at: number}[]}
 */
function tokenize(source) {
    const tokens = [];
    let i = 0;

    while (i < source.length) {
        const ch = source[i];

        if (/\s/.test(ch)) { i++; continue; }

        if (ch === '{') {
            const end = source.indexOf('}', i);
            if (end === -1) throw new Error(`has a { at ${i + 1} that is never closed`);

            const name = source.slice(i + 1, end).trim();
            if (!name) throw new Error(`has an empty {} at ${i + 1}`);

            tokens.push({ type: 'field', value: name, at: i });
            i = end + 1;
            continue;
        }

        const number = /^\d+(\.\d+)?|^\.\d+/.exec(source.slice(i));
        if (number) {
            tokens.push({ type: 'number', value: Number(number[0]), at: i });
            i += number[0].length;
            continue;
        }

        const name = /^[A-Za-z_]\w*/.exec(source.slice(i));
        if (name) {
            tokens.push({ type: 'name', value: name[0], at: i });
            i += name[0].length;
            continue;
        }

        if ('+-*/%(),'.includes(ch)) {
            tokens.push({ type: ch, value: ch, at: i });
            i++;
            continue;
        }

        throw new Error(`cannot read "${ch}" at ${i + 1}`);
    }

    return tokens;
}


/**
 * A recursive-descent reader: expression > term > unary > primary, so * binds
 * tighter than +, and a minus in front binds tightest of all.
 */
function createParser(tokens) {
    let at = 0;

    const peek = () => tokens[at];
    const take = (type) => (peek()?.type === type ? tokens[at++] : null);
    const want = (type, what) => {
        const token = take(type);
        if (!token) throw new Error(`expects ${what}${where()}`);
        return token;
    };
    const where = () => (peek() ? ` at ${peek().at + 1}` : ' at the end');

    function expression() {
        let node = term();
        for (let op = peek()?.type; op === '+' || op === '-'; op = peek()?.type) {
            at++;
            node = { kind: 'binary', op, left: node, right: term() };
        }
        return node;
    }

    function term() {
        let node = unary();
        for (let op = peek()?.type; op === '*' || op === '/' || op === '%'; op = peek()?.type) {
            at++;
            node = { kind: 'binary', op, left: node, right: unary() };
        }
        return node;
    }

    function unary() {
        if (take('-')) return { kind: 'negate', value: unary() };
        if (take('+')) return unary();
        return primary();
    }

    function primary() {
        const token = peek();
        if (!token) throw new Error('ends where a value is expected');

        if (take('number')) return { kind: 'number', value: token.value };
        if (take('field')) return { kind: 'field', name: token.value };

        if (take('(')) {
            const node = expression();
            want(')', 'a )');
            return node;
        }

        if (take('name')) {
            const name = token.value;

            if (name === 'group') {
                throw new Error(`uses "group" at ${token.at + 1}, which only means anything in percentage(x, group)`);
            }
            if (!FUNCTIONS.includes(name) && !AGGREGATES.includes(name)) {
                throw new Error(`has no function called "${name}" - it knows ` +
                    `${[...new Set([...FUNCTIONS, ...AGGREGATES])].join(', ')}`);
            }

            want('(', `a ( after ${name}`);
            const args = [];

            if (!take(')')) {
                do {
                    /** `group` is a word percentage() takes, not a value */
                    if (name === 'percentage' && args.length === 1 && peek()?.type === 'name'
                        && peek().value === 'group') {
                        at++;
                        args.push({ kind: 'group' });
                    } else {
                        args.push(expression());
                    }
                } while (take(','));
                want(')', `a ) to close ${name}(`);
            }

            return call(name, args, token);
        }

        throw new Error(`does not expect "${token.value}"${where()}`);
    }

    /** a call, checked for the number of values it takes */
    function call(name, args, token) {
        const count = args.length;
        const at = ` at ${token.at + 1}`;

        if (name === 'count') {
            if (count !== 0) throw new Error(`gives count() nothing - it counts rows${at}`);
            return { kind: 'aggregate', fn: 'count', value: null };
        }

        if ((name === 'min' || name === 'max') && count > 1) {
            return { kind: 'call', fn: name, args };
        }

        if (AGGREGATES.includes(name)) {
            if (count !== 1) throw new Error(`gives ${name}() one value${at}`);
            return { kind: 'aggregate', fn: name, value: args[0] };
        }

        if (name === 'round' && (count < 1 || count > 2)) throw new Error(`gives round() a value and, if you like, places${at}`);
        if (name === 'abs' && count !== 1) throw new Error(`gives abs() one value${at}`);
        if (name === 'percentage' && (count < 1 || count > 2)) {
            throw new Error(`gives percentage() a value and, if you like, what it is a share of${at}`);
        }

        return { kind: 'call', fn: name, args };
    }

    return {
        expression,
        end() {
            if (peek()) throw new Error(`has "${peek().value}" left over at ${peek().at + 1}`);
        }
    };
}


/* ---------------- working out ---------------- */


/**
 * What evaluate needs beyond the row: every row of the table, the rows of the
 * row's own group, and the totals already worked out - an aggregate over every
 * row is the same for every row, and is worked out once.
 */
function createContext(table, rows) {
    const levels = levelsOf(table).map(level => level?.by).filter(Boolean);
    const groupKey = (row) => levels.map(by => String(row?.[by])).join('\u0000');

    const groups = new Map();
    if (levels.length) {
        for (const row of rows) {
            const key = groupKey(row);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(row);
        }
    }

    return {
        rows,
        groupOf: (row) => (levels.length ? groups.get(groupKey(row)) ?? [row] : rows),
        groupKey,
        cache: new Map()
    };
}


/**
 * One row's value for a calculation: a number, or null where it has none.
 * @param {object} node
 * @param {object} row
 * @param {object} context
 * @returns {number|null}
 */
function evaluate(node, row, context) {
    switch (node.kind) {
        case 'number':
            return node.value;

        case 'field':
            return toNumber(lookup(row, node.name));

        case 'negate': {
            const value = evaluate(node.value, row, context);
            return value === null ? null : -value;
        }

        case 'binary': {
            const a = evaluate(node.left, row, context);
            const b = evaluate(node.right, row, context);
            if (a === null || b === null) return null;

            switch (node.op) {
                case '+': return round(a + b);
                case '-': return round(a - b);
                case '*': return round(a * b);
                case '/': return b === 0 ? null : round(a / b);
                case '%': return b === 0 ? null : round(a % b);
            }
            return null;
        }

        case 'aggregate':
            return aggregate(node, context.rows, context, 'all');

        case 'call':
            return callFunction(node, row, context);

        default:
            return null;
    }
}


/**
 * An aggregate over some rows, worked out once per scope - 'all' for the whole
 * table, or one group's key - however many rows ask for it.
 */
function aggregate(node, rows, context, scope) {
    if (!context.cache.has(node)) context.cache.set(node, new Map());
    const known = context.cache.get(node);
    if (known.has(scope)) return known.get(scope);

    let result;

    if (node.fn === 'count') {
        result = rows.length;
    } else {
        const values = rows.map(r => evaluate(node.value, r, context)).filter(v => v !== null);

        if (!values.length) result = null;
        else if (node.fn === 'sum') result = round(values.reduce((a, b) => a + b, 0));
        else if (node.fn === 'avg') result = round(values.reduce((a, b) => a + b, 0) / values.length);
        else if (node.fn === 'min') result = Math.min(...values);
        else if (node.fn === 'max') result = Math.max(...values);
        else result = null;
    }

    known.set(scope, result);
    return result;
}


/** the sum a percentage() divides by: one node per percentage, so its total is cached */
const SHARE_TOTALS = new WeakMap();

function shareTotal(node) {
    if (!SHARE_TOTALS.has(node)) {
        SHARE_TOTALS.set(node, { kind: 'aggregate', fn: 'sum', value: node.args[0] });
    }
    return SHARE_TOTALS.get(node);
}


function callFunction(node, row, context) {
    const value = (n) => evaluate(node.args[n], row, context);

    switch (node.fn) {
        case 'abs': {
            const x = value(0);
            return x === null ? null : Math.abs(x);
        }

        case 'round': {
            const x = value(0);
            const places = node.args.length > 1 ? value(1) : 0;
            if (x === null || places === null) return null;

            const factor = 10 ** Math.max(0, Math.min(10, Math.round(places)));
            return Math.round((x + Number.EPSILON * Math.sign(x)) * factor) / factor;
        }

        case 'min':
        case 'max': {
            const values = node.args.map((_, n) => value(n));
            if (values.some(v => v === null)) return null;
            return node.fn === 'min' ? Math.min(...values) : Math.max(...values);
        }

        case 'percentage': {
            const part = value(0);
            if (part === null) return null;

            const of = node.args[1];
            let whole;

            if (!of) {
                /** the same calculation, added up over every row */
                whole = aggregate(shareTotal(node), context.rows, context, 'all');
            } else if (of.kind === 'group') {
                /** … over the rows of this row's own group */
                whole = aggregate(shareTotal(node), context.groupOf(row), context,
                    `group:${context.groupKey(row)}`);
            } else {
                whole = value(1);
            }

            if (whole === null || whole === 0) return null;
            return round(part / whole);
        }

        default:
            return null;
    }
}


/** a dotted path into the row - `customer.discount` */
function lookup(row, path) {
    return path.split('.').reduce((node, part) => node?.[part], row);
}


/** twelve significant digits: 0.1 + 0.2 is 0.3 on a report */
function round(n) {
    return Number.isFinite(n) ? Number(n.toPrecision(12)) : null;
}

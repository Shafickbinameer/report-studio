/**
 * highlight.js decides how a value is styled by the rules it is given -
 * Crystal's Highlighting Expert: a list of conditions, each with a style, the
 * first that holds being the one used.
 *
 *   highlight: [
 *     { when: { op: '<', value: 0 },                          style: { color: '#b3261e' } },
 *     { when: { field: 'status', op: '=', value: 'Overdue' }, style: { background: '#fdecec' } }
 *   ]
 *
 * Rules sit in three places, each answered here:
 *
 *   a table column's `highlight`   that column's cells; a rule tests the cell's
 *                                  value, or another field of its row
 *   a table's `rowHighlight`       whole rows; a rule tests a field of the row
 *   a text item's `highlight`      the item; a rule tests the one value it
 *                                  prints, or a field of the data
 *
 * A style changes the text colour, the background, bold and italic - and only
 * what it names, so a rule that turns a figure red leaves the font alone.
 *
 * Values are compared as what they are: numbers as numbers ("1200" included),
 * dates by their day, anything else as text without regard to case. Nothing
 * here touches the document; render/, measure.js and the workbook all ask the
 * same function, so the page, its row heights and the sheet cannot disagree.
 */

import { toNumber, dateParts } from './format.js';


/** what a rule can test for, in the order the designer offers them */
export const HIGHLIGHT_OPS = [
    '=', '!=', '<', '<=', '>', '>=', 'between', 'contains', 'startsWith', 'empty', 'notEmpty'
];

/** the operators that take no value to compare with */
export const UNARY_OPS = ['empty', 'notEmpty'];

/** what a rule's style may set */
export const HIGHLIGHT_STYLE_KEYS = ['color', 'background', 'fontWeight', 'fontStyle'];


/**
 * The style the first rule that holds gives a value, or null when none does.
 *
 * @param {object[]|null|undefined} rules
 * @param {*} value what is being drawn - a cell's value, a text item's
 * @param {object|null} [row] what `field` is looked up in - the cell's row, or
 *   the data a text item was filled from
 * @returns {object|null} only the keys the rule's style sets
 */
export function highlightFor(rules, value, row = null) {
    if (!Array.isArray(rules)) return null;

    for (const rule of rules) {
        const when = rule?.when;
        if (!when || !HIGHLIGHT_OPS.includes(when.op)) continue;

        const subject = typeof when.field === 'string' && when.field !== ''
            ? lookup(row, when.field)
            : value;

        if (holds(subject, when)) return cleanStyle(rule.style);
    }

    return null;
}


/**
 * How one table cell is styled by the rules over it: the table's row rules,
 * then its column's own on top - a red figure in a shaded row is both.
 *
 * @param {object} table
 * @param {object} column
 * @param {object} row
 * @returns {object|null}
 */
export function cellHighlight(table, column, row) {
    const forRow = highlightFor(table?.rowHighlight, null, row);
    const forCell = highlightFor(column?.highlight, row?.[column?.field], row);

    if (!forRow && !forCell) return null;
    return { ...(forRow ?? {}), ...(forCell ?? {}) };
}


/**
 * One line a person reads to know what the rules are - the rail's summary.
 * @param {object[]|null|undefined} rules
 * @returns {string}
 */
export function describeHighlight(rules) {
    const count = Array.isArray(rules) ? rules.length : 0;
    if (count === 0) return 'None';
    return count === 1 ? '1 rule' : `${count} rules`;
}


/**
 * A rule's condition in words: "is less than 0", "status equals Overdue".
 * @param {object} when
 * @param {(value: *) => string} [show] how an operand is written
 * @returns {string}
 */
export function describeCondition(when, show = String) {
    const words = {
        '=': 'equals', '!=': 'is not', '<': 'is less than', '<=': 'is at most',
        '>': 'is more than', '>=': 'is at least', between: 'is between',
        contains: 'contains', startsWith: 'starts with', empty: 'is empty',
        notEmpty: 'is not empty'
    }[when?.op] ?? when?.op;

    const subject = when?.field ? `${when.field} ` : '';
    if (UNARY_OPS.includes(when?.op)) return `${subject}${words}`;
    if (when?.op === 'between') return `${subject}${words} ${show(when.value)} and ${show(when.to)}`;

    return `${subject}${words} ${show(when?.value)}`;
}


/* ---------------- comparing ---------------- */


function holds(subject, when) {
    const { op } = when;

    if (op === 'empty') return isEmpty(subject);
    if (op === 'notEmpty') return !isEmpty(subject);

    /** nothing is less than, more than or equal to a blank - it is blank */
    if (isEmpty(subject)) return op === '!=' && !isEmpty(when.value);

    if (op === 'contains') return text(subject).includes(text(when.value));
    if (op === 'startsWith') return text(subject).startsWith(text(when.value));

    if (op === 'between') {
        const low = compare(subject, when.value);
        const high = compare(subject, when.to);
        return low !== null && high !== null && low >= 0 && high <= 0;
    }

    const order = compare(subject, when.value);
    if (order === null) return op === '!=';

    switch (op) {
        case '=': return order === 0;
        case '!=': return order !== 0;
        case '<': return order < 0;
        case '<=': return order <= 0;
        case '>': return order > 0;
        case '>=': return order >= 0;
        default: return false;
    }
}


/**
 * Which way two values order - negative, zero or positive - compared as the
 * kind of thing they both are; null when there is nothing to compare with.
 *
 * Two values of different kinds do not order at all: "Pending" is neither
 * more nor less than 1000, and saying it was - by the alphabet, where letters
 * come after digits - would shade every word in a column of figures. They can
 * still be equal or not, as text: "007" is "007".
 */
function compare(a, b) {
    if (b === undefined || b === null || b === '') return null;

    const x = toNumber(a);
    const y = toNumber(b);
    if (x !== null && y !== null) return Math.sign(x - y);

    const p = dateParts(a);
    const q = dateParts(b);
    if (p && q) return Math.sign(dayValue(p) - dayValue(q));

    if (kind(a) !== kind(b)) return null;

    return Math.sign(text(a).localeCompare(text(b)));
}


/** what a value is, for deciding whether two can be ordered */
function kind(value) {
    if (toNumber(value) !== null) return 'number';
    if (dateParts(value)) return 'date';
    return 'text';
}


/** a date as one number that orders the way the dates do */
function dayValue(p) {
    return ((((p.year * 100 + p.month) * 100 + p.day) * 100 + p.hour) * 100 + p.minute) * 100 + p.second;
}


function isEmpty(value) {
    return value === null || value === undefined || String(value).trim() === '';
}


function text(value) {
    return String(value ?? '').trim().toLowerCase();
}


/** a dotted path - `customer.balance` - into the row or the data */
function lookup(row, path) {
    return path.split('.').reduce((node, part) => node?.[part], row ?? undefined);
}


/** only the keys a style may set, and only those it sets */
function cleanStyle(style) {
    const out = {};

    for (const key of HIGHLIGHT_STYLE_KEYS) {
        const value = style?.[key];
        if (typeof value === 'string' && value !== '') out[key] = value;
    }

    return out;
}

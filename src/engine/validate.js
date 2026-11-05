/**
 * validate.js checks a layout file before the engine walks it.
 *
 * Spec 6.1 chose a hand-written validator over a schema library specifically to
 * get errors that name the band and item at fault. A malformed layout should
 * say so here, not surface as a TypeError three stages downstream.
 */


import { tablesOf, hasOwnGrouping, levelsOf, MAX_GROUP_LEVELS, GROUP_SORTS } from './tables.js';
import {
    FORMAT_TYPES, GROUPINGS, NEGATIVES, ZEROS, SYMBOL_POSITIONS, MAX_DECIMALS
} from './format.js';
import { HIGHLIGHT_OPS, HIGHLIGHT_STYLE_KEYS } from './highlight.js';
import { designHeight } from './measure.js';


const BAND_TYPES = [
    'reportHeader',
    'pageHeader',
    'groupHeader',
    'detail',
    'groupFooter',
    'reportFooter',
    'pageFooter'
];

const ITEM_TYPES = ['text', 'table', 'line', 'box', 'image'];

/** spec 3.3: a line runs along one axis; which one is the item's to say */
const LINE_ORIENTATIONS = ['horizontal', 'vertical'];

/** the four CSS border styles that read as a rule rather than a box */
const LINE_STYLES = ['solid', 'dashed', 'dotted', 'double'];

/** a table's grid may also be turned off, which a line cannot be */
const RULE_STYLES = [...LINE_STYLES, 'none'];

/** how a picture is fitted to its box: the three object-fit values that mean something here */
export const IMAGE_FITS = ['contain', 'cover', 'fill'];


/** Thrown for a layout the engine cannot work with. */
export class ReportError extends Error {
    constructor(message, issues = []) {
        super(issues.length ? `${message}\n  - ${issues.join('\n  - ')}` : message);
        this.name = 'ReportError';
        this.issues = issues;
    }
}


/**
 * Collects everything wrong with a layout, rather than stopping at the first
 * problem - a designer fixing five typos wants all five named at once.
 * @param {*} json
 * @returns {string[]} human-readable issues, empty when the layout is usable
 */
export function validateLayout(json) {
    const issues = [];

    if (json == null || typeof json !== 'object' || Array.isArray(json)) {
        return ['layout must be an object'];
    }

    validatePage(json.page, issues);

    if (!Array.isArray(json.bands)) {
        issues.push('layout.bands must be an array');
        return issues;
    }

    if (json.bands.length === 0) {
        issues.push('layout.bands is empty - there is nothing to render');
    }

    if (json.groupBy != null && typeof json.groupBy !== 'string') {
        issues.push('layout.groupBy must be a field name or null');
    }

    validateFormat(json.format, 'layout.format', issues, false);

    const seenTypes = new Set();

    json.bands.forEach((band, i) => {
        const where = `bands[${i}]`;

        if (band == null || typeof band !== 'object') {
            issues.push(`${where} must be an object`);
            return;
        }

        if (!BAND_TYPES.includes(band.type)) {
            issues.push(`${where}.type "${band.type}" is not one of: ${BAND_TYPES.join(', ')}`);
        } else if (seenTypes.has(band.type)) {
            issues.push(`${where}.type "${band.type}" appears more than once; the engine places one band of each type`);
        } else {
            seenTypes.add(band.type);
        }

        if (!Array.isArray(band.items)) {
            issues.push(`${where}.items must be an array`);
            return;
        }

        band.items.forEach((item, j) =>
            validateItem(item, `${where}.items[${j}]`, issues));
    });

    if (json.groupBy != null && !seenTypes.has('groupHeader') && !seenTypes.has('groupFooter')) {
        issues.push('layout.groupBy is set but there is no groupHeader or groupFooter band to show it');
    }

    validateTables(json, json.bands, issues);

    return issues;
}


/**
 * What the tables of a report may be, together.
 *
 * Any number of them, each bound to its own dataset, and any number of them
 * grouped - each through a `grouping` of its own, which carries the bands its
 * groups are drawn with. What they may not do, because the engine has no
 * honest way to print it:
 *
 *   Two tables grouped the older way. `groupBy` on a table borrows the report's
 *   groupHeader and groupFooter, and there is one of each - so both tables
 *   would draw their groups with the same heading. A second grouped table says
 *   so with a `grouping` of its own.
 *
 *   One table grouped both ways. Which of the two it meant is not something to
 *   guess at.
 *
 *   Two tables side by side. Each table splits across pages on its own, so the
 *   one on the left would run to page three before the one on the right began,
 *   and began on page three. Tables in one band are stacked: each starts below
 *   where the one above it was designed to end, and the engine moves it down
 *   by however far the rows above really ran.
 *
 * @param {object} json the layout
 * @param {object[]} bands
 * @param {string[]} issues
 */
function validateTables(json, bands, issues) {
    const tables = tablesOf(json);

    for (const table of tables) {
        if (table.groupBy != null && typeof table.groupBy !== 'string') {
            issues.push(`table "${table.id}".groupBy must be a field name or null`);
        }

        if (table.dataset != null && typeof table.dataset !== 'string') {
            issues.push(`table "${table.id}".dataset must be a dataset name or null`);
        }

        validateGrouping(table, issues);
    }

    const grouped = tables.filter(hasOwnGrouping);

    if (grouped.length > 1) {
        issues.push(
            `${grouped.length} tables are grouped by groupBy (${grouped.map(t => `"${t.id}"`).join(', ')}); ` +
            `only one can use the report's groupHeader and groupFooter - give the others ` +
            `a grouping of their own`);
    }

    if (grouped.length > 0 && json.groupBy == null
        && !bands.some(b => b?.type === 'groupHeader' || b?.type === 'groupFooter')) {
        issues.push(
            `table "${grouped[0].id}" is grouped by "${grouped[0].groupBy}" but there is ` +
            `no groupHeader or groupFooter band to show it`);
    }

    /** layout.groupBy means the first table, unless a table names its own groupBy */
    const first = tables[0];

    if (json.groupBy != null && grouped.length === 0
        && first && levelsOf(first).length > 0) {
        issues.push(
            `layout.groupBy groups the first table, "${first.id}", which already has a ` +
            `grouping of its own; remove one of the two`);
    }

    for (const band of bands) {
        if (!Array.isArray(band?.items)) continue;

        const stack = band.items
            .filter(item => item?.type === 'table')
            .map(item => ({ item, top: Number(item.y) || 0, bottom: (Number(item.y) || 0) + designHeight(item) }))
            .sort((a, b) => a.top - b.top);

        for (let i = 1; i < stack.length; i++) {
            const above = stack[i - 1];
            const below = stack[i];

            if (below.top < above.bottom) {
                issues.push(
                    `tables "${above.item.id}" and "${below.item.id}" overlap in the ${band.type} band; ` +
                    `move "${below.item.id}" to y ${Math.ceil(above.bottom)} or lower - tables are ` +
                    `stacked, one under another, not placed side by side`);
            }
        }
    }
}


/**
 * A table's own grouping: a list of levels, each a field and the bands its
 * groups are drawn with.
 *
 *   "grouping": [{ "by": "region", "header": { "height": 30, "items": [] }, "footer": null }]
 *
 * Levels are outermost first; each after the first groups within the groups of
 * the one before. Grouping twice by the same field is refused - every group of
 * the inner level would be the whole of its outer group, drawn twice over.
 *
 * @param {object} table
 * @param {string[]} issues
 */
function validateGrouping(table, issues) {
    if (table.grouping == null) return;

    const where = `table "${table.id}".grouping`;

    if (!Array.isArray(table.grouping)) {
        issues.push(`${where} must be a list of group levels, or null`);
        return;
    }

    if (table.grouping.length > 0 && hasOwnGrouping(table)) {
        issues.push(
            `table "${table.id}" is grouped both by groupBy and by grouping; remove groupBy`);
    }

    if (table.grouping.length > MAX_GROUP_LEVELS) {
        issues.push(
            `${where} has ${table.grouping.length} levels; a table may be grouped at ` +
            `${MAX_GROUP_LEVELS} at most`);
    }

    /** the level each field was first grouped by, to name a repeat against */
    const seen = new Map();

    table.grouping.forEach((level, n) => {
        const at = `${where}[${n}]`;

        if (level == null || typeof level !== 'object' || Array.isArray(level)) {
            issues.push(`${at} must be an object with by, header and footer`);
            return;
        }

        if (typeof level.by !== 'string' || level.by === '') {
            issues.push(`${at}.by must be the name of the field to group by`);
        } else if (seen.has(level.by)) {
            issues.push(
                `${at} groups by "${level.by}" again, as ${where}[${seen.get(level.by)}] ` +
                `already does; group each level by a different field`);
        } else {
            seen.set(level.by, n);
        }

        if (level.sort != null && !GROUP_SORTS.includes(level.sort)) {
            issues.push(
                `${at}.sort must be ${GROUP_SORTS.map(s => `"${s}"`).join(' or ')}, or null ` +
                `to keep the groups in the order they are first seen`);
        }

        if (level.newPage != null && typeof level.newPage !== 'boolean') {
            issues.push(`${at}.newPage must be true or false`);
        }

        validateGroupBand(level.header, `${at}.header`, issues);
        validateGroupBand(level.footer, `${at}.footer`, issues);

        if (level.header == null && level.footer == null) {
            issues.push(`${at} has neither a header nor a footer to show its groups`);
        }
    });
}


/**
 * One of a table's group bands: a band in all but its place in the file, so
 * its items are checked the same way. It may not hold a table - it is drawn
 * once for every group, inside the table it belongs to.
 *
 * @param {*} band
 * @param {string} where
 * @param {string[]} issues
 */
function validateGroupBand(band, where, issues) {
    if (band == null) return;

    if (typeof band !== 'object' || Array.isArray(band)) {
        issues.push(`${where} must be a band with items, or null`);
        return;
    }

    if (band.height != null && !(typeof band.height === 'number' && band.height >= 0)) {
        issues.push(`${where}.height must be a number of pixels`);
    }

    if (band.background != null && (typeof band.background !== 'string' || band.background === '')) {
        issues.push(`${where}.background must be a colour, or null`);
    }

    if (!Array.isArray(band.items)) {
        issues.push(`${where}.items must be an array`);
        return;
    }

    band.items.forEach((item, j) => {
        if (item?.type === 'table') {
            issues.push(`${where}.items[${j}] is a table; a group band cannot hold one`);
            return;
        }

        validateItem(item, `${where}.items[${j}]`, issues);
    });
}


function validatePage(page, issues) {
    if (page == null || typeof page !== 'object') {
        issues.push('layout.page must be an object with width, height and margin');
        return;
    }

    for (const key of ['width', 'height']) {
        if (!(typeof page[key] === 'number' && page[key] > 0)) {
            issues.push(`layout.page.${key} must be a positive number`);
        }
    }

    if (page.margin == null || typeof page.margin !== 'object') {
        issues.push('layout.page.margin must be an object with top, right, bottom and left');
        return;
    }

    for (const side of ['top', 'right', 'bottom', 'left']) {
        if (!(typeof page.margin[side] === 'number' && page.margin[side] >= 0)) {
            issues.push(`layout.page.margin.${side} must be a number of pixels`);
        }
    }

    const printable = page.height - (page.margin.top + page.margin.bottom);
    if (printable <= 0) {
        issues.push(`layout.page margins leave no printable height (${printable}px)`);
    }
}


function validateItem(item, where, issues) {
    if (item == null || typeof item !== 'object') {
        issues.push(`${where} must be an object`);
        return;
    }

    if (!ITEM_TYPES.includes(item.type)) {
        issues.push(`${where}.type "${item.type}" is not one of: ${ITEM_TYPES.join(', ')}`);
        return;
    }

    if (typeof item.id !== 'string' || item.id === '') {
        issues.push(`${where}.id must be a non-empty string`);
    }

    if (item.type === 'text') {
        if (typeof item.value !== 'string') {
            issues.push(`${where}.value must be a string`);
        }
        validateFormat(item.format, `${where}.format`, issues, true);
        validateHighlight(item.highlight, `${where}.highlight`, issues, false);
        return;
    }

    if (item.type === 'line') {
        validateLine(item, where, issues);
        return;
    }

    if (item.type === 'box') {
        validateBox(item, where, issues);
        return;
    }

    if (item.type === 'image') {
        validateImage(item, where, issues);
        return;
    }

    /** table */
    if (!(typeof item.rowHeight === 'number' && item.rowHeight > 0)) {
        issues.push(`${where}.rowHeight must be a positive number`);
    }

    if (item.style?.borderStyle != null
        && !RULE_STYLES.includes(item.style.borderStyle)) {
        issues.push(
            `${where}.style.borderStyle "${item.style.borderStyle}" is not one of: ` +
            RULE_STYLES.join(', '));
    }

    if (item.style?.borderWidth != null
        && !(typeof item.style.borderWidth === 'number' && item.style.borderWidth > 0)) {
        issues.push(`${where}.style.borderWidth must be a positive number of pixels`);
    }

    if (!Array.isArray(item.columns) || item.columns.length === 0) {
        issues.push(`${where}.columns must be a non-empty array`);
        return;
    }

    item.columns.forEach((col, k) => {
        if (col == null || typeof col.field !== 'string' || col.field === '') {
            issues.push(`${where}.columns[${k}].field must be a non-empty string`);
        }
        validateFormat(col?.format, `${where}.columns[${k}].format`, issues, true);
        validateHighlight(col?.highlight, `${where}.columns[${k}].highlight`, issues, false);
    });

    validateHighlight(item.rowHighlight, `${where}.rowHighlight`, issues, true);
}


/**
 * A list of highlight rules: each a condition and the style it gives.
 *
 * @param {*} rules
 * @param {string} where
 * @param {string[]} issues
 * @param {boolean} needsField whether every rule must name a field - a row's
 *   rules do, a row having no one value of its own to test
 */
function validateHighlight(rules, where, issues, needsField) {
    if (rules == null) return;

    if (!Array.isArray(rules)) {
        issues.push(`${where} must be a list of rules, or null`);
        return;
    }

    rules.forEach((rule, n) => {
        const at = `${where}[${n}]`;
        const when = rule?.when;

        if (when == null || typeof when !== 'object') {
            issues.push(`${at}.when must say what to test`);
            return;
        }

        if (!HIGHLIGHT_OPS.includes(when.op)) {
            issues.push(`${at}.when.op "${when.op}" is not one of: ${HIGHLIGHT_OPS.join(', ')}`);
        }

        if (when.field != null && (typeof when.field !== 'string' || when.field === '')) {
            issues.push(`${at}.when.field must be the name of a field`);
        } else if (needsField && when.field == null) {
            issues.push(`${at}.when.field must name the field of the row to test`);
        }

        if (when.op === 'between' && (when.value == null || when.to == null)) {
            issues.push(`${at}.when needs both value and to for between`);
        }

        const style = rule.style;
        if (style == null || typeof style !== 'object' || Array.isArray(style)) {
            issues.push(`${at}.style must be an object`);
            return;
        }

        for (const key of Object.keys(style)) {
            if (!HIGHLIGHT_STYLE_KEYS.includes(key)) {
                issues.push(`${at}.style.${key} is not one of: ${HIGHLIGHT_STYLE_KEYS.join(', ')}`);
            }
        }
    });
}


/**
 * A number or date format - a text item's, a column's, or the report's own
 * defaults, which have every key but `type`. Every key is optional; what is
 * there has to be one of the things format.js knows.
 *
 * @param {*} format
 * @param {string} where
 * @param {string[]} issues
 * @param {boolean} typed whether it may say a `type` - the report's defaults may not
 */
function validateFormat(format, where, issues, typed) {
    if (format == null) return;

    if (typeof format !== 'object' || Array.isArray(format)) {
        issues.push(`${where} must be an object, or null`);
        return;
    }

    const oneOf = (key, list) => {
        if (format[key] != null && !list.includes(format[key])) {
            issues.push(`${where}.${key} "${format[key]}" is not one of: ${list.join(', ')}`);
        }
    };

    if (typed) oneOf('type', FORMAT_TYPES);
    else if (format.type != null) {
        issues.push(`${where}.type is an item's or a column's to say, not the report's`);
    }

    oneOf('grouping', GROUPINGS);
    oneOf('negative', NEGATIVES);
    oneOf('zero', ZEROS);
    oneOf('symbolPosition', SYMBOL_POSITIONS);

    if (format.decimals != null && !(Number.isInteger(format.decimals)
        && format.decimals >= 0 && format.decimals <= MAX_DECIMALS)) {
        issues.push(`${where}.decimals must be a whole number from 0 to ${MAX_DECIMALS}`);
    }

    for (const key of ['symbol', 'pattern']) {
        if (format[key] != null && typeof format[key] !== 'string') {
            issues.push(`${where}.${key} must be text`);
        }
    }
}


/**
 * A box carries no content either - it is a rule bent round four sides - so what
 * there is to check is the pen and the corner. Everything is optional: a bare
 * `{type: "box"}` is a hairline rectangle, which is what a box usually is.
 */
function validateBox(item, where, issues) {
    const style = item.style;
    if (style == null) return;

    if (typeof style !== 'object' || Array.isArray(style)) {
        issues.push(`${where}.style must be an object`);
        return;
    }

    if (style.borderStyle != null && !RULE_STYLES.includes(style.borderStyle)) {
        issues.push(
            `${where}.style.borderStyle "${style.borderStyle}" is not one of: ` +
            RULE_STYLES.join(', '));
    }

    for (const key of ['borderWidth', 'radius']) {
        const value = style[key];

        /** a radius of nothing is a square corner, so zero is allowed there */
        const floor = key === 'radius' ? 0 : 1;

        if (value != null && !(typeof value === 'number' && value >= floor)) {
            issues.push(
                `${where}.style.${key} must be a number of pixels` +
                (floor ? ' greater than zero' : ' of zero or more'));
        }
    }
}


/**
 * An image is a fixed box with a picture in it: `src` is one stored in the
 * layout, `field` is a path into the data whose value is the picture's URL.
 *
 * Neither is required. A freshly drawn image has no picture yet, and an empty
 * frame is a layout the designer has to be able to save - it prints nothing,
 * the way a text box with an empty value does. Whether a URL is one the page
 * will actually load is the renderer's question, not this one: a layout can be
 * valid and its data still point somewhere a report should not go.
 */
function validateImage(item, where, issues) {
    if (item.src != null && typeof item.src !== 'string') {
        issues.push(`${where}.src must be a string - a URL or a data: URI`);
    }

    if (item.field != null && typeof item.field !== 'string') {
        issues.push(`${where}.field must be a data path such as "company.logo"`);
    }

    if (item.fit != null && !IMAGE_FITS.includes(item.fit)) {
        issues.push(`${where}.fit "${item.fit}" is not one of: ${IMAGE_FITS.join(', ')}`);
    }

    if (item.alt != null && typeof item.alt !== 'string') {
        issues.push(`${where}.alt must be a string`);
    }
}


/**
 * A line carries no content, so what there is to get wrong is its direction and
 * its pen. Both are optional in the file - a bare `{type: "line"}` draws a
 * hairline rule, which is what a line usually is - and only a value that is
 * present and wrong is reported.
 */
function validateLine(item, where, issues) {
    if (item.orientation != null
        && !LINE_ORIENTATIONS.includes(item.orientation)) {
        issues.push(
            `${where}.orientation "${item.orientation}" is not one of: ` +
            LINE_ORIENTATIONS.join(', '));
    }

    const style = item.style;
    if (style == null) return;

    if (typeof style !== 'object' || Array.isArray(style)) {
        issues.push(`${where}.style must be an object`);
        return;
    }

    if (style.thickness != null
        && !(typeof style.thickness === 'number' && style.thickness > 0)) {
        issues.push(`${where}.style.thickness must be a positive number of pixels`);
    }

    if (style.lineStyle != null && !LINE_STYLES.includes(style.lineStyle)) {
        issues.push(
            `${where}.style.lineStyle "${style.lineStyle}" is not one of: ` +
            LINE_STYLES.join(', '));
    }
}


/**
 * Throws unless the layout is usable.
 * @param {*} json
 * @param {string} stage the engine stage asking, so the message says who refused
 */
export function assertLayout(json, stage) {
    const issues = validateLayout(json);
    if (issues.length) {
        throw new ReportError(`${stage}: the layout file is not usable`, issues);
    }
}


/**
 * The data payload is the host application's, so it gets the same treatment.
 * @param {*} data
 * @param {string} stage
 */
export function assertData(data, stage) {
    if (data == null || typeof data !== 'object' || Array.isArray(data)) {
        throw new ReportError(`${stage}: data must be an object keyed by dataset name`);
    }
}

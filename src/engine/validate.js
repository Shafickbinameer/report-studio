/**
 * validate.js checks a layout file before the engine walks it.
 *
 * Spec 6.1 chose a hand-written validator over a schema library specifically to
 * get errors that name the band and item at fault. A malformed layout should
 * say so here, not surface as a TypeError three stages downstream.
 */


const BAND_TYPES = [
    'reportHeader',
    'pageHeader',
    'groupHeader',
    'detail',
    'groupFooter',
    'reportFooter',
    'pageFooter'
];

const ITEM_TYPES = ['text', 'table', 'line', 'box'];

/** spec 3.3: a line runs along one axis; which one is the item's to say */
const LINE_ORIENTATIONS = ['horizontal', 'vertical'];

/** the four CSS border styles that read as a rule rather than a box */
const LINE_STYLES = ['solid', 'dashed', 'dotted', 'double'];

/** a table's grid may also be turned off, which a line cannot be */
const RULE_STYLES = [...LINE_STYLES, 'none'];


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

    validateOneTable(json.bands, issues);

    return issues;
}


/**
 * One table per report, for now.
 *
 * group.js binds the dataset to the first table it finds and stops, so a second
 * one renders its header and no rows - and nothing anywhere said so. The
 * designer drew sample rows in both, the validator passed it, and the fault
 * only showed up in the printed report.
 *
 * Refused rather than warned about, because the alternative is a report that
 * quietly leaves data out. Binding a table each is a real feature and a bigger
 * change than a guard: it needs a dataset per table through group.js, more than
 * one splittable item per band in paginate.js, and an answer for what a CSV
 * export of two tables means. Until then this is the honest boundary, and it is
 * one function to delete when that lands.
 *
 * @param {object[]} bands
 * @param {string[]} issues
 */
function validateOneTable(bands, issues) {
    const tables = [];

    for (const band of bands) {
        if (!Array.isArray(band?.items)) continue;

        for (const item of band.items) {
            if (item?.type === 'table') tables.push(item.id ?? '(unnamed)');
        }
    }

    if (tables.length > 1) {
        issues.push(
            `layout has ${tables.length} tables (${tables.map(id => `"${id}"`).join(', ')}); ` +
            `a report binds one - the rest would print their header and no rows`);
    }
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
    });
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

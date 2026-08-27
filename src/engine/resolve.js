/**
 * The resolve.js is used to analysis the incoming json using regex and
 * replacing the only the text content into actual data given by the user
 * so the input are @param rptJson and @param rptData
 *
 * Two placeholder families are deliberately left alone here:
 *   {sum(field)} and friends - group.js and paginate.js know the scope
 *   {page} / {totalPages}    - paginate.js is the only stage that knows these
 * Both are left in the output text verbatim so the later stage can fill them in
 * without having to re-resolve `value` and lose everything resolved here.
 */

import { assertLayout, assertData } from './validate.js';


const REGEX = /\{([^{}]+)\}/g;

/** an aggregate expression: name(field) */
const AGGREGATE = /^\w+\(.*\)$/;

/** placeholders paginate.js owns */
const PAGE_KEYS = ['page', 'totalPages'];

/** bands whose placeholders are scoped to a group, not to the root data */
const GROUP_BANDS = ['groupHeader', 'groupFooter'];


/**
 * The placeholder pattern, and which keys the host is expected to supply.
 *
 * Exported because the designer derives a sample data file from a layout, and a
 * second copy of these rules there would drift from the ones that actually
 * resolve - so it would ask the user for `{page}` and forget `{customer.name}`.
 */
export const PLACEHOLDER = REGEX;


/**
 * Whether a placeholder is answered by the engine rather than by the data.
 *
 * Aggregates are group.js's, page numbers are paginate.js's, and `today` is the
 * clock's. Everything else has to come from the payload.
 *
 * @param {string} key the text inside the braces, trimmed
 * @returns {boolean}
 */
export function isEngineKey(key) {
    return AGGREGATE.test(key) || PAGE_KEYS.includes(key) || key === 'today';
}


/**
 * Whether a band's placeholders are scoped to a row rather than to the root.
 *
 * The group bands, and only those. Spec 3.4's table says a bare `{field}` is
 * "the current row, else root data" in any band, but that is not what this file
 * does: `deferUnknown` above is set for the group bands alone, and every other
 * band - the detail band included - looks its keys up in the root payload.
 *
 * The engine is the thing that runs, so this reports the engine. Saying
 * otherwise put `{name}` in a detail band into the rows of a sample data file,
 * where the engine never looked for it, and the report printed "Name:" and
 * nothing after it.
 *
 * @param {string} type a band type
 * @returns {boolean}
 */
export function isRowScoped(type) {
    return GROUP_BANDS.includes(type);
}


/**
 * Resolves the report JSON with the provided data
 * @param {*} rptJson
 * @param {*} rptData
 * @returns
 */
export function resolve(rptJson, rptData) {
    assertLayout(rptJson, 'resolve');
    assertData(rptData, 'resolve');

    // cloning the report json and assigning it to new var
    // so that report will not affect
    const resolved = structuredClone(rptJson);

    for (const band of resolved.bands) {
        /**
         * A group band's placeholders are mostly row fields ({name} is the
         * group's own value), which only the grouping stage can answer. Anything
         * this stage cannot resolve there is deferred rather than blanked, so
         * grouping still has it to work with.
         */
        const deferUnknown = GROUP_BANDS.includes(band.type);

        for (const item of band.items) {
            if (item.type == "text")
                item.text = resolveTxt(item, rptData, deferUnknown);
        }
    }

    return resolved;
}


/**
 * Resolves the text value of an item with the provided data
 * @param {*} item
 * @param {*} rptData
 * @param {boolean} deferUnknown leave an unresolvable key for a later stage
 * @returns
 */
function resolveTxt(item, rptData, deferUnknown) {
    return item.value.replace(REGEX, (match, key) => {
        return validatePlaceHolder(match, key.trim(), rptData, item, deferUnknown);
    })
}

/**
 * Validate the given and find weather the key is system keys or not
 * in-case of system keys return appropriate value
 * eg : key == today the return current date
 * @param {*} match the whole `{...}` token, returned as-is when a later stage owns it
 * @param {*} key
 * @param {*} rptData
 * @param {*} item
 * @param {boolean} deferUnknown
 * @returns
 */
function validatePlaceHolder(match, key, rptData, item, deferUnknown) {
    if (AGGREGATE.test(key)) {
        console.debug(`Aggregate expression found: ${key}. Deferred until grouping.`);
        return match;
    }

    if (PAGE_KEYS.includes(key)) {
        console.debug(`System key found: ${key}. Deferred until pagination.`);
        return match;
    }

    if (key == 'today') return new Date().toISOString().slice(0, 10);

    const value = findVal(key, rptData);

    if (value === undefined || value === null) {
        if (deferUnknown) {
            console.debug(`Placeholder "{${key}}" on item "${item.id}". Deferred until grouping.`);
            return match;
        }
        console.warn(`Unresolved placeholder "{${key}}" on item "${item.id}".`);
        return '';
    }

    return String(value);
}


/**
 * Helps to find the value from the given data.
 * Supports dotted paths and array indexes in either notation,
 * so `items.0.name` and `items[0].name` both resolve.
 * @param {*} key
 * @param {*} rptData
 * @returns
 */
function findVal(key, rptData) {
    return key
        .replace(/\[(\d+)\]/g, '.$1')
        .split('.')
        .filter(part => part !== '')
        .reduce((obj, part) => obj?.[part], rptData);
}

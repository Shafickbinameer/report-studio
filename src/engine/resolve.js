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

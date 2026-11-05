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
import { levelsOf, tablesOf } from './tables.js';
import { effectiveFormat, formatValue } from './format.js';


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
 * The key of a text item that is one placeholder and nothing else - "{total}"
 * or "{sum(amount)}" - or null. Such an item prints one value, and the stage
 * that fills it in keeps that value as `raw`, so a spreadsheet can hold the
 * number rather than the text it was printed as.
 * @param {string} value a text item's value
 * @returns {string|null}
 */
export function soleKey(value) {
    const match = typeof value === 'string' ? value.trim().match(/^{([^{}]+)}$/) : null;
    return match ? match[1].trim() : null;
}


/**
 * Every format in the layout, with the report's defaults filled in under it.
 *
 * Done once, here, on the copy every later stage works on - so measure.js, the
 * renderer and the exporters read a text item's or a column's `format` as it
 * stands, and none of them has to be handed the report's defaults as well.
 * @param {object} layout the copy being resolved
 */
function settleFormats(layout) {
    const defaults = layout.format;
    const settle = (owner) => {
        const settled = effectiveFormat(owner?.format, defaults);
        if (settled) owner.format = settled;
    };

    const textIn = (band) => (Array.isArray(band?.items) ? band.items : [])
        .filter(item => item?.type === 'text');

    for (const band of layout.bands) textIn(band).forEach(settle);

    for (const table of tablesOf(layout)) {
        (Array.isArray(table.columns) ? table.columns : []).forEach(settle);

        for (const level of levelsOf(table)) {
            textIn(level?.header).forEach(settle);
            textIn(level?.footer).forEach(settle);
        }
    }
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

    settleFormats(resolved);

    for (const band of resolved.bands) {
        /**
         * A group band's placeholders are mostly row fields ({name} is the
         * group's own value), which only the grouping stage can answer. Anything
         * this stage cannot resolve there is deferred rather than blanked, so
         * grouping still has it to work with.
         */
        resolveBand(band, rptData, GROUP_BANDS.includes(band.type), resolved.format);

        /** a table's own group bands are group bands just the same */
        for (const item of band.items) {
            if (item.type !== 'table') continue;

            for (const level of levelsOf(item)) {
                for (const groupBand of [level?.header, level?.footer]) {
                    if (Array.isArray(groupBand?.items)) resolveBand(groupBand, rptData, true, resolved.format);
                }
            }
        }
    }

    return resolved;
}


/**
 * Fills in what the root data can answer on one band's items.
 * @param {object} band
 * @param {object} rptData
 * @param {boolean} deferUnknown leave an unresolvable key for the grouping stage
 * @param {object} [defaults] the report's own format, for what an item leaves unsaid
 */
function resolveBand(band, rptData, deferUnknown, defaults) {
    for (const item of band.items) {
        if (item.type == "text")
            item.text = resolveTxt(item, rptData, deferUnknown, defaults);

        if (item.type == "image")
            item.resolvedSrc = resolveImage(item, rptData);
    }
}


/**
 * The picture an image item shows: the value at its `field` when the data has
 * one there, and the `src` stored in the layout otherwise - so a report can
 * carry a default logo that the host replaces per customer.
 *
 * Always written, if only as '', because its presence is what tells the
 * renderer this item went through the engine. The designer canvas draws items
 * straight from the layout and shows a placeholder for a bound image; a built
 * report whose data had no picture should print an empty frame instead.
 *
 * The URL is not checked here. Every route to the page goes through the
 * renderer, which is where it is made safe - checking twice is two lists of
 * schemes to keep in step.
 *
 * @param {object} item an image item
 * @param {object} rptData
 * @returns {string}
 */
function resolveImage(item, rptData) {
    const field = typeof item.field === 'string' ? item.field.trim() : '';

    if (field) {
        const value = findVal(field, rptData);
        if (typeof value === 'string' && value !== '') return value;

        if (!item.src) {
            console.warn(`Unresolved image field "${field}" on item "${item.id}".`);
        }
    }

    return typeof item.src === 'string' ? item.src : '';
}


/**
 * Resolves the text value of an item with the provided data
 * @param {*} item
 * @param {*} rptData
 * @param {boolean} deferUnknown leave an unresolvable key for a later stage
 * @returns
 */
function resolveTxt(item, rptData, deferUnknown, defaults) {
    const sole = soleKey(item.value);

    return item.value.replace(REGEX, (match, key) => {
        const out = validatePlaceHolder(match, key.trim(), rptData, item, deferUnknown, defaults);

        /** the value itself, for an item that prints nothing else */
        if (sole === key.trim() && out !== match) {
            item.raw = sole === 'today' ? new Date() : (findVal(sole, rptData) ?? null);
        }

        return out;
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
function validatePlaceHolder(match, key, rptData, item, deferUnknown, defaults) {
    /**
     * Handed on rather than reported. An aggregate belongs to grouping and a
     * page key belongs to pagination, so neither is resolvable here and neither
     * is a surprise - these two were logged on the way past, which meant a
     * footer with a page number wrote a line to the console for every page of
     * every report. Only the unresolvable placeholder below is worth a word.
     */
    if (AGGREGATE.test(key)) return match;

    if (PAGE_KEYS.includes(key)) return match;

    /**
     * Today as the item's own date format, or the report's date pattern - in
     * the local calendar, not UTC's, which before half past five in the
     * morning in India was still yesterday.
     */
    if (key == 'today') return formatValue(new Date(), todayFormat(item.format, defaults));

    const value = findVal(key, rptData);

    if (value === undefined || value === null) {
        /** a group's own field, which only has a value once the rows are split */
        if (deferUnknown) return match;
        console.warn(`Unresolved placeholder "{${key}}" on item "${item.id}".`);
        return '';
    }

    return formatValue(value, item.format);
}


/**
 * The format {today} prints with: the item's, when it is a date format; else a
 * plain date in the pattern the item's format carries from the report - which
 * is ISO unless the report says otherwise.
 * @param {object|undefined} format the item's, settled
 * @param {object|undefined} defaults the report's
 * @returns {object}
 */
function todayFormat(format, defaults) {
    if (format?.type === 'date' || format?.type === 'datetime') return format;
    return { type: 'date', pattern: format?.pattern ?? defaults?.pattern ?? 'yyyy-MM-dd' };
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

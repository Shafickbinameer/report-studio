/**
 * tokens.js is the list of things a report can print that are not in the data:
 * the page number, the date, and the aggregates over a group.
 *
 * They exist because the placeholder syntax in spec 3.4 is written down in a
 * document and nowhere else. Someone designing a footer has to know that the
 * page count is `{totalPages}` and not `{pages}`, that a row count takes empty
 * brackets, and that `{sum(amount)}` needs the field name inside them. Getting
 * any of those slightly wrong produces an empty string and a console warning,
 * which is a poor way to find out.
 *
 * The rules about *where* each one resolves come from the engine's own
 * behaviour: resolve.js defers aggregates to group.js, which only runs over a
 * group's rows - so an aggregate in a page header has no scope to be computed
 * in and prints nothing. That is worth saying before it is inserted rather
 * than after it has printed blank.
 */

import { datasets } from './sample-data.js';
import { BAND_TYPES, hasBand, findBand } from './structure.js';


/** the placeholder that stands in for the field until one is chosen */
const FIELD = 'field';


/**
 * Every insertable token.
 *
 * `bands` is where it resolves, and an empty list means anywhere. `field` marks
 * the ones that take a field name inside the brackets.
 */
export const TOKENS = [
    {
        id: 'page',
        prefer: ['pageFooter', 'reportFooter', 'pageHeader'],
        label: 'Page number',
        value: '{page}',
        note: 'The page this is printed on'
    },
    {
        id: 'page-of',
        prefer: ['pageFooter', 'reportFooter', 'pageHeader'],
        label: 'Page X of Y',
        value: 'Page {page} of {totalPages}',
        note: 'The usual footer line, written out'
    },
    {
        id: 'total-pages',
        prefer: ['pageFooter', 'reportFooter', 'pageHeader'],
        label: 'Total pages',
        value: '{totalPages}',
        note: 'How many pages the report came to'
    },
    {
        id: 'today',
        prefer: ['pageHeader', 'reportHeader', 'pageFooter'],
        label: 'Today',
        value: '{today}',
        note: 'The date the report was run'
    },
    {
        id: 'count',
        prefer: ['groupFooter', 'reportFooter'],
        label: 'Row count',
        value: '{count()}',
        note: 'How many rows are in this group',
        bands: ['groupFooter', 'reportFooter']
    },
    {
        id: 'sum',
        prefer: ['groupFooter', 'reportFooter'],
        label: 'Sum',
        value: `{sum(${FIELD})}`,
        note: 'Added up over this group',
        field: true,
        bands: ['groupFooter', 'reportFooter']
    },
    {
        id: 'avg',
        prefer: ['groupFooter', 'reportFooter'],
        label: 'Average',
        value: `{avg(${FIELD})}`,
        note: 'The mean over this group',
        field: true,
        bands: ['groupFooter', 'reportFooter']
    },
    {
        id: 'min',
        prefer: ['groupFooter', 'reportFooter'],
        label: 'Smallest',
        value: `{min(${FIELD})}`,
        field: true,
        bands: ['groupFooter', 'reportFooter']
    },
    {
        id: 'max',
        prefer: ['groupFooter', 'reportFooter'],
        label: 'Largest',
        value: `{max(${FIELD})}`,
        field: true,
        bands: ['groupFooter', 'reportFooter']
    }
];


export function findToken(id) {
    return TOKENS.find(t => t.id === id) ?? null;
}


/** whether a token has to be told which field to work over */
export function needsField(token) {
    return Boolean(token?.field);
}


/**
 * Where a token prints something.
 *
 * @returns {boolean} true when a token with no band restriction is asked about
 *   any band at all - `{page}` is valid everywhere (spec 3.4)
 */
export function resolvesIn(token, bandType) {
    if (!token) return false;
    if (!token.bands?.length) return true;

    return token.bands.includes(bandType);
}


/**
 * The token's text, with the field filled in.
 *
 * @param {object} token
 * @param {string} [field]
 * @returns {string}
 */
export function tokenValue(token, field) {
    if (!token) return '';
    if (!needsField(token)) return token.value;

    return token.value.replace(FIELD, String(field || FIELD));
}


/**
 * Every field name the report already knows about, for the field picker.
 *
 * Read off the layout rather than typed: the columns are already there, and
 * offering a list beats hoping someone spells `amount` the same way twice.
 *
 * @param {object} layout
 * @returns {string[]} sorted, de-duplicated
 */
export function availableFields(layout) {
    const found = new Set();

    for (const [, fields] of datasets(layout)) {
        for (const field of fields) found.add(field);
    }

    if (layout?.groupBy) found.add(layout.groupBy);

    return [...found].sort();
}


/**
 * Which bands a token may sensibly be put on, given the report as it stands.
 *
 * Only bands the report actually has - offering to insert into a band that does
 * not exist would be offering to create one as a side effect of inserting a
 * page number.
 *
 * @param {object} layout
 * @param {object} token
 * @returns {string[]} band types, in page order
 */
export function bandChoices(layout, token) {
    const present = BAND_TYPES.filter(type => hasBand(layout, type));

    if (!token?.bands?.length) return present;

    const allowed = present.filter(type => token.bands.includes(type));

    /**
     * A report with no footer band gets the full list rather than an empty one,
     * so the dialog can say what is wrong instead of offering nothing and
     * leaving the reason to be guessed.
     */
    return allowed.length ? allowed : present;
}


/**
 * Where a token should go unless told otherwise.
 *
 * An aggregate belongs in a footer and a page number belongs in the page
 * footer, so those are offered first - not because anywhere else is forbidden,
 * but because it is where they are almost always wanted.
 *
 * @param {object} layout
 * @param {object} token
 * @param {string|null} [current] the band the selection is on
 * @returns {string|null}
 */
export function defaultBand(layout, token, current = null) {
    const choices = bandChoices(layout, token);
    if (!choices.length) return null;

    /**
     * The token's own home wins, and the band being worked on is only a
     * fallback.
     *
     * It used to be the other way round, and it was wrong: `{page}` resolves in
     * any band, so having a table selected in the detail band made the detail
     * band "valid", and a page number inserted while looking at the rows landed
     * among them. Where a page number goes is not a matter of what happened to
     * be selected at the time.
     */
    for (const type of (token?.prefer ?? [])) {
        if (choices.includes(type)) return type;
    }

    if (current && choices.includes(current) && resolvesIn(token, current)) {
        return current;
    }

    return choices[0];
}


/**
 * A text item carrying the token.
 *
 * Right-aligned when it prints a number, because that is where a total belongs
 * and moving every one of them by hand afterwards is the sort of thing a
 * designer should have done for you.
 *
 * @param {object} token
 * @param {string} [field]
 * @returns {object} the parts to merge onto a new text item
 */
export function tokenItem(token, field) {
    const numeric = needsField(token) || token?.id === 'count'
        || token?.id === 'page' || token?.id === 'total-pages';

    return {
        value: tokenValue(token, field),
        w: token?.id === 'page-of' ? 200 : 120,
        align: numeric ? 'right' : 'left'
    };
}


/** the band an insert would land on, for the dialog to name */
export function bandLabel(layout, type) {
    return findBand(layout, type) ? type : null;
}

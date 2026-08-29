/**
 * The insertable fields: page numbers, the date, and aggregates.
 *
 * These encode spec 3.4, which otherwise lives only in a document. The tests
 * that matter are the ones checking a token actually resolves once inserted -
 * writing `{pages}` instead of `{totalPages}` prints an empty string and a
 * console warning, which is exactly what this feature exists to prevent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    TOKENS, findToken, needsField, resolvesIn, tokenValue, tokenItem,
    availableFields, bandChoices, defaultBand, aggregateScope
} from '../src/designer/tokens.js';
import { buildPages } from '../src/engine/index.js';
import { render } from '../src/render/render.js';
import { sampleData } from '../src/designer/sample-data.js';
import { layout, text, table, band } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());

const full = () => layout({
    groupBy: 'region',
    bands: [
        band('pageHeader', [], { height: 30 }),
        band('groupHeader', [text('gh', { value: '{region}' })], { height: 26 }),
        band('detail', [table()]),
        band('groupFooter', [], { height: 30 }),
        band('reportFooter', [], { height: 40 }),
        band('pageFooter', [], { height: 26 })
    ]
});


describe('the catalogue', () => {
    it('covers what a footer usually needs', () => {
        const ids = TOKENS.map(t => t.id);

        expect(ids).toEqual(expect.arrayContaining([
            'page', 'total-pages', 'today', 'count', 'sum', 'avg', 'min', 'max'
        ]));
    });

    it('gives every token a label and something to insert', () => {
        for (const token of TOKENS) {
            expect(token.label, token.id).toBeTruthy();
            expect(token.value, token.id).toBeTruthy();
        }
    });

    it('writes each placeholder the way the engine reads it', () => {
        /**
         * The whole point. `{pages}` prints an empty string and a warning; only
         * `{totalPages}` prints a number.
         */
        expect(findToken('page').value).toBe('{page}');
        expect(findToken('total-pages').value).toBe('{totalPages}');
        expect(findToken('today').value).toBe('{today}');
        expect(findToken('count').value).toBe('{count()}');
    });

    it('marks the ones that take a field', () => {
        expect(['sum', 'avg', 'min', 'max'].every(id => needsField(findToken(id))))
            .toBe(true);

        expect(['page', 'today', 'count'].some(id => needsField(findToken(id))))
            .toBe(false);
    });
});


describe('where each one resolves', () => {
    it('lets a page number go anywhere, as spec 3.4 does', () => {
        for (const type of ['pageHeader', 'detail', 'pageFooter', 'reportFooter']) {
            expect(resolvesIn(findToken('page'), type), type).toBe(true);
        }
    });

    it('resolves an aggregate in every band', () => {
        /**
         * It used to be the two footers, because group.js only filled in a
         * reportFooter. A total under the rows is the one a designer reaches
         * for first, and it printed the raw `{sum(amount)}` back at them.
         */
        for (const id of ['sum', 'avg', 'count']) {
            for (const type of ['groupHeader', 'groupFooter', 'reportFooter',
                'pageHeader', 'pageFooter', 'detail']) {
                expect(resolvesIn(findToken(id), type), `${id} in ${type}`)
                    .toBe(true);
            }
        }
    });

    it('says which rows an aggregate would cover in the band it is going to', () => {
        /**
         * The thing left worth saying, now that nowhere refuses one:
         * {sum(price)} is a different number in a group footer and in a report
         * footer, and both of them are right.
         */
        expect(aggregateScope(findToken('sum'), 'groupFooter')).toBe('group');
        expect(aggregateScope(findToken('sum'), 'groupHeader')).toBe('group');
        expect(aggregateScope(findToken('sum'), 'detail')).toBe('report');
        expect(aggregateScope(findToken('sum'), 'reportFooter')).toBe('report');
    });

    it('has no scope to report for a token that is not an aggregate', () => {
        expect(aggregateScope(findToken('page'), 'pageFooter')).toBeNull();
        expect(aggregateScope(null, 'detail')).toBeNull();
    });
});


describe('tokenValue', () => {
    it('leaves a token that takes no field alone', () => {
        expect(tokenValue(findToken('page'), 'amount')).toBe('{page}');
    });

    it('puts the field inside the brackets', () => {
        expect(tokenValue(findToken('sum'), 'amount')).toBe('{sum(amount)}');
        expect(tokenValue(findToken('avg'), 'price')).toBe('{avg(price)}');
    });

    it('leaves the word "field" as a prompt when none is chosen', () => {
        expect(tokenValue(findToken('sum'))).toBe('{sum(field)}');
    });
});


describe('availableFields', () => {
    it('reads the field names off the report rather than asking for them', () => {
        expect(availableFields(full())).toEqual(
            ['name', 'price', 'qty', 'region']);
    });

    it('includes the grouping field even with no table', () => {
        const l = layout({ groupBy: 'region', bands: [band('groupHeader', [])] });
        expect(availableFields(l)).toContain('region');
    });

    it('is empty for a report with nothing to aggregate yet', () => {
        expect(availableFields(layout({ bands: [] }))).toEqual([]);
    });
});


describe('which band it offers', () => {
    it('offers only bands the report has', () => {
        const l = layout({ bands: [band('detail', [table()])] });
        expect(bandChoices(l, findToken('page'))).toEqual(['detail']);
    });

    it('offers an aggregate every band the report has', () => {
        expect(bandChoices(full(), findToken('sum')))
            .toEqual([
                'pageHeader', 'groupHeader', 'detail',
                'groupFooter', 'reportFooter', 'pageFooter'
            ]);
    });

    it('falls back to every band when none of them will do', () => {
        /** so the dialog can say what is wrong rather than offer nothing */
        const l = layout({ bands: [band('detail', [table()])] });
        expect(bandChoices(l, findToken('sum'))).toEqual(['detail']);
    });
});


describe('where it goes by default', () => {
    it('puts a total in a group footer', () => {
        expect(defaultBand(full(), findToken('sum'))).toBe('groupFooter');
    });

    it('puts a page number in the page footer', () => {
        expect(defaultBand(full(), findToken('page'))).toBe('pageFooter');
    });

    it('sends a page number to the footer whatever is selected', () => {
        /**
         * The bug this replaces: `{page}` resolves in any band, so a table
         * selected in the detail band made the detail band "valid" and a page
         * number inserted while looking at the rows landed among them. Where a
         * page number goes is not a matter of what happened to be selected.
         */
        expect(defaultBand(full(), findToken('page'), 'detail')).toBe('pageFooter');
        expect(defaultBand(full(), findToken('page'), 'pageHeader')).toBe('pageFooter');
    });

    it('overrides the selection for an aggregate too', () => {
        expect(defaultBand(full(), findToken('sum'), 'pageHeader'))
            .toBe('groupFooter');
    });

    it('falls back to the selected band when the token has no home here', () => {
        /** a report with none of the preferred bands still has to place it */
        const l = layout({
            bands: [band('groupHeader', [], { height: 30 }), band('detail', [table()])]
        });

        expect(defaultBand(l, findToken('page'), 'detail')).toBe('detail');
    });

    it('puts the date in a header, where a date belongs', () => {
        expect(defaultBand(full(), findToken('today'))).toBe('pageHeader');
    });

    it('is null for a report with no bands at all', () => {
        expect(defaultBand(layout({ bands: [] }), findToken('page'))).toBeNull();
    });
});


describe('the item it makes', () => {
    it('right-aligns a number, where a total belongs', () => {
        expect(tokenItem(findToken('sum'), 'amount').align).toBe('right');
        expect(tokenItem(findToken('count')).align).toBe('right');
    });

    it('leaves the date alone', () => {
        expect(tokenItem(findToken('today')).align).toBe('left');
    });

    it('gives the written-out line room for its words', () => {
        expect(tokenItem(findToken('page-of')).w)
            .toBeGreaterThan(tokenItem(findToken('page')).w);
    });
});


describe('what actually prints', () => {
    /**
     * The claim worth making: every token in the catalogue, put where the
     * catalogue says it goes, prints something.
     */
    const runWith = (token, field) => {
        const l = full();
        const where = defaultBand(l, token);

        l.bands.find(b => b.type === where).items.push({
            id: `tok-${token.id}`,
            type: 'text',
            x: 0, y: 0, w: 300, h: 20,
            value: tokenValue(token, field),
            style: {
                fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 12,
                fontWeight: 'normal', fontStyle: 'normal',
                color: '#000000', align: 'right', background: null,
                border: null, padding: 0
            }
        });

        return render(buildPages(l, sampleData(l)));
    };

    it.each(TOKENS.map(t => [t.id, t]))('%s prints a value', (id, token) => {
        const warnings = [];
        vi.spyOn(console, 'warn').mockImplementation(m => warnings.push(String(m)));

        const html = runWith(token, 'price');

        expect(html.match(/\{[a-zA-Z][^}<]*\}/g), `${id} left a placeholder`)
            .toBeNull();
        expect(warnings.filter(w => /Unresolved/.test(w)), id).toEqual([]);
    });

    it('prints a real total, not a zero', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        const html = runWith(findToken('sum'), 'price');

        expect(html).toMatch(/>\s*\d+\s*</);
    });

    it('prints the page number and the count together', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        const html = runWith(findToken('page-of'));

        expect(html).toMatch(/Page 1 of \d+/);
    });
});

/**
 * What building a long report costs, held where it should be: rows are read
 * and sliced, never copied - not once a page, and not once a stage.
 *
 * A table split over pages used to be copied whole for each page, every row
 * of the report each time, and replaced at once with that page's share. A
 * 29,000-row stock statement over 509 pages spent a minute and a half doing
 * nothing else. Timing a build would make a flaky test, so these count what
 * is copied instead.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { layout, text, table, band, rows, groupedRows, run } from './helpers/layout.js';
import { resolve, group, measure, paginate } from '../src/engine/index.js';

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());


/** how many characters of JSON buildPages hands to structuredClone, all told */
function copied(build) {
    const real = globalThis.structuredClone;
    let size = 0;

    const spy = vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
        size += JSON.stringify(value)?.length ?? 0;
        return real(value, options);
    });

    try {
        return { result: build(), size };
    } finally {
        spy.mockRestore();
    }
}

const plain = () => layout({ bands: [band('detail', [table()])] });

const grouped = () => layout({
    groupBy: 'name',
    bands: [
        band('groupHeader', [text('gh', { value: 'Group {name}', h: 20 })], { height: 20 }),
        band('detail', [table()]),
        band('groupFooter', [text('gf', { value: 'Total {sum(price)}', h: 20 })], { height: 20 })
    ]
});

/** every row object on every page, in order */
function placed(report) {
    return report.pages.flatMap(page => page.bands.flatMap(b => b.items
        .filter(item => item.type === 'table')
        .flatMap(item => item.groups ? item.groups.flatMap(g => g.rows) : item.row)));
}


describe('building a long report', () => {
    /**
     * Each page costs a copy of the table's settings and of the group bands it
     * prints - a fixed amount a page. What must never happen again is a copy
     * of the rows a page: then twice the rows over twice the pages copied four
     * times as much, where it should copy twice as much.
     */
    it('copies in step with the rows, not with rows x pages', () => {
        const small = copied(() => run(plain(), { items: rows(1500) }));
        const large = copied(() => run(plain(), { items: rows(3000) }));

        expect(large.result.pages.length).toBeGreaterThan(50);
        expect(large.result.pages.length).toBeGreaterThanOrEqual(small.result.pages.length * 2 - 1);
        expect(large.size).toBeLessThan(small.size * 2.5);
    });

    it('copies in step with the rows for a grouped table too', () => {
        const keys = (n) => Array.from({ length: n }, (_, k) => `group-${k}`);
        const small = copied(() => run(grouped(), { items: groupedRows(keys(30), 50) }));
        const large = copied(() => run(grouped(), { items: groupedRows(keys(60), 50) }));

        expect(large.result.pages.length).toBeGreaterThan(50);
        expect(large.size).toBeLessThan(small.size * 2.5);
    });

    it('never copies the rows themselves', () => {
        const data = { items: rows(3000) };
        const { size } = copied(() => run(plain(), data));

        /** a few copies of the table's settings a page, and nothing like the 3,000 rows */
        expect(size).toBeLessThan(JSON.stringify(data).length);
    });

    it('puts the rows it was given on the pages, every one once, in order', () => {
        const data = { items: rows(500) };
        const report = run(plain(), data);

        const onPages = placed(report);
        expect(onPages).toHaveLength(500);
        onPages.forEach((row, n) => expect(row).toBe(data.items[n]));
    });

    it('leaves the layout and the data as they were', () => {
        const json = grouped();
        const data = { items: groupedRows(['A', 'B', 'C'], 80) };
        const before = JSON.stringify({ json, data });

        run(json, data);

        expect(JSON.stringify({ json, data })).toBe(before);
    });
});


describe('the stages one at a time', () => {
    it('still hand back copies, leaving what they were given as it was', () => {
        const data = { items: rows(200) };
        const grouped = group(resolve(plain(), data), data);

        const groupedBefore = JSON.stringify(grouped);
        const measured = measure(grouped);
        expect(JSON.stringify(grouped)).toBe(groupedBefore);
        expect(measured).not.toBe(grouped);

        const measuredBefore = JSON.stringify(measured);
        const paginated = paginate(measured);
        expect(JSON.stringify(measured)).toBe(measuredBefore);
        expect(paginated).not.toBe(measured);
        expect(paginated.pages.length).toBeGreaterThan(1);
    });

    it('come out the same as buildPages', () => {
        const data = { items: groupedRows(['A', 'B'], 120) };
        const json = grouped();

        const staged = paginate(measure(group(resolve(json, data), data)));
        expect(JSON.stringify(staged)).toBe(JSON.stringify(run(json, data)));
    });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveHeight, bandZoneHeight, pageRegions, DEFAULT_BAND_HEIGHTS } from '../src/engine/regions.js';
import { layout, text, table, band, rows, run, AVAILABLE_HEIGHT } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());

const CONTENT = 1000;

/** a report with every band, so the zones are all in play */
const fullLayout = (heights = {}) => layout({
    bands: [
        band('pageHeader', [text('ph', { value: 'head', h: 16 })],
            heights.pageHeader !== undefined ? { height: heights.pageHeader } : {}),
        band('reportHeader', [text('rh', { value: 'report', h: 16 })],
            heights.reportHeader !== undefined ? { height: heights.reportHeader } : {}),
        band('detail', [table()]),
        band('reportFooter', [text('rf', { value: 'total', h: 16 })],
            heights.reportFooter !== undefined ? { height: heights.reportFooter } : {}),
        band('pageFooter', [text('pf', { value: 'Page {page}', h: 16 })],
            heights.pageFooter !== undefined ? { height: heights.pageFooter } : {})
    ]
});

const zoneOf = (page, type) => page.bands.find(b => b.type === type);

describe('resolveHeight', () => {
    it('takes a plain number as pixels', () => {
        expect(resolveHeight(120, CONTENT, '10%')).toBe(120);
    });

    it('takes a percentage of the printable height', () => {
        expect(resolveHeight('25%', CONTENT, '10%')).toBe(250);
    });

    it('takes a px string', () => {
        expect(resolveHeight('80px', CONTENT, '10%')).toBe(80);
    });

    it('tolerates whitespace', () => {
        expect(resolveHeight('  15 % ', CONTENT, '10%')).toBe(150);
    });

    it('falls back when the value is missing', () => {
        expect(resolveHeight(undefined, CONTENT, '10%')).toBe(100);
    });

    it('falls back when the value makes no sense', () => {
        expect(resolveHeight('wide', CONTENT, '10%')).toBe(100);
        expect(resolveHeight(-40, CONTENT, '10%')).toBe(100);
    });

    it('accepts zero as a real height', () => {
        expect(resolveHeight(0, CONTENT, '10%')).toBe(0);
    });
});

describe('bandZoneHeight', () => {
    it('uses the default for the band type', () => {
        expect(bandZoneHeight({ type: 'pageFooter' }, CONTENT)).toBe(100);
        expect(DEFAULT_BAND_HEIGHTS.pageFooter).toBe('10%');
    });

    it('prefers what the layout declared', () => {
        expect(bandZoneHeight({ type: 'pageFooter', height: 60 }, CONTENT)).toBe(60);
    });

    it('grows rather than clipping content that outran the zone', () => {
        const zone = bandZoneHeight(
            { type: 'pageFooter', height: 20, measuredHeight: 90 }, CONTENT);

        expect(zone).toBe(90);
        expect(console.warn).toHaveBeenCalled();
    });

    it('is zero for a band that is not there', () => {
        expect(bandZoneHeight(null, CONTENT)).toBe(0);
    });
});

describe('pageRegions - the default sheet', () => {
    const bands = {
        pageHeader: { type: 'pageHeader' },
        reportHeader: { type: 'reportHeader' },
        reportFooter: { type: 'reportFooter' },
        pageFooter: { type: 'pageFooter' }
    };

    it('gives 10/10/60/10/10 when every band is present', () => {
        const r = pageRegions({ bands, contentHeight: CONTENT, isFirstPage: true, isLastPage: true });

        expect(r.pageHeader).toEqual({ top: 0, height: 100 });
        expect(r.reportHeader).toEqual({ top: 100, height: 100 });
        expect(r.detail).toEqual({ top: 200, height: 600 });
        expect(r.reportFooter).toEqual({ top: 800, height: 100 });
        expect(r.pageFooter).toEqual({ top: 900, height: 100 });
    });

    it('puts the page footer on the bottom edge', () => {
        const r = pageRegions({ bands, contentHeight: CONTENT, isFirstPage: true, isLastPage: true });
        expect(r.pageFooter.top + r.pageFooter.height).toBe(CONTENT);
    });

    it('drops the report header off continuation pages', () => {
        const r = pageRegions({ bands, contentHeight: CONTENT, isFirstPage: false, isLastPage: false });

        expect(r.reportHeader).toBeUndefined();
        expect(r.detail.top).toBe(100);
    });

    it('drops the report footer off pages that are not last', () => {
        const r = pageRegions({ bands, contentHeight: CONTENT, isFirstPage: false, isLastPage: false });

        expect(r.reportFooter).toBeUndefined();
        expect(r.pageFooter.top + r.pageFooter.height).toBe(CONTENT);
    });

    it('gives the detail whatever the zones leave', () => {
        const r = pageRegions({ bands, contentHeight: CONTENT, isFirstPage: false, isLastPage: false });
        expect(r.detail.height).toBe(800);
    });
});

describe('pageRegions - the layout overrides the defaults', () => {
    it('honours pixel heights', () => {
        const r = pageRegions({
            bands: {
                pageHeader: { type: 'pageHeader', height: 50 },
                pageFooter: { type: 'pageFooter', height: 30 }
            },
            contentHeight: CONTENT, isFirstPage: true, isLastPage: true
        });

        expect(r.pageHeader.height).toBe(50);
        expect(r.pageFooter).toEqual({ top: 970, height: 30 });
        expect(r.detail).toEqual({ top: 50, height: 920 });
    });

    it('honours percentages', () => {
        const r = pageRegions({
            bands: {
                pageHeader: { type: 'pageHeader', height: '20%' },
                pageFooter: { type: 'pageFooter', height: '5%' }
            },
            contentHeight: CONTENT, isFirstPage: true, isLastPage: true
        });

        expect(r.pageHeader.height).toBe(200);
        expect(r.pageFooter.top).toBe(950);
        expect(r.detail.height).toBe(750);
    });

    it('still pins the footer to the bottom whatever the sizes', () => {
        for (const height of [10, 200, '3%', '25%']) {
            const r = pageRegions({
                bands: { pageFooter: { type: 'pageFooter', height } },
                contentHeight: CONTENT, isFirstPage: true, isLastPage: true
            });
            expect(r.pageFooter.top + r.pageFooter.height, String(height)).toBe(CONTENT);
        }
    });

    it('never gives the detail a negative height', () => {
        const r = pageRegions({
            bands: {
                pageHeader: { type: 'pageHeader', height: '80%' },
                pageFooter: { type: 'pageFooter', height: '80%' }
            },
            contentHeight: CONTENT, isFirstPage: true, isLastPage: true
        });

        expect(r.detail.height).toBe(0);
    });
});

describe('paginate - bands are anchored, not stacked', () => {
    it('keeps the page footer on the bottom edge when the detail is nearly empty', () => {
        const out = run(fullLayout(), { items: rows(2) });
        const footer = zoneOf(out.pages[0], 'pageFooter');

        expect(footer.top + footer.zoneHeight).toBe(AVAILABLE_HEIGHT);
    });

    it('puts the footer in the same place whether the detail is full or empty', () => {
        const empty = zoneOf(run(fullLayout(), { items: rows(1) }).pages[0], 'pageFooter');
        const full = zoneOf(run(fullLayout(), { items: rows(120) }).pages[0], 'pageFooter');

        expect(empty.top).toBe(full.top);
    });

    it('never lets the detail band overlap the footer zone', () => {
        const out = run(fullLayout(), { items: rows(120) });

        for (const page of out.pages) {
            const detail = zoneOf(page, 'detail');
            const footer = zoneOf(page, 'pageFooter');
            if (!detail) continue;

            expect(detail.top + detail.zoneHeight).toBeLessThanOrEqual(footer.top + 0.001);
        }
    });

    it('orders the zones down the page', () => {
        const out = run(fullLayout(), { items: rows(2) });
        const page = out.pages[0];

        const tops = ['pageHeader', 'reportHeader', 'detail', 'reportFooter', 'pageFooter']
            .map(type => zoneOf(page, type)?.top)
            .filter(t => t !== undefined);

        expect(tops).toEqual([...tops].sort((a, b) => a - b));
    });

    it('gives continuation pages a taller detail zone than page one', () => {
        const out = run(fullLayout(), { items: rows(200) });
        expect(out.pages.length).toBeGreaterThan(2);

        expect(out.pages[1].regions.detail.height)
            .toBeGreaterThan(out.pages[0].regions.detail.height);
    });

    it('honours a designer-set footer height', () => {
        const out = run(fullLayout({ pageFooter: 40 }), { items: rows(2) });
        const footer = zoneOf(out.pages[0], 'pageFooter');

        expect(footer.zoneHeight).toBe(40);
        expect(footer.top).toBe(AVAILABLE_HEIGHT - 40);
    });

    it('honours a designer-set footer percentage', () => {
        const out = run(fullLayout({ pageFooter: '20%' }), { items: rows(2) });
        const footer = zoneOf(out.pages[0], 'pageFooter');

        expect(footer.zoneHeight).toBeCloseTo(AVAILABLE_HEIGHT * 0.2, 5);
        expect(footer.top + footer.zoneHeight).toBeCloseTo(AVAILABLE_HEIGHT, 5);
    });

    it('gives the detail the room a smaller footer frees up', () => {
        const roomy = run(fullLayout({ pageFooter: 20 }), { items: rows(2) });
        const cramped = run(fullLayout({ pageFooter: '30%' }), { items: rows(2) });

        expect(roomy.pages[0].regions.detail.height)
            .toBeGreaterThan(cramped.pages[0].regions.detail.height);
    });
});

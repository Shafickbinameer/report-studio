/**
 * The design canvas draws one unpaginated page from a layout, with no data.
 *
 * It stays in the node environment: drawSheet returns markup, the same way
 * render does, so there is nothing here that needs a document.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { drawSheet, designZones } from '../src/designer/canvas.js';
import { blankLayout } from '../src/designer/blank.js';
import { layout, text, table, band } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());

const CONTENT_HEIGHT = 1043;

const full = () => layout({
    groupBy: 'name',
    bands: [
        band('reportHeader', [text('rh', { value: 'SALES' })], { height: 76 }),
        band('pageHeader', [text('ph', { value: 'head' })], { height: 26 }),
        band('groupHeader', [text('gh', { value: 'Region: {name}' })], { height: 38 }),
        band('detail', [table()]),
        band('groupFooter', [text('gf', { value: 'Subtotal' })], { height: 42 }),
        band('pageFooter', [text('pf', { value: 'Page {page}' })], { height: 30 })
    ]
});

const zonesOf = (json) => Object.fromEntries(
    designZones(json).map(z => [z.type, z]));


describe('designZones - geometry', () => {
    it('shows every band at once, unlike any single printed page', () => {
        const types = designZones(full()).map(z => z.type);

        expect(types).toEqual(expect.arrayContaining([
            'reportHeader', 'pageHeader', 'groupHeader',
            'detail', 'groupFooter', 'pageFooter'
        ]));
    });

    it('omits a band the layout does not declare', () => {
        const types = designZones(layout({
            bands: [band('detail', [table()])]
        })).map(z => z.type);

        expect(types).toEqual(['detail']);
    });

    it('pins the page footer to the bottom of the printable area', () => {
        const { pageFooter } = zonesOf(full());
        expect(pageFooter.top + pageFooter.height).toBeCloseTo(CONTENT_HEIGHT, 5);
    });

    it('stacks the header zones downward from the top', () => {
        const { pageHeader, reportHeader } = zonesOf(full());

        expect(pageHeader.top).toBe(0);
        expect(reportHeader.top).toBe(pageHeader.height);
    });

    it('stacks the group bands inside the detail region, not beside it', () => {
        const z = zonesOf(full());

        expect(z.groupHeader.top).toBeLessThan(z.detail.top);
        expect(z.detail.top + z.detail.height).toBeLessThanOrEqual(z.groupFooter.top);
        expect(z.groupFooter.top + z.groupFooter.height)
            .toBeLessThanOrEqual(z.pageFooter.top);
    });

    it('gives the detail whatever the other zones leave', () => {
        const z = zonesOf(full());
        const others = ['reportHeader', 'pageHeader', 'groupHeader',
            'groupFooter', 'pageFooter']
            .reduce((sum, t) => sum + z[t].height, 0);

        expect(z.detail.height).toBeCloseTo(CONTENT_HEIGHT - others, 5);
    });

    it('uses the same geometry the engine prints with', () => {
        /**
         * The point of calling pageRegions rather than re-deriving zones: change
         * a band height and both move together. A canvas with its own maths
         * drifts from the print and nobody notices until it is on paper.
         */
        const shorter = full();
        shorter.bands.find(b => b.type === 'pageHeader').height = 100;

        const before = zonesOf(full()).detail.height;
        const after = zonesOf(shorter).detail.height;

        expect(after).toBeCloseTo(before - 74, 5);
    });
});


describe('drawSheet - markup', () => {
    it('draws the page at the layout page size, margins as padding', () => {
        const html = drawSheet(full());

        expect(html).toContain('width:794px');
        expect(html).toContain('height:1123px');
        expect(html).toContain('padding-top:40px');
    });

    it('adds the margins back to each zone, since absolute anchors to padding', () => {
        const html = drawSheet(full());
        const { pageHeader } = zonesOf(full());

        expect(html).toMatch(
            new RegExp(`data-band-type="pageHeader"[^>]*top:${pageHeader.top + 40}px`));
    });

    it('tags every zone so a pointer event can find its band', () => {
        const html = drawSheet(full());
        expect((html.match(/data-band-type=/g) || [])).toHaveLength(6);
    });

    it('tags every item so a pointer event can find its layout item', () => {
        const html = drawSheet(full());
        expect(html).toContain('data-item-id="rh"');
        expect(html).toContain('data-item-type="text"');
        expect(html).toContain('data-item-type="table"');
    });

    it('shows a placeholder unresolved, because that is what is being edited', () => {
        const html = drawSheet(full());

        expect(html).toContain('Region: {name}');
        expect(html).not.toContain('Region: undefined');
    });

    it('gives a table sample rows, so it does not draw as an empty shell', () => {
        const html = drawSheet(full());
        /** three sample rows plus the column header */
        expect((html.match(/<tr/g) || [])).toHaveLength(4);
    });

    it('names the columns in the sample cells', () => {
        const html = drawSheet(full());
        expect(html).toContain('>name<');
        expect(html).toContain('>qty<');
    });

    it('escapes a value, exactly as the preview does', () => {
        const evil = layout({
            bands: [band('reportHeader', [text('x', { value: '<script>alert(1)</script>' })])]
        });

        const html = drawSheet(evil);
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('lines the gutter tags up with the zones they name', () => {
        /**
         * The gutter is a separate column from the page, so nothing but this
         * keeps the two in step - and a label beside the wrong band is worse
         * than no label at all.
         */
        const html = drawSheet(full());
        const zones = zonesOf(full());

        for (const [type, z] of Object.entries(zones)) {
            const tag = html.match(
                new RegExp(`data-band-tag="${type}"[^>]*top:([0-9.]+)px`));

            expect(tag, `no gutter tag for ${type}`).not.toBeNull();
            expect(Number(tag[1])).toBeCloseTo(z.top + 40, 5);
        }
    });

    it('puts the band name in the gutter rather than over the design', () => {
        const html = drawSheet(full());
        const gutter = html.slice(html.indexOf('dz-gutter'), html.indexOf('dz-page'));

        expect(gutter).toContain('data-band-tag="reportHeader"');
        expect(gutter).not.toContain('data-item-id');
    });
});


describe('drawSheet - a blank report', () => {
    it('draws without throwing', () => {
        expect(() => drawSheet(blankLayout())).not.toThrow();
    });

    it('shows the three bands a new report starts with', () => {
        const types = designZones(blankLayout()).map(z => z.type);
        expect(types).toEqual(['pageHeader', 'pageFooter', 'detail']);
    });

    it('has no items to draw yet', () => {
        expect(drawSheet(blankLayout())).not.toContain('data-item-id');
    });
});


describe('drawSheet - purity', () => {
    it('does not mutate the layout it draws', () => {
        const json = full();
        const before = structuredClone(json);

        drawSheet(json);

        expect(json).toEqual(before);
    });
});

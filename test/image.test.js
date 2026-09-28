/**
 * The image item, through the engine and out to the markup.
 *
 * An image is a box with a picture scaled into it, so the engine's side is
 * small: it is exactly as tall as it declares, whatever the picture. What
 * matters more is where the picture comes from - stored in the layout, or read
 * from the host's data - and that neither route can put a `javascript:` URL in
 * a `src` attribute.
 *
 * The designer's side is in image-designer.test.js.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateLayout } from '../src/engine/validate.js';
import { measure } from '../src/engine/measure.js';
import { resolve } from '../src/engine/resolve.js';
import { toReportCSV } from '../src/engine/csv.js';
import { render } from '../src/render/render.js';
import { items, imageSrc } from '../src/render/items.js';
import { sampleData, imageKeys, SAMPLE_IMAGE } from '../src/designer/sample-data.js';
import { layout, image, text, band, rows, run, placedItem } from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());


const PNG = SAMPLE_IMAGE;

const withImage = (item, others = []) => layout({
    bands: [band('detail', [item, ...others]), band('pageFooter', [], { height: 40 })]
});


describe('an image is a layout the engine accepts', () => {
    it('validates with a stored picture', () => {
        expect(validateLayout(withImage(image('i1', { src: PNG })))).toEqual([]);
    });

    it('validates bound to a data field', () => {
        expect(validateLayout(withImage(image('i1', { field: 'company.logo' })))).toEqual([]);
    });

    /** a freshly drawn image has no picture yet, and has to be saveable */
    it('validates with no picture at all', () => {
        expect(validateLayout(withImage({ id: 'i1', type: 'image' }))).toEqual([]);
    });

    it('takes every fit there is', () => {
        for (const fit of ['contain', 'cover', 'fill']) {
            expect(validateLayout(withImage(image('i1', { fit }))), fit).toEqual([]);
        }
    });

    it('refuses a fit that is not one', () => {
        const issues = validateLayout(withImage(image('i1', { fit: 'squash' })));

        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatch(/fit "squash"/);
    });

    it('refuses a src or a field that is not a string', () => {
        expect(validateLayout(withImage(image('i1', { src: 42 }))))
            .toEqual([expect.stringMatching(/src must be a string/)]);
        expect(validateLayout(withImage(image('i1', { field: ['logo'] }))))
            .toEqual([expect.stringMatching(/field must be a data path/)]);
    });

    it('names image among the types it will take', () => {
        const issues = validateLayout(withImage({ id: 'x', type: 'blob' }));

        expect(issues[0]).toMatch(/text, table, line, box, image/);
    });
});


describe('where the picture comes from', () => {
    const resolved = (item, data = {}) =>
        resolve(withImage(item), data).bands[0].items[0].resolvedSrc;

    it('is the stored one when nothing is bound', () => {
        expect(resolved(image('i1', { src: PNG }))).toBe(PNG);
    });

    it('is read from the data at a dotted path', () => {
        expect(resolved(image('i1', { field: 'company.logo' }),
            { company: { logo: 'https://example.com/logo.png' } }))
            .toBe('https://example.com/logo.png');
    });

    it('takes array indexes, the way text placeholders do', () => {
        expect(resolved(image('i1', { field: 'brands[1].logo' }),
            { brands: [{ logo: 'a.png' }, { logo: 'b.png' }] }))
            .toBe('b.png');
    });

    /** a default logo in the layout, replaced per customer by the host */
    it('prefers the data to the stored picture', () => {
        expect(resolved(image('i1', { src: PNG, field: 'logo' }), { logo: 'mine.png' }))
            .toBe('mine.png');
    });

    it('falls back to the stored picture when the data has none', () => {
        expect(resolved(image('i1', { src: PNG, field: 'logo' }), {})).toBe(PNG);
        expect(console.warn).not.toHaveBeenCalled();
    });

    it('says so when a bound image has nothing to show', () => {
        expect(resolved(image('i1', { field: 'logo' }), {})).toBe('');
        expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/"logo".*"i1"/));
    });

    it('does not take a value that is not a string', () => {
        expect(resolved(image('i1', { field: 'logo' }), { logo: { url: 'x.png' } })).toBe('');
    });

    it('leaves the layout it was given alone', () => {
        const json = withImage(image('i1', { field: 'logo' }));
        resolve(json, { logo: 'x.png' });

        expect(json.bands[0].items[0]).not.toHaveProperty('resolvedSrc');
    });
});


describe('measuring an image', () => {
    const measured = (item) => {
        const json = measure(resolve(withImage(item), {}));
        return json.bands.find(b => b.type === 'detail').items[0].measuredHeight;
    };

    /** the picture is scaled into the box; the box never grows round it */
    it('is the height it declares', () => {
        expect(measured(image('i1', { h: 60, src: PNG }))).toBe(60);
    });

    it('counts towards the band it is on', () => {
        const json = measure(resolve(layout({
            bands: [band('detail', [
                text('t', { y: 0, h: 20 }),
                image('i1', { y: 40, h: 60 })
            ])]
        }), {}));

        expect(json.bands[0].measuredHeight).toBe(100);
    });

    it('is placed on the page like any other fixed item', () => {
        const built = run(withImage(image('i1', { y: 10, h: 60, src: PNG })), { items: [] });
        const placed = placedItem(built, 'i1');

        expect(placed.y).toBe(10);
        expect(placed.measuredHeight).toBe(60);
    });
});


describe('drawing an image', () => {
    const drawn = (item, data = {}) => render(run(withImage(item), { items: [], ...data }));

    it('draws the picture in a box of the size it declares', () => {
        const html = drawn(image('i1', { w: 120, h: 40, src: PNG }));

        expect(html).toContain('data-item-type="image"');
        expect(html).toContain('width:120px');
        expect(html).toContain('height:40px');
        expect(html).toContain(`<img src="${PNG}"`);
    });

    it('draws the picture the data supplied', () => {
        expect(drawn(image('i1', { field: 'logo' }), { logo: 'https://cdn.test/a.png' }))
            .toContain('src="https://cdn.test/a.png"');
    });

    it('fits the picture as asked, and inside the box when not', () => {
        expect(drawn(image('i1', { src: PNG, fit: 'cover' }))).toContain('object-fit:cover');
        expect(drawn({ id: 'i1', type: 'image', w: 10, h: 10, src: PNG }))
            .toContain('object-fit:contain');
    });

    it('carries the description as alt text, escaped', () => {
        const html = drawn(image('i1', { src: PNG, alt: 'Acme "logo"' }));
        expect(html).toContain('alt="Acme &quot;logo&quot;"');
    });

    /** a built report prints nothing where the data had no picture */
    it('draws an empty frame when a built report has no picture', () => {
        const html = drawn(image('i1', { field: 'logo' }));

        expect(html).toContain('data-item-type="image"');
        expect(html).not.toContain('<img');
        expect(html).not.toContain('image-empty');
    });

    /** the designer canvas draws from the layout, where nothing has been resolved */
    it('draws a placeholder naming the field on the canvas', () => {
        const html = items([image('i1', { field: 'company.logo' })]);

        expect(html).toContain('image-empty');
        expect(html).toContain('{company.logo}');
    });

    it('draws the stored picture on the canvas', () => {
        expect(items([image('i1', { src: PNG })])).toContain(`<img src="${PNG}"`);
    });

    it('refuses a javascript: URL from the data', () => {
        const html = drawn(image('i1', { field: 'logo' }), { logo: 'javascript:alert(1)' });

        expect(html).not.toMatch(/javascript/i);
        expect(html).not.toContain('<img');
    });

    it('cannot be used to break out of the attribute', () => {
        const html = drawn(image('i1', { field: 'logo' }),
            { logo: 'x.png" onerror="alert(1)' });

        expect(html).not.toContain('" onerror=');
    });

    it('is not written into the CSV', () => {
        const built = run(withImage(image('i1', { src: PNG }), [text('t', { y: 100 })]),
            { items: rows(1) });

        expect(toReportCSV(built.pages)).not.toMatch(/data:image|i1/);
    });
});


describe('which URLs an image may load', () => {
    it.each([
        ['https://example.com/logo.png'],
        ['http://example.com/logo.png'],
        ['blob:https://example.com/0f3c'],
        ['/assets/logo.png'],
        ['./logo.png'],
        ['logo.png'],
        ['//cdn.example.com/logo.png'],
        [PNG],
        ['data:image/jpeg;base64,/9j/4AAQ'],
        ['data:image/webp;base64,UklGRg==']
    ])('loads %s', (url) => {
        expect(imageSrc(url)).toBe(url);
    });

    it.each([
        ['javascript:alert(1)'],
        ['JAVASCRIPT:alert(1)'],
        ['java\tscript:alert(1)'],
        ['  javascript:alert(1)'],
        ['vbscript:msgbox(1)'],
        ['file:///etc/passwd'],
        ['data:text/html;base64,PHNjcmlwdD4='],
        ['data:image/svg+xml;base64,PHN2Zz4='],
        ['data:image/png,notbase64']
    ])('refuses %s', (url) => {
        expect(imageSrc(url)).toBe('');
    });

    it('keeps a space in the middle of a path', () => {
        expect(imageSrc('/assets/my logo.png')).toBe('/assets/my logo.png');
    });

    it('treats anything that is not a string as no picture', () => {
        for (const value of [null, undefined, 42, {}, ['a.png']]) {
            expect(imageSrc(value), String(value)).toBe('');
        }
    });
});


describe('sample data for a bound image', () => {
    const bound = () => withImage(image('i1', { field: 'company.logo' }),
        [text('t', { y: 100, value: '{company.name}' })]);

    it('names the paths the images are bound to', () => {
        expect(imageKeys(bound())).toEqual(['company.logo']);
    });

    it('fills them with a picture, not a word', () => {
        const data = sampleData(bound());

        expect(data.company.logo).toBe(PNG);
        expect(data.company.name).toBe('Name 1');
    });

    it('is a picture the renderer will draw', () => {
        expect(imageSrc(SAMPLE_IMAGE)).toBe(SAMPLE_IMAGE);
    });

    it('asks for nothing when no image is bound', () => {
        expect(imageKeys(withImage(image('i1', { src: PNG })))).toEqual([]);
    });
});

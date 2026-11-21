import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    fitText, graphemes, wrapLines, measureText, LINE_HEIGHT_RATIO
} from '../src/engine/text-metrics.js';
import { mm, toMM, pageSize, PAPER, PX_PER_MM } from '../src/engine/units.js';
import { toPDF, pdfImage, PDF_MIME } from '../src/engine/pdf.js';
import { reportToPDF } from '../src/render/pdf.js';
import { validateLayout } from '../src/engine/validate.js';
import { render } from '../src/render/render.js';
import { drawPage } from '../src/render/canvas.js';
import { buildPages } from '../src/engine/index.js';
import * as entry from '../src/index.js';

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());


const STYLE = { fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 16, fontWeight: 'normal', fontStyle: 'normal' };

/** a 50 x 25 mm label with one product-name box on it */
function label(name, overflow) {
    const layout = {
        version: 1,
        name: 'label',
        page: pageSize({ width: 50, height: 25 }, { margin: 2 }),
        bands: [{
            type: 'detail',
            height: 80,
            items: [{
                id: 'name', type: 'text', x: 0, y: 0, w: 150, h: 40,
                value: '{item.name}', style: { ...STYLE }, overflow
            }]
        }]
    };
    return { layout, report: buildPages(layout, { item: { name } }) };
}

const nameItem = (report) => report.pages[0].bands[0].items[0];


describe('graphemes', () => {
    it('keeps a vowel sign and a virama with the consonant they belong to', () => {
        /** each is two code points and one letter */
        expect(graphemes('கு')).toHaveLength(1);
        expect(graphemes('കു')).toHaveLength(1);
        expect(graphemes('தமிழ்')).toEqual(['த', 'மி', 'ழ்']);
        expect(graphemes('മലയാളം')).toEqual(['മ', 'ല', 'യാ', 'ളം']);
    });

    it('keeps an emoji whole', () => {
        expect(graphemes('a👍🏽b')).toEqual(['a', '👍🏽', 'b']);
    });
});


describe('wrapLines - a word too wide for its line', () => {
    it('is cut between letters, never inside one', () => {
        const word = 'மாம்பழஊறுகாய்மாம்பழஊறுகாய்மாம்பழஊறுகாய்';
        const lines = wrapLines(word, 60, STYLE);

        expect(lines.length).toBeGreaterThan(1);
        expect(lines.join('')).toBe(word);

        /** no line starts with a combining mark - the sign of a letter cut in two */
        for (const line of lines) expect(line).not.toMatch(/^\p{M}/u);
    });
});


describe('fitText', () => {
    it('leaves text that fits as it is', () => {
        const fit = fitText('Ragi', 150, 40, STYLE, 'shrink');
        expect(fit).toEqual({ fontSize: 16, lines: ['Ragi'], truncated: false });
    });

    it('shrinks until every line fits the height', () => {
        const text = 'Homemade Mango Pickle with Garlic and Gingelly Oil';
        const fit = fitText(text, 150, 40, STYLE, 'shrink');

        expect(fit.fontSize).toBeLessThan(16);
        expect(fit.fontSize).toBeGreaterThanOrEqual(8);
        expect(fit.lines.length * Math.ceil(fit.fontSize * LINE_HEIGHT_RATIO)).toBeLessThanOrEqual(40);
        expect(fit.lines.join(' ')).toBe(text);
        expect(fit.truncated).toBe(false);
    });

    it('shrinks a long single word rather than cutting it, while it can', () => {
        const fit = fitText('Supercalifragilistic', 120, 40, STYLE, 'shrink');
        expect(fit.lines).toEqual(['Supercalifragilistic']);
        expect(measureText(fit.lines[0], { ...STYLE, fontSize: fit.fontSize })).toBeLessThanOrEqual(120);
    });

    it('stops at half size and cuts with an ellipsis past that', () => {
        const text = 'word '.repeat(80).trim();
        const fit = fitText(text, 150, 40, STYLE, 'shrink');

        expect(fit.fontSize).toBe(8);
        expect(fit.truncated).toBe(true);
        expect(fit.lines.at(-1)).toMatch(/…$/);
    });

    it('cuts at the declared size for ellipsis', () => {
        const fit = fitText('Homemade Mango Pickle with Garlic and Gingelly Oil', 150, 40, STYLE, 'ellipsis');

        expect(fit.fontSize).toBe(16);
        expect(fit.lines).toHaveLength(Math.floor(40 / Math.ceil(16 * LINE_HEIGHT_RATIO)));
        expect(fit.lines.at(-1)).toMatch(/…$/);
        expect(measureText(fit.lines.at(-1), STYLE)).toBeLessThanOrEqual(150);
    });
});


describe('a fixed-size label', () => {
    const long = 'Homemade Mango Pickle with Garlic, Ginger and Gingelly Oil - Extra Hot';

    it('grows past its box and onto a second page when it wraps', () => {
        /** the problem the overflow option exists for (Phase 0.6) */
        const { report } = label(long.repeat(3), undefined);
        expect(nameItem(report).measuredHeight).toBeGreaterThan(40);
    });

    it('keeps its box and one page when it shrinks or cuts', () => {
        for (const mode of ['shrink', 'ellipsis']) {
            const { report } = label(long.repeat(3), mode);
            expect(report.pages).toHaveLength(1);
            expect(nameItem(report).measuredHeight).toBe(40);
            expect(nameItem(report).fitted.lines.length).toBeGreaterThan(0);
        }
    });

    it('is drawn from the fitted lines, at the fitted size, in both renderers', () => {
        const { report } = label(long, 'shrink');
        const { fitted } = nameItem(report);

        const html = render(report);
        expect(html).toContain(`font-size:${fitted.fontSize}px`);
        expect(html).toContain('white-space:pre;overflow:hidden;');
        expect(html).toContain(fitted.lines.join('\n'));

        const drawn = [];
        const state = {};
        const ctx = new Proxy(state, {
            get: (target, key) => {
                if (key === 'fillText') return (text) => drawn.push({ text, font: target.font });
                if (key === 'measureText') return () => ({ width: 1 });
                if (key in target) return target[key];
                return () => { };
            },
            set: (target, key, value) => { target[key] = value; return true; }
        });

        drawPage(ctx, report);
        expect(drawn.map(d => d.text)).toEqual(fitted.lines);
        expect(drawn[0].font).toContain(` ${fitted.fontSize}px `);
    });

    it('is a layout the validator accepts, and refuses a mode it does not know', () => {
        expect(() => validateLayout(label('x', 'shrink').layout)).not.toThrow();
        expect(() => validateLayout(label('x', 'squash').layout)).toThrow(/overflow "squash"/);
    });
});


describe('units', () => {
    it('converts millimetres at 96 dpi', () => {
        expect(mm(25.4)).toBeCloseTo(96, 10);
        expect(toMM(mm(50))).toBeCloseTo(50, 10);
        expect(PX_PER_MM).toBeCloseTo(3.7795, 4);
    });

    it('gives a layout page block for a paper or a label', () => {
        expect(pageSize('A4')).toEqual({ width: 793.7, height: 1122.52, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
        expect(pageSize('A4', { orientation: 'landscape' }).width).toBe(1122.52);
        expect(pageSize({ width: 50, height: 25 }, { margin: { top: 2, left: 3 } })).toEqual({
            width: 188.98, height: 94.49, margin: { top: 7.56, right: 0, bottom: 0, left: 11.34 }
        });
    });

    it('refuses a size it does not know', () => {
        expect(() => pageSize('B9')).toThrow(RangeError);
        expect(PAPER.A4).toEqual({ width: 210, height: 297 });
    });
});


/** the bytes of a PDF as text, for looking at its structure */
const ascii = (bytes) => Array.from(bytes, b => String.fromCharCode(b)).join('');

/** a solid-colour RGBA image */
function solid(width, height, [r, g, b, a]) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) data.set([r, g, b, a], i);
    return { width, height, data };
}

async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}


describe('toPDF', () => {
    it('writes one page per image, sized in points', async () => {
        const pdf = await toPDF([
            { width: 794, height: 1123, image: solid(4, 4, [255, 0, 0, 255]) },
            { width: 189, height: 94.5, image: solid(2, 1, [0, 0, 0, 255]) }
        ], { title: 'Labels' });

        const text = ascii(pdf);
        expect(text.startsWith('%PDF-1.4')).toBe(true);
        expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
        expect(text).toContain('/Count 2');
        expect(text).toContain('/MediaBox [0 0 595.5 842.25]');
        expect(text).toContain('/MediaBox [0 0 141.75 70.875]');
        expect(text).toContain('/Title (Labels)');
        expect(PDF_MIME).toBe('application/pdf');
    });

    it('points its cross-reference table at every object', async () => {
        const pdf = await toPDF([{ width: 100, height: 100, image: solid(3, 3, [1, 2, 3, 255]) }]);
        const text = ascii(pdf);

        const start = Number(text.match(/startxref\n(\d+)/)[1]);
        expect(text.slice(start, start + 4)).toBe('xref');

        const offsets = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
        offsets.forEach((offset, n) => expect(text.slice(offset).startsWith(`${n + 1} 0 obj`)).toBe(true));
    });

    it('stores the pixels losslessly, laid on white where they are transparent', async () => {
        const pdf = await toPDF([{ width: 10, height: 10, image: solid(2, 2, [0, 0, 0, 0]) }]);
        const text = ascii(pdf);

        const head = text.indexOf('/Subtype /Image');
        const length = Number(text.slice(head).match(/\/Length (\d+)/)[1]);
        const begin = text.indexOf('stream\n', head) + 'stream\n'.length;

        const rgb = await inflate(pdf.slice(begin, begin + length));
        expect(Array.from(rgb)).toEqual(new Array(12).fill(255));
    });

    it('takes a JPEG as it is, and an image compressed ahead of time', async () => {
        const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
        const early = await pdfImage(solid(1, 1, [9, 9, 9, 255]));

        const text = ascii(await toPDF([
            { width: 10, height: 10, image: { width: 1, height: 1, jpeg } },
            { width: 10, height: 10, image: early }
        ]));

        expect(text).toContain('/Filter /DCTDecode /Length 4');
        expect(text).toContain('/Filter /FlateDecode');
        expect(early.flate).toBeInstanceOf(Uint8Array);
    });

    it('writes a title in any script', async () => {
        const text = ascii(await toPDF([{ width: 10, height: 10, image: solid(1, 1, [0, 0, 0, 255]) }], { title: 'அம்மா' }));
        expect(text).toMatch(/\/Title <FEFF0B85/);
    });

    it('refuses nothing to write, and an image of the wrong size', async () => {
        await expect(toPDF([])).rejects.toThrow(TypeError);
        await expect(toPDF([{ width: 10, height: 10, image: { width: 2, height: 2, data: new Uint8Array(4) } }]))
            .rejects.toThrow(/not 16/);
    });
});


describe('reportToPDF', () => {
    it('draws every page and makes one PDF of them', async () => {
        const report = buildPages({
            version: 1, name: 'two', page: { width: 100, height: 50, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
            bands: [{ type: 'detail', height: 40, items: [{ id: 't', type: 'text', x: 0, y: 0, w: 90, h: 40, value: 'hi', style: { ...STYLE } }] }]
        }, {});

        const sizes = [];
        const fakeCanvas = {
            width: 0, height: 0,
            getContext: () => new Proxy({}, {
                get: (_, key) => key === 'getImageData'
                    ? (x, y, w, h) => { sizes.push([w, h]); return { data: new Uint8ClampedArray(w * h * 4).fill(255) }; }
                    : key === 'measureText' ? () => ({ width: 1 }) : () => { },
                set: () => true
            })
        };

        vi.stubGlobal('document', { createElement: () => fakeCanvas });

        try {
            const pdf = await reportToPDF(report, { scale: 2, title: 't' });
            expect(ascii(pdf)).toContain(`/Count ${report.pages.length}`);
            expect(sizes[0]).toEqual([200, 100]);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('is on the package entry, with the units and the writer', () => {
        for (const name of ['reportToPDF', 'toPDF', 'pdfImage', 'mm', 'pageSize', 'fitText', 'graphemes', 'renderToCanvas']) {
            expect(typeof entry[name]).toBe('function');
        }
    });
});

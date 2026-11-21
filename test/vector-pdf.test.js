import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PdfDocument, STANDARD_FONTS } from '../src/engine/pdf-document.js';
import { PdfContext, winAnsi, parseColor, splitRuns } from '../src/render/pdf-context.js';
import { reportToVectorPDF } from '../src/render/pdf.js';
import { drawPage } from '../src/render/canvas.js';
import { buildPages } from '../src/engine/index.js';
import { layout, text, line, box, image, table, band, rows } from './helpers/layout.js';
import * as entry from '../src/index.js';

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});


const ascii = (bytes) => Array.from(bytes, b => String.fromCharCode(b)).join('');

async function inflate(bytes) {
    const stream = new DecompressionStream('deflate');
    const writer = stream.writable.getWriter();
    writer.write(bytes).catch(() => { });
    writer.close().catch(() => { });
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** every stream in a file, decompressed, with the dictionary in front of it */
async function streams(pdf) {
    const text = ascii(pdf);
    const found = [];

    for (const m of text.matchAll(/<<([^]*?)\/Length (\d+) >>\nstream\n/g)) {
        const begin = m.index + m[0].length;
        const raw = pdf.slice(begin, begin + Number(m[2]));
        const dict = m[1];
        found.push({ dict, data: /FlateDecode/.test(dict) ? ascii(await inflate(raw)) : ascii(raw) });
    }

    return found;
}

/** the content streams: the ones that draw a page */
async function pageContents(pdf) {
    return (await streams(pdf)).filter(s => !/\/Subtype \/Image/.test(s.dict)).map(s => s.data);
}

function report(bands, data = {}) {
    return buildPages(layout({ bands }), data);
}


describe('PdfDocument', () => {
    it('writes a file whose cross-reference table points at every object', async () => {
        const doc = new PdfDocument({ title: 'Ledger' });
        doc.font('Helvetica');
        doc.page(794, 1123, 'BT /F1 12 Tf ET');
        doc.page(794, 1123, '');

        const pdf = await doc.save();
        const text = ascii(pdf);

        expect(text.startsWith('%PDF-1.4')).toBe(true);
        expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
        expect(text).toContain('/Count 2');
        expect(text).toContain('/MediaBox [0 0 595.5 842.25]');
        expect(text).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding');
        expect(text).toContain('/Title (Ledger)');

        const start = Number(text.match(/startxref\n(\d+)/)[1]);
        expect(text.slice(start, start + 4)).toBe('xref');

        const offsets = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
        expect(offsets.length).toBe(Number(text.match(/\/Size (\d+)/)[1]) - 1);
        offsets.forEach((offset, n) => expect(text.slice(offset).startsWith(`${n + 1} 0 obj`)).toBe(true));
    });

    it('names each font, picture and opacity once', () => {
        const doc = new PdfDocument();

        expect(doc.font('Helvetica')).toBe('F1');
        expect(doc.font('Helvetica-Bold')).toBe('F2');
        expect(doc.font('Helvetica')).toBe('F1');
        expect(doc.alpha('ca', 0.5)).toBe(doc.alpha('ca', 0.5));
        expect(doc.alpha('ca', 0.5)).not.toBe(doc.alpha('CA', 0.5));
        expect(() => doc.font('Arial')).toThrow(RangeError);
        expect(STANDARD_FONTS).toContain('Courier-BoldOblique');
    });

    it('keeps a picture\'s transparency as a soft mask, and only when it has some', async () => {
        const doc = new PdfDocument();
        const clear = new Uint8Array([255, 0, 0, 128, 0, 255, 0, 255]);
        const solid = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);

        doc.image({ width: 2, height: 1, rgba: clear });
        doc.image({ width: 2, height: 1, rgba: solid });
        doc.page(10, 10, '');

        const images = (await streams(await doc.save())).filter(s => /\/Subtype \/Image/.test(s.dict));
        const gray = images.filter(s => /DeviceGray/.test(s.dict));
        const masked = images.filter(s => /\/SMask/.test(s.dict));

        expect(images).toHaveLength(3);
        expect(gray).toHaveLength(1);
        expect(Array.from(gray[0].data, ch => ch.charCodeAt(0))).toEqual([128, 255]);
        expect(masked).toHaveLength(1);
    });

    it('refuses a document with no pages', async () => {
        await expect(new PdfDocument().save()).rejects.toThrow(TypeError);
    });
});


describe('PdfContext', () => {
    const context = () => {
        const doc = new PdfDocument();
        return { doc, ctx: new PdfContext(doc, { width: 100, height: 200 }) };
    };

    it('turns the page to run down from the top, in pixels', () => {
        const { ctx } = context();
        expect(ctx.content().split('\n')[0]).toBe('0.75 0 0 -0.75 0 150 cm');
    });

    it('paints a rectangle in its colour, setting the colour once', () => {
        const { ctx } = context();

        ctx.fillStyle = '#ff0000';
        ctx.fillRect(1, 2, 3, 4);
        ctx.fillRect(5, 6, 7, 8);

        const ops = ctx.content();
        expect(ops.match(/1 0 0 rg/g)).toHaveLength(1);
        expect(ops).toContain('1 2 3 4 re f');
        expect(ops).toContain('5 6 7 8 re f');
    });

    it('ignores a colour it cannot read and keeps the last, as a canvas does', () => {
        const { ctx } = context();

        ctx.fillStyle = '#00ff00';
        ctx.fillStyle = 'not-a-colour';
        expect(ctx.fillStyle).toBe('#00ff00');
    });

    it('paints nothing in a transparent colour, and a translucent one through a graphics state', async () => {
        const { doc, ctx } = context();

        ctx.fillStyle = 'transparent';
        ctx.fillRect(0, 0, 10, 10);
        expect(ctx.content()).not.toContain('re f');

        ctx.fillStyle = 'rgba(0, 0, 255, 0.5)';
        ctx.fillRect(0, 0, 10, 10);
        expect(ctx.content()).toMatch(/\/G1 gs/);

        doc.page(100, 200, ctx.content());
        expect(ascii(await doc.save())).toContain('/G1 << /Type /ExtGState /ca 0.5 >>');
    });

    it('strokes with the width, the dash and the cap it was given', () => {
        const { ctx } = context();

        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(10, 0);
        ctx.stroke();

        const ops = ctx.content();
        expect(ops).toContain('2 w');
        expect(ops).toContain('[6 6] 0 d');
        expect(ops).toContain('0 0 m 10 0 l S');
    });

    it('rounds a corner with a curve', () => {
        const { ctx } = context();

        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.arcTo(20, 0, 20, 10, 10);
        ctx.stroke();

        const ops = ctx.content();
        expect(ops).toMatch(/10 0 m 10 0 l [\d.]+ 0 20 [\d.]+ 20 10 c S/);
    });

    it('clips, and puts back what save kept on restore', () => {
        const { ctx } = context();

        ctx.fillStyle = '#ff0000';
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, 5, 5);
        ctx.clip();
        ctx.fillStyle = '#0000ff';
        ctx.fillRect(0, 0, 5, 5);
        ctx.restore();
        ctx.fillRect(0, 0, 5, 5);

        const ops = ctx.content().split('\n');
        expect(ops).toContain('0 0 5 5 re W n');
        expect(ctx.fillStyle).toBe('#ff0000');

        /** the PDF forgot the blue on Q too, so the red is set again */
        const after = ops.slice(ops.indexOf('Q'));
        expect(after).toContain('1 0 0 rg');
    });

    it('sets Latin text in the built-in font, the right way up', () => {
        const { doc, ctx } = context();

        ctx.font = 'normal 600 12px Helvetica, Arial, sans-serif';
        ctx.fillText('Total (net)', 10, 20);

        expect(ctx.content()).toContain('BT /F1 12 Tf 1 0 0 -1 10 20 Tm (Total \\(net\\)) Tj ET');
        expect([...doc.fonts.keys()]).toEqual(['Helvetica-Bold']);
    });

    it('picks the built-in face for the family, weight and slant', () => {
        const { doc, ctx } = context();

        for (const font of [
            'italic normal 12px Arial',
            'italic bold 12px "Times New Roman", serif',
            'normal normal 12px Courier New, monospace'
        ]) {
            ctx.font = font;
            ctx.fillText('a', 0, 0);
        }

        expect([...doc.fonts.keys()]).toEqual(['Helvetica-Oblique', 'Times-BoldItalic', 'Courier']);
    });

    it('lines text up on its right or its centre', () => {
        const { ctx } = context();

        ctx.font = 'normal normal 12px Helvetica';
        ctx.textAlign = 'right';
        ctx.fillText('99', 100, 20);
        ctx.textAlign = 'center';
        ctx.fillText('99', 50, 40);

        const xs = [...ctx.content().matchAll(/1 0 0 -1 ([\d.]+) [\d.]+ Tm/g)].map(m => Number(m[1]));
        expect(xs[0]).toBeLessThan(100);
        expect(xs[0]).toBeGreaterThan(80);
        expect(xs[1]).toBeCloseTo(50 - (100 - xs[0]) / 2, 3);
    });

    it('writes a character outside the built-in fonts as ? where there is no browser to draw it', () => {
        const { ctx } = context();

        ctx.font = 'normal normal 12px Helvetica';
        ctx.fillText('₹ 500', 0, 10);

        expect(ctx.content()).toContain('(? 500) Tj');
        expect(console.warn).toHaveBeenCalled();
    });
});


describe('winAnsi and parseColor', () => {
    it('encodes Latin and its punctuation, and nothing else', () => {
        expect(winAnsi('Café – €5')).toBe('Caf\xe9 \x96 \x805');
        expect(winAnsi('₹')).toBeNull();
        expect(winAnsi('அ')).toBeNull();
    });

    it('cuts a line where the built-in fonts stop being able to show it, never inside a letter', () => {
        expect(splitRuns('₹ 1,250')).toEqual([
            { text: '₹', bytes: null },
            { text: ' 1,250', bytes: ' 1,250' }
        ]);

        /** an e with a combining accent the fonts lack goes with its e */
        expect(splitRuns('Café ok').map(r => r.text)).toEqual(['Caf', 'é', ' ok']);

        expect(splitRuns('சென்னை Stores').map(r => r.bytes === null)).toEqual([true, false]);
    });

    it('reads the colours a layout writes', () => {
        expect(parseColor('#abc')).toEqual([170, 187, 204, 1]);
        expect(parseColor('#11223380')).toEqual([17, 34, 51, 128 / 255]);
        expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3, 1]);
        expect(parseColor('rgba(1 2 3 / 50%)')).toEqual([1, 2, 3, 0.5]);
        expect(parseColor('transparent')).toEqual([0, 0, 0, 0]);
        expect(parseColor('#12')).toBeNull();
    });
});


describe('reportToVectorPDF', () => {
    it('draws every page, with its text as text', async () => {
        const built = report([
            band('pageHeader', [text('title', { value: 'Stock report' })], { height: 30 }),
            band('detail', [table()], { height: 40 })
        ], { items: rows(80) });

        expect(built.pages.length).toBeGreaterThan(1);

        const pdf = await reportToVectorPDF(built, { title: 'Stock' });
        const file = ascii(pdf);
        const pages = await pageContents(pdf);

        expect(file).toContain(`/Count ${built.pages.length}`);
        expect(file).toContain('/Title (Stock)');
        expect(file).toContain('/BaseFont /Helvetica ');
        expect(file).toContain('/BaseFont /Helvetica-Bold ');
        expect(file).not.toContain('/Subtype /Image');

        expect(pages).toHaveLength(built.pages.length);
        for (const page of pages) expect(page).toContain('(Stock report) Tj');
        expect(pages[0]).toContain('(row-0) Tj');
        expect(pages.at(-1)).toContain('(row-79) Tj');
        expect(pages[0]).toContain('(Item) Tj');
    });

    it('draws rules and boxes as lines', async () => {
        const built = report([band('detail', [
            line('rule', { y: 0, thickness: 2, lineStyle: 'dashed', color: '#ff0000' }),
            box('frame', { y: 20, radius: 6, background: '#eeeeee' })
        ], { height: 100 })]);

        const [page] = await pageContents(await reportToVectorPDF(built));

        expect(page).toContain('1 0 0 RG');
        expect(page).toContain('[6 6] 0 d');
        expect(page).toMatch(/ c /);
        expect(page).toContain('0.9333 0.9333 0.9333 rg');
    });

    it('draws the pages asked for, and only those', async () => {
        const built = report([band('detail', [table()], { height: 40 })], { items: rows(80) });
        const pdf = await reportToVectorPDF(built, { pages: [1] });

        expect(ascii(pdf)).toContain('/Count 1');
        const [page] = await pageContents(pdf);
        expect(page).not.toContain('(row-0) Tj');
    });

    it('embeds a picture once, however many pages show it', async () => {
        vi.stubGlobal('OffscreenCanvas', FakeCanvas);

        const built = report([
            band('pageHeader', [image('logo', { src: 'logo.png', w: 40, h: 20 })], { height: 30 }),
            band('detail', [table()], { height: 40 })
        ], { items: rows(80) });

        const picture = { width: 4, height: 2 };
        const loadImage = vi.fn(async () => picture);

        const pdf = await reportToVectorPDF(built, { loadImage });
        const pages = await pageContents(pdf);

        expect(loadImage).toHaveBeenCalledOnce();
        /** one picture - and its soft mask, the fake canvas's pixels being partly clear */
        expect(ascii(pdf).match(/\/ColorSpace \/DeviceRGB/g)).toHaveLength(1);
        for (const page of pages) expect(page).toMatch(/\/Im1 Do/);
    });

    it('leaves out a picture that will not load, as an empty frame', async () => {
        const built = report([band('detail', [image('logo', { src: 'missing.png' })], { height: 100 })]);
        const pdf = await reportToVectorPDF(built, { loadImage: async () => null });

        expect(ascii(pdf)).not.toContain('/Subtype /Image');
    });

    it('refuses something that is not a built report', async () => {
        await expect(reportToVectorPDF({})).rejects.toThrow(TypeError);
    });

    it('is on the package entry', () => {
        expect(typeof entry.reportToVectorPDF).toBe('function');
    });
});


describe('text in the built-in fonts', () => {
    const textLines = (content) => content.split('\n').filter(line => line.startsWith('BT '));

    /** the text font is graphics state, kept from one text object to the next */
    it('sets the font only when it changes', () => {
        const doc = new PdfDocument();
        const ctx = new PdfContext(doc, { width: 100, height: 100 });

        ctx.font = 'normal normal 12px Helvetica';
        ctx.fillText('a', 0, 10);
        ctx.fillText('b', 0, 20);

        ctx.font = 'normal bold 12px Helvetica';
        ctx.fillText('c', 0, 30);

        ctx.save();
        ctx.font = 'normal normal 12px Helvetica';
        ctx.fillText('d', 0, 40);
        ctx.restore();

        /** Q took the font back to the bold one, which is what this asks for */
        ctx.fillText('e', 0, 50);

        const lines = textLines(ctx.content());
        expect(lines.map(line => /Tf/.test(line))).toEqual([true, false, true, true, false]);
        expect(lines[2]).toMatch(/^BT \/F2 12 Tf /);
        expect(lines[4]).toMatch(/^BT 1 0 0 -1 .* \(e\) Tj ET$/);
    });

    it('sets it again in a new size', () => {
        const ctx = new PdfContext(new PdfDocument(), { width: 100, height: 100 });

        ctx.font = 'normal normal 12px Helvetica';
        ctx.fillText('a', 0, 10);
        ctx.font = 'normal normal 14px Helvetica';
        ctx.fillText('b', 0, 20);

        expect(textLines(ctx.content()).map(line => line.match(/\/F\d+ \d+ Tf/)?.[0]))
            .toEqual(['/F1 12 Tf', '/F1 14 Tf']);
    });
});


describe('text the built-in fonts cannot show', () => {
    /**
     * The context keeps one scratch canvas for the life of its module, so
     * these load a fresh copy with a canvas in place first.
     */
    async function freshContext() {
        vi.resetModules();
        vi.stubGlobal('OffscreenCanvas', FakeCanvas);
        const { PdfContext: Context } = await import('../src/render/pdf-context.js');
        const { PdfDocument: Document } = await import('../src/engine/pdf-document.js');
        const doc = new Document();
        return { doc, ctx: new Context(doc, { width: 100, height: 100 }) };
    }

    it('is drawn by the browser and placed as a picture, the rest of the line staying text', async () => {
        const { doc, ctx } = await freshContext();

        ctx.font = 'normal normal 12px Helvetica';
        ctx.fillStyle = '#ff0000';
        ctx.fillText('₹ 500', 10, 20);

        expect(ctx.content()).toMatch(/q [\d.]+ 0 0 -[\d.]+ [\d.]+ [\d.]+ cm \/Im1 Do Q/);

        /** the fake canvas measures 6px a character, so the text starts one character in */
        expect(ctx.content()).toContain('1 0 0 -1 16 20 Tm ( 500) Tj');

        doc.page(100, 100, ctx.content());
        const images = (await streams(await doc.save())).filter(s => /\/Subtype \/Image/.test(s.dict));

        /** the letters in the fill colour, their shape in the soft mask */
        const rgb = images.find(s => /DeviceRGB/.test(s.dict));
        expect(rgb.data.slice(0, 3)).toBe('\xff\x00\x00');
        expect(images.some(s => /DeviceGray/.test(s.dict))).toBe(true);
    });

    it('shares one picture of a symbol across every amount that has it', async () => {
        const { doc, ctx } = await freshContext();

        ctx.font = 'normal normal 12px Helvetica';
        ctx.textAlign = 'right';
        for (const amount of ['₹ 1,250.00', '₹ 80.00', '₹ 9,99,999.00']) ctx.fillText(amount, 90, 20);

        expect(doc.images).toHaveLength(1);
        expect(ctx.content().match(/\/Im1 Do/g)).toHaveLength(3);
        expect(ctx.content()).toContain('( 80.00) Tj');
    });

    it('is drawn once for a line repeated on every page', async () => {
        const { doc, ctx } = await freshContext();

        ctx.font = 'normal normal 12px "Noto Sans Tamil"';
        ctx.fillText('சென்னை', 0, 10);
        ctx.fillText('சென்னை', 0, 30);

        expect(ctx.content().match(/\/Im1 Do/g)).toHaveLength(2);
        expect(doc.images).toHaveLength(1);
    });
});


/** an OffscreenCanvas whose drawing leaves a little ink, enough to be a picture */
class FakeCanvas {
    constructor(width, height) {
        this.width = width;
        this.height = height;
    }

    getContext() {
        const canvas = this;
        return {
            canvas,
            font: '12px sans-serif',
            fillStyle: '#000000',
            measureText: (str) => ({
                width: String(str).length * 6,
                fontBoundingBoxAscent: 11, fontBoundingBoxDescent: 3,
                actualBoundingBoxLeft: 0, actualBoundingBoxRight: String(str).length * 6,
                actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 2
            }),
            getImageData: (x, y, w, h) => {
                const data = new Uint8ClampedArray(w * h * 4);
                for (let p = 0; p < data.length; p += 8) data[p + 3] = 200;
                return { data };
            },
            setTransform() { }, clearRect() { }, fillRect() { }, fillText() { }, drawImage() { }
        };
    }
}

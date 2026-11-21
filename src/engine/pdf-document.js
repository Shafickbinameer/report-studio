/**
 * pdf-document.js writes a PDF whose pages are drawing instructions rather
 * than pictures: text set in the reader's own Helvetica, rules and boxes as
 * paths, pictures embedded once however many pages show them.
 *
 * pdf.js (toPDF) is the other writer - one picture per page, exact but heavy.
 * This one is what the viewer's PDF export uses: it is written in milliseconds,
 * a few kilobytes a page, and its text can be selected and searched.
 *
 * It knows nothing of reports. render/pdf-context.js turns drawing calls into
 * the content of a page; this keeps the objects, the shared resources and the
 * cross-reference table. Streams are compressed as they are added, all at
 * once, and save() waits for them.
 */

import { PT_PER_PX } from './units.js';
import { deflate, pdfString, Writer } from './pdf.js';


/**
 * The fonts every PDF reader carries, so a file can name them and embed
 * nothing. Their characters are WinAnsi: Latin, and the punctuation around it.
 */
export const STANDARD_FONTS = Object.freeze([
    'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
    'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
    'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'
]);


export class PdfDocument {
    /**
     * @param {object} [options]
     * @param {string} [options.title]
     * @param {string} [options.producer]
     */
    constructor({ title, producer = 'report-studio' } = {}) {
        this.title = title;
        this.producer = producer;

        /** id -> { dict, stream? }; 1 to 4 are the catalog, page tree, info and shared resources */
        this.objects = new Map();
        this.nextId = 5;

        this.pageIds = [];
        this.fonts = new Map();     // base font -> resource name
        this.images = [];           // [name, id]
        this.states = new Map();    // 'ca 0.5' -> resource name

        /** for callers that want to embed a thing once per document - a picture, a line of text */
        this.cache = new Map();
    }

    /** a font by its standard name, as the name a content stream selects it with */
    font(baseFont) {
        if (!STANDARD_FONTS.includes(baseFont)) throw new RangeError(`"${baseFont}" is not a standard PDF font.`);

        let name = this.fonts.get(baseFont);
        if (!name) {
            name = `F${this.fonts.size + 1}`;
            this.fonts.set(baseFont, name);
        }
        return name;
    }

    /**
     * An opacity, as the graphics state that sets it.
     * @param {'ca'|'CA'} key ca for fills, CA for strokes
     * @param {number} alpha
     */
    alpha(key, alpha) {
        const value = Math.round(Math.min(Math.max(alpha, 0), 1) * 1000) / 1000;
        const id = `${key} ${value}`;

        let name = this.states.get(id);
        if (!name) {
            name = `G${this.states.size + 1}`;
            this.states.set(id, name);
        }
        return name;
    }

    /**
     * A picture, as the name a content stream draws it with.
     *
     * Pixels go in losslessly, with their transparency as a soft mask when
     * they have any; `color` paints every pixel one colour and keeps only the
     * transparency, which is what a line of text drawn as a picture is. JPEG
     * bytes go in as they are.
     *
     * @param {{width: number, height: number, rgba: Uint8Array|Uint8ClampedArray, color?: number[]}
     *   | {width: number, height: number, jpeg: Uint8Array}} image
     * @returns {string}
     */
    image(image) {
        const width = Math.floor(Number(image?.width));
        const height = Math.floor(Number(image?.height));

        if (!(width > 0 && height > 0)) throw new RangeError('PdfDocument.image: the image has no size.');

        const name = `Im${this.images.length + 1}`;
        const id = this.nextId++;
        this.images.push([name, id]);

        const head = `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8`;

        if (image.jpeg) {
            this.objects.set(id, { dict: `${head} /Filter /DCTDecode`, stream: Promise.resolve(image.jpeg) });
            return name;
        }

        const rgba = image.rgba;
        if (!rgba || rgba.length < width * height * 4) {
            throw new RangeError(`PdfDocument.image: ${rgba?.length ?? 0} bytes is not ${width} x ${height} pixels.`);
        }

        const count = width * height;
        const rgb = new Uint8Array(count * 3);
        const alpha = new Uint8Array(count);
        let clear = false;

        const color = image.color;

        for (let p = 0, q = 0, n = 0; n < count; n++, p += 4, q += 3) {
            if (color) {
                rgb[q] = color[0];
                rgb[q + 1] = color[1];
                rgb[q + 2] = color[2];
            } else {
                rgb[q] = rgba[p];
                rgb[q + 1] = rgba[p + 1];
                rgb[q + 2] = rgba[p + 2];
            }

            alpha[n] = rgba[p + 3];
            if (rgba[p + 3] !== 255) clear = true;
        }

        let mask = '';

        if (clear) {
            const maskId = this.nextId++;
            this.objects.set(maskId, {
                dict: `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
                    '/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode',
                stream: settled(deflate(alpha))
            });
            mask = ` /SMask ${maskId} 0 R`;
        }

        this.objects.set(id, { dict: `${head}${mask} /Filter /FlateDecode`, stream: settled(deflate(rgb)) });

        return name;
    }

    /**
     * A page, from its content: the operators a page is drawn with, as a
     * string of byte-sized characters.
     *
     * @param {number} width the page in layout pixels (96 to the inch)
     * @param {number} height
     * @param {string} content
     */
    page(width, height, content) {
        const w = num(Number(width) * PT_PER_PX);
        const h = num(Number(height) * PT_PER_PX);

        if (!(w > 0 && h > 0)) throw new RangeError(`PdfDocument.page: page ${this.pageIds.length + 1} has no size.`);

        const pageId = this.nextId++;
        const contentId = this.nextId++;

        this.objects.set(pageId, {
            dict: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources 4 0 R /Contents ${contentId} 0 R >>`
        });
        this.objects.set(contentId, { dict: '/Filter /FlateDecode', stream: settled(deflate(latin1(content))) });

        this.pageIds.push(pageId);
    }

    /** @returns {Promise<Uint8Array>} the file */
    async save() {
        if (this.pageIds.length === 0) throw new TypeError('A PDF needs at least one page.');

        const fonts = [...this.fonts].map(([base, name]) => {
            const id = this.nextId++;
            this.objects.set(id, { dict: `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>` });
            return `/${name} ${id} 0 R`;
        });

        const states = [...this.states].map(([setting, name]) => `/${name} << /Type /ExtGState /${setting} >>`);
        const images = this.images.map(([name, id]) => `/${name} ${id} 0 R`);

        this.objects.set(1, { dict: '<< /Type /Catalog /Pages 2 0 R >>' });
        this.objects.set(2, { dict: `<< /Type /Pages /Kids [${this.pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${this.pageIds.length} >>` });
        this.objects.set(3, { dict: `<< /Producer ${pdfString(this.producer)}${this.title ? ` /Title ${pdfString(this.title)}` : ''} >>` });
        this.objects.set(4, {
            dict: '<< /ProcSet [/PDF /Text /ImageB /ImageC]' +
                (fonts.length ? ` /Font << ${fonts.join(' ')} >>` : '') +
                (images.length ? ` /XObject << ${images.join(' ')} >>` : '') +
                (states.length ? ` /ExtGState << ${states.join(' ')} >>` : '') +
                ' >>'
        });

        const size = this.nextId;
        const streams = new Map();

        await Promise.all([...this.objects].map(async ([id, object]) => {
            if (object.stream) streams.set(id, toBytes(await object.stream));
        }));

        const out = new Writer();
        out.text('%PDF-1.4\n%âãÏÓ\n');

        const offsets = [];

        for (let id = 1; id < size; id++) {
            const object = this.objects.get(id);
            offsets[id] = out.length;
            out.text(`${id} 0 obj\n`);

            if (!object) {
                out.text('null');
            } else if (streams.has(id)) {
                const bytes = streams.get(id);
                out.text(`<< ${object.dict} /Length ${bytes.length} >>\nstream\n`);
                out.bytes(bytes);
                out.text('\nendstream');
            } else {
                out.text(object.dict);
            }

            out.text('\nendobj\n');
        }

        const xref = out.length;

        out.text(`xref\n0 ${size}\n0000000000 65535 f \n`);
        for (let id = 1; id < size; id++) out.text(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
        out.text(`trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

        return out.done();
    }
}


/**
 * A stream still being compressed. Its failure is marked as seen here, since
 * nothing awaits it until save() - which still gets the failure, and throws it.
 */
function settled(promise) {
    promise.catch(() => { });
    return promise;
}


/** a string of byte-sized characters as the bytes they are */
function latin1(str) {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
    return bytes;
}


function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError('PdfDocument: a stream must be bytes.');
}


/** a number as PDF writes one: no exponent, at most three decimals */
function num(n) {
    return Math.round(n * 1000) / 1000;
}

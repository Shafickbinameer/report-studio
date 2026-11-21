/**
 * pdf.js writes a PDF whose pages are pictures.
 *
 * Spec: an image-based PDF first. Each page is one image the size of the
 * page, which is exact - what was drawn is what prints - and sidesteps font
 * embedding entirely, which matters most for Tamil and Malayalam, where a PDF
 * with real text would need the shaping engine a browser already ran.
 *
 * No dependencies, like zip.js: a PDF this simple is a few dictionaries and a
 * cross-reference table. Pixels go in losslessly, Flate-compressed with the
 * platform's CompressionStream, so a label's small text stays sharp; a JPEG
 * the caller already has can go in as it is.
 */

import { PT_PER_PX } from './units.js';


export const PDF_MIME = 'application/pdf';


/**
 * One PDF from a list of page images.
 *
 * @param {Array<{width: number, height: number, image: PdfImage}>} pages
 *   `width` and `height` are the page in layout pixels (96 to the inch); the
 *   image is stretched over it, so its own resolution decides the print's
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {string} [options.producer]
 * @returns {Promise<Uint8Array>}
 *
 * @typedef {{width: number, height: number, data: Uint8ClampedArray|Uint8Array}
 *   | {width: number, height: number, jpeg: Uint8Array}} PdfImage
 *   RGBA pixels as a canvas's getImageData gives them, or JPEG bytes
 */
export async function toPDF(pages, { title, producer = 'report-studio' } = {}) {
    if (!Array.isArray(pages) || pages.length === 0) {
        throw new TypeError('toPDF needs at least one page.');
    }

    const out = new Writer();
    out.text('%PDF-1.4\n%âãÏÓ\n');

    /** 1 catalog, 2 page tree, 3 info; each page takes three after that */
    const pageIds = pages.map((_, n) => 4 + n * 3);
    const offsets = [];

    const object = (id, writeBody) => {
        offsets[id] = out.length;
        out.text(`${id} 0 obj\n`);
        writeBody();
        out.text('\nendobj\n');
    };

    object(1, () => out.text('<< /Type /Catalog /Pages 2 0 R >>'));
    object(2, () => out.text(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`));
    object(3, () => out.text(`<< /Producer ${pdfString(producer)}${title ? ` /Title ${pdfString(title)}` : ''} >>`));

    for (const [n, page] of pages.entries()) {
        const id = pageIds[n];
        const w = num(Number(page.width) * PT_PER_PX);
        const h = num(Number(page.height) * PT_PER_PX);

        if (!(w > 0 && h > 0)) throw new RangeError(`toPDF: page ${n + 1} has no size.`);

        const image = await encodeImage(page.image, n);
        const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;

        object(id, () => out.text(
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
            `/Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`));

        object(id + 1, () => {
            out.text(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
        });

        object(id + 2, () => {
            out.text(
                `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
                `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${image.filter} /Length ${image.bytes.length} >>\nstream\n`);
            out.bytes(image.bytes);
            out.text('\nendstream');
        });
    }

    const size = 4 + pages.length * 3;
    const xref = out.length;

    out.text(`xref\n0 ${size}\n0000000000 65535 f \n`);
    for (let id = 1; id < size; id++) out.text(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
    out.text(`trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    return out.done();
}


/**
 * Compresses a page image now, so the pixels can be let go of before the
 * next page is drawn. toPDF takes what this returns in place of the image.
 *
 * @param {PdfImage} image
 * @returns {Promise<{width: number, height: number, flate: Uint8Array}|{width: number, height: number, jpeg: Uint8Array}>}
 */
export async function pdfImage(image) {
    const encoded = await encodeImage(image, 0);
    return encoded.filter === 'DCTDecode'
        ? { width: encoded.width, height: encoded.height, jpeg: encoded.bytes }
        : { width: encoded.width, height: encoded.height, flate: encoded.bytes };
}


/**
 * A page image as PDF image bytes: JPEG as it came, pixels as Flate.
 * Transparency is laid on white, since paper is.
 */
async function encodeImage(image, n) {
    const width = Math.floor(Number(image?.width));
    const height = Math.floor(Number(image?.height));

    if (!(width > 0 && height > 0)) throw new RangeError(`toPDF: page ${n + 1}'s image has no size.`);

    if (image.jpeg) return { width, height, filter: 'DCTDecode', bytes: toBytes(image.jpeg) };

    /** already compressed by pdfImage */
    if (image.flate) return { width, height, filter: 'FlateDecode', bytes: toBytes(image.flate) };

    const rgba = image.data;
    if (!rgba || rgba.length < width * height * 4) {
        throw new RangeError(`toPDF: page ${n + 1}'s image has ${rgba?.length ?? 0} bytes, not ${width * height * 4}.`);
    }

    const rgb = new Uint8Array(width * height * 3);

    for (let p = 0, q = 0; q < rgb.length; p += 4, q += 3) {
        const a = rgba[p + 3];

        if (a === 255) {
            rgb[q] = rgba[p];
            rgb[q + 1] = rgba[p + 1];
            rgb[q + 2] = rgba[p + 2];
        } else {
            const white = 255 - a;
            rgb[q] = Math.round((rgba[p] * a) / 255 + white);
            rgb[q + 1] = Math.round((rgba[p + 1] * a) / 255 + white);
            rgb[q + 2] = Math.round((rgba[p + 2] * a) / 255 + white);
        }
    }

    return { width, height, filter: 'FlateDecode', bytes: await deflate(rgb) };
}


/** zlib-wrapped deflate, which is what /FlateDecode reads */
export async function deflate(bytes) {
    if (typeof CompressionStream !== 'function') {
        throw new Error('toPDF needs CompressionStream (any current browser, or Node 18+).');
    }

    /**
     * Written and read by hand rather than through Blob and Response, which a
     * DOM stand-in (jsdom) may replace with versions that cannot stream. The
     * write is not awaited: it only settles once the output is being read.
     */
    const stream = new CompressionStream('deflate');
    const writer = stream.writable.getWriter();
    writer.write(bytes).catch(() => { });
    writer.close().catch(() => { });

    const chunks = [];
    let length = 0;
    const reader = stream.readable.getReader();

    for (; ;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        length += value.length;
    }

    const out = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
        out.set(chunk, at);
        at += chunk.length;
    }
    return out;
}


function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError('toPDF: a jpeg must be bytes.');
}


/** a number as PDF writes one: no exponent, at most three decimals */
function num(n) {
    return Math.round(n * 1000) / 1000;
}


/**
 * A PDF text string. Plain ASCII goes in brackets, escaped; anything else as
 * UTF-16BE hex with a byte order mark, so a Tamil shop name in the title
 * survives.
 */
export function pdfString(value) {
    const str = String(value);

    if (/^[\x20-\x7e]*$/.test(str)) return `(${str.replace(/[\\()]/g, '\\$&')})`;

    let hex = 'FEFF';
    for (let i = 0; i < str.length; i++) hex += str.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
    return `<${hex}>`;
}


/** a growing byte buffer; offsets in a PDF are bytes, so text is written as latin1 */
export class Writer {
    constructor() {
        this.chunks = [];
        this.length = 0;
    }

    text(str) {
        const bytes = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
        this.bytes(bytes);
    }

    bytes(bytes) {
        this.chunks.push(bytes);
        this.length += bytes.length;
    }

    done() {
        const all = new Uint8Array(this.length);
        let at = 0;
        for (const chunk of this.chunks) {
            all.set(chunk, at);
            at += chunk.length;
        }
        return all;
    }
}

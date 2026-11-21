/**
 * pdf.js (render) turns a built report into a PDF file, by drawing each page
 * with renderToCanvas and handing the pixels to the engine's toPDF.
 *
 * Pages are drawn one at a time and let go of before the next: an A4 page at
 * print resolution is tens of megabytes of pixels, and a phone holding thirty
 * of them at once is a phone that closes the app.
 */

import { renderToCanvas, drawPage, pageImageSources, pageFonts, loadFonts, loadImage } from './canvas.js';
import { PdfContext } from './pdf-context.js';
import { px } from './items.js';
import { toPDF, pdfImage } from '../engine/pdf.js';
import { PdfDocument } from '../engine/pdf-document.js';


/** 2 device pixels per layout pixel is 192 dpi - sharp on paper, light on memory */
export const PDF_SCALE = 2;


/**
 * A built report as PDF bytes.
 *
 * @param {object} report a buildPages result
 * @param {object} [options]
 * @param {number} [options.scale] device pixels per page pixel; 300 / 96 for 300 dpi
 * @param {string} [options.title]
 * @param {number[]} [options.pages] which pages, 0-based; all of them by default
 * @param {object} [options.theme] as renderToCanvas takes it
 * @param {(src: string) => Promise<CanvasImageSource|null>} [options.loadImage]
 * @returns {Promise<Uint8Array>}
 */
export async function reportToPDF(report, options = {}) {
    const scale = Number(options.scale) > 0 ? Number(options.scale) : PDF_SCALE;
    const which = options.pages ?? report.pages.map((_, n) => n);

    const pages = [];
    let canvas;

    for (const index of which) {
        /** one canvas, redrawn per page, so only one page of pixels is alive */
        canvas = await renderToCanvas(report, {
            page: index, scale, canvas,
            theme: options.theme, loadImage: options.loadImage
        });

        /** compressed straight away, so these pixels are not held while the next page draws */
        pages.push({ width: report.page.width, height: report.page.height, image: await pdfImage(canvasImage(canvas)) });
    }

    return toPDF(pages, { title: options.title });
}


/**
 * A canvas's pixels as toPDF takes them.
 * @param {HTMLCanvasElement|OffscreenCanvas} canvas
 * @returns {{width: number, height: number, data: Uint8ClampedArray}}
 */
export function canvasImage(canvas) {
    const { width, height } = canvas;
    const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    return { width, height, data };
}


/** the longest side a picture is embedded at; a logo drawn 3 cm wide needs nowhere near it */
const MAX_PICTURE = 2400;


/**
 * A built report as a vector PDF: text the reader can select and search, rules
 * and boxes as lines, each picture embedded once however many pages show it.
 *
 * What the viewer's PDF export makes. Where reportToPDF photographs every page
 * - exact, but slow and tens of megabytes for a long report - this records the
 * same drawing (canvas.js's drawPage) as PDF operators, which takes a fraction
 * of the time and of the space.
 *
 * Text is set in the PDF's built-in Helvetica, Times or Courier when its font
 * is one of those. What those fonts lack - a rupee sign, a Tamil or Malayalam
 * word - is drawn by the browser and placed in the line as a picture, once per
 * document for each distinct stretch; a line in a web font is a picture whole.
 *
 * @param {object} report a buildPages result
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {number[]} [options.pages] which pages, 0-based; all of them by default
 * @param {object} [options.theme] as renderToCanvas takes it
 * @param {(src: string) => Promise<CanvasImageSource|null>} [options.loadImage]
 * @param {boolean} [options.waitForFonts] see renderToCanvas
 * @returns {Promise<Uint8Array>}
 */
export async function reportToVectorPDF(report, options = {}) {
    if (!Array.isArray(report?.pages)) {
        throw new TypeError('reportToVectorPDF takes a buildPages result: it has no `pages` array.');
    }

    const which = options.pages ?? report.pages.map((_, n) => n);
    const load = options.loadImage ?? loadImage;

    const width = px(report.page?.width);
    const height = px(report.page?.height);

    const doc = new PdfDocument({ title: options.title });

    /** src -> the loaded picture, and the picture -> its name in the PDF; both for the whole document */
    const images = new Map();
    const pictures = new Map();

    for (const [count, index] of which.entries()) {
        const page = report.pages[index];

        for (const src of pageImageSources(page)) {
            if (images.has(src)) continue;

            let picture = null;
            try {
                picture = await load(src);
            } catch {
                /** an empty frame, as in the HTML */
            }

            images.set(src, picture);
            if (picture && !pictures.has(picture)) {
                const name = await embedPicture(doc, picture, src);
                if (name) pictures.set(picture, name);
            }
        }

        if (options.waitForFonts !== false) await loadFonts(pageFonts(page));

        const ctx = new PdfContext(doc, { width, height }, { pictures });
        drawPage(ctx, report, index, { images: loaded(images), theme: options.theme });
        doc.page(width, height, ctx.content());

        /** a long report gives the page a moment to breathe now and then */
        if (count % 25 === 24) await pause();
    }

    return doc.save();
}


function loaded(images) {
    const map = new Map();
    for (const [src, picture] of images) if (picture) map.set(src, picture);
    return map;
}


/**
 * A loaded picture into the document. A photograph (a JPEG by its address)
 * goes in as JPEG; anything else losslessly, with its transparency. A picture
 * from a site that did not allow it taints the canvas and cannot be read, so it
 * is left out - an empty frame, as renderToCanvas leaves it.
 *
 * @returns {Promise<string|null>} its name, or null
 */
async function embedPicture(doc, picture, src) {
    const iw = picture.naturalWidth || picture.videoWidth || picture.width || 0;
    const ih = picture.naturalHeight || picture.videoHeight || picture.height || 0;
    if (!(iw > 0 && ih > 0)) return null;

    const k = Math.min(1, MAX_PICTURE / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * k));
    const h = Math.max(1, Math.round(ih * k));

    try {
        const canvas = createCanvas(w, h);
        const ctx = canvas?.getContext('2d');
        if (!ctx) return null;

        ctx.drawImage(picture, 0, 0, w, h);

        if (/^data:image\/jpe?g[;,]|\.jpe?g(?:[?#]|$)/i.test(src)) {
            const jpeg = await jpegBytes(canvas);
            if (jpeg) return doc.image({ width: w, height: h, jpeg });
        }

        return doc.image({ width: w, height: h, rgba: ctx.getImageData(0, 0, w, h).data });
    } catch {
        return null;
    }
}


async function jpegBytes(canvas) {
    let blob = null;

    if (typeof canvas.convertToBlob === 'function') {
        blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    } else if (typeof canvas.toBlob === 'function') {
        blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    }

    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}


function createCanvas(width, height) {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
    return null;
}


function pause() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

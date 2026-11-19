/**
 * pdf.js (render) turns a built report into a PDF file, by drawing each page
 * with renderToCanvas and handing the pixels to the engine's toPDF.
 *
 * Pages are drawn one at a time and let go of before the next: an A4 page at
 * print resolution is tens of megabytes of pixels, and a phone holding thirty
 * of them at once is a phone that closes the app.
 */

import { renderToCanvas } from './canvas.js';
import { toPDF, pdfImage } from '../engine/pdf.js';


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

/**
 * text-metrics.js measures text the way the browser will actually draw it.
 *
 * Spec 4.3: text height comes from canvas 2D measureText, wrapping is greedy,
 * and measurements are cached by text + font because the same strings recur
 * constantly across a report.
 *
 * Outside a browser (tests, SSR) there is no canvas, so a documented
 * approximation stands in. The browser path is the authoritative one.
 */


/** CSS line-height multiplier - preview/styles.css draws text at this ratio */
export const LINE_HEIGHT_RATIO = 1.3;


/** measureText results, keyed by `${font}\u0000${text}` */
const cache = new Map();

/** guards against a cache that grows without bound on very large reports */
const CACHE_LIMIT = 10000;

let ctx;
let ctxResolved = false;


/**
 * One offscreen 2D context for the life of the module, or null when there is
 * no browser to ask.
 * @returns {CanvasRenderingContext2D|null}
 */
function context() {
    if (ctxResolved) return ctx;
    ctxResolved = true;

    try {
        if (typeof OffscreenCanvas !== 'undefined') {
            ctx = new OffscreenCanvas(1, 1).getContext('2d');
        } else if (typeof document !== 'undefined') {
            ctx = document.createElement('canvas').getContext('2d');
        } else {
            ctx = null;
        }
    } catch {
        ctx = null;
    }

    return ctx;
}


/**
 * Builds the CSS font shorthand measureText expects.
 * @param {object} style an item's style block
 * @returns {string}
 */
export function fontString(style = {}) {
    const fontStyle = style.fontStyle || 'normal';
    const fontWeight = style.fontWeight || 'normal';
    const fontSize = style.fontSize ?? 12;
    const fontFamily = style.fontFamily || 'Helvetica, Arial, sans-serif';
    return `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
}


/**
 * Width of a single line, in pixels.
 * @param {string} text
 * @param {object} style
 * @returns {number}
 */
export function measureText(text, style) {
    const str = String(text ?? '');
    if (str === '') return 0;

    const font = fontString(style);
    const key = `${font}\u0000${str}`;

    const hit = cache.get(key);
    if (hit !== undefined) return hit;

    const c = context();
    let width;

    if (c) {
        c.font = font;
        width = c.measureText(str).width;
    } else {
        width = approximateWidth(str, style);
    }

    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, width);

    return width;
}


/**
 * Fallback used only where no canvas exists. Character widths are expressed as
 * a fraction of the font size, coarse-grained by character class. It is close
 * enough to keep pagination sane in tests; it is not a substitute for the real
 * measurement a browser gives.
 * @param {string} str
 * @param {object} style
 * @returns {number}
 */
function approximateWidth(str, style = {}) {
    const size = style.fontSize ?? 12;
    const bold = String(style.fontWeight) === 'bold' || Number(style.fontWeight) >= 600;
    const mono = /mono|courier|consolas/i.test(style.fontFamily || '');

    let units = 0;

    for (const ch of str) {
        if (mono) { units += 0.6; continue; }
        if (ch === ' ') units += 0.26;
        else if (/[iljI.,:;'`|!\[\]()]/.test(ch)) units += 0.28;
        else if (/[ftr]/.test(ch)) units += 0.34;
        else if (/[A-Z]/.test(ch)) units += 0.68;
        else if (/[mwMW@]/.test(ch)) units += 0.88;
        else if (/[0-9]/.test(ch)) units += 0.56;
        else units += 0.52;
    }

    return units * size * (bold ? 1.06 : 1);
}


/**
 * Greedy word wrap: add words until the line would exceed {width}, then break.
 * A single word longer than the line is broken character by character rather
 * than allowed to overflow.
 * @param {string} text
 * @param {number} width available width in pixels
 * @param {object} style
 * @returns {string[]} the laid-out lines
 */
export function wrapLines(text, width, style) {
    const source = String(text ?? '');

    /** an author's explicit newlines are hard breaks */
    const paragraphs = source.split('\n');

    if (!(width > 0)) return paragraphs;

    const lines = [];

    for (const paragraph of paragraphs) {
        const words = paragraph.split(/(\s+)/).filter(w => w !== '');

        if (words.length === 0) {
            lines.push('');
            continue;
        }

        let line = '';

        for (const word of words) {
            const candidate = line + word;

            if (line !== '' && measureText(candidate, style) > width) {
                lines.push(line.trimEnd());
                line = word.trimStart();
            } else {
                line = candidate;
            }

            /**
             * whatever now sits on the line may be a single word wider than the
             * item. Break it rather than let it overflow the box silently.
             */
            while (measureText(line, style) > width && line.trim().length > 1) {
                let cut = line.length;
                while (cut > 1 && measureText(line.slice(0, cut), style) > width) cut--;
                if (cut >= line.length) break;
                lines.push(line.slice(0, cut));
                line = line.slice(cut);
            }
        }

        lines.push(line.trimEnd());
    }

    return lines;
}


/**
 * Rendered height of a text item: however many lines it wraps to, at the
 * line height the preview draws with.
 * @param {string} text
 * @param {number} width available width in pixels
 * @param {object} style
 * @returns {number}
 */
export function textHeight(text, width, style) {
    const lineHeight = Math.ceil((style?.fontSize ?? 12) * LINE_HEIGHT_RATIO);
    return wrapLines(text, width, style).length * lineHeight;
}


/** exposed for tests - measurements are cached for the life of the module */
export function clearMetricsCache() {
    cache.clear();
}

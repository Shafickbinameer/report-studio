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
 * A context with `font` already set on it, one each for the first few fonts.
 *
 * Setting a canvas's font parses it, every time - and a long table measures
 * in two or three fonts by turns (a cell's own, its bold header, the PDF's
 * built-in faces), so one shared context spent as long being told its font
 * as measuring. A handful of contexts that keep theirs costs nothing; past
 * that, the shared one is told each time, as before.
 * @param {string} font
 * @returns {CanvasRenderingContext2D|null}
 */
function contextFor(font) {
    const shared = context();
    if (!shared) return null;

    const kept = fontContexts.get(font);
    if (kept) return kept;

    let c = shared;

    if (fontContexts.size < FONT_CONTEXTS) {
        try {
            c = typeof OffscreenCanvas !== 'undefined'
                ? new OffscreenCanvas(1, 1).getContext('2d')
                : document.createElement('canvas').getContext('2d');
        } catch {
            c = null;
        }

        if (c) {
            watchFontLoads();
            c.font = font;
            fontContexts.set(font, c);
            return c;
        }

        c = shared;
    }

    c.font = font;
    return c;
}

/** contexts kept with a font set, by font */
const fontContexts = new Map();
const FONT_CONTEXTS = 16;

let watching = false;

/**
 * A canvas settles which face a font means when it is told the font. One
 * told while a web font was still on its way keeps the fallback after the
 * font arrives, where the shared context, told afresh each time, picked the
 * real one up - so the kept contexts go whenever fonts finish loading, and
 * are made again told the font as it now is.
 */
function watchFontLoads() {
    if (watching) return;
    watching = true;

    const faces = typeof document !== 'undefined' ? document.fonts
        : (typeof self !== 'undefined' ? self.fonts : undefined);

    faces?.addEventListener?.('loadingdone', () => fontContexts.clear());
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

    const c = contextFor(font);
    let width;

    if (c) {
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


/** grapheme clusters, where the platform can say; code points where it cannot */
let segmenter;

/**
 * A string as the characters a reader sees.
 *
 * A word is only ever cut between these. Cutting between UTF-16 code units, as
 * this used to, split a Tamil or Malayalam conjunct - or a vowel sign from the
 * consonant it belongs to - and printed half a letter at the end of one line
 * and a stray mark at the start of the next. An emoji fared no better.
 *
 * @param {string} str
 * @returns {string[]}
 */
export function graphemes(str) {
    if (segmenter === undefined) {
        try {
            segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
                ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
                : null;
        } catch {
            segmenter = null;
        }
    }

    if (segmenter) return Array.from(segmenter.segment(str), part => part.segment);

    return Array.from(str);
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
            while (measureText(line, style) > width && graphemes(line.trim()).length > 1) {
                const parts = graphemes(line);
                let cut = parts.length;
                while (cut > 1 && measureText(parts.slice(0, cut).join(''), style) > width) cut--;
                if (cut >= parts.length) break;
                lines.push(parts.slice(0, cut).join(''));
                line = parts.slice(cut).join('');
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
    /** a font that has since loaded measures differently in a context of its own too */
    fontContexts.clear();
}


/** the overflow modes a text item may ask for; anything else wraps and grows */
export const TEXT_OVERFLOWS = ['wrap', 'shrink', 'ellipsis'];

/** the smallest a shrinking text goes, as a share of its own size, and in pixels */
const SHRINK_FLOOR = 0.5;
const SHRINK_MIN_PX = 6;


/**
 * Fits text into a fixed box instead of growing the box round it.
 *
 * A label is a fixed size: a product name that wraps onto a third line cannot
 * make the sticker taller, and a text item that grows pushes the page past the
 * label and onto a second one. So an item can ask for one of:
 *
 *   'shrink'   - the font is made smaller, half a pixel at a time, until every
 *                line fits the height and no word has to be cut to fit the
 *                width; past half its size it stops shrinking and cuts instead
 *   'ellipsis' - the font stays, and the text is cut after the last line that
 *                fits, ending in "…"
 *
 * The answer is the lines to draw and the size to draw them at, so both
 * renderers print exactly what was fitted rather than wrapping again.
 *
 * @param {string} text
 * @param {number} width
 * @param {number} height
 * @param {object} style
 * @param {'shrink'|'ellipsis'} mode
 * @returns {{fontSize: number, lines: string[], truncated: boolean}}
 */
export function fitText(text, width, height, style, mode) {
    const source = String(text ?? '');
    const declared = Number(style?.fontSize) > 0 ? Number(style.fontSize) : 12;
    const lineHeight = (size) => Math.ceil(size * LINE_HEIGHT_RATIO);

    let size = declared;

    if (mode === 'shrink') {
        const floor = Math.max(SHRINK_MIN_PX, declared * SHRINK_FLOOR);

        for (; size >= floor; size -= 0.5) {
            const sized = { ...style, fontSize: size };
            const lines = wrapLines(source, width, sized);

            if (lines.length * lineHeight(size) <= height && wordsFit(source, width, sized)) {
                return { fontSize: size, lines, truncated: false };
            }
        }

        size = Math.max(floor, Math.min(declared, size + 0.5));
    }

    const sized = { ...style, fontSize: size };
    const all = wrapLines(source, width, sized);
    const room = Math.max(1, Math.floor(height / lineHeight(size)));

    if (all.length <= room) return { fontSize: size, lines: all, truncated: false };

    const lines = all.slice(0, room);
    lines[room - 1] = withEllipsis(lines[room - 1], width, sized);

    return { fontSize: size, lines, truncated: true };
}


/** whether every word of the text fits the width whole, at this size */
function wordsFit(text, width, style) {
    if (!(width > 0)) return true;
    return text.split(/\s+/).every(word => word === '' || measureText(word, style) <= width);
}


/**
 * A line with "…" on the end, losing characters from the end until the two
 * fit. Cut between graphemes, so a conjunct is never left half drawn.
 * @param {string} line
 * @param {number} width
 * @param {object} style
 * @returns {string}
 */
export function withEllipsis(line, width, style) {
    const parts = graphemes(String(line ?? '').trimEnd());
    let n = parts.length;

    while (n > 0 && measureText(parts.slice(0, n).join('').trimEnd() + '…', style) > width) n--;

    return n > 0 ? parts.slice(0, n).join('').trimEnd() + '…' : '…';
}

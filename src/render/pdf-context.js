/**
 * pdf-context.js is a canvas 2D context that writes PDF instead of pixels.
 *
 * canvas.js's drawPage already knows how to draw a built page - every rule of
 * report.css, every number the engine measured. Handing it this in place of a
 * real context makes a vector PDF from that same drawing, so the PDF is not a
 * third renderer to keep in step with the other two: it is the canvas one,
 * recorded.
 *
 * Only what drawPage calls is here: paths, rectangles, clipping, the CSS
 * colours, dashes, text and pictures, with save and restore around them. No
 * transforms - drawPage never sets one; the page's own (pixels to points, and
 * PDF's upward y turned down) is applied once at the top of the page.
 *
 * Text is set in the PDF's built-in Helvetica, Times or Courier where the font
 * asks for one of those and every character is one they have (WinAnsi: Latin
 * and its punctuation). What they lack - a rupee sign, a Tamil or Malayalam
 * word - is drawn by the browser onto a small canvas and placed in the line as
 * a picture, because only the browser can shape it; the rest of the line stays
 * text. Each distinct stretch is drawn once per document however often it
 * recurs, so the ₹ in front of every amount is one picture. A line in any other
 * family (a web font) is a picture as a whole.
 */

import { measureText, graphemes } from '../engine/text-metrics.js';


/** device pixels per page pixel a line of text is drawn at when it has to be a picture: 288 dpi */
export const TEXT_RASTER_SCALE = 3;

/** 96 layout pixels to the inch, 72 points */
const PT = 0.75;

/** the font every assignment starts from, as canvas.js's setFont does */
const SAFE_FONT = '12px sans-serif';


/**
 * Families the built-in fonts stand in for, by the first name in a stack. A
 * generic `monospace` is not one: browsers draw it in Consolas or Menlo, whose
 * letters are narrower than Courier's, and the line was wrapped against those.
 */
const FAMILIES = {
    sans: ['helvetica', 'arial', 'sans-serif', 'liberation sans', 'arimo', 'nimbus sans', 'nimbus sans l'],
    serif: ['times', 'times new roman', 'serif', 'liberation serif', 'tinos', 'nimbus roman'],
    mono: ['courier', 'courier new', 'liberation mono', 'cousine', 'nimbus mono ps']
};

/** the faces with the built-in fonts' own widths, to measure what the PDF will draw */
const METRIC_STACKS = {
    sans: 'Arial, Helvetica, "Liberation Sans", Arimo, sans-serif',
    serif: '"Times New Roman", Times, "Liberation Serif", Tinos, serif',
    mono: '"Courier New", Courier, "Liberation Mono", Cousine, monospace'
};

const BASE_FONTS = {
    sans: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
    serif: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
    mono: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique']
};

/** WinAnsi's 0x80 to 0x9F, which are not Latin-1's */
const WIN_ANSI = new Map([
    [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86],
    [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
    [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95],
    [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
    [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f]
]);

const CAPS = { butt: 0, round: 1, square: 2 };


export class PdfContext {
    /**
     * @param {import('../engine/pdf-document.js').PdfDocument} doc
     * @param {object} page
     * @param {number} page.width the page in layout pixels
     * @param {number} page.height
     * @param {object} [options]
     * @param {Map<object, string>} [options.pictures] each loaded picture, as
     *   the name doc.image gave it
     * @param {number} [options.textScale] see TEXT_RASTER_SCALE
     */
    constructor(doc, { width, height }, options = {}) {
        this.doc = doc;
        this.width = width;
        this.height = height;
        this.canvas = { width, height };

        this.pictures = options.pictures ?? new Map();
        this.textScale = Number(options.textScale) > 0 ? Number(options.textScale) : TEXT_RASTER_SCALE;

        /** what the drawing has asked for, as a canvas keeps it */
        this.state = {
            fill: { css: '#000000', rgba: [0, 0, 0, 1] },
            stroke: { css: '#000000', rgba: [0, 0, 0, 1] },
            lineWidth: 1,
            lineCap: 'butt',
            dash: [],
            font: parseFont(SAFE_FONT),
            textAlign: 'start',
            textBaseline: 'alphabetic'
        };

        /** what the PDF's graphics state has been told - set only when it differs */
        this.pdf = { fill: '0 0 0', stroke: '0 0 0', ca: 1, CA: 1, w: 1, J: 0, d: '[] 0', font: null };

        this.stack = [];
        this.path = [];
        this.point = null;
        this.start = null;

        /** pixels to points, and y turned to run down the page as a canvas's does */
        this.ops = [`${PT} 0 0 ${-PT} 0 ${n(height * PT)} cm`];
    }

    /** the page's content stream */
    content() {
        return this.ops.join('\n');
    }

    /* ------------------------------------------------------------ state */

    save() {
        this.stack.push({ state: { ...this.state, dash: [...this.state.dash] }, pdf: { ...this.pdf } });
        this.ops.push('q');
    }

    restore() {
        const saved = this.stack.pop();
        if (!saved) return;

        this.state = saved.state;
        this.pdf = saved.pdf;
        this.ops.push('Q');
    }

    get fillStyle() { return this.state.fill.css; }
    set fillStyle(value) {
        const rgba = parseColor(value);
        if (rgba) this.state.fill = { css: String(value), rgba };
    }

    get strokeStyle() { return this.state.stroke.css; }
    set strokeStyle(value) {
        const rgba = parseColor(value);
        if (rgba) this.state.stroke = { css: String(value), rgba };
    }

    get lineWidth() { return this.state.lineWidth; }
    set lineWidth(value) {
        const w = Number(value);
        if (Number.isFinite(w) && w > 0) this.state.lineWidth = w;
    }

    get lineCap() { return this.state.lineCap; }
    set lineCap(value) {
        if (value in CAPS) this.state.lineCap = value;
    }

    setLineDash(segments) {
        const list = Array.from(segments ?? [], Number);
        if (list.some(v => !Number.isFinite(v) || v < 0)) return;
        this.state.dash = list.length % 2 ? [...list, ...list] : list;
    }

    getLineDash() { return [...this.state.dash]; }

    get font() { return this.state.font.css; }
    set font(value) {
        const font = parseFont(value);
        if (font) this.state.font = font;
    }

    get textAlign() { return this.state.textAlign; }
    set textAlign(value) { this.state.textAlign = String(value); }

    get textBaseline() { return this.state.textBaseline; }
    set textBaseline(value) { this.state.textBaseline = String(value); }

    /* ------------------------------------------------------------- paths */

    beginPath() {
        this.path = [];
        this.point = null;
        this.start = null;
    }

    moveTo(x, y) {
        this.path.push(`${n(x)} ${n(y)} m`);
        this.point = this.start = [x, y];
    }

    lineTo(x, y) {
        if (!this.point) return this.moveTo(x, y);
        this.path.push(`${n(x)} ${n(y)} l`);
        this.point = [x, y];
    }

    bezierCurveTo(x1, y1, x2, y2, x, y) {
        if (!this.point) this.moveTo(x1, y1);
        this.path.push(`${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(x)} ${n(y)} c`);
        this.point = [x, y];
    }

    rect(x, y, w, h) {
        this.path.push(`${n(x)} ${n(y)} ${n(w)} ${n(h)} re`);
        this.point = this.start = [x, y];
    }

    closePath() {
        if (!this.point) return;
        this.path.push('h');
        this.point = this.start;
    }

    /**
     * The canvas arcTo: a line to where a circle of radius r touches both
     * lines through (x1, y1), then the arc between the two touching points as
     * one cubic curve - exact enough for anything up to a half turn, and a
     * rounded corner is a quarter.
     */
    arcTo(x1, y1, x2, y2, r) {
        if (!this.point) this.moveTo(x1, y1);

        const [x0, y0] = this.point;
        const ax = x0 - x1, ay = y0 - y1;
        const bx = x2 - x1, by = y2 - y1;
        const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
        const cross = ax * by - ay * bx;

        if (!(r > 0) || la === 0 || lb === 0 || Math.abs(cross) < 1e-9) {
            this.lineTo(x1, y1);
            return;
        }

        const ux = ax / la, uy = ay / la;
        const vx = bx / lb, vy = by / lb;

        /** the angle at the corner, and the arc's sweep, which is what is left of a half turn */
        const corner = Math.acos(Math.min(1, Math.max(-1, ux * vx + uy * vy)));
        const reach = r / Math.tan(corner / 2);
        const sweep = Math.PI - corner;

        const t1x = x1 + ux * reach, t1y = y1 + uy * reach;
        const t2x = x1 + vx * reach, t2y = y1 + vy * reach;
        const k = (4 / 3) * Math.tan(sweep / 4) * r;

        this.lineTo(t1x, t1y);
        this.bezierCurveTo(t1x - ux * k, t1y - uy * k, t2x - vx * k, t2y - vy * k, t2x, t2y);
    }

    /* ---------------------------------------------------------- painting */

    fill(rule) {
        if (this.path.length === 0 || this.state.fill.rgba[3] <= 0) return;
        this.setFill();
        this.ops.push(`${this.path.join(' ')} ${rule === 'evenodd' ? 'f*' : 'f'}`);
    }

    stroke() {
        if (this.path.length === 0 || this.state.stroke.rgba[3] <= 0) return;
        this.setStroke();
        this.ops.push(`${this.path.join(' ')} S`);
    }

    clip(rule) {
        const path = this.path.length ? this.path.join(' ') : '0 0 0 0 re';
        this.ops.push(`${path} ${rule === 'evenodd' ? 'W*' : 'W'} n`);
    }

    fillRect(x, y, w, h) {
        if (this.state.fill.rgba[3] <= 0) return;
        this.setFill();
        this.ops.push(`${n(x)} ${n(y)} ${n(w)} ${n(h)} re f`);
    }

    strokeRect(x, y, w, h) {
        if (this.state.stroke.rgba[3] <= 0) return;
        this.setStroke();
        this.ops.push(`${n(x)} ${n(y)} ${n(w)} ${n(h)} re S`);
    }

    /** paper cannot be unpainted; nothing drawPage draws asks for it */
    clearRect() { }

    /* -------------------------------------------------------------- text */

    /**
     * What a canvas would measure, for drawPage to find the baseline with:
     * the browser's own answer where there is a browser, the engine's
     * approximation where there is not.
     */
    measureText(text) {
        const scratch = scratchContext();

        if (scratch) {
            scratch.font = SAFE_FONT;
            scratch.font = this.state.font.css;
            return scratch.measureText(String(text ?? ''));
        }

        return { width: measureText(String(text ?? ''), this.state.font.style) };
    }

    /**
     * A line of text. In a built-in font's family, every stretch of it the
     * font can show is text, and each stretch it cannot - a rupee sign, a
     * Tamil word - is a picture the browser drew, set in its place on the
     * line. So "₹ 1,250.00" is one small picture of ₹, shared by every amount
     * in the document, followed by text. In any other family the whole line is
     * a picture.
     */
    fillText(text, x, y) {
        const str = String(text ?? '').replace(/[\u0000-\u001f]/g, ' ');
        if (str === '' || this.state.fill.rgba[3] <= 0) return;

        const kind = familyKind(this.state.font.family);
        const baseline = y + this.baselineShift();
        const browser = scratchContext() !== null;

        if (kind) {
            const bytes = winAnsi(str);

            if (bytes !== null) {
                this.textRun(bytes, kind, this.alignX(x, () => this.textWidth(str, kind)), baseline);
                return;
            }

            if (browser) {
                const runs = splitRuns(str).map(run => {
                    if (run.bytes !== null) return { ...run, width: this.textWidth(run.text, kind) };
                    const shot = this.textShot(run.text);
                    return { ...run, shot, width: shot.advance };
                });

                let at = this.alignX(x, () => runs.reduce((sum, run) => sum + run.width, 0));

                for (const run of runs) {
                    if (run.shot) this.placeShot(run.shot, at, baseline);
                    else this.textRun(run.bytes, kind, at, baseline);
                    at += run.width;
                }
                return;
            }
        } else if (browser) {
            const shot = this.textShot(str);
            this.placeShot(shot, this.alignX(x, () => shot.advance), baseline);
            return;
        }

        /**
         * No browser to draw it: the built-in font, with what it cannot show
         * as question marks, rather than a line missing from the page.
         */
        warnOnce('A PDF made outside a browser cannot draw text the built-in fonts lack; it is replaced with "?".');
        const plain = Array.from(str, ch => (winAnsi(ch) === null ? '?' : ch)).join('');
        const font = kind ?? 'sans';
        this.textRun(winAnsi(plain), font, this.alignX(x, () => this.textWidth(plain, font)), baseline);
    }

    /** a stretch of text in a built-in font, its left end at `left` */
    textRun(bytes, kind, left, baseline) {
        const font = this.state.font;
        const name = this.doc.font(BASE_FONTS[kind][(font.bold ? 1 : 0) + (font.italic ? 2 : 0)]);

        this.setFill();

        /** the text font is graphics state, kept from one BT to the next */
        const tf = `/${name} ${n(font.size)}`;
        const set = this.pdf.font === tf ? '' : `${tf} Tf `;
        this.pdf.font = tf;

        this.ops.push(`BT ${set}1 0 0 -1 ${n(left)} ${n(baseline)} Tm (${escapeBytes(bytes)}) Tj ET`);
    }

    /** measured in faces with the built-in font's widths, which is what the reader will draw */
    textWidth(str, kind) {
        return measureText(str, { ...this.state.font.style, fontFamily: METRIC_STACKS[kind] });
    }

    /**
     * A stretch of text as a picture the browser drew: its letters in the
     * fill colour, the rest transparent, at TEXT_RASTER_SCALE. Drawn and
     * embedded once a document for each text, font and colour; `name` is
     * null when it left no ink (spaces, or a mark with no glyph).
     */
    textShot(str) {
        const font = this.state.font;
        const [r, g, b] = this.state.fill.rgba;
        const key = `text\u0000${font.css}\u0000${r},${g},${b}\u0000${this.textScale}\u0000${str}`;

        let shot = this.doc.cache.get(key);
        if (shot) return shot;

        const drawn = drawLine(scratchContext(), str, font, [r, g, b], this.textScale);

        shot = { ...drawn, name: null };
        if (drawn.data) {
            shot.name = this.doc.image({ width: drawn.pixelWidth, height: drawn.pixelHeight, rgba: drawn.data, color: [r, g, b] });
            delete shot.data;
        }

        this.doc.cache.set(key, shot);
        return shot;
    }

    /** a textShot with its text's left end at `left` on the baseline */
    placeShot(shot, left, baseline) {
        if (!shot.name) return;

        const x = left - shot.left;
        const top = baseline - shot.ascent;

        this.setAlpha('ca', this.state.fill.rgba[3]);
        this.ops.push(`q ${n(shot.width)} 0 0 ${n(-shot.height)} ${n(x)} ${n(top + shot.height)} cm /${shot.name} Do Q`);
    }

    /** where a text starts for its alignment; `width` is asked for only when the alignment needs it */
    alignX(x, width) {
        const align = this.state.textAlign;
        if (align === 'right' || align === 'end') return x - width();
        if (align === 'center') return x - width() / 2;
        return x;
    }

    /** how far the alphabetic baseline is below the y a text was drawn at */
    baselineShift() {
        const where = this.state.textBaseline;
        if (where === 'alphabetic' || where === 'ideographic') return 0;

        const m = this.measureText('Hg');
        const size = this.state.font.size;
        const ascent = Number.isFinite(m.fontBoundingBoxAscent) ? m.fontBoundingBoxAscent : size * 0.9;
        const descent = Number.isFinite(m.fontBoundingBoxDescent) ? m.fontBoundingBoxDescent : size * 0.25;

        if (where === 'top' || where === 'hanging') return ascent;
        if (where === 'middle') return (ascent - descent) / 2;
        if (where === 'bottom') return -descent;
        return 0;
    }

    /* ---------------------------------------------------------- pictures */

    /**
     * A picture that was embedded before the page was drawn (see the
     * `pictures` option); one that was not - it failed to load, or a canvas
     * tainted by another site would not give up its pixels - is left out, as
     * an empty frame, which is what the HTML shows for it too.
     */
    drawImage(picture, ...args) {
        const name = this.pictures.get(picture);
        if (!name) return;

        const iw = picture.naturalWidth || picture.videoWidth || picture.width || 0;
        const ih = picture.naturalHeight || picture.videoHeight || picture.height || 0;

        let dx, dy, dw, dh;
        let source = null;

        if (args.length >= 8) {
            const [sx, sy, sw, sh] = args;
            [dx, dy, dw, dh] = args.slice(4);
            source = { sx, sy, sw, sh };
        } else if (args.length >= 4) {
            [dx, dy, dw, dh] = args;
        } else {
            [dx, dy] = args;
            dw = iw;
            dh = ih;
        }

        if (!(dw > 0 && dh > 0)) return;

        this.setAlpha('ca', 1);

        if (!source) {
            this.ops.push(`q ${n(dw)} 0 0 ${n(-dh)} ${n(dx)} ${n(dy + dh)} cm /${name} Do Q`);
            return;
        }

        /** a part of the picture: the whole of it scaled so that part lands on the box, clipped to the box */
        const kx = dw / source.sw;
        const ky = dh / source.sh;
        const fx = dx - source.sx * kx;
        const fy = dy - source.sy * ky;
        const fw = iw * kx;
        const fh = ih * ky;

        this.ops.push(`q ${n(dx)} ${n(dy)} ${n(dw)} ${n(dh)} re W n ${n(fw)} 0 0 ${n(-fh)} ${n(fx)} ${n(fy + fh)} cm /${name} Do Q`);
    }

    /* ------------------------------------------------- the PDF's own state */

    setFill() {
        const [r, g, b, a] = this.state.fill.rgba;
        const color = `${c(r)} ${c(g)} ${c(b)}`;

        if (this.pdf.fill !== color) {
            this.ops.push(`${color} rg`);
            this.pdf.fill = color;
        }
        this.setAlpha('ca', a);
    }

    setStroke() {
        const [r, g, b, a] = this.state.stroke.rgba;
        const color = `${c(r)} ${c(g)} ${c(b)}`;

        if (this.pdf.stroke !== color) {
            this.ops.push(`${color} RG`);
            this.pdf.stroke = color;
        }
        this.setAlpha('CA', a);

        const w = this.state.lineWidth;
        if (this.pdf.w !== w) {
            this.ops.push(`${n(w)} w`);
            this.pdf.w = w;
        }

        const cap = CAPS[this.state.lineCap] ?? 0;
        if (this.pdf.J !== cap) {
            this.ops.push(`${cap} J`);
            this.pdf.J = cap;
        }

        const dash = `[${this.state.dash.map(n).join(' ')}] 0`;
        if (this.pdf.d !== dash) {
            this.ops.push(`${dash} d`);
            this.pdf.d = dash;
        }
    }

    setAlpha(key, alpha) {
        const value = Math.round(alpha * 1000) / 1000;
        if (this.pdf[key] === value) return;

        this.ops.push(`/${this.doc.alpha(key, value)} gs`);
        this.pdf[key] = value;
    }
}


/* ------------------------------------------------------------------- text */

/**
 * A line drawn by the browser onto the scratch canvas, at `scale`, with room
 * for whatever the glyphs reach past the font's own box - a Tamil vowel sign
 * can, and an italic's tail.
 */
function drawLine(scratch, str, font, rgb, scale) {
    scratch.font = SAFE_FONT;
    scratch.font = font.css;

    const m = scratch.measureText(str);
    const size = font.size;

    const advance = m.width;
    const ascent = Math.max(finite(m.fontBoundingBoxAscent, size * 0.9), finite(m.actualBoundingBoxAscent, 0)) + 1;
    const descent = Math.max(finite(m.fontBoundingBoxDescent, size * 0.25), finite(m.actualBoundingBoxDescent, 0)) + 1;
    const left = Math.max(0, finite(m.actualBoundingBoxLeft, 0)) + 1;
    const right = Math.max(advance, finite(m.actualBoundingBoxRight, advance)) + 1;

    const width = left + right;
    const height = ascent + descent;

    const pixelWidth = Math.ceil(width * scale);
    const pixelHeight = Math.ceil(height * scale);

    const shot = { data: null, pixelWidth, pixelHeight, width: pixelWidth / scale, height: pixelHeight / scale, advance, ascent, left };
    if (!(pixelWidth > 0 && pixelHeight > 0)) return shot;

    const canvas = scratch.canvas;
    canvas.width = Math.max(canvas.width, pixelWidth);
    canvas.height = Math.max(canvas.height, pixelHeight);

    scratch.setTransform(1, 0, 0, 1, 0, 0);
    scratch.clearRect(0, 0, pixelWidth, pixelHeight);
    scratch.setTransform(scale, 0, 0, scale, 0, 0);

    /** resizing the canvas forgets the font, so it is set again */
    scratch.font = SAFE_FONT;
    scratch.font = font.css;
    scratch.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    scratch.textAlign = 'left';
    scratch.textBaseline = 'alphabetic';
    scratch.fillText(str, left, ascent);
    scratch.setTransform(1, 0, 0, 1, 0, 0);

    const data = scratch.getImageData(0, 0, pixelWidth, pixelHeight).data;

    for (let p = 3; p < data.length; p += 4) {
        if (data[p] !== 0) {
            shot.data = data;
            break;
        }
    }

    return shot;
}


/**
 * A line cut where it turns from what the built-in fonts can show to what
 * they cannot, and back - between characters as a reader sees them, so an
 * accent stays with its letter and a vowel sign with its consonant.
 *
 * @returns {Array<{text: string, bytes: string|null}>} bytes is the WinAnsi
 *   of a stretch the fonts can show, null for one they cannot
 */
export function splitRuns(str) {
    const runs = [];

    for (const ch of graphemes(str)) {
        const bytes = winAnsi(ch);
        const last = runs.at(-1);

        if (last && (last.bytes === null) === (bytes === null)) {
            last.text += ch;
            if (bytes !== null) last.bytes += bytes;
        } else {
            runs.push({ text: ch, bytes });
        }
    }

    return runs;
}


/**
 * A text in WinAnsi, the built-in fonts' encoding, as a string of byte-sized
 * characters - or null when it has a character they do not.
 */
export function winAnsi(str) {
    let out = '';

    for (const ch of str) {
        const code = ch.codePointAt(0);

        if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) out += String.fromCharCode(code);
        else if (WIN_ANSI.has(code)) out += String.fromCharCode(WIN_ANSI.get(code));
        else return null;
    }

    return out;
}


function escapeBytes(bytes) {
    return bytes.replace(/[\\()]/g, '\\$&');
}


/**
 * A CSS font shorthand as fontString writes it - style, weight, size in
 * pixels, family - or null when it is not one, which a canvas would ignore.
 */
function parseFont(value) {
    const key = String(value ?? '');
    if (fonts.has(key)) return fonts.get(key);

    if (fonts.size >= 256) fonts.clear();
    const font = readFont(key);
    fonts.set(key, font);

    return font;
}

/** parsed fonts by their CSS, since a table sets the same few once a cell */
const fonts = new Map();

function readFont(value) {
    const m = /^\s*(?:(normal|italic|oblique)\s+)?(?:(normal|bold|bolder|lighter|\d{1,4})\s+)?(\d*\.?\d+)px(?:\s*\/\s*\S+)?\s+(.+?)\s*$/i
        .exec(String(value ?? ''));
    if (!m) return null;

    const size = Number(m[3]);
    if (!(size > 0)) return null;

    const fontStyle = (m[1] || 'normal').toLowerCase();
    const fontWeight = (m[2] || 'normal').toLowerCase();
    const fontFamily = m[4];

    return Object.freeze({
        css: String(value),
        size,
        family: fontFamily,
        bold: fontWeight === 'bold' || fontWeight === 'bolder' || Number(fontWeight) >= 600,
        italic: fontStyle !== 'normal',
        style: Object.freeze({ fontStyle, fontWeight, fontSize: size, fontFamily })
    });
}


/** which built-in font a family stack is, by its first name; null for any other */
function familyKind(stack) {
    const key = String(stack ?? '');
    if (!kinds.has(key)) kinds.set(key, readFamilyKind(key));
    return kinds.get(key);
}

const kinds = new Map();

function readFamilyKind(stack) {
    const first = String(stack ?? '').split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();

    for (const [kind, names] of Object.entries(FAMILIES)) {
        if (names.includes(first)) return kind;
    }
    return null;
}


/* ----------------------------------------------------------------- colour */

const colors = new Map();

/**
 * A CSS colour as [r, g, b, alpha] - or null when it is not one, which a
 * canvas would ignore and keep the last. The common spellings are read here;
 * anything else (a name, hsl, a newer colour space) is asked of the browser.
 */
export function parseColor(value) {
    const key = String(value ?? '').trim().toLowerCase();
    if (colors.has(key)) return colors.get(key);

    const rgba = readColor(key) ?? browserColor(key);
    if (colors.size > 1000) colors.clear();
    colors.set(key, rgba);
    return rgba;
}

function readColor(s) {
    if (s === 'transparent') return [0, 0, 0, 0];
    if (s === 'black') return [0, 0, 0, 1];
    if (s === 'white') return [255, 255, 255, 1];

    let m = /^#([0-9a-f]{3,8})$/.exec(s);
    if (m) {
        const hex = m[1];
        if (hex.length === 3 || hex.length === 4) {
            const v = [...hex].map(h => parseInt(h + h, 16));
            return [v[0], v[1], v[2], hex.length === 4 ? v[3] / 255 : 1];
        }
        if (hex.length === 6 || hex.length === 8) {
            const v = hex.match(/../g).map(h => parseInt(h, 16));
            return [v[0], v[1], v[2], hex.length === 8 ? v[3] / 255 : 1];
        }
        return null;
    }

    m = /^rgba?\(([^)]*)\)$/.exec(s);
    if (m) {
        const parts = m[1].split(/[\s,/]+/).filter(Boolean);
        if (parts.length !== 3 && parts.length !== 4) return null;

        const channel = (p) => p.endsWith('%') ? Number(p.slice(0, -1)) * 2.55 : Number(p);
        const rgb = parts.slice(0, 3).map(channel);
        const alpha = parts[3] === undefined ? 1
            : parts[3].endsWith('%') ? Number(parts[3].slice(0, -1)) / 100 : Number(parts[3]);

        if (![...rgb, alpha].every(Number.isFinite)) return null;
        return [...rgb.map(v => Math.round(Math.min(Math.max(v, 0), 255))), Math.min(Math.max(alpha, 0), 1)];
    }

    return null;
}

/** the browser's reading of a colour: painted onto one pixel and read back */
function browserColor(s) {
    const scratch = scratchContext();
    if (!scratch || s === '') return null;

    /** two different colours first: if the value is ignored, the two survive and differ */
    scratch.fillStyle = '#000000';
    scratch.fillStyle = s;
    const one = scratch.fillStyle;
    scratch.fillStyle = '#ffffff';
    scratch.fillStyle = s;
    if (scratch.fillStyle !== one) return null;

    scratch.setTransform(1, 0, 0, 1, 0, 0);
    scratch.clearRect(0, 0, 1, 1);
    scratch.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = scratch.getImageData(0, 0, 1, 1).data;

    return a === 0 ? [0, 0, 0, 0] : [r, g, b, a / 255];
}


/* ---------------------------------------------------------------- helpers */

let scratch;
let scratchResolved = false;

/** one small canvas to measure, read colours and draw lines of text on; null outside a browser */
function scratchContext() {
    if (scratchResolved) return scratch;
    scratchResolved = true;

    try {
        if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
            scratch = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        } else if (typeof OffscreenCanvas !== 'undefined') {
            scratch = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
        }
    } catch {
        scratch = null;
    }

    scratch = scratch ?? null;
    return scratch;
}

const warned = new Set();
function warnOnce(message) {
    if (warned.has(message)) return;
    warned.add(message);
    console.warn(message);
}

function finite(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

/** a coordinate: at most three decimals, never an exponent */
function n(value) {
    const r = Math.round(Number(value) * 1000) / 1000;
    return Object.is(r, -0) || !Number.isFinite(r) ? 0 : r;
}

/** a colour channel, 0 to 1 */
function c(value) {
    return Math.round((Number(value) / 255) * 10000) / 10000;
}

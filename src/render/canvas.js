/**
 * canvas.js draws a built page onto a 2D canvas.
 *
 * render.js turns a page list into markup for a browser to lay out. This draws
 * the same page list straight onto pixels instead, for the places markup cannot
 * go: a thermal printer that takes a bitmap, an image shared to a phone, a PDF
 * made of page images, a thumbnail.
 *
 * It is a second drawing path, and items.js warns what that costs - two paths
 * drift. So this one reads report.css rather than inventing a look of its own:
 * every rule that file applies to a page is applied here, with the same
 * defaults, and every number the engine measured with (the wrap, the line
 * height, the cell padding, the column widths) is taken from the engine rather
 * than worked out again. Where the browser would wrap, this calls the same
 * wrapLines that measure.js paginated against.
 *
 * Coordinates are page pixels (the layout's own units); `scale` turns them into
 * device pixels, so a 50 x 25 mm label can be drawn at 203 dpi for a thermal
 * printer or at 2x for a sharp thumbnail from the same page.
 */

import { px, imageSrc, IMAGE_FITS, LINE_STYLES, RULE_STYLES, maxRuleWidth, fragmentBands } from './items.js';
import { formatValue } from '../engine/format.js';
import { cellHighlight } from '../engine/highlight.js';
import { wrapLines, measureText, fontString, LINE_HEIGHT_RATIO } from '../engine/text-metrics.js';
import { columnWidths, CELL_PADDING } from '../engine/measure.js';


/**
 * What report.css falls back to when the host defines none of its variables.
 * A canvas has no stylesheet to inherit from, so these are the whole answer
 * unless the caller passes a theme.
 */
export const CANVAS_DEFAULTS = Object.freeze({
    /** the paper; null leaves the canvas transparent */
    background: '#ffffff',
    /** `color: inherit` with nothing to inherit from */
    color: '#000000',
    /** var(--border, #cdd4db): a table's grid when it names no colour */
    ruleColor: '#cdd4db',
    /** var(--surface-muted, #f1f3f5): a table's header row when it names no fill */
    headerBackground: '#f1f3f5'
});

/** report.css: .page th, .page td { font-family: var(--rs-cell-family, ...) } */
const CELL_FAMILY = 'Helvetica, Arial, sans-serif';

/** the font every assignment starts from, so an invalid one never inherits the last item's */
const SAFE_FONT = '12px sans-serif';

/** the order render.js draws bands in; a type it does not know goes last */
const ORDER = ['pageHeader', 'reportHeader', 'detail', 'reportFooter', 'pageFooter'];


/**
 * Draws one page of a built report onto a canvas, and resolves to the canvas.
 *
 * Asynchronous because pictures and fonts are: every image on the page is
 * loaded, and every font the page uses is asked for, before anything is drawn.
 * A font that is still downloading when text is drawn is a label printed in
 * the fallback face, and on a label that is the difference between a name that
 * fits and one that runs off the edge.
 *
 * @param {object} report a buildPages result
 * @param {object} [options]
 * @param {number} [options.page] which page, 0-based
 * @param {number} [options.scale] device pixels per page pixel
 * @param {HTMLCanvasElement|OffscreenCanvas} [options.canvas] draw into this one
 *   rather than a new canvas; it is resized to the page
 * @param {(src: string) => Promise<CanvasImageSource|null>} [options.loadImage]
 *   how a picture is fetched; the default uses Image, then createImageBitmap
 * @param {boolean} [options.waitForFonts] ask document.fonts for every face the
 *   page uses first (default true, where there is a document.fonts)
 * @param {object} [options.theme] colours for what report.css leaves to variables
 * @returns {Promise<HTMLCanvasElement|OffscreenCanvas>}
 */
export async function renderToCanvas(report, options = {}) {
    const index = options.page ?? 0;
    const page = pageAt(report, index);

    const scale = Number(options.scale) > 0 ? Number(options.scale) : 1;
    const width = Math.max(1, Math.ceil(px(report.page?.width) * scale));
    const height = Math.max(1, Math.ceil(px(report.page?.height) * scale));

    const canvas = options.canvas ?? createCanvas(width, height);
    canvas.width = width;
    canvas.height = height;

    const load = options.loadImage ?? loadImage;
    const images = new Map();

    await Promise.all([...pageImageSources(page)].map(async (src) => {
        try {
            const picture = await load(src);
            if (picture) images.set(src, picture);
        } catch {
            /** a picture that will not load prints as an empty frame, as it does in HTML */
        }
    }));

    if (options.waitForFonts !== false) await loadFonts(pageFonts(page));

    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    drawPage(ctx, report, index, { images, theme: options.theme });

    return canvas;
}


/**
 * Draws one page of a built report into a 2D context, synchronously, in page
 * pixels - whatever transform the context already has is kept, so the caller
 * decides the scale and where on a larger sheet the page lands.
 *
 * Pictures must already be loaded: they come in as a map from the address the
 * engine resolved to the decoded image. One that is missing is not drawn.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {object} report a buildPages result
 * @param {number} [index] which page, 0-based
 * @param {object} [options]
 * @param {Map<string, CanvasImageSource>} [options.images]
 * @param {object} [options.theme]
 */
export function drawPage(ctx, report, index = 0, options = {}) {
    const page = pageAt(report, index);
    const conf = report.page ?? {};
    const margin = conf.margin ?? {};

    const env = {
        ctx,
        images: options.images ?? new Map(),
        theme: { ...CANVAS_DEFAULTS, ...(options.theme ?? {}) },
        baselines: new Map()
    };

    const width = px(conf.width);
    const height = px(conf.height);

    ctx.save();

    /** .page { overflow: hidden }: nothing prints past the paper's edge */
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();

    if (env.theme.background) {
        fill(ctx, env.theme.background, CANVAS_DEFAULTS.background);
        ctx.fillRect(0, 0, width, height);
    }

    const rank = (type) => {
        const i = ORDER.indexOf(type);
        return i === -1 ? ORDER.length : i;
    };

    const bands = [...(page.bands ?? [])].sort((a, b) => rank(a.type) - rank(b.type));

    /**
     * A band the engine anchored sits at its zone's top, inside the margins.
     * One it did not - an older page list - flows under the last one that
     * flowed, which is what render.js falls back to as well.
     */
    let flowTop = px(margin.top);

    for (const band of bands) {
        const bandHeight = Math.max(band.zoneHeight ?? 0, band.measuredHeight ?? 0);
        let top;

        if (Number.isFinite(band.top)) {
            top = px(band.top) + px(margin.top);
        } else {
            top = flowTop;
            flowTop += bandHeight;
        }

        drawItems(env, band.items, px(margin.left), top, 0);
    }

    ctx.restore();
}


/**
 * Every picture address a page will draw, so they can be loaded before it is.
 * Group bands inside a table are bands too, and may hold a logo.
 * @param {object} page one entry of a buildPages result's `pages`
 * @returns {Set<string>}
 */
export function pageImageSources(page) {
    const found = new Set();

    const visit = (list) => {
        for (const item of list ?? []) {
            if (item?.type === 'image') {
                const src = itemImageSrc(item);
                if (src) found.add(src);
            } else if (item?.type === 'table' && Array.isArray(item.groups)) {
                for (const g of item.groups) {
                    const { headers, footers } = fragmentBands(g);
                    for (const band of [...headers, ...footers]) visit(band.items);
                }
            }
        }
    };

    for (const band of page?.bands ?? []) visit(band.items);

    return found;
}


/* ------------------------------------------------------------ the page list */

function pageAt(report, index) {
    const pages = report?.pages;

    if (!Array.isArray(pages)) {
        throw new TypeError('renderToCanvas takes a buildPages result: it has no `pages` array.');
    }

    const page = pages[index];

    if (!page) {
        throw new RangeError(
            `Page ${index} does not exist; the report has ${pages.length} page${pages.length === 1 ? '' : 's'}.`);
    }

    return page;
}


/** the address items.js would put in the <img>, by the same rule */
function itemImageSrc(item) {
    const built = Object.prototype.hasOwnProperty.call(item, 'resolvedSrc');
    return imageSrc(built ? item.resolvedSrc : item.src);
}


/* ----------------------------------------------------------------- items */

/**
 * @param {object} env
 * @param {object[]} list
 * @param {number} ox where the band's left edge is on the page
 * @param {number} oy where the band's top edge is on the page
 * @param {number} padX horizontal padding a text item gets - 8 inside a
 *   group band, which report.css gives `.group-band-cell .band p`
 */
function drawItems(env, list, ox, oy, padX) {
    for (const item of list ?? []) {
        switch (item?.type) {
            case 'text': text(env, item, ox, oy, padX); break;
            case 'table': table(env, item, ox, oy); break;
            case 'line': line(env, item, ox, oy); break;
            case 'box': box(env, item, ox, oy); break;
            case 'image': image(env, item, ox, oy); break;
            default:
                console.warn(`Unknown item type "${item?.type}"; it is not drawn.`);
        }
    }
}


/**
 * A text item: `.page p` - white-space: pre-wrap, line-height 1.3, the box at
 * its declared `w` x `h` with the text free to run past `h`, exactly as the
 * engine let it when it grew the item's measured height.
 */
function text(env, i, ox, oy, padX) {
    const { ctx } = env;
    const lit = i.highlighted ?? null;

    /** the very style block measure.js wrapped this item against */
    const measured = lit ? { ...(i.style ?? {}), ...lit } : (i.style ?? {});

    const x = ox + px(i.x);
    const y = oy + px(i.y);
    const w = px(i.w);

    /**
     * The viewer and the designer draw every box border-box (theme.css), so a
     * group band's 8px of padding is inside `w`, not added to it: the text has
     * w - 16 to sit in. Drawn as padding outside `w`, a right-aligned subtotal
     * ran 16px past where the screen shows it and lost its last digit to the
     * table's edge.
     */
    const inner = Math.max(0, w - padX * 2);

    /** the highlight's fill covers the paragraph's border box */
    if (lit?.background) {
        fill(ctx, lit.background, 'transparent');
        ctx.fillRect(x, y, w, px(i.h));
    }

    /** fitted by the engine: its lines, its size, clipped to the box like the HTML */
    const fitted = Array.isArray(i.fitted?.lines) ? i.fitted : null;

    const size = fitted ? px(fitted.fontSize, 12) : px(measured.fontSize, 12);
    const font = fontString({ ...measured, fontSize: size });
    const lines = fitted ? fitted.lines : wrapLines(i.text ?? '', inner, measured);

    if (fitted) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + padX, y, inner, px(i.h));
        ctx.clip();
    }

    fill(ctx, measured.color, env.theme.color);

    textLines(env, lines, {
        font, size,
        left: x + padX, width: inner, top: y,
        align: measured.align
    });

    if (fitted) ctx.restore();
}


/**
 * A rectangle, border-box: `w` and `h` are its outside however thick the
 * border, which the stroke is drawn inside of.
 */
function box(env, i, ox, oy) {
    const { ctx } = env;
    const style = i.style ?? {};

    const x = ox + px(i.x);
    const y = oy + px(i.y);
    const w = px(i.w);
    const h = px(i.h);

    /** items.js: a border of 0, or of nonsense, is drawn at 1 */
    const width = Math.max(0, Number(style.borderWidth ?? 1)) || 1;
    const pen = RULE_STYLES.includes(style.borderStyle) ? style.borderStyle : 'solid';
    const radius = Math.min(Math.max(0, Number(style.radius ?? 0)) || 0, w / 2, h / 2);

    if (style.background) {
        fill(ctx, style.background, 'transparent');
        roundRect(ctx, x, y, w, h, radius);
        ctx.fill();
    }

    if (pen === 'none') return;

    stroke(ctx, style.borderColor, '#000000');

    strokeRule(ctx, width, pen, (inset) => {
        roundRect(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, Math.max(0, radius - inset));
    });
}


/**
 * A rule centred in its box: the box is what the designer grabs, the rule is
 * `thickness` deep down the middle of it - across for a horizontal line, down
 * for a vertical one.
 */
function line(env, i, ox, oy) {
    const { ctx } = env;
    const style = i.style ?? {};

    const x = ox + px(i.x);
    const y = oy + px(i.y);
    const w = px(i.w);
    const h = px(i.h);

    const thickness = Math.max(0, Number(style.thickness ?? 1)) || 1;
    const pen = LINE_STYLES.includes(style.lineStyle) ? style.lineStyle : 'solid';
    const vertical = i.orientation === 'vertical';

    stroke(ctx, style.color, '#000000');

    /** the rule's near edge: flex centring puts it half the slack in */
    const edge = vertical ? x + (w - thickness) / 2 : y + (h - thickness) / 2;

    strokeRule(ctx, thickness, pen, (inset) => {
        ctx.beginPath();
        if (vertical) {
            ctx.moveTo(edge + inset, y);
            ctx.lineTo(edge + inset, y + h);
        } else {
            ctx.moveTo(x, edge + inset);
            ctx.lineTo(x + w, edge + inset);
        }
    });
}


/** a picture scaled into its box by `fit`, and clipped to it */
function image(env, i, ox, oy) {
    const picture = env.images.get(itemImageSrc(i));
    if (!picture) return;

    const { ctx } = env;
    const x = ox + px(i.x);
    const y = oy + px(i.y);
    const w = px(i.w);
    const h = px(i.h);

    const iw = picture.naturalWidth || picture.videoWidth || picture.width || 0;
    const ih = picture.naturalHeight || picture.videoHeight || picture.height || 0;
    if (!(iw > 0 && ih > 0 && w > 0 && h > 0)) return;

    const fit = IMAGE_FITS.includes(i.fit) ? i.fit : 'contain';

    let dw = w;
    let dh = h;

    if (fit !== 'fill') {
        const ratio = fit === 'cover'
            ? Math.max(w / iw, h / ih)
            : Math.min(w / iw, h / ih);
        dw = iw * ratio;
        dh = ih * ratio;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    /** object-position defaults to the centre */
    ctx.drawImage(picture, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
}


/* ----------------------------------------------------------------- tables */

/**
 * A table as items.js and report.css draw it: fixed layout, each row exactly
 * the height measure.js gave it, every cell owning its top and left rule, the
 * last cell of a row its right rule, and the last row of a body its bottom one.
 */
function table(env, i, ox, oy) {
    const style = i.style ?? {};
    const columns = i.columns ?? [];

    const x0 = ox + px(i.x);
    const widths = columnWidths(i);
    const lefts = [];
    let run = x0;
    for (const w of widths) { lefts.push(run); run += w; }
    const tableWidth = run - x0;

    const pen = RULE_STYLES.includes(style.borderStyle) ? style.borderStyle : 'solid';
    const declared = Number(style.borderWidth);
    const rule = pen === 'none'
        ? 0
        : (Number.isFinite(declared) && declared > 0 ? Math.min(declared, maxRuleWidth(i)) : 1);

    const size = Number(style.fontSize) > 0 ? Number(style.fontSize) : 12;

    const look = {
        pen, rule,
        ruleColor: style.borderColor || env.theme.ruleColor,
        font: { fontSize: size, fontFamily: style.fontFamily || CELL_FAMILY, fontWeight: 'normal', fontStyle: 'normal' },
        color: style.color,
        headBackground: style.headerBackground || env.theme.headerBackground,
        headColor: style.headerColor,
        wrap: i.wrap !== false
    };

    const headHeight = px(i.headerMeasured ?? i.headerHeight ?? i.rowHeight);

    /**
     * The rows in drawing order, grouped the way the markup groups them: a
     * header row is a section of its own (a <thead>), and a body is the rest.
     * Only a body's last row draws the bottom rule.
     */
    const sections = [];

    if (Array.isArray(i.groups)) {
        for (const g of i.groups) {
            if (g.showHeader && i.showHeader) sections.push({ head: true, rows: [{ kind: 'head', height: headHeight }] });

            const { headers, footers } = fragmentBands(g);

            sections.push({
                head: false,
                rows: [
                    ...headers.map(band => ({ kind: 'band', band })),
                    ...(g.rows ?? []).map((row, n) => ({ kind: 'data', row, height: px(g.rowHeights?.[n] ?? i.rowHeight) })),
                    ...footers.map(band => ({ kind: 'band', band }))
                ]
            });
        }
    } else {
        if (i.showHeader) sections.push({ head: true, rows: [{ kind: 'head', height: headHeight }] });

        sections.push({
            head: false,
            rows: (i.row ?? []).map((row, n) => ({ kind: 'data', row, height: px(i.rowHeights?.[n] ?? i.rowHeight) }))
        });
    }

    /** every th and td, and every group band between them, where it lands */
    const cells = [];
    const bands = [];
    let y = oy + px(i.y);

    for (const section of sections) {
        section.rows.forEach((r, n) => {
            const last = !section.head && n === section.rows.length - 1;

            if (r.kind === 'band') {
                bands.push({ band: r.band, y });
                y += bandRowHeight(r.band);
                return;
            }

            columns.forEach((column, c) => {
                const head = r.kind === 'head';

                cells.push({
                    x: lefts[c], y, w: widths[c], h: r.height,
                    head,
                    lit: head ? null : cellHighlight(i, column, r.row),
                    align: column.align,
                    value: head ? column.label : formatValue(r.row?.[column.field], column.format),
                    lastColumn: c === columns.length - 1,
                    bottom: last
                });
            });

            y += r.height;
        });
    }

    /**
     * Drawn in three passes - fills, rules, text - rather than a cell at a
     * time. Nothing of one cell reaches into another, so the page comes out
     * the same, and the rules go down as one stroke for the whole table: a
     * PDF page of a long statement spent most of its bytes, and much of its
     * time, setting the pen up again for each edge of each cell.
     */
    const { ctx } = env;

    ctx.save();
    for (const c of cells) cellFill(env, look, c);
    ctx.restore();

    for (const b of bands) groupBandRow(env, b.band, x0, b.y, tableWidth);
    tableRules(env, look, cells);

    ctx.save();
    for (const c of cells) cellText(env, look, c);
    ctx.restore();
}


/** a th's or a highlighted td's background */
function cellFill(env, look, c) {
    const background = c.head ? look.headBackground : c.lit?.background;
    if (!background) return;

    fill(env.ctx, background, 'transparent');
    env.ctx.fillRect(c.x, c.y, c.w, c.h);
}


/**
 * Every cell's rules - top and left, the last column's right, the last row's
 * bottom - as one path, each edge a subpath of its own. A dash pattern starts
 * again at each subpath, on a canvas and in a PDF alike, so a dashed edge
 * begins where it did when every edge was a stroke of its own.
 */
function tableRules(env, look, cells) {
    const { ctx } = env;
    const { rule } = look;
    if (!(rule > 0) || cells.length === 0) return;

    ctx.save();
    stroke(ctx, look.ruleColor, CANVAS_DEFAULTS.ruleColor);

    strokeRule(ctx, rule, look.pen, (inset) => {
        ctx.beginPath();

        for (const c of cells) {
            ctx.moveTo(c.x, c.y + inset);
            ctx.lineTo(c.x + c.w, c.y + inset);

            ctx.moveTo(c.x + inset, c.y);
            ctx.lineTo(c.x + inset, c.y + c.h);

            if (c.lastColumn) {
                ctx.moveTo(c.x + c.w - rule + inset, c.y);
                ctx.lineTo(c.x + c.w - rule + inset, c.y + c.h);
            }

            if (c.bottom) {
                ctx.moveTo(c.x, c.y + c.h - rule + inset);
                ctx.lineTo(c.x + c.w, c.y + c.h - rule + inset);
            }
        }
    });

    ctx.restore();
}


/** a cell's text, inside its .cell box */
function cellText(env, look, c) {
    const { ctx } = env;
    const { rule } = look;

    const value = c.value == null ? '' : String(c.value);
    if (value === '') return;

    /** the header is bold; a highlight may make a body cell bold or slanted */
    const font = {
        ...look.font,
        fontWeight: c.head ? 600 : (c.lit?.fontWeight || 'normal'),
        fontStyle: c.lit?.fontStyle || 'normal'
    };

    const left = c.x + rule + CELL_PADDING;
    const width = c.w - CELL_PADDING * 2 - rule * (c.lastColumn ? 2 : 1);

    const top = c.y + rule;
    const inner = c.h - rule * (c.bottom ? 2 : 1);

    const lines = look.wrap ? wrapLines(value, width, font) : [ellipsis(value, width, font)];
    const lineHeight = font.fontSize * LINE_HEIGHT_RATIO;

    /**
     * th, td { overflow: hidden } - which cuts nothing from text that sits
     * inside the cell, as nearly all of it does: lines that fit inside its
     * rules, each no wider than its text box. The padding either side is room
     * to spare. Only the rest pay for a clip, which in a PDF is a saved and
     * restored state around the cell's text. (The widths were measured while
     * the lines were wrapped or cut, so asking again costs a cache lookup.)
     */
    const fits = lines.length * lineHeight <= inner &&
        lines.every(line => measureText(line, font) <= width);

    if (!fits) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(c.x, c.y, c.w, c.h);
        ctx.clip();
    }

    /**
     * The header's colour is the header's; a body cell's is its highlight's,
     * then the table's. (report.css lets --rs-cell-color win over the
     * header's own colour, which reads as an accident rather than a rule.)
     */
    const color = c.head
        ? (look.headColor || look.color)
        : (c.lit?.color || look.color);

    fill(ctx, color, env.theme.color);

    textLines(env, lines, {
        font: fontString(font),
        size: font.fontSize,
        left, width,
        /** .cell is a column centred on the main axis: lines sit in the middle */
        top: top + (inner - lines.length * lineHeight) / 2,
        align: c.align
    });

    if (!fits) ctx.restore();
}


/** how tall a group band drawn across a table is */
function bandRowHeight(band) {
    return px(band.measuredHeight > 0 ? band.measuredHeight : (band.height ?? 0));
}


/** a group header or footer: a designed band stretched across the table */
function groupBandRow(env, band, x, y, width) {
    const { ctx } = env;
    const height = bandRowHeight(band);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    if (band.background) {
        fill(ctx, band.background, 'transparent');
        ctx.fillRect(x, y, width, height);
    }

    drawItems(env, band.items, x, y, CELL_PADDING);

    ctx.restore();

    return height;
}


/* ------------------------------------------------------------------ text */

/**
 * Lines of text, one under the next at line-height 1.3, each placed by
 * `align` within `width`. The fill style is the caller's.
 */
function textLines(env, lines, { font, size, left, width, top, align }) {
    const { ctx } = env;

    setFont(ctx, font);

    const lineHeight = size * LINE_HEIGHT_RATIO;
    const baseline = baselineIn(env, font, size, lineHeight);

    const where = align === 'right' || align === 'end'
        ? 'right'
        : align === 'center' ? 'center' : 'left';

    const x = where === 'right' ? left + width : where === 'center' ? left + width / 2 : left;

    ctx.textAlign = where;
    ctx.textBaseline = 'alphabetic';

    lines.forEach((text, n) => {
        if (text !== '') ctx.fillText(text, x, top + n * lineHeight + baseline);
    });
}


/**
 * How far below a line box's top its baseline falls.
 *
 * CSS centres the font's own ascent-plus-descent in the line box and puts the
 * baseline an ascent below that, which is what the font bounding box metrics
 * give. A canvas without them (old engines, test doubles) gets a close
 * approximation instead.
 */
function baselineIn(env, font, size, lineHeight) {
    const key = `${font}\u0000${lineHeight}`;
    const hit = env.baselines.get(key);
    if (hit !== undefined) return hit;

    let ascent;
    let descent;

    try {
        const m = env.ctx.measureText('Hg');
        ascent = m?.fontBoundingBoxAscent;
        descent = m?.fontBoundingBoxDescent;
    } catch {
        /** measured below */
    }

    if (!(Number.isFinite(ascent) && Number.isFinite(descent))) {
        ascent = size * 0.9;
        descent = size * 0.25;
    }

    const baseline = (lineHeight - (ascent + descent)) / 2 + ascent;
    env.baselines.set(key, baseline);

    return baseline;
}


/** one line, cut with "…" where it would run past `width` */
function ellipsis(value, width, font) {
    if (!(width > 0) || measureText(value, font) <= width) return value;

    const chars = Array.from(value);
    let n = chars.length;

    while (n > 0 && measureText(chars.slice(0, n).join('') + '…', font) > width) n--;

    return n > 0 ? chars.slice(0, n).join('') + '…' : '';
}


/* ---------------------------------------------------------------- drawing */

/**
 * Sets a fill colour that came from a layout. A canvas ignores a colour it
 * cannot parse and keeps the last one, which would paint this item in the
 * previous item's colour - so the fallback goes in first.
 */
function fill(ctx, value, fallback) {
    ctx.fillStyle = fallback;
    if (value) ctx.fillStyle = String(value);
}

function stroke(ctx, value, fallback) {
    ctx.strokeStyle = fallback;
    if (value) ctx.strokeStyle = String(value);
}

function setFont(ctx, font) {
    ctx.font = SAFE_FONT;
    ctx.font = font;
}


/**
 * Strokes a band `width` deep in one of the CSS border styles. `trace(inset)`
 * builds the path at a given depth into the band; it is called once for a
 * single rule and twice for `double`.
 *
 * Dash lengths follow what Chromium draws for a border: dashes three times the
 * width, dots one width.
 */
function strokeRule(ctx, width, pen, trace) {
    if (!(width > 0)) return;

    ctx.save();
    ctx.lineCap = 'butt';

    if (pen === 'double' && width >= 3) {
        const third = width / 3;
        ctx.lineWidth = third;
        ctx.setLineDash([]);
        trace(third / 2);
        ctx.stroke();
        trace(width - third / 2);
        ctx.stroke();
        ctx.restore();
        return;
    }

    ctx.lineWidth = width;
    ctx.setLineDash(pen === 'dashed' ? [width * 3, width * 3] : pen === 'dotted' ? [width, width] : []);
    trace(width / 2);
    ctx.stroke();
    ctx.restore();
}


function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();

    if (!(r > 0)) {
        ctx.rect(x, y, w, h);
        return;
    }

    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}


/* ---------------------------------------------------- canvases, pictures, fonts */

function createCanvas(width, height) {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);

    throw new Error('renderToCanvas needs a canvas: pass options.canvas, or run it in a browser.');
}


/**
 * The default picture loader.
 *
 * A picture from another site is asked for with CORS, because a canvas that
 * has drawn one without it is tainted - and a tainted canvas cannot be turned
 * into the PNG or PDF this drawing exists to make. A server that does not
 * allow it gets an empty frame rather than a canvas that cannot be exported.
 */
export function loadImage(src) {
    if (typeof Image !== 'undefined') {
        return new Promise((resolve) => {
            const img = new Image();
            if (/^https?:/i.test(src)) img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = src;
        });
    }

    if (typeof fetch === 'function' && typeof createImageBitmap === 'function') {
        return fetch(src)
            .then(res => (res.ok ? res.blob() : null))
            .then(blob => (blob ? createImageBitmap(blob) : null))
            .catch(() => null);
    }

    return Promise.resolve(null);
}


/**
 * Every face a page draws text in, with the characters it draws in it. The
 * characters matter: a font split by unicode-range (Noto's Tamil and Malayalam
 * faces are) only downloads the part a text asks for.
 */
export function pageFonts(page) {
    const fonts = new Map();

    const add = (font, value) => {
        const str = String(value ?? '');
        if (str === '') return;
        const seen = fonts.get(font) ?? new Set();
        for (const ch of str) if (seen.size < 512) seen.add(ch);
        fonts.set(font, seen);
    };

    const visit = (list) => {
        for (const item of list ?? []) {
            if (item?.type === 'text') {
                const style = item.highlighted ? { ...(item.style ?? {}), ...item.highlighted } : (item.style ?? {});
                const size = Array.isArray(item.fitted?.lines) ? item.fitted.fontSize : style.fontSize;
                add(fontString({ ...style, fontSize: px(size, 12) }), item.text);
            } else if (item?.type === 'table') {
                const s = item.style ?? {};
                const base = { fontSize: Number(s.fontSize) > 0 ? Number(s.fontSize) : 12, fontFamily: s.fontFamily || CELL_FAMILY };
                const labels = (item.columns ?? []).map(c => c.label).join('');
                add(fontString({ ...base, fontWeight: 600 }), labels);

                const rows = Array.isArray(item.groups) ? item.groups.flatMap(g => g.rows ?? []) : (item.row ?? []);
                const body = rows.map(r => (item.columns ?? []).map(c => formatValue(r?.[c.field], c.format)).join('')).join('');
                add(fontString({ ...base, fontWeight: 'normal' }), body);
                add(fontString({ ...base, fontWeight: 'bold' }), body);

                for (const g of item.groups ?? []) {
                    const { headers, footers } = fragmentBands(g);
                    for (const band of [...headers, ...footers]) visit(band.items);
                }
            }
        }
    };

    for (const band of page?.bands ?? []) visit(band.items);

    return fonts;
}


export async function loadFonts(fonts) {
    const set = typeof document !== 'undefined' ? document.fonts
        : (typeof self !== 'undefined' ? self.fonts : undefined);

    if (!set || typeof set.load !== 'function') return;

    await Promise.all([...fonts].map(([font, chars]) =>
        set.load(font, [...chars].join('')).catch(() => null)));
}

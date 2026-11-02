/**
 * xlsx-drawing.js draws what a cell cannot hold: pictures, rules and boxes,
 * as DrawingML - the floating layer Excel keeps above a sheet's cells.
 *
 * Every drawing is anchored to a cell and an offset into it, and given its size
 * in EMUs, so it stays where it was put when a reader resizes a column above
 * it. Positions arrive in sheet pixels; xlsx.js works those out from the page.
 *
 * The layer is always above the cells - DrawingML has no "behind" - which is
 * why a box with text over it draws only its outline here and leaves its fill
 * to the cells underneath. That choice is xlsx.js's; this file draws what it is
 * told.
 *
 * Pictures are embedded, never linked. Only bytes in hand can be: a `data:`
 * URI, or bytes the caller fetched (toXLSXAsync does). PNG, JPEG, GIF and BMP
 * are what every Excel opens; WebP and AVIF are left out, as a frame with
 * nothing in it is better than a file some readers refuse.
 */


const NS_XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** English Metric Units: 914400 to the inch, 96 CSS pixels to the inch */
const EMU_PER_PX = 9525;

export const DRAWING_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.drawing+xml';
export const REL_DRAWING = `${NS_R}/drawing`;
export const REL_IMAGE = `${NS_R}/image`;

/** the formats embedded, by extension */
export const IMAGE_TYPES = Object.freeze({
    png: 'image/png',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    bmp: 'image/bmp'
});

const DATA_URI = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]*)$/i;


/** CSS pixels as EMUs, whole */
export function emu(px) {
    return Math.max(0, Math.round((Number(px) || 0) * EMU_PER_PX));
}


/* ---------------- pictures ---------------- */


/**
 * The bytes of a base64 `data:` URI, or null.
 * @param {*} src
 * @returns {Uint8Array|null}
 */
export function decodeDataUri(src) {
    if (typeof src !== 'string') return null;
    const match = src.trim().match(DATA_URI);
    if (!match) return null;

    try {
        const binary = atob(match[1].replace(/\s+/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    } catch {
        return null;
    }
}


/**
 * What a picture is, from its first bytes rather than what it claims: its
 * format and its natural size, which `contain` and `cover` need to fit it.
 *
 * @param {Uint8Array} bytes
 * @returns {{ext: string, width: number|null, height: number|null}|null}
 *   null for a format that is not embedded
 */
export function sniffImage(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 10) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const at = (i, ...sig) => sig.every((b, k) => bytes[i + k] === b);

    if (at(0, 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A) && bytes.length >= 24) {
        return { ext: 'png', width: view.getUint32(16), height: view.getUint32(20) };
    }

    if (at(0, 0x47, 0x49, 0x46, 0x38)) {
        return { ext: 'gif', width: view.getUint16(6, true), height: view.getUint16(8, true) };
    }

    if (at(0, 0x42, 0x4D) && bytes.length >= 26) {
        return { ext: 'bmp', width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) };
    }

    if (at(0, 0xFF, 0xD8)) return { ext: 'jpeg', ...jpegSize(bytes, view) };

    return null;
}


/**
 * A JPEG's size, from its first start-of-frame marker. The markers before it
 * are skipped by their declared lengths; the ones that are not frames despite
 * the number (DHT, JPG, DAC) are passed over.
 */
function jpegSize(bytes, view) {
    let i = 2;

    while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xFF) { i++; continue; }

        const marker = bytes[i + 1];
        if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }

        const length = view.getUint16(i + 2);
        const frame = marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker);

        if (frame) return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };

        i += 2 + length;
    }

    return { width: null, height: null };
}


/**
 * Where a picture sits in its box, as items.js's object-fit puts it.
 *
 * contain: scaled to fit and centred, so the box shows round it.
 * cover:   scaled to fill and centred, the overflow cropped - in Excel, a
 *          source rectangle in thousandths of a percent of each edge.
 * fill:    stretched to the box.
 *
 * A picture whose size could not be read is stretched, which is wrong only in
 * proportion, never in place.
 *
 * @returns {{x: number, y: number, w: number, h: number, crop: object|null}}
 *   the picture's frame relative to the box, in pixels
 */
export function fitImage(fit, box, natural) {
    const { width, height } = natural ?? {};
    const whole = { x: 0, y: 0, w: box.w, h: box.h, crop: null };

    if (!(width > 0 && height > 0) || fit === 'fill' || box.w <= 0 || box.h <= 0) return whole;

    if (fit === 'cover') {
        const scale = Math.max(box.w / width, box.h / height);
        const crop = (shown, full) => Math.round(((1 - shown / full) / 2) * 100000);
        const lr = crop(box.w, width * scale);
        const tb = crop(box.h, height * scale);

        return { ...whole, crop: lr || tb ? { l: lr, r: lr, t: tb, b: tb } : null };
    }

    const scale = Math.min(box.w / width, box.h / height);
    const w = width * scale;
    const h = height * scale;

    return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h, crop: null };
}


/* ---------------- the drawing part ---------------- */


/**
 * A sheet's drawing part.
 *
 * @param {object[]} anchors each { col, colOff, row, rowOff, cx, cy, shape } -
 *   offsets and size in pixels, and a shape from picture(), box() or rule()
 * @returns {string} xl/drawings/drawingN.xml
 */
export function drawingXml(anchors) {
    const body = anchors.map((a, i) => {
        const id = i + 2;
        return '<xdr:oneCellAnchor>' +
            `<xdr:from><xdr:col>${a.col}</xdr:col><xdr:colOff>${emu(a.colOff)}</xdr:colOff>` +
            `<xdr:row>${a.row}</xdr:row><xdr:rowOff>${emu(a.rowOff)}</xdr:rowOff></xdr:from>` +
            `<xdr:ext cx="${emu(a.cx)}" cy="${emu(a.cy)}"/>` +
            a.shape(id, emu(a.cx), emu(a.cy)) +
            '<xdr:clientData/>' +
            '</xdr:oneCellAnchor>';
    }).join('');

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        `<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}" xmlns:r="${NS_R}">${body}</xdr:wsDr>`;
}


/**
 * The drawing part's relationships: one per embedded picture.
 * @param {{rId: string, file: string}[]} media
 */
export function drawingRels(media) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        media.map(m => `<Relationship Id="${m.rId}" Type="${REL_IMAGE}" Target="../media/${m.file}"/>`).join('') +
        '</Relationships>';
}


/**
 * A picture.
 * @param {{rId: string, alt?: string, crop?: object|null}} picture
 */
export function picture({ rId, alt = '', crop = null }) {
    return (id, cx, cy) => '<xdr:pic>' +
        `<xdr:nvPicPr><xdr:cNvPr id="${id}" name="Picture ${id - 1}" descr="${escapeAttr(alt)}"/>` +
        '<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
        '<xdr:blipFill>' +
        `<a:blip r:embed="${rId}"/>` +
        (crop ? `<a:srcRect l="${crop.l}" t="${crop.t}" r="${crop.r}" b="${crop.b}"/>` : '') +
        '<a:stretch><a:fillRect/></a:stretch>' +
        '</xdr:blipFill>' +
        `<xdr:spPr>${xfrm(cx, cy)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
        '</xdr:pic>';
}


/**
 * A rectangle, rounded or not, with an outline, a fill, both or neither.
 *
 * @param {{fill?: string|null, outline?: object|null, radius?: number,
 *   w: number, h: number}} box fill is ARGB; outline is a pen from pen();
 *   radius and size in pixels
 */
export function box({ fill = null, outline = null, radius = 0, w, h }) {
    const shortest = Math.min(w, h);
    const adj = radius > 0 && shortest > 0
        ? Math.min(50000, Math.round((radius / shortest) * 100000))
        : 0;

    const geometry = adj > 0
        ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`
        : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';

    return (id, cx, cy) => '<xdr:sp macro="" textlink="">' +
        `<xdr:nvSpPr><xdr:cNvPr id="${id}" name="Box ${id - 1}"/><xdr:cNvSpPr/></xdr:nvSpPr>` +
        `<xdr:spPr>${xfrm(cx, cy)}${geometry}` +
        (fill ? solid(fill) : '<a:noFill/>') +
        lineXml(outline) +
        '</xdr:spPr>' +
        '</xdr:sp>';
}


/**
 * A straight rule, horizontal or vertical.
 * @param {object} rulePen a pen from pen()
 */
export function rule(rulePen) {
    return (id, cx, cy) => '<xdr:cxnSp macro="">' +
        `<xdr:nvCxnSpPr><xdr:cNvPr id="${id}" name="Line ${id - 1}"/><xdr:cNvCxnSpPr/></xdr:nvCxnSpPr>` +
        `<xdr:spPr>${xfrm(cx, cy)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom>${lineXml(rulePen)}</xdr:spPr>` +
        '</xdr:cxnSp>';
}


/**
 * A pen: the CSS line styles as DrawingML draws them.
 *
 * @param {{style?: string, width?: number, color?: string|null}} spec color is ARGB
 * @returns {object|null} null for no line
 */
export function pen({ style = 'solid', width = 1, color = null } = {}) {
    if (style === 'none' || style === 'hidden') return null;
    const w = Number(width);
    if (!Number.isFinite(w) || w <= 0) return null;

    return {
        width: w,
        color: color ?? 'FF000000',
        dash: { dashed: 'dash', dotted: 'sysDot' }[style] ?? null,
        double: style === 'double'
    };
}


function lineXml(p) {
    if (!p) return '<a:ln><a:noFill/></a:ln>';

    return `<a:ln w="${emu(p.width)}"${p.double ? ' cmpd="dbl"' : ''}>` +
        solid(p.color) +
        (p.dash ? `<a:prstDash val="${p.dash}"/>` : '') +
        '</a:ln>';
}


/** an ARGB colour as a solid DrawingML fill; DrawingML takes RGB without the alpha */
function solid(argbColor) {
    return `<a:solidFill><a:srgbClr val="${argbColor.slice(-6)}"/></a:solidFill>`;
}


/** the shape's own frame; the anchor is what places it, so the offset stays 0 */
function xfrm(cx, cy) {
    return `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;
}


function escapeAttr(text) {
    return String(text ?? '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * xlsx-style.js turns how a report cell was drawn into how an Excel cell is
 * formatted, and keeps the workbook's table of formats.
 *
 * Two halves:
 *
 * - cellFormat reads a design descriptor from rows.js - a text item's style, or
 *   a table cell's column and table style - and says what the cell looks like
 *   in Excel's terms: a font, a fill, a border, an alignment. What the layout
 *   leaves unset is filled in from what report.css draws, so an unstyled table
 *   exports as it looks on screen, not as Excel's defaults.
 *
 * - createStyles is the registry. Excel keeps formats as indexed tables - every
 *   distinct font, fill and border once, and one cell format (xf) per distinct
 *   combination of them - so a cell refers to its format by number. The same
 *   look asked for twice is one entry.
 *
 * Padding becomes an indent, the only inset a cell has. What has no cell
 * equivalent at all - line height, transparency - is left behind; rounded
 * corners belong to boxes, which xlsx-drawing.js draws as shapes.
 */


/**
 * What report.css draws when a layout says nothing. Kept in step with that
 * stylesheet by a spec, since the two have to agree for an export to look like
 * the preview.
 */
export const REPORT_DEFAULTS = Object.freeze({
    fontFamily: 'Helvetica, Arial, sans-serif',
    fontSize: 12,
    headerWeight: 600,
    headerBackground: '#f1f3f5',
    ruleColor: '#cdd4db',
    ruleWidth: 1,
    ruleStyle: 'solid',
    cellPadding: 8
});

/**
 * Fonts every machine that opens a workbook is likely to have. A CSS stack
 * names its first choice first, but the first choice is often Helvetica, which
 * Windows does not have; the first of these in the stack is the better pick.
 */
const OFFICE_FONTS = [
    'aptos', 'arial', 'calibri', 'cambria', 'candara', 'consolas', 'constantia',
    'corbel', 'courier new', 'georgia', 'segoe ui', 'tahoma', 'times new roman',
    'trebuchet ms', 'verdana'
];

/** what a CSS generic family means in a workbook */
const GENERIC_FONTS = {
    'sans-serif': 'Arial',
    'serif': 'Times New Roman',
    'monospace': 'Courier New',
    'system-ui': 'Calibri',
    '-apple-system': 'Calibri',
    'ui-sans-serif': 'Arial',
    'ui-serif': 'Times New Roman',
    'ui-monospace': 'Courier New',
    'cursive': 'Comic Sans MS',
    'fantasy': 'Impact'
};

/** Excel refuses a font name longer than this */
const FONT_NAME_LIMIT = 31;

/** the CSS colour names a hand-written layout is likely to use */
const NAMED_COLORS = {
    black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF',
    gray: '808080', grey: '808080', silver: 'C0C0C0', maroon: '800000', navy: '000080',
    teal: '008080', olive: '808000', purple: '800080', orange: 'FFA500', yellow: 'FFFF00',
    lime: '00FF00', aqua: '00FFFF', cyan: '00FFFF', fuchsia: 'FF00FF', magenta: 'FF00FF',
    darkgray: 'A9A9A9', darkgrey: 'A9A9A9', lightgray: 'D3D3D3', lightgrey: 'D3D3D3'
};

const RULE_STYLES = ['solid', 'dashed', 'dotted', 'double'];

const ALIGNMENTS = ['left', 'center', 'right'];

/** Excel's default column: 8.43 characters of Calibri 11, which is 64px */
export const DEFAULT_COLUMN_PX = 64;

/**
 * One level of Excel's indent, in pixels: three spaces of the default font.
 * Padding and an item's offset inside its column are both written as indents,
 * the only inset Excel gives a cell.
 */
export const INDENT_PX = 9;

/** Excel's cap on indent levels */
const MAX_INDENT = 15;


/**
 * Pixels of inset as indent levels, to the nearest.
 * @param {number} px
 * @returns {number}
 */
export function indentLevels(px) {
    const n = Math.round((Number(px) || 0) / INDENT_PX);
    return Math.max(0, Math.min(MAX_INDENT, n));
}


/* ---------------- converters ---------------- */


/**
 * A CSS colour as Excel's ARGB hex, or null when there is none to give.
 *
 * Hex in its four lengths, rgb() and rgba() in either syntax, and the common
 * names. Excel has no transparency, so alpha is dropped - except a colour that
 * is fully transparent, which is no colour at all.
 *
 * @param {*} value
 * @returns {string|null} such as 'FF1A2B3C'
 */
export function argb(value) {
    if (typeof value !== 'string') return null;
    const css = value.trim().toLowerCase();
    if (css === '' || css === 'transparent' || css === 'none' || css === 'inherit') return null;

    if (NAMED_COLORS[css]) return `FF${NAMED_COLORS[css]}`;

    const hex = css.match(/^#([0-9a-f]{3,8})$/);
    if (hex) {
        let digits = hex[1];
        if (digits.length === 3 || digits.length === 4) {
            digits = [...digits].map(d => d + d).join('');
        }
        if (digits.length === 8) {
            if (digits.slice(6) === '00') return null;
            digits = digits.slice(0, 6);
        }
        return digits.length === 6 ? `FF${digits.toUpperCase()}` : null;
    }

    const fn = css.match(/^rgba?\(\s*([^)]*)\)$/);
    if (fn) {
        const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
        if (parts.length < 3) return null;

        const alpha = parts[3];
        if (alpha !== undefined && parseFloat(alpha) === 0) return null;

        const channels = parts.slice(0, 3).map((part) => {
            /** 255 / 100 rather than 2.55, which leaves 50% a hair under 127.5 */
            const n = part.endsWith('%') ? (parseFloat(part) * 255) / 100 : parseFloat(part);
            return Number.isFinite(n) ? Math.max(0, Math.min(255, Math.round(n))) : null;
        });
        if (channels.includes(null)) return null;

        return 'FF' + channels.map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
    }

    return null;
}


/**
 * One font name from a CSS font-family stack.
 * @param {*} stack such as '"Segoe UI", Helvetica, sans-serif'
 * @returns {string}
 */
export function fontName(stack) {
    const families = String(stack ?? '')
        .split(',')
        .map(f => f.trim().replace(/^['"]|['"]$/g, '').trim())
        .filter(Boolean);

    if (families.length === 0) return 'Arial';

    const safe = families.find(f => OFFICE_FONTS.includes(f.toLowerCase()));
    const chosen = safe ?? GENERIC_FONTS[families[0].toLowerCase()] ?? families[0];

    return chosen.slice(0, FONT_NAME_LIMIT);
}


/** CSS pixels as points, to the half point Excel shows */
export function points(px) {
    return Math.round(px * 0.75 * 2) / 2;
}


/**
 * CSS pixels as an Excel column width, which is counted in characters of the
 * default font: Calibri 11's digits are 7px wide, plus 5px of cell padding.
 */
export function columnChars(px) {
    return Math.max(1, Math.round(((px - 5) / 7) * 100) / 100);
}


/** whether a CSS font-weight is bold enough to be bold in Excel */
export function isBold(weight) {
    if (weight === 'bold' || weight === 'bolder') return true;
    const n = Number(weight);
    return Number.isFinite(n) && n >= 600;
}


/**
 * A rule as an Excel border style, by the nearest weight Excel has: it draws
 * thin, medium and thick, and only a thin dot.
 *
 * @param {{style?: string, width?: number, color?: string}} rule
 * @returns {{style: string, color: string|null}|null} null for no rule
 */
export function excelBorder({ style = 'solid', width = 1, color = null } = {}) {
    if (style === 'none' || style === 'hidden') return null;

    const pen = RULE_STYLES.includes(style) ? style : 'solid';
    const w = Number(width);
    if (!Number.isFinite(w) || w <= 0) return null;

    const excel = {
        solid: w <= 1 ? 'thin' : w <= 2 ? 'medium' : 'thick',
        dashed: w <= 1 ? 'dashed' : 'mediumDashed',
        dotted: 'dotted',
        double: 'double'
    }[pen];

    return { style: excel, color: argb(color) };
}


/* ---------------- what a cell looks like ---------------- */


/**
 * The Excel format for one cell of a report.
 *
 * @param {object|null} design a descriptor from rows.js
 * @returns {object|null} { font, fill, border, alignment }, null for the default
 */
export function cellFormat(design) {
    if (!design) return null;

    if (design.kind === 'text') return lit(textFormat(design.style ?? {}), design.highlight);
    if (design.kind === 'head' || design.kind === 'cell') {
        return lit(tableFormat(design.kind === 'head', design.column ?? {}, design.table ?? {}),
            design.highlight);
    }

    return null;
}


/**
 * A format with a highlight rule's style laid over it: the text colour, the
 * fill, bold and italic, each only where the rule set it - the same four the
 * page draws, so a red figure on the page is a red figure in the sheet.
 *
 * @param {object} format from textFormat or tableFormat
 * @param {object|null|undefined} highlight from highlight.js
 * @returns {object}
 */
function lit(format, highlight) {
    if (!highlight) return format;

    const font = { ...format.font };
    if (highlight.color) font.color = argb(highlight.color) ?? font.color;
    if (highlight.fontWeight) font.bold = isBold(highlight.fontWeight);
    if (highlight.fontStyle) font.italic = highlight.fontStyle === 'italic' || highlight.fontStyle === 'oblique';

    return {
        ...format,
        font,
        fill: highlight.background ? (argb(highlight.background) ?? format.fill) : format.fill
    };
}


/**
 * A text item: its own font, colour and alignment. Text sits at the top of its
 * box on the page and never wraps here - a cell's neighbours are empty more
 * often than not, and spilling into them is how a long line stays one line.
 *
 * A text style may also carry background, border and padding, but items.js
 * draws none of the three and the designer offers none of them, so neither
 * does the export: the workbook shows what the preview shows. A filled or
 * framed panel is a box, which the export does draw.
 */
function textFormat(style) {
    return {
        font: {
            name: fontName(style.fontFamily ?? REPORT_DEFAULTS.fontFamily),
            size: points(positive(style.fontSize) ?? REPORT_DEFAULTS.fontSize),
            bold: isBold(style.fontWeight),
            italic: style.fontStyle === 'italic' || style.fontStyle === 'oblique',
            color: argb(style.color)
        },
        fill: null,
        border: null,
        alignment: {
            horizontal: ALIGNMENTS.includes(style.align) ? style.align : 'left',
            vertical: 'top',
            wrapText: false
        }
    };
}


/**
 * A table cell: the table's font, the column's alignment, the grid on all four
 * sides, and the header's fill and weight - each falling back to what
 * report.css draws, which is what the reader saw.
 */
function tableFormat(head, column, table) {
    const style = table.style ?? {};

    const color = head
        ? argb(style.headerColor) ?? argb(style.color)
        : argb(style.color);

    return {
        font: {
            name: fontName(style.fontFamily ?? REPORT_DEFAULTS.fontFamily),
            size: points(positive(style.fontSize) ?? REPORT_DEFAULTS.fontSize),
            bold: head ? isBold(style.fontWeight ?? REPORT_DEFAULTS.headerWeight) : isBold(style.fontWeight),
            italic: style.fontStyle === 'italic' || style.fontStyle === 'oblique',
            color
        },
        fill: head
            ? (style.headerBackground === null ? null
                : argb(style.headerBackground ?? REPORT_DEFAULTS.headerBackground))
            : argb(style.background),
        border: excelBorder({
            style: style.borderStyle ?? REPORT_DEFAULTS.ruleStyle,
            width: style.borderWidth ?? REPORT_DEFAULTS.ruleWidth,
            color: style.borderColor ?? REPORT_DEFAULTS.ruleColor
        }),
        alignment: {
            horizontal: ALIGNMENTS.includes(column.align) ? column.align : 'left',
            vertical: 'center',
            wrapText: table.wrap !== false,
            /** report.css pads a cell 8px either side; a centred cell has no side to pad */
            indent: column.align === 'center' ? 0 : indentLevels(REPORT_DEFAULTS.cellPadding)
        }
    };
}


function positive(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}


/* ---------------- the registry ---------------- */


/**
 * The workbook's formats. `xf` hands out a cell format's index, adding what it
 * has not seen; `xml` writes styles.xml once every cell has asked.
 *
 * Entry 0 of each table is Excel's default and stays so - Calibri 11, no fill,
 * no border - because the column widths are counted in that font. The two
 * leading fills are required by Excel even though nothing uses gray125.
 */
export function createStyles() {
    const fonts = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
    const fills = [
        '<fill><patternFill patternType="none"/></fill>',
        '<fill><patternFill patternType="gray125"/></fill>'
    ];
    const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
    const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];

    /** custom number format codes, by code; Excel numbers its own from 164 up */
    const numFmts = new Map();

    /**
     * The id of a custom number format, such as "#,##0.00" or "dd/mm/yyyy",
     * adding it the first time it is asked for.
     * @param {string} code
     * @returns {number}
     */
    function numFmt(code) {
        if (!numFmts.has(code)) numFmts.set(code, 164 + numFmts.size);
        return numFmts.get(code);
    }

    const index = new Map([
        ...fonts.map((x, i) => [x, i]),
        ...fills.map((x, i) => [x, i]),
        ...borders.map((x, i) => [x, i]),
        ...xfs.map((x, i) => [x, i])
    ]);

    const add = (list, xml) => {
        if (index.has(xml)) return index.get(xml);
        list.push(xml);
        index.set(xml, list.length - 1);
        return list.length - 1;
    };

    function fontXml(font) {
        if (!font) return null;
        return '<font>' +
            (font.bold ? '<b/>' : '') +
            (font.italic ? '<i/>' : '') +
            `<sz val="${font.size ?? 11}"/>` +
            (font.color ? `<color rgb="${font.color}"/>` : '') +
            `<name val="${escapeAttr(font.name ?? 'Calibri')}"/>` +
            '</font>';
    }

    function fillXml(color) {
        if (!color) return null;
        return `<fill><patternFill patternType="solid"><fgColor rgb="${color}"/>` +
            '<bgColor indexed="64"/></patternFill></fill>';
    }

    function borderXml(border) {
        if (!border) return null;
        const side = (name) => `<${name} style="${border.style}">` +
            (border.color ? `<color rgb="${border.color}"/>` : '<color auto="1"/>') +
            `</${name}>`;
        return `<border>${side('left')}${side('right')}${side('top')}${side('bottom')}<diagonal/></border>`;
    }

    function alignmentXml(alignment) {
        if (!alignment) return '';
        const attrs = [];
        if (alignment.horizontal && alignment.horizontal !== 'general') {
            attrs.push(`horizontal="${alignment.horizontal}"`);
        }
        if (alignment.vertical && alignment.vertical !== 'bottom') {
            attrs.push(`vertical="${alignment.vertical}"`);
        }
        if (alignment.wrapText) attrs.push('wrapText="1"');
        if (Number(alignment.indent) > 0 &&
            ['left', 'right', 'distributed'].includes(alignment.horizontal)) {
            attrs.push(`indent="${Math.round(Number(alignment.indent))}"`);
        }
        return attrs.length ? `<alignment ${attrs.join(' ')}/>` : '';
    }

    /**
     * @param {object|null} format from cellFormat, or { font: { bold } } and the like
     * @param {number} [numFmtId=0] a number format's id: built in, such as 14 for a
     *   date, or one numFmt handed out
     * @returns {number} the cell format's index
     */
    function xf(format, numFmtId = 0) {
        if (!format && numFmtId === 0) return 0;

        const font = fontXml(format?.font ? { name: 'Calibri', size: 11, ...format.font } : null);
        const fill = fillXml(format?.fill);
        const border = borderXml(format?.border);
        const alignment = alignmentXml(format?.alignment);

        const fontId = font ? add(fonts, font) : 0;
        const fillId = fill ? add(fills, fill) : 0;
        const borderId = border ? add(borders, border) : 0;

        const applies = [
            numFmtId ? ' applyNumberFormat="1"' : '',
            fontId ? ' applyFont="1"' : '',
            fillId ? ' applyFill="1"' : '',
            borderId ? ' applyBorder="1"' : '',
            alignment ? ' applyAlignment="1"' : ''
        ].join('');

        const xml = `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" ` +
            `borderId="${borderId}" xfId="0"${applies}` +
            (alignment ? `>${alignment}</xf>` : '/>');

        return add(xfs, xml);
    }

    function xml() {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
            '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
            (numFmts.size
                ? `<numFmts count="${numFmts.size}">${[...numFmts]
                    .map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${escapeAttr(code)}"/>`)
                    .join('')}</numFmts>`
                : '') +
            `<fonts count="${fonts.length}">${fonts.join('')}</fonts>` +
            `<fills count="${fills.length}">${fills.join('')}</fills>` +
            `<borders count="${borders.length}">${borders.join('')}</borders>` +
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
            `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
            '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
            '</styleSheet>';
    }

    return { xf, numFmt, xml, get size() { return xfs.length; } };
}


function escapeAttr(text) {
    return String(text)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

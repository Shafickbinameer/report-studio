/**
 * items.js draws the things that live inside a band: text boxes and tables.
 *
 * Split out of render.js because the designer canvas needs exactly this and
 * nothing more. The preview wraps these in anchored, paginated bands; the
 * designer wraps them in band zones on a single unpaginated page. Spec 5.2 asks
 * for one drawing path so that what is designed looks like what is printed -
 * two paths drift, and the drift is always found by a user rather than a test.
 *
 * Every element carries data-item-id and data-item-type. The preview ignores
 * them; the designer uses them to take a pointer event back to a layout item
 * without maintaining a parallel element map that can fall out of step.
 */


/** items are placed against the band box, which the caller has made relative */
export const position = (p) => `position:absolute;top:${p.y}px;left:${p.x}px;`;


/**
 * Everything that reaches the page came from user data, so it is escaped on the
 * way into the markup. Without this a value like "<script>" is executed rather
 * than printed.
 * @param {*} value
 * @returns {string}
 */
export function esc(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


/**
 * Draws every item in a band, in layout order.
 * @param {object[]} list the band's items
 * @returns {string} markup
 */
export function items(list) {
    return (list || []).map(i => {
        switch (i.type) {
            case "text":
                return text(i);
            case "table":
                return table(i)
            case "line":
                return line(i)
            case "box":
                return box(i)
            default:
                console.debug("invalid report type")
                return ''
        }
    }).join("");
}


function text(i) {
    return `
    <p id="${esc(i.id)}" style="
    width:${i.w}px;
    height:${i.h}px;
    ${position(i)}
    font-size:${i.style.fontSize}px;
    font-family:${i.style.fontFamily ?? 'inherit'};
    font-weight:${i.style.fontWeight};
    font-style:${i.style.fontStyle ?? 'normal'};
    text-align:${i.style.align};
    color:${i.style.color};
    " data-item-id="${esc(i.id)}" data-item-type="text">${esc(i.text)}</p>
    `
}


/**
 * A rectangle: a rule bent round four sides, with an optional fill.
 *
 * `box-sizing: border-box` in the stylesheet, so `w` and `h` are the outside of
 * the box however thick its border - which is what the designer draws round it
 * and what the engine paginated against. A border that added to them would put
 * the two a few pixels apart at every thickness.
 *
 * Drawn before the items above it, because paginate orders a band by `y` and a
 * backdrop is placed at the top of what it sits behind.
 */
function box(i) {
    const style = i.style ?? {};
    const width = Math.max(0, Number(style.borderWidth ?? 1)) || 1;

    const border = RULE_STYLES.includes(style.borderStyle)
        ? `${width}px ${style.borderStyle} ${style.borderColor ?? '#000000'}`
        : `${width}px solid ${style.borderColor ?? '#000000'}`;

    const radius = Math.max(0, Number(style.radius ?? 0)) || 0;

    return `
    <div id="${esc(i.id)}" class="box" style="
    width:${i.w}px;
    height:${i.h}px;
    ${position(i)}
    border:${border};
    ${radius ? `border-radius:${radius}px;` : ''}
    ${style.background ? `background:${style.background};` : ''}
    " data-item-id="${esc(i.id)}" data-item-type="box"></div>
    `
}


/** the pen a line is drawn with, as one CSS border shorthand */
function stroke(style) {
    const thickness = Math.max(0, Number(style?.thickness ?? 1)) || 1;

    return `${thickness}px ${style?.lineStyle ?? 'solid'} ${style?.color ?? '#000000'}`;
}


/**
 * A rule, drawn down the middle of the item's box.
 *
 * The box is not the rule: a 1px hairline that *was* its box would be a 1px
 * target in the designer, and an item nobody can click is an item nobody can
 * edit. So the box is whatever `h` (or `w`, running vertically) says, and the
 * rule sits centred inside it - which is also where an eye expects a rule that
 * separates one thing from another to fall.
 *
 * The border goes on the inner span rather than the box, so that `w` and `h`
 * keep meaning what they mean for every other item.
 */
function line(i) {
    const vertical = i.orientation === 'vertical';
    const pen = stroke(i.style);

    return `
    <div id="${esc(i.id)}" class="line${vertical ? ' is-vertical' : ''}" style="
    width:${i.w}px;
    height:${i.h}px;
    ${position(i)}
    " data-item-id="${esc(i.id)}" data-item-type="line"><span class="line-mark"
        style="${vertical ? `border-left:${pen}` : `border-top:${pen}`}"></span></div>
    `
}


/** what a table's grid may be drawn in; anything else is not a rule */
const RULE_STYLES = ['solid', 'dashed', 'dotted', 'double', 'none'];


/**
 * The widest rule a table can be drawn with and still measure what it declares.
 *
 * .cell is box-sizing: border-box with a fixed height, so a rule is drawn
 * inside the row rather than added to it - until the two rules of a cell are
 * together taller than the row, at which point the cell has to grow and the
 * table stops being headerHeight + rows x rowHeight. Half the shallowest row
 * is the point where that starts, so that is the limit.
 *
 * @param {object} item the table
 * @returns {number} pixels
 */
function maxRuleWidth(item) {
    const rowHeight = item.rowHeight ?? 0;
    const headerHeight = item.showHeader ? (item.headerHeight ?? rowHeight) : rowHeight;

    const shallowest = Math.min(rowHeight || Infinity, headerHeight || Infinity);

    return Number.isFinite(shallowest) ? Math.max(1, Math.floor(shallowest / 2)) : 1;
}


/**
 * A table's grid, as custom properties on the table itself.
 *
 * Set here and read by .cell rather than written onto every cell: a five
 * hundred row table has fifteen hundred cells, and the same border string
 * repeated that many times is markup nobody needs to send. Custom properties
 * inherit, so one declaration on the table reaches all of them.
 *
 * Only what the table actually declares is emitted, so a table that says
 * nothing keeps taking its colour from the stylesheet's own variable.
 *
 * @param {object} item the table
 * @returns {string} css declarations, or empty
 */
function tableRule(item) {
    const style = item.style ?? {};
    const out = [];

    /**
     * Whitelisted rather than passed through: the designer canvas draws
     * straight from the layout without asking the validator, and a border style
     * it does not recognise should fall back to the stylesheet rather than land
     * in a style attribute.
     */
    if (RULE_STYLES.includes(style.borderStyle)) {
        out.push(`--rs-rule-style:${style.borderStyle}`);
    }

    if (style.borderColor) out.push(`--rs-rule-color:${style.borderColor}`);

    /**
     * The header's own colours, set here for the same reason the grid is: they
     * belong to every `th` in the table, and a table that says nothing about
     * them keeps taking the stylesheet's.
     */
    if (style.headerBackground) {
        out.push(`--rs-head-bg:${style.headerBackground}`);
    }

    if (style.headerColor) out.push(`--rs-head-color:${style.headerColor}`);

    /**
     * The cell font, which used to go nowhere at all: the rail offered a size
     * and a colour, report.css hard-coded 12px, and the two never met. It
     * matters more than it looks - the engine wraps a cell against this font,
     * so a table drawn in one and measured in another paginates to a row count
     * it does not print.
     */
    if (style.fontFamily) out.push(`--rs-cell-family:${style.fontFamily}`);

    const size = Number(style.fontSize);
    if (Number.isFinite(size) && size > 0) out.push(`--rs-cell-size:${size}px`);

    if (style.color) out.push(`--rs-cell-color:${style.color}`);

    /** one line and an ellipsis, for a column of figures that must not wrap */
    if (item.wrap === false) out.push('--rs-cell-wrap:nowrap');

    /**
     * Clamped rather than trusted: the rail will not offer a width past this,
     * but a hand-written layout can, and a rule that outgrows its row would
     * quietly undo the arithmetic pagination was done with.
     */
    const width = Number(style.borderWidth);

    if (Number.isFinite(width) && width > 0) {
        out.push(`--rs-rule-width:${Math.min(width, maxRuleWidth(item))}px`);
    }

    return out.length ? `${out.join(';')};` : '';
}


function table(i) {
    return `
    <table id="${esc(i.id)}" style="width:${i.w}px;height:${i.measuredHeight}px;${position(i)}${tableRule(i)}" data-item-id="${esc(i.id)}" data-item-type="table">
        ${i.groups ? groupedBody(i) : flatBody(i)}
    </table>
    `
}


/**
 * A cell's content, in a box of exactly the row's height.
 *
 * `height` on a `<tr>` is a minimum, not a height: a cell whose padding and
 * line box need more than that makes the row taller, and the table then outgrows
 * the `headerHeight + rows x rowHeight` the engine paginated against. A few
 * pixels a row is invisible until the fortieth row has pushed the detail band
 * over the page footer. So the padding lives on a box of a known height inside
 * the cell, and the cell itself adds nothing.
 *
 * @param {number} height the row height the engine budgeted
 * @param {string} align the column's text alignment
 * @param {*} value what the cell shows
 * @returns {string} markup
 */
function cell(height, align, value) {
    return `<div class="cell" style="height:${height}px;text-align:${align ?? 'left'}">` +
        `${esc(value)}</div>`;
}


/** the column header row, shared by both table shapes */
function columnHeader(i) {
    /** what measure.js budgeted, which is taller than declared if a label wrapped */
    const height = i.headerMeasured ?? i.headerHeight ?? i.rowHeight;

    return `<thead>
        <tr style="height:${height}px">
        ${i.columns.map(c => `<th style="width:${c.width}px;">${cell(height, c.align, c.label)}</th>`).join("")}
        </tr>
    </thead>`;
}


/**
 * @param {object} i the table
 * @param {object[]} rows
 * @param {number[]} [heights] one per row, from measure.js; absent on the
 *   designer canvas, where nothing has been measured and every row is its
 *   declared height
 */
function dataRows(i, rows, heights) {
    return (rows || []).map((r, n) => {
        const height = heights?.[n] ?? i.rowHeight;

        return `<tr style="height:${height}px">
        ${i.columns.map(c => `<td style="width:${c.width}px;">${cell(height, c.align, r[c.field])}</td>`).join("")}
        </tr>`;
    }).join("");
}


/**
 * A group band is a designed band with absolutely positioned items, so it is
 * dropped into a full-width cell that recreates the band box inside the table.
 */
function groupBandRow(band, colSpan, cls) {
    if (!band) return '';
    const height = band.measuredHeight > 0 ? band.measuredHeight : (band.height ?? 0);
    return `<tr class="${cls}">
        <td colspan="${colSpan}" class="group-band-cell">
            <div class="band" style="position:relative;height:${height}px">${items(band.items)}</div>
        </td>
    </tr>`;
}


function flatBody(i) {
    return `
        ${i.showHeader ? columnHeader(i) : ""}
        <tbody>
            ${dataRows(i, i.row, i.rowHeights)}
        </tbody>
    `;
}


/**
 * One tbody per group fragment, so a group that survives a page break keeps its
 * header on the next page and only prints its footer on the fragment that ends it.
 */
function groupedBody(i) {
    const colSpan = i.columns.length;

    return i.groups.map(g => `
        ${g.showHeader && i.showHeader ? columnHeader(i) : ""}
        <tbody>
            ${groupBandRow(g.headerBand, colSpan, "group-header")}
            ${dataRows(i, g.rows, g.rowHeights)}
            ${g.showFooter ? groupBandRow(g.footerBand, colSpan, "group-footer") : ""}
        </tbody>
    `).join("");
}

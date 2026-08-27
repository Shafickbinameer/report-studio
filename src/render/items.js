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


function table(i) {
    return `
    <table id="${esc(i.id)}" style="width:${i.w}px;height:${i.measuredHeight}px;${position(i)}" data-item-id="${esc(i.id)}" data-item-type="table">
        ${i.groups ? groupedBody(i) : flatBody(i)}
    </table>
    `
}


/** the column header row, shared by both table shapes */
function columnHeader(i) {
    return `<thead>
        <tr style="height:${i.headerHeight ?? i.rowHeight}px">
        ${i.columns.map(c => `<th style="width:${c.width}px;">${esc(c.label)}</th>`).join("")}
        </tr>
    </thead>`;
}


function dataRows(i, rows) {
    return (rows || []).map(r =>
        `<tr style="height:${i.rowHeight}px">
        ${i.columns.map(c => `<td style="width:${c.width}px;text-align:${c.align};">${esc(r[c.field])}</td>`).join("")}
        </tr>`
    ).join("");
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
            ${dataRows(i, i.row)}
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
            ${dataRows(i, g.rows)}
            ${g.showFooter ? groupBandRow(g.footerBand, colSpan, "group-footer") : ""}
        </tbody>
    `).join("");
}

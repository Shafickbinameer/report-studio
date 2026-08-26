/**
 * render.js catches the pages json and loop it
 * and render it in the html to visualize
 */


/** used to return the padding config */
const padding = (m) => `padding-top:${m.top}px;padding-left:${m.left}px;padding-bottom:${m.bottom}px;padding-right:${m.right}px;`
const position = (p) => `position:absolute;top:${p.y}px;left:${p.x}px;`

/** display order */
const order = ['pageHeader', 'reportHeader', 'detail', 'reportFooter', 'pageFooter'];


/**
 * Everything that reaches the page came from user data, so it is escaped on the
 * way into the markup. Without this a value like "<script>" is executed rather
 * than printed.
 * @param {*} value
 * @returns {string}
 */
function esc(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


export function render(json) {
    const pageConf = json.page;
    let html = `
        <main id="main-page">
            ${json.pages.map(p =>
        `
                <section id="page-${esc(p.pageNO)}" class="page"  style="height:${pageConf.height}px; width:${pageConf.width}px; ${padding(pageConf.margin)};position:relative">
                    ${page(p, pageConf)}
                </section>
                `
    ).join('')}
        </main>
    `;
    return html;
}


function page(page, pageConf) {
    /**
     * copy before sorting - the page list is the seam every other consumer
     * reads, and render has no business reordering it in place.
     * A band type render does not know about sorts to the end, not the front.
     */
    const rank = (type) => {
        const i = order.indexOf(type);
        return i === -1 ? order.length : i;
    };

    const sortedPage = [...page.bands].sort(
        ({ type: a }, { type: b }) => rank(a) - rank(b)
    );

    let pageHtmlStr = [];


    for (const band of sortedPage) {
        pageHtmlStr.push(bandConversion(band, page.pageNO, pageConf))
    }

    return pageHtmlStr.join('');
}


/**
 * Bands are anchored, not stacked: the engine gave each one the top of its zone,
 * so a page whose detail ran short still prints its footer on the bottom edge.
 * Without a `top` - an older page list, or a band the engine did not place - it
 * falls back to flowing, which is what this used to do for everything.
 */
function bandConversion(comp, pageNO, pageConf) {
    const anchored = Number.isFinite(comp.top);
    const margin = pageConf?.margin ?? { top: 0, left: 0, right: 0 };

    /**
     * An absolutely positioned child anchors to its ancestor's *padding* box,
     * and the page draws its margins as padding - so the margins have to be
     * added back here, or every band would sit inside them.
     */
    const box = anchored
        ? `position:absolute;top:${comp.top + margin.top}px;` +
          `left:${margin.left}px;right:${margin.right}px;`
        : `position:relative;`;

    /** the zone is the height; a band that outgrew it keeps its measured height */
    const height = Math.max(comp.zoneHeight ?? 0, comp.measuredHeight ?? 0);

    return `
    <div class="band" id="${esc(comp.type)}-${esc(pageNO)}" style="${box}${height > 0 ? `height:${height}px` : ""}">
        ${items(comp.items)}
    </div>
    `
}


function items(list) {
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
    ">${esc(i.text)}</p>
    `
}


function table(i) {
    return `
    <table id="${esc(i.id)}" style="width:${i.w}px;height:${i.measuredHeight}px;${position(i)}">
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

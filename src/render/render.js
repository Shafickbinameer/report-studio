/**
 * render.js catches the pages json and loop it
 * and render it in the html to visualize
 */


/** used to return the padding config */
const padding = (m) => `padding-top:${m.top}px;padding-left:${m.left}px;padding-bottom:${m.bottom}px;padding-right:${m.right}px;`
const position = (p) => `position:absolute;top:${p.y}px;left:${p.x}px;`

/** display order */
const order = ['pageHeader', 'reportHeader', 'detail', 'reportFooter', 'pageFooter'];



export function render(json) {
    const pageConf = json.page;
    let html = `
        <main id="main-page">
            ${json.pages.map(p =>
        `
                <section id="page-${p.pageNO}" class="page"  style="height:${pageConf.height}px; width:${pageConf.width}px; ${padding(pageConf.margin)};position:relative">
                    ${page(p)}
                </section>
                `
    ).join('')}
        </main>
    `;
    return html;
}


function page(page) {
    const sortedPage = page.bands.sort(({ type: a }, { type: b }) => {
        return order.indexOf(a) - order.indexOf(b)
    });

    console.debug(JSON.stringify(sortedPage ,null,2));


    let pageHtmlStr = [];


    for (const band of sortedPage) {
        pageHtmlStr.push(bandConversion(band, page.pageNO))
    }

    return pageHtmlStr.join('');
}


function bandConversion(comp, pageNO) {
    return `
    <div class="band" id="${comp.type}-${pageNO}" style="position:relative;${comp.measuredHeight > 0 ? `height:${comp.measuredHeight}px` : ""}">
        ${comp.items.map(i => {
        switch (i.type) {
            case "text":
                return text(i);
            case "table":
                return table(i)
            default:
                console.debug("invalid report type")
                return ''
        }
    }).join("")}
    </div>
    `
}



function text(i) {
    return `
    <p id="${i.id}" style="
    width:${i.w};
    height:${i.h};
    ${position(i)};
    font-size:${i.style.fontSize}px;
    font-weight:${i.style.fontWeight};
    text-align:${i.style.align};
        color:${i.style.color};
    ">${i.text}</p>
    `
}


function table(i) {
    return `
    <table id="${i.id}" style="width:${i.w}px;height:${i.measuredHeight}px;${position(i)}">
        ${i.showHeader
            ? `<thead>
                <tr style="height:${i.rowHeight}px">
                ${i.columns.map(c => `<th style="width:${c.width}px;" id="${c.field}">${c.label}</th>`).join("")}
                </tr>
            </thead>`
            : ""
        }
        <tbody>
            ${i.row.map((r) => {
            return (
                `<tr style="height:${i.rowHeight}px">
                ${i.columns.map(c => `<td style="width:${c.width}px;text-align:${c.align};" id="${c.field}">${r[c.field]}</td>`).join("")}
                </tr > `
            )

        }).join("")}
        </tbody>
    </table>
    `
}




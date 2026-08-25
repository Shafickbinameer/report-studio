/**
 * render.js catches the pages json and loop it
 * and render it in the html to visualize
 */


/** used to return the margin config */
const margin = (m) => `margin-top:${m.top}px;margin-left:${m.left}px;margin-bottom:${m.bottom}px;margin-right:${m.right}px;`

/** display order */
const order = ['pageHeader', 'reportHeader', 'detail', 'reportFooter', 'pageFooter'];



export function render(json) {
    const pageConf = json.page;
    let html = `
        <main id="main-page">
            ${json.pages.map(p =>
        `
                <section id="page-${p.pageNO}"  style="height:${pageConf.height}px; width:${pageConf.width}px; ${margin(pageConf.margin)}">
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

    let pageHtmlStr = [];


    for (const band of sortedPage) {
        pageHtmlStr.push(bandConversion(band, page.pageNO))
    }

    return pageHtmlStr.join('');
}


function bandConversion(comp, pageNO) {
    return `
    <div id="${comp.type}-${pageNO}">
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
    })}
    </div>
    `
}



function text(i) {
    return `
    <p id="${i.id}">${i.text}</p>
    `
}


function table(i) {
    return `
    <table id="${i.id}" style="width:${i.w}px;">
        ${i.showHeader
            ? `<thead>
                <tr>
                ${i.columns.map(c => `<th style="width:${c.width}px;" id="${c.field}">${c.label}</th>`)}
                </tr>
            </thead>`
            : ""
        }
        <tbody>
            ${i.row.map((r) => {
            return (
                `<tr>
                ${i.columns.map(c => `<td style="width:${c.width}px;" id="${c.field}">${r[c.field]}</td>`)}
                </tr > `
            )

        })}
        </tbody>
    </table>
    `
}



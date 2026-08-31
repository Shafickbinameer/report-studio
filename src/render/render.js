/**
 * render.js takes the pages json and turns it into the preview's markup.
 *
 * It owns page and band composition only - where a band sits on a paginated
 * page, and how the page box is drawn. Drawing the items inside a band lives in
 * items.js, because the designer canvas needs that half and none of this one.
 */

import { items, esc, px } from './items.js';


/**
 * The page margins, as padding.
 *
 * Every length goes through px() on the way into a style attribute. The page
 * block is the layout's, buildPages does not run the validator over it, and a
 * margin that arrived as a string writes `padding-top:undefinedpx` - or worse,
 * closes the attribute.
 */
const padding = (m) => `padding-top:${px(m?.top)}px;padding-left:${px(m?.left)}px;` +
    `padding-bottom:${px(m?.bottom)}px;padding-right:${px(m?.right)}px;`

/** display order */
const order = ['pageHeader', 'reportHeader', 'detail', 'reportFooter', 'pageFooter'];


export function render(json) {
    const pageConf = json.page;
    let html = `
        <main id="main-page">
            ${json.pages.map(p =>
        `
                <section id="page-${esc(p.pageNO)}" class="page"  style="height:${px(pageConf.height)}px; width:${px(pageConf.width)}px; ${padding(pageConf.margin)};position:relative">
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
        ? `position:absolute;top:${px(comp.top) + px(margin.top)}px;` +
          `left:${px(margin.left)}px;right:${px(margin.right)}px;`
        : `position:relative;`;

    /** the zone is the height; a band that outgrew it keeps its measured height */
    const height = Math.max(comp.zoneHeight ?? 0, comp.measuredHeight ?? 0);

    return `
    <div class="band" id="${esc(comp.type)}-${esc(pageNO)}" style="${box}${height > 0 ? `height:${px(height)}px` : ""}" data-band-type="${esc(comp.type)}">
        ${items(comp.items)}
    </div>
    `
}

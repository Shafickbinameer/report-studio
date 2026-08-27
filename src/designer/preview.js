/**
 * preview.js runs the report the designer is holding and draws the result.
 *
 * This is the moment the whole seam pays off (spec 2.2): the canvas has been
 * drawing bands with items.js all along, and the preview draws pages with
 * render.js, which draws its bands with items.js. So switching between them is
 * a different *wrapper* around the same drawing - the design cannot look one
 * way here and another way on paper, because there is only one way.
 *
 * What it adds over the canvas is everything the canvas cannot know: how many
 * pages there are, where the breaks fall, what the aggregates come to, and
 * whether a band that fitted at design time still fits once real rows arrive.
 *
 * It is a check, not the preview screen. Zoom, search, print and CSV live there
 * (src/preview/), and the designer links to it rather than growing a second
 * copy of a toolbar that already exists.
 */

import { buildPages } from '../engine/index.js';
import { render } from '../render/render.js';
import { ReportError } from '../engine/validate.js';
import { esc } from '../render/items.js';


/**
 * A ceiling, because real data has no reason to be small.
 *
 * Pagination itself is cheap and runs in full - the page *count* is one of the
 * things worth previewing - but mounting five thousand pages of DOM to glance
 * at a header is not. Spec 9 asks the real preview screen to mount only what is
 * near the viewport; here the honest thing is to draw a bounded number and say
 * so, rather than draw fewer and let it look like the report ends early.
 */
export const PAGE_LIMIT = 12;


/**
 * @param {object} layout
 * @param {object} data
 * @param {object} [options]
 * @param {number} [options.limit]
 * @returns {{markup: string, pageCount: number, error: string|null}}
 */
export function drawPreview(layout, data, { limit = PAGE_LIMIT } = {}) {
    let paginated;

    try {
        paginated = buildPages(layout, data ?? {});
    } catch (error) {
        return {
            markup: problem(error),
            pageCount: 0,
            error: error?.message ?? String(error)
        };
    }

    const pageCount = paginated.pages.length;
    const shown = pageCount > limit
        ? { ...paginated, pages: paginated.pages.slice(0, limit) }
        : paginated;

    return {
        markup: `
            ${render(shown)}
            ${pageCount > limit ? truncated(pageCount, limit) : ''}`,
        pageCount,
        error: null
    };
}


/**
 * A layout the engine refuses is reported in its own words. ReportError already
 * names the band and the field (spec 9.1), so there is nothing to translate.
 */
function problem(error) {
    const issues = error instanceof ReportError && error.issues?.length
        ? error.issues
        : [error?.message ?? String(error)];

    return `
    <div class="dz-problems" role="alert">
        <h2>This report will not run yet</h2>
        <ul>${issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
    </div>`;
}


function truncated(pageCount, limit) {
    return `
    <p class="dz-truncated">
        Showing the first ${limit} of ${esc(pageCount)} pages.
        Open the preview screen to read them all.
    </p>`;
}

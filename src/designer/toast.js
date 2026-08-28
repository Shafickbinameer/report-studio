/**
 * toast.js is the corner the designer says things from.
 *
 * The validator's findings used to be a banner above the page, which pushed the
 * design down the canvas every time a report was mid-edit - and setting groupBy
 * before switching the group band on is exactly the sort of half-finished state
 * a designer is in most of the time. So they moved to the top right, out of the
 * way of the thing being designed.
 *
 * A validation finding is a condition, not an event: it is true until the layout
 * is fixed. So this toast does not time out - it is dismissed, and comes back
 * when what is wrong changes. sameIssues is what decides that, and it is here
 * rather than in designer.js because it is the whole of the rule.
 */

import { esc } from '../render/items.js';


/**
 * Whether a dismissal still covers what the validator is now saying.
 *
 * Order matters as much as content: validate.js reports fields in a fixed
 * order, so a change in order is a change in what is wrong.
 *
 * @param {string[]|null} issues
 * @param {string[]|null} dismissed
 * @returns {boolean}
 */
export function sameIssues(issues, dismissed) {
    if (!Array.isArray(issues) || !Array.isArray(dismissed)) return false;
    if (issues.length !== dismissed.length) return false;

    return issues.every((line, i) => line === dismissed[i]);
}


/**
 * The problems toast.
 *
 * role="alert" rather than a live region on the container: the container is
 * always in the document, and a screen reader should hear this when it arrives
 * rather than be told a region exists.
 *
 * @param {string[]} issues what validateLayout returned
 * @returns {string} markup
 */
export function drawProblems(issues) {
    const many = issues.length > 1;

    return `
    <div class="dz-toast dz-problems" role="alert" data-role="problems">
        <div class="dz-toast-text">
            <strong class="dz-toast-title">This report will not render yet</strong>
            <ul>${issues.map(one => `<li>${esc(one)}</li>`).join('')}</ul>
        </div>
        <button type="button" class="dz-toast-close"
                data-action="dismiss-problems"
                title="Dismiss${many ? ` ${issues.length} problems` : ''}"
                aria-label="Dismiss${many ? ` ${issues.length} problems` : ''}"
            >&times;</button>
    </div>`;
}

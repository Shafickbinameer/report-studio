/**
 * chrome.js is the viewer's own markup: the toolbar, the floating pager and the
 * export dialog.
 *
 * It lives here rather than in a page because the viewer is something an
 * application mounts, and an API whose first instruction is "copy these 144
 * lines of HTML into your app" is not an API. createDesigner has always taken
 * one empty element and built what it needs inside it; this is the viewer
 * catching up.
 *
 * Ids became data-roles on the way: an id may appear once in a document, and
 * nothing should stop a page showing two reports side by side.
 */


/**
 * @param {object} [options]
 * @param {string} [options.title] what the brand corner reads
 * @returns {string} the whole of the viewer's chrome
 */
export function chrome({ title = 'Report Studio' } = {}) {
    return `
<!--
        A header, not role="toolbar": that role promises arrow-key roving focus
        between the controls, and here the arrow keys page the report instead.
    -->
    <header class="toolbar" data-role="bar" aria-label="Report tools">
        <div class="toolbar-brand">${title}</div>

        <div class="toolbar-centre">
            <div class="toolbar-group toolbar-search">
                <!--
                    Buttons cannot live inside an <input>, so the wrapper draws
                    the field and the input inside it draws no chrome of its own.
                -->
                <div class="search-field">
                    <input type="search" data-role="query" placeholder="Search the report  (ctrl+K)"
                        title="Search the report (ctrl+K)"
                        aria-label="Search the report" spellcheck="false">
                    <span class="hits" data-role="hits" data-state="idle" aria-live="polite"></span>
                    <button type="button" data-role="hit-prev" title="Previous match (shift+enter)"
                        aria-label="Previous match">&#8593;</button>
                    <button type="button" data-role="hit-next" title="Next match (enter)"
                        aria-label="Next match">&#8595;</button>
                </div>
            </div>

            <div class="toolbar-group toolbar-zoom">
                <button type="button" data-role="zoom-out" title="Zoom out (ctrl+-)"
                    aria-label="Zoom out">&#8722;</button>

                <!--
                    A listbox rather than a <select>: option items are drawn by
                    the operating system, so they cannot take the palette.
                -->
                <div class="dropdown" data-role="zoom-dropdown">
                    <button type="button" class="dropdown-trigger" data-role="zoom"
                        aria-haspopup="listbox" aria-expanded="false" aria-label="Zoom level">
                        <span class="dropdown-value">100%</span>
                        <span class="dropdown-caret" aria-hidden="true"></span>
                    </button>

                    <ul class="dropdown-menu" data-role="zoom-menu" role="listbox"
                        aria-label="Zoom level" hidden>
                        <li class="dropdown-item" role="option" tabindex="-1" data-value="fit">Fit width</li>
                        <li class="dropdown-item" role="option" tabindex="-1" data-value="0.5">50%</li>
                        <li class="dropdown-item" role="option" tabindex="-1" data-value="0.75">75%</li>
                        <li class="dropdown-item" role="option" tabindex="-1" data-value="1"
                            data-selected="true">100%</li>
                        <li class="dropdown-item" role="option" tabindex="-1" data-value="1.25">125%</li>
                        <li class="dropdown-item" role="option" tabindex="-1" data-value="1.5">150%</li>
                        <li class="dropdown-item" role="option" tabindex="-1" data-value="2">200%</li>
                        <li class="dropdown-item" role="option" tabindex="-1" data-value="3">300%</li>
                    </ul>
                </div>

                <button type="button" data-role="zoom-in" title="Zoom in (ctrl++)"
                    aria-label="Zoom in">&#43;</button>
            </div>
        </div>

        <div class="toolbar-group toolbar-save">
            <button type="button" data-role="print" title="Print or save as PDF (ctrl+P)">
                Print</button>
            <button type="button" data-role="export" title="Export the report (ctrl+X)">
                Export&#8230;</button>
        </div>
    </header>

    <div class="viewport" data-role="viewport"></div>

    <!-- paging floats over the report rather than taking a strip of it -->
    <div class="pager" data-role="pager" role="toolbar" aria-label="Page navigation">
        <button type="button" data-role="prev" title="Previous page (left arrow)"
            aria-label="Previous page">&#8249;</button>

        <label class="page-of">
            <input type="number" data-role="current" min="1" value="1" aria-label="Current page">
            <span>of</span>
            <span data-role="total">1</span>
        </label>

        <button type="button" data-role="next" title="Next page (right arrow)"
            aria-label="Next page">&#8250;</button>
    </div>



    <!--
        Hand-written rather than a <dialog>: the element is still unimplemented
        in the environment the specs run in, and a stubbed showModal would test
        the stub instead of the behaviour.
    -->
    <div class="modal" data-role="export-modal" hidden>
        <div class="modal-backdrop" data-role="export-backdrop"></div>

        <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="export-title">
            <h2 id="export-title">Export report</h2>

            <div class="modal-formats" role="radiogroup" aria-labelledby="export-title">
                <label class="format">
                    <input type="radio" name="export-format" value="pdf" checked>
                    <span class="format-body">
                        <span class="format-name">PDF</span>
                        <span class="format-note">Opens the print dialog - choose "Save as PDF"</span>
                    </span>
                </label>

                <label class="format">
                    <input type="radio" name="export-format" value="csv">
                    <span class="format-body">
                        <span class="format-name">CSV</span>
                        <span class="format-note">Every text line and table row, in report order</span>
                    </span>
                </label>
            </div>

            <p class="modal-summary" data-role="export-summary" aria-live="polite"></p>

            <div class="modal-actions">
                <button type="button" data-role="export-cancel">Cancel</button>
                <button type="button" class="is-primary" data-role="export-confirm">Export</button>
            </div>
        </div>
    </div>
`;
}

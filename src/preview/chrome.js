/**
 * chrome.js is the viewer's own markup: the toolbar, the floating pager and the
 * export menu.
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
 * The toolbar's and the pager's glyphs, drawn rather than typed: a character
 * such as &#8249; sits on the font's baseline and varies with it, where these
 * sit on one 16px grid and take their colour from the button.
 */
const glyph = (body, size = 16) => `<svg viewBox="0 0 16 16" width="${size}" height="${size}"
    fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

const GLYPHS = {
    up: glyph('<path d="M4.5 10 8 6.5l3.5 3.5"/>', 14),
    down: glyph('<path d="M4.5 6 8 9.5 11.5 6"/>', 14),
    left: glyph('<path d="M9.5 4.5 6 8l3.5 3.5"/>'),
    right: glyph('<path d="M6.5 4.5 10 8l-3.5 3.5"/>'),
    minus: glyph('<path d="M4 8h8"/>'),
    plus: glyph('<path d="M8 4v8M4 8h8"/>'),
    print: glyph('<path d="M4.5 6V2.75h7V6"/><rect x="2.25" y="6" width="11.5" height="5.5" rx="1"/>'
        + '<path d="M4.5 9.5h7v3.75h-7z"/>'),
    caret: glyph('<path d="M5 6.5 8 9.5l3-3"/>', 14),
    /** a sheet with its corner turned - a file, which is what each format makes */
    file: glyph('<path d="M4 2.25h5.25L12 5v8.75H4z"/><path d="M9 2.25V5.25h3"/>')
};


/**
 * The formats the export menu offers, in the order it lists them. The viewer
 * fills in each one's note - how many pages, which file - and says which are
 * available; this is only what they are called.
 */
const EXPORT_FORMATS = [
    { value: 'pdf', name: 'PDF', keys: 'Ctrl P' },
    { value: 'csv', name: 'CSV', keys: '' },
    { value: 'xlsx', name: 'Excel', keys: '' }
];


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

        Two boxes: the header is what measures its width, and the row inside
        it is what rearranges. A container query restyles what is inside the
        container, never the container, so the grid cannot be the header.
    -->
    <header class="toolbar" aria-label="Report tools">
        <div class="toolbar-row" data-role="bar">
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
                            aria-label="Previous match">${GLYPHS.up}</button>
                        <button type="button" data-role="hit-next" title="Next match (enter)"
                            aria-label="Next match">${GLYPHS.down}</button>
                    </div>
                </div>

                <div class="toolbar-group toolbar-zoom">
                    <button type="button" data-role="zoom-out" title="Zoom out (ctrl+-)"
                        aria-label="Zoom out">${GLYPHS.minus}</button>

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
                        aria-label="Zoom in">${GLYPHS.plus}</button>
                </div>
            </div>

            <div class="toolbar-group toolbar-save">
                <button type="button" data-role="print" title="Print or save as PDF (ctrl+P)">
                    ${GLYPHS.print}<span>Print</span></button>
                <!--
                    A menu rather than a dialog: choosing a format is the whole
                    of the decision, so it is made where the button is, in one
                    click - as a design tool's export menu does it. Each item
                    acts at once; there is no confirm step to come back to.
                -->
                <div class="export-menu">
                    <button type="button" data-role="export" title="Export the report (ctrl+X)"
                        aria-haspopup="menu" aria-expanded="false">
                        <span>Export</span>${GLYPHS.caret}</button>

                    <div class="export-list" data-role="export-menu" role="menu"
                        aria-label="Export as" hidden>
                        <p class="export-heading" aria-hidden="true">Export as</p>
                        ${EXPORT_FORMATS.map(f => `
                        <button type="button" class="format" role="menuitem" tabindex="-1"
                            data-format="${f.value}">
                            <span class="format-icon">${GLYPHS.file}</span>
                            <span class="format-body">
                                <span class="format-name">${f.name}</span>
                                <span class="format-note" data-role="export-note-${f.value}"></span>
                            </span>
                            ${f.keys ? `<kbd class="format-keys">${f.keys}</kbd>` : ''}
                        </button>`).join('')}
                    </div>
                </div>
            </div>
        </div>
    </header>

    <div class="viewport" data-role="viewport"></div>

    <!-- paging floats over the report rather than taking a strip of it -->
    <div class="pager" data-role="pager" role="toolbar" aria-label="Page navigation">
        <button type="button" data-role="prev" title="Previous page (left arrow)"
            aria-label="Previous page">${GLYPHS.left}</button>

        <label class="page-of">
            <input type="number" data-role="current" min="1" value="1" aria-label="Current page">
            <span>of</span>
            <span data-role="total">1</span>
        </label>

        <button type="button" data-role="next" title="Next page (right arrow)"
            aria-label="Next page">${GLYPHS.right}</button>
    </div>
`;
}

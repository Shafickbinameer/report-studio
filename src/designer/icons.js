/**
 * icons.js holds the designer's glyphs as inline SVG.
 *
 * Written out rather than pulled from an icon set: the package ships with zero
 * dependencies and no binary assets, and an inline path costs nothing to load,
 * stays sharp at any size, and takes its colour from `currentColor` - so a
 * button's hover and focus states carry the glyph with them without a second
 * file per state.
 *
 * Every glyph is aria-hidden and unfocusable. The button around it carries the
 * label, so a screen reader hears "Add a text box" once rather than twice.
 */


const wrap = (body) => `<svg viewBox="0 0 16 16" width="16" height="16"
    fill="none" stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" focusable="false">${body}</svg>`;


export const ICONS = {
    /** a serifed capital T, the tool mark every design app uses for type */
    text: wrap(`<path d="M3 3.75h10M8 3.75v8.5M6.25 12.25h3.5"/>`),

    /** a grid whose first row is ruled off, so it reads as a table not a frame */
    table: wrap(`<rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.25"/>
                 <path d="M2.25 6.5h11.5M6.5 6.5v6.25M10 6.5v6.25"/>`),

    /** an arrow curving back on itself, the mark undo has had for forty years */
    undo: wrap(`<path d="M6 4.5 2.75 7.75 6 11"/>
                <path d="M2.75 7.75h6.75a3.75 3.75 0 0 1 0 7.5H7"/>`),

    /** and its mirror, so the pair reads as one control at a glance */
    redo: wrap(`<path d="M10 4.5l3.25 3.25L10 11"/>
                <path d="M13.25 7.75H6.5a3.75 3.75 0 0 0 0 7.5H9"/>`),

    /** a folder, opened - the report being swapped for another */
    open: wrap(`<path d="M1.75 12.5V4a.75.75 0 0 1 .75-.75h3.4l1.5 1.75h5.35
                         a.75.75 0 0 1 .75.75v1.5"/>
                <path d="M1.75 12.5 3.6 7.5h11.15l-1.85 5z"/>`),

    /** braces - the mark a placeholder wears everywhere in this format */
    field: wrap(`<path d="M6.25 2.75c-1.5 0-2 .8-2 2v1.4c0 .9-.55 1.5-1.5 1.85
                          .95.35 1.5.95 1.5 1.85v1.4c0 1.2.5 2 2 2"/>
                 <path d="M9.75 2.75c1.5 0 2 .8 2 2v1.4c0 .9.55 1.5 1.5 1.85
                          -.95.35-1.5.95-1.5 1.85v1.4c0 1.2-.5 2-2 2"/>`),

    /** an arrow leaving its box: the preview screen, opened beside this one */
    external: wrap(`<path d="M9.5 2.75h3.75V6.5"/>
                    <path d="M13.25 2.75 7.5 8.5"/>
                    <path d="M11.5 9.25v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7
                             a1 1 0 0 1 1-1h3"/>`),

    /** an eye: what the report looks like once it has run */
    preview: wrap(`<path d="M1 8s2.6-4.25 7-4.25S15 8 15 8s-2.6 4.25-7 4.25S1 8 1 8z"/>
                   <circle cx="8" cy="8" r="1.9"/>`),

    /** a pencil, for going back to arranging it */
    design: wrap(`<path d="M11.4 2.85 13.15 4.6 5.3 12.45l-2.4.65.65-2.4z"/>
                  <path d="M10.15 4.1l1.75 1.75"/>`),

    /** stacked discs, the mark a database or a dataset has always had */
    data: wrap(`<ellipse cx="8" cy="4" rx="5.25" ry="2"/>
                <path d="M2.75 4v8c0 1.1 2.35 2 5.25 2s5.25-.9 5.25-2V4"/>
                <path d="M2.75 8c0 1.1 2.35 2 5.25 2s5.25-.9 5.25-2"/>`),

    /** a disk: the shutter above, the label below */
    save: wrap(`<path d="M2.75 3.25h8.5l2.5 2.5v7a.5.5 0 0 1-.5.5h-11
                         a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5z"/>
                <path d="M5 3.25v3.5h5.5v-3.5M5 13.25V9.5h6v3.75"/>`)
};


/**
 * @param {string} name
 * @returns {string} markup, or empty for a glyph that does not exist
 */
export function icon(name) {
    return ICONS[name] ?? '';
}

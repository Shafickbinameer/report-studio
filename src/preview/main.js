/**
 * The Vite playground entry. This is the demo, not the library - it is what
 * src/preview/index.html loads. The package entry is src/index.js and must stay
 * free of fixtures and DOM side effects.
 */

import { buildPages } from '../engine/index.js';
import { render } from '../render/render.js';
import { createViewer } from './viewer.js';
import { rptData, rptJson } from '../../fixtures/test-data.js';

const mount = document.getElementById('preview');
const paginated = buildPages(rptJson, rptData);

mount.innerHTML = render(paginated);

const viewer = createViewer({
    mount,
    bar: document.getElementById('toolbar'),
    pager: document.getElementById('pager'),
    modal: document.querySelector('[data-role="export-modal"]'),
    paginated
});

/** handy from the devtools console while poking at a layout */
window.viewer = viewer;

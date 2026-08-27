/**
 * The preview page's entry.
 *
 *   /preview/?report=<id>     a saved report, with its data file
 *   /preview/?fixture         the sales-summary fixture, for poking at
 *
 * There is almost nothing here, which is the point: the viewer takes one empty
 * element and builds the rest. This page is what any application using it looks
 * like, rather than a special arrangement of markup the library depends on.
 */

import { buildPages } from '../engine/index.js';
import { createViewer } from './viewer.js';
import { createStore } from '../shared/store.js';

const params = new URLSearchParams(location.search);
const wanted = params.get('report');


async function load() {
    if (wanted) {
        const store = createStore();

        const [layout, data] = await Promise.all([
            store.load(wanted),
            store.loadData(wanted)
        ]);

        /**
         * A report with no data file still renders - the placeholders come out
         * empty, which is a truthful preview of a report nobody has supplied
         * data for, and better than refusing to draw it.
         */
        return { layout, data: data ?? {} };
    }

    const { rptJson, rptData } = await import('../../fixtures/test-data.js');
    return { layout: rptJson, data: rptData };
}


load().then(({ layout, data }) => {
    /** handy from the devtools console while poking at a layout */
    window.viewer = createViewer({
        mount: '#report',
        paginated: buildPages(layout, data),
        title: layout.name || 'Report Studio'
    });
}).catch(error => {
    document.getElementById('report').innerHTML = `
        <div class="viewer-problem" role="alert">
            <h2>Nothing to preview</h2>
            <p>${escapeText(error?.message ?? String(error))}</p>
            <p>Open a report with <code>?report=&lt;name&gt;</code>.</p>
        </div>`;

    console.warn(error);
});


function escapeText(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * The designer page's entry.
 *
 * It opens whatever the URL asks for:
 *
 *   /designer/                 a blank report
 *   /designer/?report=<id>     a saved report, through the dev server
 *   /designer/?fixture         the sales-summary fixture, for poking at
 *
 * The fixture is loaded dynamically and its failure is survivable, because it
 * is a development file that sits outside what the CLI serves. A static import
 * of it would make this page work under `npm run dev` and break under
 * `npx report-studio design`, which is the shipped path of the two.
 */

import { createDesigner } from './designer.js';
import { createStore } from '../shared/store.js';

const params = new URLSearchParams(location.search);
const wanted = params.get('report');

const designer = createDesigner({ mount: '#report-designer', layout: {} });

if (wanted) {
    /**
     * Loaded through the store rather than fetched here, so a missing report
     * reports itself the way it would for anyone else.
     */
    createStore().load(wanted)
        .then(layout => designer.open(layout, wanted))
        .catch(error => console.warn(`could not open "${wanted}": ${error.message}`));
} else if (params.has('fixture')) {
    import('../../fixtures/test-data.js')
        .then(({ rptJson }) => designer.open(structuredClone(rptJson)))
        .catch(() => console.warn('the fixtures are only there under `npm run dev`'));
}

/** handy from the devtools console while poking at a layout */
window.designer = designer;

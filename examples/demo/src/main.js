import { buildPages, createViewer } from 'report-studio';
import { createDesigner } from 'report-studio/designer';
import 'report-studio/viewer.css';
import 'report-studio/designer.css';
import './demo.css';
import { data } from './data.js';

const REPORT = 'sales-summary';

/** the routes the Vite plugin serves: GET reads a report, PUT (the designer's Save) writes it */
const loadLayout = () => fetch(`/__reports/${REPORT}`).then(r => r.json());

const screens = {
    report: document.querySelector('#report'),
    designer: document.querySelector('#designer')
};

const hints = {
    report: 'The layout from reports/sales-summary.json, filled with data from src/data.js.',
    designer: 'Change something, press Ctrl+S, then switch back to Report.'
};

let viewer = null;
let designer = null;

/** read the saved layout every time, so a save in the designer shows up here */
async function showReport() {
    const layout = await loadLayout();

    viewer?.destroy();
    viewer = createViewer({
        mount: screens.report,
        paginated: buildPages(layout, data),
        title: layout.name
    });
}

async function showDesigner() {
    /** kept mounted while hidden, so undo history survives switching tabs */
    if (designer) return;

    designer = createDesigner({
        mount: screens.designer,
        layout: await loadLayout(),
        id: REPORT
    });
}

async function select(tab) {
    for (const [name, el] of Object.entries(screens)) el.hidden = name !== tab;

    for (const button of document.querySelectorAll('[data-tab]')) {
        button.setAttribute('aria-selected', String(button.dataset.tab === tab));
    }

    document.querySelector('[data-role="hint"]').textContent = hints[tab];

    if (tab === 'report') {
        await showReport();
    } else {
        /** the viewer listens for paging keys on the document, so it goes while hidden */
        viewer?.destroy();
        viewer = null;
        await showDesigner();
    }
}

for (const button of document.querySelectorAll('[data-tab]')) {
    button.addEventListener('click', () => select(button.dataset.tab));
}

select('report');

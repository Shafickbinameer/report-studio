import { resolve } from './engine/resolve.js';
import { rptData, rptJson } from './../fixtures/test-data.js';
import { group } from './engine/group.js';
import { measure } from './engine/measure.js';
import { paginate } from './engine/paginate.js';
import { render } from './render/render.js';

const resolved = resolve(rptJson, rptData);
const grouped = group(resolved, rptData);
const measured = measure(grouped);
const paginated = paginate(measured);


const html = render(paginated);

document.getElementById("preview").innerHTML = html;

const blob = new Blob([html], { type: 'text/html' });
const url = URL.createObjectURL(blob);

window.open(url, '_blank');


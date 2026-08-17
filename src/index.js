import { resolve } from './engine/resolve.js';
import { rptData, rptJson } from './../fixtures/test-data.js';
import { group } from './engine/group.js';
import { measure } from './engine/measure.js';
import { paginate } from './engine/paginate.js';

const resolved = resolve(rptJson, rptData);
const grouped = group(resolved, rptData);
const measured = measure(grouped);
// const paginated = paginate(measured);
console.debug("++++++++++++++++++++++++++++++++++++")
console.debug("paginated:", JSON.stringify(measured, null, 2))
console.debug("++++++++++++++++++++++++++++++++++++")


import { resolve } from './engine/resolve.js';
import { rptData, rptJson } from './../fixtures/test-data.js';
import { group } from './engine/group.js';  

const resolved = resolve(rptJson, rptData);
const grouped = group(resolved, rptData);

console.debug("Grouped Report JSON:", JSON.stringify(grouped, null, 2));
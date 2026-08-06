import { resolve } from './engine/resolve.js';
import { rptData, rptJson } from './../fixtures/test-data.js';
import { group } from './engine/group.js'; 
import { measure } from './engine/measure.js'; 

const resolved = resolve(rptJson, rptData);
const grouped = group(resolved, rptData);
const measured = measure(grouped);

console.debug("grouped:", measured);

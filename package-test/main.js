/**
 * The whole of what an application does: fetch a layout, supply the data, and
 * hand both to the viewer.
 */

import { buildPages, createViewer } from 'report-studio';

const layout = await fetch('./reports/tetsing-package.json').then(r => r.json());
const data = {
    name: "Shafick",
    address: "Akshya Nagar 1st Block 1st Cross, Rammurthy Nagar, Bangalore - 560016",
    friends: Array.from({ length: 5000 }, (_, i) => ({
        name: `Name ${i + 1}`,
        age: 20 + (i % 41),           // Ages: 20–60
        salary: 25000 + (i * 137),    // Dummy salary
        address: `Address ${i + 1}`
    }))
};

createViewer({
    mount: '#out',
    paginated: buildPages(layout, data),
    title: layout.name
});

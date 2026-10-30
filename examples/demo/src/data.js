/**
 * The app's own data. In a real app this comes from your API or database;
 * the report only needs it keyed by the dataset names the layout uses.
 */

const customers = [
    'Acme Corp', 'Globex', 'Initech', 'Umbrella Ltd', 'Hooli', 'Stark Industries',
    'Wayne Enterprises', 'Wonka Foods', 'Cyberdyne', 'Soylent Co', 'Tyrell Corp',
    'Vandelay Imports'
];

const reps = {
    North: ['Priya Shah', 'Tom Becker'],
    South: ['Ana Lima', 'Sam Osei'],
    East: ['Mei Chen', 'Leo Novak'],
    West: ['Jo Park', 'Ravi Nair']
};

/** a fixed seed, so the report reads the same on every load */
let seed = 7;
const next = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;

const sales = [];

for (const [region, names] of Object.entries(reps)) {
    for (let i = 0; i < 9; i++) {
        const day = String(1 + Math.floor(next() * 30)).padStart(2, '0');

        sales.push({
            date: `2026-06-${day}`,
            customer: customers[Math.floor(next() * customers.length)],
            rep: names[i % names.length],
            region,
            amount: Math.round(200 + next() * 4800)
        });
    }
}

sales.sort((a, b) => a.region.localeCompare(b.region) || a.date.localeCompare(b.date));

export const data = {
    report: { period: 'June 2026', currency: 'USD' },
    sales
};

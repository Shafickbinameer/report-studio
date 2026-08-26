/**
 * Small builders so the specs read as layouts, not as walls of JSON.
 * A4 at 794x1123 with 40px margins leaves 1043px of printable height.
 */

import { buildPages } from '../../src/engine/index.js';
import { resolve } from '../../src/engine/resolve.js';
import { measure } from '../../src/engine/measure.js';
import { paginate } from '../../src/engine/paginate.js';

export const AVAILABLE_HEIGHT = 1043;

const STYLE = {
    fontFamily: 'Helvetica, Arial, sans-serif',
    fontSize: 12,
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#000000',
    align: 'left',
    background: null,
    border: null,
    padding: 0
};

export function layout({ groupBy = null, bands = [] } = {}) {
    return {
        version: 1,
        name: 'spec',
        page: {
            width: 794,
            height: 1123,
            margin: { top: 40, right: 40, bottom: 40, left: 40 }
        },
        dataset: 'items',
        groupBy,
        bands
    };
}

export function text(id, { x = 0, y = 0, w = 700, h = 20, value = id } = {}) {
    return { id, type: 'text', x, y, w, h, value, style: { ...STYLE } };
}

export function table({
    id = 'tbl',
    rowHeight = 28,
    headerHeight = 32,
    showHeader = true
} = {}) {
    return {
        id,
        type: 'table',
        x: 0, y: 0, w: 714,
        dataset: 'items',
        rowHeight,
        headerHeight,
        showHeader,
        columns: [
            { field: 'name', label: 'Item', width: 400, align: 'left' },
            { field: 'qty', label: 'Qty', width: 100, align: 'right' },
            { field: 'price', label: 'Price', width: 214, align: 'right' }
        ],
        style: { fontSize: 12, color: '#000000', borderColor: '#cccccc' }
    };
}

export function band(type, items, extra = {}) {
    return { type, items, ...extra };
}

/** n rows, all in one group unless {name} is varied by the caller */
export function rows(n, name = 'row') {
    return Array.from({ length: n }, (_, i) => ({
        name: `${name}-${i}`,
        qty: i,
        price: i * 10
    }));
}

/** rows spread evenly across the given group keys */
export function groupedRows(keys, perGroup) {
    return keys.flatMap(key =>
        Array.from({ length: perGroup }, (_, i) => ({
            name: key,
            qty: i,
            price: 10
        }))
    );
}

/** the full engine pipeline, through its public entry point */
export function run(json, data) {
    return buildPages(json, data);
}

/** pagination-only, for layouts with no table band (group() requires one) */
export function runWithoutGroup(json, data) {
    return paginate(measure(resolve(json, data)));
}

/* ---------- assertions helpers ---------- */

export function detailBands(page) {
    return page.bands.filter(b => b.type === 'detail');
}

export function itemIdsOn(page, type = 'detail') {
    return page.bands
        .filter(b => b.type === type)
        .flatMap(b => b.items.map(i => i.id));
}

/** every row the engine actually placed, flat, in page order */
export function placedRows(paginated) {
    const out = [];
    for (const page of paginated.pages) {
        for (const b of page.bands) {
            for (const i of (b.items || [])) {
                if (i.type !== 'table') continue;
                if (i.row) out.push(...i.row);
                else if (i.groups) for (const g of i.groups) out.push(...g.rows);
            }
        }
    }
    return out;
}

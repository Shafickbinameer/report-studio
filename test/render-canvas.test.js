import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToCanvas, drawPage, pageImageSources, CANVAS_DEFAULTS } from '../src/render/canvas.js';
import { wrapLines, LINE_HEIGHT_RATIO } from '../src/engine/text-metrics.js';
import {
    layout, text, table, band, rows, groupedRows, run, runWithoutGroup,
    box as boxItem, line as lineItem, image as imageItem
} from './helpers/layout.js';

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => vi.restoreAllMocks());


/**
 * A 2D context that draws nothing and remembers everything: each call is
 * logged with the state it was made in, so a spec can ask what was drawn,
 * where, and in what colour. No measureText font metrics, so the renderer's
 * own baseline approximation is what runs.
 */
function recorder() {
    const log = [];
    let state = { fillStyle: '#000000', strokeStyle: '#000000', font: '10px sans-serif', lineWidth: 1, dash: [], textAlign: 'start' };
    const stack = [];
    let path = [];

    const ctx = {
        log,
        save() { stack.push({ ...state }); },
        restore() { state = stack.pop() ?? state; },
        setTransform(...m) { log.push({ op: 'transform', m }); },
        beginPath() { path = []; },
        rect(x, y, w, h) { path.push({ rect: [x, y, w, h] }); },
        moveTo(x, y) { path.push({ move: [x, y] }); },
        lineTo(x, y) { path.push({ line: [x, y] }); },
        arcTo(...a) { path.push({ arc: a }); },
        closePath() { },
        clip() { log.push({ op: 'clip', path: [...path] }); },
        fill() { log.push({ op: 'fill', path: [...path], fillStyle: state.fillStyle }); },
        stroke() { log.push({ op: 'stroke', path: [...path], strokeStyle: state.strokeStyle, lineWidth: state.lineWidth, dash: state.dash }); },
        fillRect(x, y, w, h) { log.push({ op: 'fillRect', rect: [x, y, w, h], fillStyle: state.fillStyle }); },
        fillText(text, x, y) { log.push({ op: 'fillText', text, x, y, font: state.font, fillStyle: state.fillStyle, align: state.textAlign }); },
        drawImage(img, x, y, w, h) { log.push({ op: 'drawImage', img, rect: [x, y, w, h] }); },
        setLineDash(d) { state.dash = d; },
        measureText(t) { return { width: String(t).length * 6 }; }
    };

    for (const key of ['fillStyle', 'strokeStyle', 'font', 'lineWidth', 'textAlign']) {
        Object.defineProperty(ctx, key, {
            get: () => state[key],
            set: (v) => {
                /** a real canvas ignores a colour it cannot read */
                if ((key === 'fillStyle' || key === 'strokeStyle') && /^bogus/.test(v)) return;
                state[key] = v;
            }
        });
    }

    ctx.textBaseline = 'alphabetic';
    ctx.lineCap = 'butt';

    return ctx;
}

const ops = (ctx, op) => ctx.log.filter(e => e.op === op);
const texts = (ctx) => ops(ctx, 'fillText').map(e => e.text);

/** a built report with one band of plain items and no table */
const plain = (items, extra = {}) => runWithoutGroup(layout({ bands: [band('reportHeader', items, { height: 200, ...extra })] }), {});

const MARGIN = 40;


describe('drawPage - the page', () => {
    it('clips to the paper and fills it white', () => {
        const ctx = recorder();
        drawPage(ctx, plain([text('t', { value: 'Hi' })]));

        expect(ops(ctx, 'clip')[0].path).toEqual([{ rect: [0, 0, 794, 1123] }]);
        expect(ops(ctx, 'fillRect')[0]).toMatchObject({ rect: [0, 0, 794, 1123], fillStyle: '#ffffff' });
    });

    it('leaves the canvas transparent when the theme has no background', () => {
        const ctx = recorder();
        drawPage(ctx, plain([text('t')]), 0, { theme: { background: null } });
        expect(ops(ctx, 'fillRect')).toHaveLength(0);
    });

    it('refuses a page that does not exist, and something that is not a page list', () => {
        const report = plain([text('t')]);
        expect(() => drawPage(recorder(), report, 5)).toThrow(RangeError);
        expect(() => drawPage(recorder(), { page: {} })).toThrow(TypeError);
    });

    it('places a band at its zone, inside the margins', () => {
        const report = runWithoutGroup(layout({
            bands: [
                band('reportHeader', [text('a', { value: 'top' })], { height: 50 }),
                band('pageFooter', [text('f', { x: 10, y: 5, value: 'foot' })], { height: 30 })
            ]
        }), {});

        const footer = report.pages[0].bands.find(b => b.type === 'pageFooter');
        const ctx = recorder();
        drawPage(ctx, report);

        const foot = ops(ctx, 'fillText').find(e => e.text === 'foot');
        expect(foot.x).toBe(MARGIN + 10);
        expect(foot.y).toBeGreaterThan(MARGIN + footer.top + 5);
        expect(foot.y).toBeLessThan(MARGIN + footer.top + 5 + 12 * LINE_HEIGHT_RATIO);
    });

    it('stacks bands the engine did not anchor, as render.js does', () => {
        const report = plain([text('a', { value: 'one' })]);
        report.pages[0].bands.push({ type: 'pageFooter', zoneHeight: 20, items: [{ ...text('b', { value: 'two' }), text: 'two' }] });
        report.pages[0].bands.forEach(b => delete b.top);

        const ctx = recorder();
        drawPage(ctx, report);

        const [one, two] = ['one', 'two'].map(t => ops(ctx, 'fillText').find(e => e.text === t));
        expect(two.y - one.y).toBeCloseTo(200, 0);
    });
});


describe('drawPage - text', () => {
    it('wraps exactly as the engine measured it', () => {
        const value = 'The quick brown fox jumps over the lazy dog again and again';
        const report = plain([text('t', { w: 120, value })]);
        const item = report.pages[0].bands[0].items[0];

        const ctx = recorder();
        drawPage(ctx, report);

        expect(texts(ctx)).toEqual(wrapLines(value, 120, item.style).filter(Boolean));
    });

    it('steps each line down by the CSS line height', () => {
        const report = plain([text('t', { value: 'one\ntwo\nthree' })]);
        const ctx = recorder();
        drawPage(ctx, report);

        const ys = ops(ctx, 'fillText').map(e => e.y);
        expect(ys[1] - ys[0]).toBeCloseTo(12 * LINE_HEIGHT_RATIO, 5);
        expect(ys[2] - ys[1]).toBeCloseTo(12 * LINE_HEIGHT_RATIO, 5);
    });

    it('aligns within the item width', () => {
        const items = ['left', 'center', 'right'].map((align, n) => {
            const t = text(align, { x: 100, w: 300, y: n * 30, value: align });
            t.style.align = align;
            return t;
        });

        const ctx = recorder();
        drawPage(ctx, plain(items));

        const by = Object.fromEntries(ops(ctx, 'fillText').map(e => [e.text, e]));
        expect(by.left).toMatchObject({ x: MARGIN + 100, align: 'left' });
        expect(by.center).toMatchObject({ x: MARGIN + 250, align: 'center' });
        expect(by.right).toMatchObject({ x: MARGIN + 400, align: 'right' });
    });

    it('draws in the item font and colour', () => {
        const t = text('t', { value: 'Bold' });
        Object.assign(t.style, { fontSize: 20, fontWeight: 'bold', color: '#ff0000', fontFamily: 'Noto Sans Tamil' });

        const ctx = recorder();
        drawPage(ctx, plain([t]));

        expect(ops(ctx, 'fillText')[0]).toMatchObject({ font: 'normal bold 20px Noto Sans Tamil', fillStyle: '#ff0000' });
    });

    it('falls back to black for a colour the canvas cannot read, not the last colour used', () => {
        const a = text('a', { value: 'red' });
        a.style.color = '#ff0000';
        const b = text('b', { y: 40, value: 'bad' });
        b.style.color = 'bogus';

        const ctx = recorder();
        drawPage(ctx, plain([a, b]));

        expect(ops(ctx, 'fillText').find(e => e.text === 'bad').fillStyle).toBe(CANVAS_DEFAULTS.color);
    });
});


describe('drawPage - boxes, lines and pictures', () => {
    it('strokes a box inside its outline', () => {
        const ctx = recorder();
        drawPage(ctx, plain([boxItem('b', { x: 10, y: 10, w: 100, h: 50, borderWidth: 4, background: '#eeeeee' })]));

        expect(ops(ctx, 'fill')[0]).toMatchObject({ fillStyle: '#eeeeee', path: [{ rect: [50, 50, 100, 50] }] });
        expect(ops(ctx, 'stroke')[0]).toMatchObject({ lineWidth: 4, path: [{ rect: [52, 52, 96, 46] }] });
    });

    it('draws no outline for borderStyle none, and a dashed one as dashes', () => {
        const ctx = recorder();
        drawPage(ctx, plain([
            boxItem('a', { borderStyle: 'none' }),
            boxItem('b', { y: 80, borderStyle: 'dashed', borderWidth: 2 })
        ]));

        const strokes = ops(ctx, 'stroke');
        expect(strokes).toHaveLength(1);
        expect(strokes[0].dash).toEqual([6, 6]);
    });

    it('draws a double rule as two', () => {
        const ctx = recorder();
        drawPage(ctx, plain([lineItem('l', { thickness: 6, lineStyle: 'double' })]));
        expect(ops(ctx, 'stroke').map(s => s.lineWidth)).toEqual([2, 2]);
    });

    it('centres a rule in its box', () => {
        const ctx = recorder();
        drawPage(ctx, plain([
            lineItem('h', { x: 0, y: 0, w: 300, h: 12, thickness: 2 }),
            lineItem('v', { x: 400, y: 0, w: 12, h: 100, thickness: 2, orientation: 'vertical' })
        ]));

        const [h, v] = ops(ctx, 'stroke');
        expect(h.path).toEqual([{ move: [MARGIN, MARGIN + 6] }, { line: [MARGIN + 300, MARGIN + 6] }]);
        expect(v.path).toEqual([{ move: [MARGIN + 406, MARGIN] }, { line: [MARGIN + 406, MARGIN + 100] }]);
    });

    it('fits a picture into its box, centred', () => {
        const src = 'data:image/png;base64,AAAA';
        const picture = { naturalWidth: 200, naturalHeight: 100 };

        const ctx = recorder();
        drawPage(ctx, plain([imageItem('i', { w: 100, h: 100, src })]), 0, { images: new Map([[src, picture]]) });

        expect(ops(ctx, 'drawImage')[0].rect).toEqual([MARGIN, MARGIN + 25, 100, 50]);
    });

    it('covers when asked, and skips a picture it does not have', () => {
        const src = 'data:image/png;base64,AAAA';
        const picture = { naturalWidth: 200, naturalHeight: 100 };

        const ctx = recorder();
        drawPage(ctx, plain([
            imageItem('i', { w: 100, h: 100, src, fit: 'cover' }),
            imageItem('j', { y: 120, w: 100, h: 100, src: 'data:image/png;base64,BBBB' })
        ]), 0, { images: new Map([[src, picture]]) });

        const draws = ops(ctx, 'drawImage');
        expect(draws).toHaveLength(1);
        expect(draws[0].rect).toEqual([MARGIN - 50, MARGIN, 200, 100]);
    });

    it('never asks for a picture with an unsafe address', () => {
        const report = plain([imageItem('i', { src: 'javascript:alert(1)' }), imageItem('j', { y: 90, src: 'https://x.test/a.png' })]);
        expect([...pageImageSources(report.pages[0])]).toEqual(['https://x.test/a.png']);
    });
});


describe('drawPage - tables', () => {
    const built = (data, t = table()) => run(layout({ bands: [band('detail', [t])] }), data);

    it('prints the header and every cell, formatted', () => {
        const ctx = recorder();
        drawPage(ctx, built({ items: [{ name: 'Cable', qty: 2, price: 50 }] }));

        expect(texts(ctx)).toEqual(['Item', 'Qty', 'Price', 'Cable', '2', '50']);
    });

    it('lays columns out at the width the engine measured them at', () => {
        const ctx = recorder();
        drawPage(ctx, built({ items: rows(1) }));

        /** header row: Item at the first column's text box, Price right-aligned in the last */
        const [item, , price] = ops(ctx, 'fillText');
        expect(item.x).toBe(MARGIN + 1 + 8);
        expect(price).toMatchObject({ align: 'right', x: MARGIN + 714 - 1 - 8 });
    });

    it('fills the header row and draws it bold', () => {
        const ctx = recorder();
        drawPage(ctx, built({ items: rows(1) }));

        const head = ops(ctx, 'fillText')[0];
        expect(head.font).toMatch(/^normal 600 12px/);

        const fills = ops(ctx, 'fillRect').filter(f => f.fillStyle === CANVAS_DEFAULTS.headerBackground);
        expect(fills).toHaveLength(3);
        expect(fills[0].rect[3]).toBe(32);
    });

    it('rules every cell top and left, the last column right, the last row bottom', () => {
        const ctx = recorder();
        drawPage(ctx, built({ items: rows(2) }));

        /** 3 columns x 3 rows, two rules each, + 3 right edges + 3 bottom edges */
        const rules = ops(ctx, 'stroke').filter(s => s.strokeStyle === '#cccccc');
        expect(rules).toHaveLength(9 * 2 + 3 + 3);
    });

    it('steps rows by the heights measure.js wrote onto the table', () => {
        const report = built({ items: rows(3) });
        const tbl = report.pages[0].bands[0].items[0];

        const ctx = recorder();
        drawPage(ctx, report);

        const firstColumn = ops(ctx, 'fillText').filter(e => e.x === MARGIN + 9).map(e => e.y);
        expect(firstColumn[2] - firstColumn[1]).toBeCloseTo(tbl.rowHeights[0], 5);
    });

    it('shades a highlighted cell and draws it in the highlight colour', () => {
        const t = table();
        t.columns[1].highlight = [{ when: { op: '>', value: 1 }, style: { background: '#ffeeee', color: '#cc0000' } }];

        const ctx = recorder();
        drawPage(ctx, built({ items: rows(3) }, t));

        expect(ops(ctx, 'fillRect').filter(f => f.fillStyle === '#ffeeee')).toHaveLength(1);
        expect(ops(ctx, 'fillText').find(e => e.text === '2').fillStyle).toBe('#cc0000');
    });

    it('cuts a cell that may not wrap with an ellipsis', () => {
        const t = table();
        t.wrap = false;

        const ctx = recorder();
        drawPage(ctx, built({ items: [{ name: 'x'.repeat(200), qty: 1, price: 1 }] }, t));

        expect(texts(ctx).find(s => s.startsWith('x'))).toMatch(/…$/);
    });

    it('draws group bands across the table, with their text padded', () => {
        const report = run(layout({
            groupBy: 'name',
            bands: [
                band('groupHeader', [text('gh', { value: 'Region: {name}', h: 22 })], { height: 22 }),
                band('detail', [table()]),
                band('groupFooter', [text('gf', { value: 'Subtotal: {sum(price)}', h: 20 })], { height: 20 })
            ]
        }), { items: groupedRows(['A', 'B'], 2) });

        const ctx = recorder();
        drawPage(ctx, report);

        const all = texts(ctx);
        expect(all).toContain('Region: A');
        expect(all).toContain('Region: B');
        expect(all.filter(t => t.startsWith('Subtotal'))).toHaveLength(2);

        expect(ops(ctx, 'fillText').find(e => e.text === 'Region: A').x).toBe(MARGIN + 8);
    });
});


describe('renderToCanvas', () => {
    function fakeCanvas() {
        const ctx = recorder();
        return { width: 0, height: 0, ctx, getContext: () => ctx };
    }

    it('sizes the canvas to the page at the given scale', async () => {
        const canvas = fakeCanvas();
        const out = await renderToCanvas(plain([text('t')]), { canvas, scale: 2 });

        expect(out).toBe(canvas);
        expect([canvas.width, canvas.height]).toEqual([1588, 2246]);
        expect(ops(canvas.ctx, 'transform')[0].m).toEqual([2, 0, 0, 2, 0, 0]);
    });

    it('loads every picture before drawing, and survives one that fails', async () => {
        const good = 'data:image/png;base64,AAAA';
        const bad = 'data:image/png;base64,BBBB';
        const report = plain([imageItem('a', { src: good }), imageItem('b', { y: 90, src: bad })]);

        const loadImage = vi.fn(async (src) => {
            if (src === bad) throw new Error('nope');
            return { naturalWidth: 10, naturalHeight: 10 };
        });

        const canvas = fakeCanvas();
        await renderToCanvas(report, { canvas, loadImage });

        expect(loadImage).toHaveBeenCalledTimes(2);
        expect(ops(canvas.ctx, 'drawImage')).toHaveLength(1);
    });

    it('asks for each font with the characters it will draw', async () => {
        const load = vi.fn(async () => []);
        vi.stubGlobal('document', { fonts: { load } });

        try {
            const t = text('t', { value: 'தமிழ்' });
            t.style.fontFamily = 'Noto Sans Tamil';
            await renderToCanvas(plain([t]), { canvas: fakeCanvas() });
        } finally {
            vi.unstubAllGlobals();
        }

        expect(load).toHaveBeenCalledWith('normal normal 12px Noto Sans Tamil', 'தமிழ்');
    });

    it('needs a canvas where there is no browser', async () => {
        await expect(renderToCanvas(plain([text('t')]))).rejects.toThrow(/needs a canvas/);
    });
});

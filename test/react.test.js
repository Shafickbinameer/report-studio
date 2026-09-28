/**
 * @vitest-environment jsdom
 *
 * The React components, rendered by React.
 *
 * They are wrappers, so what is specified is the wrapping: that the viewer and
 * designer are mounted into the component's element and taken away with it,
 * that a re-render with the same props leaves them alone, that new data keeps
 * the reader's place, that the ref outlives a remount, and that Strict Mode's
 * mount-unmount-mount leaves exactly one of each behind.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, createRef, Component, StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { ReportViewer } from '../src/react/index.js';
import { ReportDesigner } from '../src/react/designer.js';
import { buildPages } from '../src/engine/index.js';
import { layout, table, text, band, rows } from './helpers/layout.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container = null;
let root = null;

beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    window.print = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
});

const draw = (element) => act(() => root.render(element));

/** a report long enough to run to several pages */
const report = () => layout({
    bands: [
        band('detail', [table()]),
        band('pageFooter', [text('pf', { value: 'Page {page} of {totalPages}' })], { height: 40 })
    ]
});

const pagesIn = () => container.querySelectorAll('.page').length;


describe('ReportViewer', () => {
    it('builds the pages from a layout and data, and mounts the viewer', () => {
        draw(createElement(ReportViewer, { layout: report(), data: { items: rows(80) } }));

        expect(container.querySelector('.report-viewer')).not.toBeNull();
        expect(pagesIn()).toBeGreaterThan(1);
    });

    it('takes pages already built instead', () => {
        const paginated = buildPages(report(), { items: rows(3) });
        draw(createElement(ReportViewer, { paginated }));

        expect(pagesIn()).toBe(1);
    });

    it('draws nothing, and throws nothing, before it has a layout', () => {
        draw(createElement(ReportViewer, {}));
        expect(container.querySelector('.report-viewer')).toBeNull();
    });

    it('passes className and style to its element', () => {
        draw(createElement(ReportViewer, {
            layout: report(), data: { items: rows(2) },
            className: 'my-report', style: { height: '600px' }
        }));

        const element = container.firstElementChild;
        expect(element.className).toContain('my-report');
        expect(element.style.height).toBe('600px');
    });

    it('gives the ref the viewer controls', () => {
        const ref = createRef();
        draw(createElement(ReportViewer, { ref, layout: report(), data: { items: rows(80) } }));

        expect(ref.current.page).toBe(1);
        expect(ref.current.pageCount).toBeGreaterThan(1);

        act(() => ref.current.next());
        expect(ref.current.page).toBe(2);

        act(() => ref.current.print());
        expect(window.print).toHaveBeenCalledOnce();
    });

    /** the same objects are the same report; nothing is rebuilt */
    it('leaves the viewer alone on a re-render with the same props', () => {
        const props = { layout: report(), data: { items: rows(80) } };

        draw(createElement(ReportViewer, props));
        const first = container.querySelector('.page');

        draw(createElement(ReportViewer, { ...props }));
        expect(container.querySelector('.page')).toBe(first);
    });

    it('rebuilds on new data, keeping the page and zoom the reader was on', () => {
        const ref = createRef();
        const json = report();

        draw(createElement(ReportViewer, { ref, layout: json, data: { items: rows(80) } }));

        act(() => {
            ref.current.show(1);
            ref.current.setZoom(1.5);
        });

        draw(createElement(ReportViewer, { ref, layout: json, data: { items: rows(90) } }));

        expect(ref.current.page).toBe(2);
        expect(ref.current.zoom).toBe(1.5);
        expect(container.querySelectorAll('.report-viewer')).toHaveLength(1);
    });

    it('keeps the reader in range when new data has fewer pages', () => {
        const ref = createRef();
        const json = report();

        draw(createElement(ReportViewer, { ref, layout: json, data: { items: rows(80) } }));
        act(() => ref.current.show(ref.current.pageCount - 1));

        draw(createElement(ReportViewer, { ref, layout: json, data: { items: rows(2) } }));

        expect(ref.current.page).toBe(1);
    });

    it('takes the viewer away with it', () => {
        draw(createElement(ReportViewer, { layout: report(), data: { items: rows(3) } }));
        act(() => root.unmount());

        expect(container.innerHTML).toBe('');

        /** its keyboard shortcuts went too */
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true }));
        expect(window.print).not.toHaveBeenCalled();

        root = createRoot(container);
    });

    it('mounts one viewer under Strict Mode', () => {
        draw(createElement(StrictMode, null,
            createElement(ReportViewer, { layout: report(), data: { items: rows(3) } })));

        expect(container.querySelectorAll('.report-viewer')).toHaveLength(1);
        expect(container.querySelectorAll('[data-role="viewport"]')).toHaveLength(1);
    });

    /** a report the engine refuses is the host's to show, through a boundary */
    it('throws a report it cannot build to an error boundary', () => {
        vi.spyOn(console, 'error').mockImplementation(() => { });

        class Boundary extends Component {
            constructor(props) { super(props); this.state = { error: null }; }
            static getDerivedStateFromError(error) { return { error }; }
            render() {
                return this.state.error
                    ? createElement('p', { id: 'failed' }, this.state.error.name)
                    : this.props.children;
            }
        }

        draw(createElement(Boundary, null,
            createElement(ReportViewer, { layout: { bands: 'nope' }, data: {} })));

        expect(container.querySelector('#failed').textContent).toBe('ReportError');
    });
});


describe('ReportDesigner', () => {
    const start = () => layout({
        bands: [band('detail', [text('t1', { w: 200, h: 40 })])]
    });

    const press = (action) => container.querySelector(`[data-action="${action}"]`)
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    it('mounts the designer on the layout it is given', () => {
        draw(createElement(ReportDesigner, { layout: start(), guardUnload: false }));

        expect(container.querySelector('.report-designer')).not.toBeNull();
        expect(container.querySelector('[data-item-id="t1"]')).not.toBeNull();
    });

    it('tells the host about every edit', () => {
        const onChange = vi.fn();
        draw(createElement(ReportDesigner, { layout: start(), onChange, guardUnload: false }));

        act(() => press('add-text'));

        expect(onChange).toHaveBeenCalled();
        const latest = onChange.mock.calls.at(-1)[0];
        expect(latest.bands[0].items.map(i => i.id)).toEqual(['t1', 'text-1']);
    });

    /** a new arrow function every render is the common case */
    it('calls the latest onChange without remounting for it', () => {
        const first = vi.fn();
        const second = vi.fn();
        const json = start();

        draw(createElement(ReportDesigner, { layout: json, onChange: first, guardUnload: false }));
        const designerRoot = container.querySelector('.report-designer');

        draw(createElement(ReportDesigner, { layout: json, onChange: second, guardUnload: false }));
        act(() => press('add-text'));

        expect(container.querySelector('.report-designer')).toBe(designerRoot);
        expect(second).toHaveBeenCalled();
        expect(first).not.toHaveBeenCalled();
    });

    /** the designer owns the layout once open; the prop is where it starts */
    it('keeps its edits when the host re-renders with the layout it started from', () => {
        const ref = createRef();
        const json = start();

        draw(createElement(ReportDesigner, { ref, layout: json, guardUnload: false }));
        act(() => press('add-text'));
        draw(createElement(ReportDesigner, { ref, layout: start(), guardUnload: false }));

        expect(ref.current.layout.bands[0].items).toHaveLength(2);
    });

    it('opens a fresh designer when the id changes', () => {
        const ref = createRef();

        draw(createElement(ReportDesigner, { ref, id: 'a', layout: start(), guardUnload: false }));
        act(() => press('add-text'));

        draw(createElement(ReportDesigner, { ref, id: 'b', layout: start(), guardUnload: false }));

        expect(ref.current.layout.bands[0].items).toHaveLength(1);
        expect(container.querySelectorAll('.report-designer')).toHaveLength(1);
    });

    it('gives the ref the designer handle', () => {
        const ref = createRef();
        draw(createElement(ReportDesigner, { ref, layout: start(), guardUnload: false }));

        expect(ref.current.layout.bands[0].items[0].id).toBe('t1');
        expect(typeof ref.current.redraw).toBe('function');
    });

    it('mounts one designer under Strict Mode, and takes it away with it', () => {
        draw(createElement(StrictMode, null,
            createElement(ReportDesigner, { layout: start(), guardUnload: false })));

        expect(container.querySelectorAll('.report-designer')).toHaveLength(1);

        act(() => root.unmount());
        expect(container.innerHTML).toBe('');
        root = createRoot(container);
    });
});


describe('React stays in src/react', () => {
    const SRC = resolvePath(process.cwd(), 'src');

    it('is imported nowhere else in the package', () => {
        const offenders = [];

        const walk = (dir) => {
            for (const entry of readdirSync(join(SRC, dir), { withFileTypes: true })) {
                const path = join(dir, entry.name);

                if (entry.isDirectory()) {
                    if (path !== 'react') walk(path);
                    continue;
                }

                if (!entry.name.endsWith('.js')) continue;

                const source = readFileSync(join(SRC, path), 'utf8');
                if (/from\s+['"]react(-dom)?(\/[^'"]*)?['"]/.test(source)) offenders.push(path);
            }
        };

        walk('');
        expect(offenders).toEqual([]);
    });
});


describe('a store that is not one', () => {
    /** a folder path is the natural mistake, and used to fail as "l.list is not a function" */
    it('says what a store is when given a path, and how to use a folder', () => {
        vi.spyOn(console, 'error').mockImplementation(() => { });

        expect(() => draw(createElement(ReportDesigner, { store: './reports', guardUnload: false })))
            .toThrow(/store must be an object with list, load and save functions, not a path \("\.\/reports"\).*reportStudio\(\{ dir: '\.\/reports' \}\)/);
    });

    it('names what an object store is missing', () => {
        vi.spyOn(console, 'error').mockImplementation(() => { });

        expect(() => draw(createElement(ReportDesigner, {
            store: { list: async () => [] }, guardUnload: false
        }))).toThrow(/store is missing load, save/);
    });

    it('takes a store with list, load and save', () => {
        const store = { list: async () => [], load: async () => ({}), save: async () => ({}) };
        draw(createElement(ReportDesigner, { store, guardUnload: false }));

        expect(container.querySelector('.report-designer')).not.toBeNull();
    });
});

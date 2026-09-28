/**
 * report-studio/react - the viewer as a React component.
 *
 * A wrapper and nothing more. The viewer is plain DOM and builds everything
 * inside one element, so the component renders that element and hands it to
 * createViewer in an effect - the same two steps a plain-JS host takes. None of
 * the engine or the viewer knows React is here, which is what keeps the rest of
 * the package usable without it (see framework-free.test.js).
 *
 * Written with createElement rather than JSX, so the package ships as it is
 * built and asks no JSX transform of the host.
 *
 * The designer is a separate entry, `report-studio/react/designer`, for the
 * reason the core package gives: most applications ship reports, not the tool
 * that drew them.
 */

import {
    createElement, forwardRef, useEffect, useImperativeHandle, useMemo, useRef
} from 'react';
import { buildPages } from '../engine/index.js';
import { createViewer } from '../preview/viewer.js';


/** the viewer's methods, forwarded from the ref to whichever viewer is mounted */
const VIEWER_METHODS = [
    'show', 'next', 'prev', 'find', 'print', 'downloadCSV',
    'openExport', 'closeExport', 'confirmExport',
    'setZoom', 'zoomIn', 'zoomOut', 'fitWidth'
];


/**
 * The report viewer: paging, zoom, search, print and CSV.
 *
 * Give it a layout and data, or pages already built with buildPages. New data
 * builds new pages and remounts the viewer inside the same element, keeping the
 * page and the zoom the reader was on - a report refreshed under someone should
 * not throw them back to page one at 100%.
 *
 * A layout or data the engine cannot use throws while rendering, as a ReportError,
 * so an error boundary around the component is where a host shows it.
 *
 * Import `report-studio/viewer.css` once, and give the component a height: the
 * viewer fills its element and scrolls inside it.
 *
 * @param {object} props
 * @param {object} [props.layout] a layout the designer saved
 * @param {object} [props.data] the data for it, keyed by dataset name
 * @param {object} [props.paginated] a buildPages result, in place of layout and data
 * @param {string} [props.title] shown in the viewer's toolbar
 * @param {string} [props.className]
 * @param {object} [props.style]
 * @param {object} ref receives the viewer's controls: show, next, prev, find,
 *   print, downloadCSV, setZoom, zoomIn, zoomOut, fitWidth, and page, pageCount
 *   and zoom
 */
export const ReportViewer = forwardRef(function ReportViewer(
    { layout, data, paginated, title, className, style }, ref
) {
    const element = useRef(null);
    const viewer = useRef(null);

    /** where the reader was, carried across a remount */
    const place = useRef(null);

    /**
     * Built during render rather than in the effect, so a layout the engine
     * refuses throws where an error boundary can catch it. Memoised on the
     * objects themselves: a host that passes the same layout and data gets the
     * same pages, and nothing is rebuilt.
     */
    const pages = useMemo(
        () => paginated ?? (layout ? buildPages(layout, data ?? {}) : null),
        [paginated, layout, data]
    );

    useEffect(() => {
        if (!pages || !element.current) return undefined;

        const mounted = createViewer({ mount: element.current, paginated: pages, title });
        viewer.current = mounted;

        const was = place.current;
        if (was) {
            mounted.setZoom(was.zoom);
            mounted.show(Math.min(was.page, mounted.pageCount) - 1);
        }

        return () => {
            place.current = { page: mounted.page, zoom: mounted.zoom };
            mounted.destroy();
            if (viewer.current === mounted) viewer.current = null;
        };
    }, [pages, title]);

    /**
     * One object for the life of the component, forwarding to whichever viewer
     * is mounted now - so a host that kept the ref across a data refresh is not
     * left holding a destroyed viewer.
     */
    useImperativeHandle(ref, () => {
        const handle = {
            get page() { return viewer.current?.page ?? 0; },
            get pageCount() { return viewer.current?.pageCount ?? 0; },
            get zoom() { return viewer.current?.zoom ?? 1; }
        };

        for (const name of VIEWER_METHODS) {
            handle[name] = (...args) => viewer.current?.[name]?.(...args);
        }

        return handle;
    }, []);

    return createElement('div', { ref: element, className, style });
});

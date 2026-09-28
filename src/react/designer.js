/**
 * report-studio/react/designer - the designer as a React component.
 *
 * The same kind of wrapper as the viewer's: one element, and createDesigner
 * mounted into it in an effect.
 *
 * The designer owns the layout while it is open. Every edit, undo and redo is
 * made to its own copy, so the `layout` prop is where it *starts* - like an
 * input's defaultValue - and `onChange` is how the host hears where it has got
 * to. Remounting on every change would throw away the selection, the history
 * and whatever the user was typing. To open a different report, change `id`
 * (or the component's `key`), which is a different report and a fresh designer.
 */

import {
    createElement, forwardRef, useEffect, useImperativeHandle, useRef
} from 'react';
import { createDesigner } from '../designer/designer.js';


/**
 * The report designer.
 *
 * Import `report-studio/designer.css` once, and give the component a height.
 *
 * @param {object} props
 * @param {object} [props.layout] the report to start from; absent starts a blank one
 * @param {string} [props.id] the report's filename stem. Changing it opens a
 *   fresh designer on whatever `layout` is then
 * @param {object} [props.store] where Open and Save read and write - see the
 *   README; the dev server's routes when absent
 * @param {boolean} [props.guardUnload=true] ask before a tab with unsaved
 *   changes closes. Read once, when the designer mounts
 * @param {(layout: object) => void} [props.onChange] the layout after every
 *   edit. The designer's own object: clone it before keeping it
 * @param {string} [props.className]
 * @param {object} [props.style]
 * @param {object} ref receives the designer's handle: layout, redraw,
 *   togglePreview, select and the rest createDesigner returns
 */
export const ReportDesigner = forwardRef(function ReportDesigner(
    { layout, id = null, store, guardUnload = true, onChange, className, style }, ref
) {
    const element = useRef(null);
    const designer = useRef(null);

    /**
     * The latest of the props read at mount, so a host passing a new arrow
     * function every render - which is most of them - gets its current callback
     * called, without the designer being torn down to pick it up.
     */
    const latest = useRef({ layout, store, guardUnload, onChange });
    latest.current = { layout, store, guardUnload, onChange };

    useEffect(() => {
        if (!element.current) return undefined;

        const mounted = createDesigner({
            mount: element.current,
            layout: latest.current.layout,
            id,
            store: latest.current.store,
            guardUnload: latest.current.guardUnload,
            onChange: (next) => latest.current.onChange?.(next)
        });

        designer.current = mounted;

        return () => {
            mounted.destroy();
            if (designer.current === mounted) designer.current = null;
        };
    }, [id]);

    /** forwards to whichever designer is mounted, like the viewer's ref */
    useImperativeHandle(ref, () => new Proxy({}, {
        get(_, name) {
            const current = designer.current;
            if (!current) return undefined;

            const value = current[name];
            return typeof value === 'function' ? value.bind(current) : value;
        }
    }), []);

    return createElement('div', { ref: element, className, style });
});

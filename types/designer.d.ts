/**
 * report-studio/designer - the visual report designer.
 */

import type { BandType, Layout, ReportData } from './layout.js';
import type { WindowOptions } from './index.js';

export type * from './layout.js';


/**
 * Where the designer's Open and Save read and write. Leave it out to use the
 * dev server's routes (`npx report-studio design` or the Vite plugin).
 */
export interface ReportStore {
    /** the reports there are; the picker shows `name` and opens `id` */
    list(): Promise<Array<{ id: string; name: string; [key: string]: unknown }>>;
    load(id: string): Promise<Layout>;
    save(id: string, layout: Layout): Promise<unknown>;
    /** resolve to null, not throw, when the report has no data yet */
    loadData?(id: string): Promise<ReportData | null>;
    saveData?(id: string, data: ReportData): Promise<unknown>;
    /** enables Delete in the report picker */
    remove?(id: string): Promise<unknown>;
}

export interface DesignerOptions {
    /** the element to take over, or a selector for it */
    mount: Element | string;
    /** the report to edit; absent starts a blank one */
    layout?: Layout;
    /** the report's filename stem, when it has one */
    id?: string | null;
    store?: ReportStore;
    /** confirm before a tab with unsaved changes closes; default true */
    guardUnload?: boolean;
    /**
     * Called after every edit, undo and redo. Receives the designer's own
     * object: clone it before keeping it.
     */
    onChange?: ((layout: Layout) => void) | null;
}

export interface DesignerSelection {
    band: BandType;
    id: string;
}

export interface DesignerHandle {
    /** the layout as it currently stands */
    readonly layout: Layout;
    readonly mode: 'design' | 'preview';
    /** the data the report asks for, derived from the layout */
    readonly sampleData: ReportData;
    /** the most recently selected item, or null */
    readonly selection: DesignerSelection | null;
    /** every selected item, oldest first */
    readonly selections: DesignerSelection[];
    /** the filename stem the report is saved under, or null */
    readonly id: string | null;
    /** whether there are unsaved changes */
    readonly dirty: boolean;
    select(
        next: DesignerSelection | DesignerSelection[] | null,
        options?: { add?: boolean }
    ): void;
    togglePreview(): Promise<void>;
    /** swap the report being edited; returns its validation issues */
    open(layout: Layout | null, id?: string | null): string[];
    /** save where it came from, asking for a name the first time */
    save(): Promise<void>;
    redraw(): void;
    destroy(): void;
}

/** mounts the designer into an element */
export function createDesigner(options: DesignerOptions): DesignerHandle;

/**
 * Opens the designer in a window of its own. Call it from a click or a keypress.
 * @returns null when the browser blocked the window
 */
export function openDesignerWindow(
    options: Omit<DesignerOptions, 'mount'> & WindowOptions
): (DesignerHandle & { window: Window }) | null;

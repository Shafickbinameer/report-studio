/**
 * report-studio - the engine and the viewer.
 */

import type {
    Band, BandType, Layout, PaginatedReport, Page, ReportData, TableItem, TextStyle
} from './layout.js';

export type * from './layout.js';


/* ---------------------------------------------------------------- engine */

/**
 * Turns a layout file plus your data into a page list.
 * @throws {ReportError} when the layout or data cannot be used
 */
export function buildPages(layout: Layout, data: ReportData): PaginatedReport;

/** stage 1 of buildPages: fills in placeholders from the data */
export function resolve(layout: Layout, data: ReportData): Layout;
/** stage 2: splits the grouped table's rows into groups */
export function group(resolved: Layout, data: ReportData): Layout;
/** stage 3: measures text and table rows */
export function measure(grouped: Layout): Layout;
/** stage 4: breaks the measured report into pages */
export function paginate(measured: Layout): PaginatedReport;

/**
 * Everything wrong with a layout, as readable messages.
 * @returns an empty array when the layout is usable
 */
export function validateLayout(layout: unknown): string[];

/** thrown for a layout or data the engine cannot work with */
export class ReportError extends Error {
    constructor(message: string, issues?: string[]);
    name: 'ReportError';
    issues: string[];
}

export interface SearchOptions {
    caseSensitive?: boolean;
}

export interface SearchMatch {
    pageNO: number;
    bandType: BandType;
    itemId: string;
    /** the table column it was found in; null for a text item */
    field: string | null;
    text: string;
    start: number;
    end: number;
}

/** every occurrence of `query` in a built report, in page order */
export function search(pages: Page[], query: string, options?: SearchOptions): SearchMatch[];

/** the distinct page numbers a query appears on, in order */
export function searchPages(pages: Page[], query: string, options?: SearchOptions): number[];

export interface PageRegionsOptions {
    bands: Partial<Record<BandType, Band>>;
    contentHeight: number;
    isFirstPage: boolean;
    isLastPage: boolean;
}

export function pageRegions(options: PageRegionsOptions): Record<string, unknown>;
export function bandZoneHeight(band: Band | null, contentHeight: number): number;
export function resolveHeight(
    value: number | string | undefined,
    contentHeight: number,
    fallback?: number | string
): number;
export const DEFAULT_BAND_HEIGHTS: Readonly<Record<string, string>>;

export interface CSVOptions {
    /** the id of the table to write; the first when absent */
    table?: string;
    /** default `','`; use `';'` where Excel expects it */
    delimiter?: string;
    /** default `'\r\n'` */
    newline?: string;
    /** emit the column labels as the first row; default true */
    header?: boolean;
    /** prepend the group key on a grouped table; default true */
    groupColumn?: boolean;
    /** default `'Group'` */
    groupLabel?: string;
    /** stop cells starting `=`, `+`, `-` or `@` running as formulas; default true */
    neutraliseFormulas?: boolean;
}

export type ReportCSVOptions = Pick<CSVOptions, 'delimiter' | 'newline' | 'neutraliseFormulas'>;

/** one table's rows as CSV text; empty when there is no such table */
export function toCSV(pages: Page[], options?: CSVOptions): string;

/** the whole report as CSV, one row per line in the order it is read */
export function toReportCSV(pages: Page[], options?: ReportCSVOptions): string;

/** a download filename from the report's name */
export function reportFilename(paginated: { name?: string }, extension?: string): string;

/** the tables a built report holds, in the order they first appear */
export function reportTables(pages: Page[]): Array<{ id: string; columns: string[] }>;

/** every table item in a layout, in the order they are drawn */
export function tablesOf(layout: Layout): TableItem[];

/** the dataset a table reads: its own, or the layout's */
export function datasetOf(table: TableItem, layout: Layout): string | null;

/** the grouped table and its field, or null when nothing is grouped */
export function groupingOf(layout: Layout): { table: TableItem; by: string } | null;

/** width of one line of text, in pixels */
export function measureText(text: string, style?: TextStyle): number;

/** greedy word wrap to `width` pixels */
export function wrapLines(text: string, width: number, style?: TextStyle): string[];

/** rendered height of wrapped text, in pixels */
export function textHeight(text: string, width: number, style?: TextStyle): number;

/** CSS line-height multiplier the report draws text at */
export const LINE_HEIGHT_RATIO: number;


/* ---------------------------------------------------------------- render */

/** a built report as HTML markup, with no viewer around it */
export function render(paginated: PaginatedReport): string;


/* ---------------------------------------------------------------- viewer */

export interface ViewerOptions {
    /** the element to take over, or a selector for it */
    mount: Element | string;
    /** a buildPages result */
    paginated: PaginatedReport;
    /** shown in the viewer's toolbar */
    title?: string;
}

export interface ViewerHandle {
    /** go to a page, 0-based */
    show(index: number): void;
    next(): void;
    prev(): void;
    find(query: string): void;
    print(): void;
    /** false when the report has nothing to write */
    downloadCSV(): boolean;
    openExport(): void;
    closeExport(): void;
    confirmExport(): void;
    setZoom(zoom: number): void;
    zoomIn(): void;
    zoomOut(): void;
    fitWidth(): void;
    destroy(): void;
    /** the current page, 1-based */
    readonly page: number;
    readonly pageCount: number;
    readonly zoom: number;
    readonly exportOpen: boolean;
}

export interface WindowOptions {
    width?: number;
    height?: number;
    /** passed to window.open as given */
    features?: string;
}

/** mounts the report viewer into an element */
export function createViewer(options: ViewerOptions): ViewerHandle;

/**
 * Opens the viewer in a window of its own. Call it from a click or a keypress.
 * @returns null when the browser blocked the window
 */
export function openViewerWindow(
    options: Omit<ViewerOptions, 'mount'> & WindowOptions
): (ViewerHandle & { window: Window }) | null;

export interface OpenedWindow {
    window: Window;
    document: Document;
    mount: Element;
    close(): void;
}

/**
 * Opens a blank window carrying this page's stylesheets, ready to mount into.
 * @returns null when the browser blocked the window
 */
export function openWindow(
    options?: WindowOptions & { title?: string; opener?: Window }
): OpenedWindow | null;

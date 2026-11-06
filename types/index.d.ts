/**
 * report-studio - the engine and the viewer.
 */

import type {
    Band, BandType, FormatDefaults, GroupBand, GroupFragment, GroupLevel, Layout, PaginatedReport,
    HighlightRule, Page, ReportData, TableColumn, TableItem, TextStyle, ValueFormat
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
/**
 * stage 2: binds each table to its rows and splits every grouped table's rows
 * into groups. Grouping written the older way comes out as each table's own
 * `grouping` - see normalizeGrouping.
 */
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
    /**
     * the group column's heading; default `'Group'`. A list names one column
     * per level of a nested grouping, whose columns are otherwise named after
     * the fields they group by
     */
    groupLabel?: string | string[];
    /** stop cells starting `=`, `+`, `-` or `@` running as formulas; default true */
    neutraliseFormulas?: boolean;
    /** write each cell as printed, ₹1,00,000.00, rather than its value; default false */
    formatted?: boolean;
}

export type ReportCSVOptions = Pick<CSVOptions, 'delimiter' | 'newline' | 'neutraliseFormulas'>;

/** one table's rows as CSV text; empty when there is no such table */
export function toCSV(pages: Page[], options?: CSVOptions): string;

/** the whole report as CSV, one row per line in the order it is read */
export function toReportCSV(pages: Page[], options?: ReportCSVOptions): string;

export interface XLSXOptions {
    /** include the "Report" sheet, the report as it reads; default true */
    report?: boolean;
    /** include one sheet per table; default true */
    tables?: boolean;
    /**
     * carry the report's look: fonts, colours, alignment, table grid, row
     * heights and column widths, text placed where it sits on the page, and
     * pictures, lines and boxes drawn. False writes plain data with bold
     * headers. Default true
     */
    styled?: boolean;
    /**
     * the bytes of pictures given as URLs, keyed by their src; `data:` URIs
     * need none. A picture with no bytes is left out. toXLSXAsync fills this in
     */
    images?: Record<string, Uint8Array | ArrayBuffer> | Map<string, Uint8Array | ArrayBuffer>;
    /** default `'Report'` */
    reportSheetName?: string;
    /** prepend the group key on a grouped table's sheet; default true */
    groupColumn?: boolean;
    /**
     * the group column's heading; default `'Group'`. A list names one column
     * per level of a nested grouping, whose columns are otherwise named after
     * the fields they group by
     */
    groupLabel?: string | string[];
}

/**
 * the report as an .xlsx workbook; empty when the report writes nothing.
 * Throws a RangeError when a sheet would pass Excel's row or column limit
 */
export function toXLSX(pages: Page[], options?: XLSXOptions): Uint8Array;

export interface XLSXAsyncOptions extends XLSXOptions {
    /** what fetches a picture's URL; the global fetch by default */
    fetch?: (url: string) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;
}

/**
 * toXLSX with the report's URL pictures fetched first; a picture that cannot
 * be fetched is left out rather than failing the workbook
 */
export function toXLSXAsync(pages: Page[], options?: XLSXAsyncOptions): Promise<Uint8Array>;

/** the picture URLs a report shows that need fetching to be embedded */
export function reportImageSources(pages: Page[]): string[];

/** the MIME type to give a Blob of toXLSX's bytes */
export const XLSX_MIME: string;

/** a download filename from the report's name */
export function reportFilename(paginated: { name?: string }, extension?: string): string;

/** the tables a built report holds, in the order they first appear */
export function reportTables(pages: Page[]): Array<{ id: string; columns: string[] }>;

/** every table item in a layout, in the order they are drawn */
export function tablesOf(layout: Layout): TableItem[];

/** the dataset a table reads: its own, or the layout's */
export function datasetOf(table: TableItem, layout: Layout): string | null;

/** a grouped table, its field, and the bands its groups are drawn with */
export interface TableGrouping {
    table: TableItem;
    by: string;
    header: GroupBand | Band | null;
    footer: GroupBand | Band | null;
    /** every level, outermost first; the fields above are the first's */
    levels: Array<{ by: string; header: GroupBand | Band | null; footer: GroupBand | Band | null }>;
}

/** every grouped table, in the order they are drawn, either way it is grouped */
export function groupingsOf(layout: Layout): TableGrouping[];

/** the first grouped table, or null when nothing is grouped */
export function groupingOf(layout: Layout): TableGrouping | null;

/** the text a value prints as, under a format and the report's defaults */
export function formatValue(value: unknown, format?: ValueFormat | null, defaults?: FormatDefaults | null): string;

/** a format in one line, such as "Currency · ₹12,34,567.89" */
export function describeFormat(format?: ValueFormat | null, defaults?: FormatDefaults | null): string;

/** the Excel number format code that shows a value as formatValue prints it, or null */
export function excelNumberFormat(format?: ValueFormat | null, defaults?: FormatDefaults | null): string | null;

/** international digit groups, no symbol, ISO dates */
export const DEFAULT_FORMAT: Readonly<Required<ValueFormat>>;

/** the style the first rule that holds gives a value, or null */
export function highlightFor(
    rules: HighlightRule[] | null | undefined, value: unknown, row?: Record<string, unknown> | null
): HighlightRule['style'] | null;

/** a table cell's style: its row's rules, then its column's own on top */
export function cellHighlight(
    table: TableItem, column: TableColumn, row: Record<string, unknown>
): HighlightRule['style'] | null;

/** "None", "1 rule", "3 rules" */
export function describeHighlight(rules: HighlightRule[] | null | undefined): string;

/** ₹, 1,00,000 and dd/MM/yyyy - what the designer's one-click Indian button sets */
export const INDIAN_DEFAULTS: Readonly<FormatDefaults>;

/** the most levels a table may be grouped at; validateLayout refuses more */
export const MAX_GROUP_LEVELS: number;

/** a table's grouping levels as the layout states them; empty when it has none */
export function levelsOf(table: TableItem): GroupLevel[];

/** whether a table is grouped, by `grouping` or by the older `groupBy` */
export function isGrouped(table: TableItem): boolean;

/**
 * the bands one level of a table's groups are drawn with - the outermost's
 * when no level is named - from a layout past normalizeGrouping
 */
export function groupBandsOf(
    table: TableItem, level?: number
): { header: GroupBand | null; footer: GroupBand | null };

/**
 * a built group fragment's bands in drawing order: headers outermost first,
 * footers innermost first
 */
export function fragmentBandsOf(
    fragment: GroupFragment
): { headers: Array<GroupBand & { level?: number }>; footers: Array<GroupBand & { level?: number }> };

/**
 * A copy of a layout with grouping written one way only: `layout.groupBy`,
 * `table.groupBy` and the report's groupHeader/groupFooter bands become that
 * table's own `grouping`. Idempotent; the layout given is not changed.
 */
export function normalizeGrouping<T extends Layout>(layout: T): T;

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
    /**
     * false when the report has nothing to write. A report with pictures
     * from URLs fetches them first, so its download starts a moment later
     */
    downloadXLSX(): boolean;
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

/**
 * The layout file the designer saves, and the page list buildPages makes of it.
 *
 * Hand-written to match src/engine/validate.js. Every object also accepts
 * properties not named here, because the designer adds its own (guides, for
 * one) and a layout from a newer version should still type-check.
 */

export type BandType =
    | 'reportHeader'
    | 'pageHeader'
    | 'groupHeader'
    | 'detail'
    | 'groupFooter'
    | 'pageFooter'
    | 'reportFooter';

export type ItemType = 'text' | 'table' | 'line' | 'box' | 'image';

export type Align = 'left' | 'center' | 'right';

export type LineStyle = 'solid' | 'dashed' | 'dotted' | 'double';

/** a table's grid and a box's border may also be turned off */
export type RuleStyle = LineStyle | 'none';

export type ImageFit = 'contain' | 'cover' | 'fill';

export interface Margin {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

/** sizes in CSS pixels; A4 at 96dpi is 794 x 1123 */
export interface PageSetup {
    width: number;
    height: number;
    margin: Margin;
    [key: string]: unknown;
}

export interface TextStyle {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: string;
    fontStyle?: string;
    color?: string;
    align?: Align;
    background?: string | null;
    border?: string | null;
    padding?: number;
    [key: string]: unknown;
}

interface ItemBase {
    id: string;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    [key: string]: unknown;
}

export interface TextItem extends ItemBase {
    type: 'text';
    /** literal text and `{placeholders}`, such as `Total: {sum(amount)}` */
    value: string;
    style?: TextStyle;
}

export interface TableColumn {
    /** the row property this column shows */
    field: string;
    label?: string;
    width?: number;
    align?: Align;
    [key: string]: unknown;
}

export interface TableStyle extends TextStyle {
    borderStyle?: RuleStyle;
    borderWidth?: number;
    borderColor?: string;
    headerColor?: string;
    headerBackground?: string;
}

export interface TableItem extends ItemBase {
    type: 'table';
    columns: TableColumn[];
    rowHeight: number;
    headerHeight?: number;
    showHeader?: boolean;
    /** the dataset this table reads rows from; the layout's when absent */
    dataset?: string | null;
    /** group this table's rows by a field. One table per report may */
    groupBy?: string | null;
    /** false keeps each cell to one line with an ellipsis */
    wrap?: boolean;
    style?: TableStyle;
}

export interface LineItem extends ItemBase {
    type: 'line';
    orientation?: 'horizontal' | 'vertical';
    style?: {
        thickness?: number;
        lineStyle?: LineStyle;
        color?: string;
        [key: string]: unknown;
    };
}

export interface BoxItem extends ItemBase {
    type: 'box';
    style?: {
        borderStyle?: RuleStyle;
        borderWidth?: number;
        borderColor?: string;
        radius?: number;
        background?: string | null;
        [key: string]: unknown;
    };
}

export interface ImageItem extends ItemBase {
    type: 'image';
    /** a picture stored in the layout: a URL or a `data:` URI */
    src?: string | null;
    /** a data path, such as `company.logo`, whose value is the picture's URL */
    field?: string | null;
    fit?: ImageFit;
    alt?: string;
}

export type ReportItem = TextItem | TableItem | LineItem | BoxItem | ImageItem;

export interface Band {
    type: BandType;
    /** pixels, or a percentage of the printable height such as `'10%'` */
    height?: number | string;
    items: ReportItem[];
    [key: string]: unknown;
}

/** what the designer saves as `<name>.json` */
export interface Layout {
    version?: number;
    name?: string;
    page: PageSetup;
    /** the dataset tables read from when they name none of their own */
    dataset?: string | null;
    /** group the first table's rows by this field */
    groupBy?: string | null;
    bands: Band[];
    [key: string]: unknown;
}

/**
 * The host application's data, keyed by dataset name: arrays of rows for
 * tables, and objects or values for text placeholders.
 */
export type ReportData = Record<string, unknown>;

/** one page of a built report */
export interface Page {
    /** 1-based */
    pageNO: number;
    bands: Array<Band & Record<string, unknown>>;
    regions: Record<string, unknown>;
    [key: string]: unknown;
}

/** what buildPages returns: the layout, with every page laid out */
export interface PaginatedReport extends Layout {
    pages: Page[];
}

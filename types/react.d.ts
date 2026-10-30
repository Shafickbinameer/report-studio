/**
 * report-studio/react - the viewer as a React component.
 */

import type { CSSProperties, ForwardRefExoticComponent, RefAttributes } from 'react';
import type { Layout, PaginatedReport, ReportData } from './layout.js';
import type { ViewerHandle } from './index.js';

export type * from './layout.js';


export interface ReportViewerProps {
    /** a layout the designer saved */
    layout?: Layout;
    /** the data for it, keyed by dataset name. Keep it stable between renders */
    data?: ReportData;
    /** a buildPages result, in place of layout and data */
    paginated?: PaginatedReport;
    title?: string;
    className?: string;
    /** give the viewer a height; it fills it and scrolls inside */
    style?: CSSProperties;
}

/** what a ref on ReportViewer receives */
export type ReportViewerHandle = Omit<ViewerHandle, 'destroy' | 'exportOpen'>;

export const ReportViewer: ForwardRefExoticComponent<
    ReportViewerProps & RefAttributes<ReportViewerHandle>
>;

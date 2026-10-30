/**
 * report-studio/react/designer - the designer as a React component.
 */

import type { CSSProperties, ForwardRefExoticComponent, RefAttributes } from 'react';
import type { Layout } from './layout.js';
import type { DesignerHandle, ReportStore } from './designer.js';

export type * from './layout.js';
export type { DesignerHandle, ReportStore } from './designer.js';


export interface ReportDesignerProps {
    /** where the designer starts, like an input's defaultValue */
    layout?: Layout;
    /** the report's filename stem. Changing it opens a fresh designer */
    id?: string | null;
    store?: ReportStore;
    /** confirm before a tab with unsaved changes closes; default true */
    guardUnload?: boolean;
    /** the layout after every edit. The designer's own object: clone it */
    onChange?: (layout: Layout) => void;
    className?: string;
    style?: CSSProperties;
}

export const ReportDesigner: ForwardRefExoticComponent<
    ReportDesignerProps & RefAttributes<DesignerHandle>
>;

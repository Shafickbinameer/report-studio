/**
 * report-studio/vite - mounts the designer's file routes in a Vite dev server.
 */

import type { Plugin } from 'vite';


export interface ReportStudioPluginOptions {
    /** where report files live, relative to the project; default `'reports'` */
    dir?: string;
    /** the URL the routes are served under */
    prefix?: string;
}

/** dev only: the routes write files, so they are never mounted for a build */
export function reportStudio(options?: ReportStudioPluginOptions): Plugin;

export default reportStudio;

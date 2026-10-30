import { defineConfig } from 'vite';
import { reportStudio } from 'report-studio/vite';

/**
 * The plugin gives the dev server the routes the designer reads and saves
 * through, with report files in ./reports. Dev only: a build gets no routes.
 */
export default defineConfig({
    plugins: [reportStudio({ dir: 'reports' })]
});

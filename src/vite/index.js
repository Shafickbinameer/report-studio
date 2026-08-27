/**
 * The Vite plugin: report file access for a project that already runs Vite.
 *
 * A convenience, not the product. The CLI is the primary way in, because it
 * works for a plain-JS project, a webpack one, or anything else - requiring a
 * build tool the consumer does not otherwise use would be a poor first
 * impression for a package whose engine needs no bundler at all.
 *
 * This is Node code and must never reach a browser bundle, which is why it
 * lives behind its own export path (`report-studio/vite`). Nothing in src/
 * outside this folder and src/server/ imports it.
 */

import { createReportRoutes, DEFAULT_PREFIX } from '../server/routes.js';


/**
 * @param {object} [options]
 * @param {string} [options.dir] where report files live, relative to the project
 * @param {string} [options.prefix] the URL the routes are served under
 * @returns {object} a Vite plugin
 */
export function reportStudio({ dir = 'reports', prefix = DEFAULT_PREFIX } = {}) {
    return {
        name: 'report-studio',

        /**
         * `configureServer` and not `configurePreviewServer`.
         *
         * The first runs only for `vite` (dev). The second runs for `vite
         * preview`, which serves a production build - mounting a route that
         * writes files there would put a write endpoint in front of built
         * output, which is a hole rather than a feature.
         */
        configureServer(server) {
            const handle = createReportRoutes({ dir, prefix });

            /**
             * Before Vite's own middleware, so the prefix cannot be shadowed by
             * a file that happens to sit at the same path. The handler calls
             * next() for anything outside the prefix, so nothing else changes.
             */
            server.middlewares.use(handle);

            server.config.logger.info(
                `  report-studio  reports in ${dir}, served at ${prefix}`
            );
        }
    };
}


export default reportStudio;

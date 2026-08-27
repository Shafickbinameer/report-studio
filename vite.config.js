import { defineConfig } from 'vite';
import { reportStudio } from './src/vite/index.js';

/**
 * Two jobs, two roots.
 *
 * `vite` (serve) runs the playground, whose pages live under src/ - a landing
 * page at src/index.html, the designer at src/designer/ and the preview at
 * src/preview/. So src is the dev root, and both screens are reachable without
 * a second dev server. It reaches back into fixtures/, which sits outside that
 * root, hence the fs.allow entry.
 *
 * `vite build` is the library build and stays at the project root, because the
 * lib entries are written relative to it.
 *
 * No React plugin: nothing in this package is React, and the screens are plain
 * DOM. The old src/react stub has gone with the peer dependency that announced
 * a requirement the package never had.
 *
 * The report routes are mounted with the package's own Vite plugin, so the
 * playground reads and writes real files in reports/ - and the plugin is
 * exercised by using it rather than only by its specs.
 */
export default defineConfig(({ command }) => ({
  plugins: [reportStudio({ dir: 'reports' })],
  root: command === 'serve' ? 'src' : undefined,
  server: {
    open: command === 'serve',
    fs: {
      // fixtures/ is above the dev root
      allow: ['..', '../..']
    }
  },
  build: {
    lib: {
      entry: {
        index: 'src/index.js',
        designer: 'src/designer/designer.js'
      },
      formats: ['es']
    }
  }
}));

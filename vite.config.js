import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Two jobs, two roots.
 *
 * `vite` (serve) runs the preview playground, whose index.html lives in
 * src/preview - so that is the dev root and `npm run dev` opens the report
 * instead of a 404. It reaches back into fixtures/, which sits outside that
 * root, hence the fs.allow entry.
 *
 * `vite build` is the library build and stays at the project root, because the
 * lib entries are written relative to it.
 */
export default defineConfig(({ command }) => ({
  plugins: [react()],
  root: command === 'serve' ? 'src/preview' : undefined,
  server: {
    open: command === 'serve',
    fs: {
      // fixtures/ and src/engine/ are above the dev root
      allow: ['..', '../..']
    }
  },
  build: {
    lib: {
      entry: { index: 'src/index.js', react: 'src/react/index.js' },
      formats: ['es']
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime']
    }
  }
}));

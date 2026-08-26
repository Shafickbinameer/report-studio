import { defineConfig } from 'vitest/config';

/**
 * Tests get their own config on purpose.
 *
 * vite.config.js switches `root` to src/preview when it is serving the preview
 * playground, and Vitest counts as a "serve" command - so sharing that file
 * would send test discovery into src/preview and find nothing. Vitest prefers
 * vitest.config.js over vite.config.js, so this keeps the two apart.
 *
 * Spec 2.1: the engine specs must run with no React import at all. Nothing is
 * plugged in here, which is what keeps that honest.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node'
  }
});

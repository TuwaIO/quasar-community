import path from 'path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: false,
  test: {
    globals: true,
    root: './',
    environment: 'node',
    include: ['**/*.spec.ts'],
    alias: {
      '@src': path.resolve(__dirname, './src'),
    },
    server: {
      deps: {
        // pnpm injects the workspace package as a copy under node_modules, which Vitest would externalize: the specs
        // mock `dns/promises` for the SSRF checks of `@tuwaio/shared/ssrf`
        inline: ['@tuwaio/shared'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
});

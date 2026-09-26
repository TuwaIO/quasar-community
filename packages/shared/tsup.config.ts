import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/encryption.ts',
    'src/cuid.ts',
    'src/constants.ts',
    'src/billing.ts',
    'src/utils.ts',
    'src/fixtures/index.ts',
    'src/crash-injection.ts',
    'src/ssrf.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  treeshake: true,
  outDir: 'dist',
  external: ['@paralleldrive/cuid2', 'crypto'],
});

// @vitest-environment node
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

type MonacoLocalLoader = {
  rewriteMonacoBase: (source: string) => string;
  monacoLoaderFiles: RegExp;
  monacoCdn: RegExp;
};

const dashboard = path.resolve(__dirname, '../..');
const require = createRequire(path.join(dashboard, 'package.json'));
const { rewriteMonacoBase, monacoLoaderFiles, monacoCdn } =
  require('./scripts/monaco-local-loader.cjs') as MonacoLocalLoader;

/** Every JavaScript file of an installed package folder (the build of @payloadcms/ui, the @monaco-editor/loader lib). */
function packageFiles(packageName: string, folder: string): string[] {
  const root = path.join(realpathSync(path.join(dashboard, 'node_modules', ...packageName.split('/'))), folder);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (file.endsWith('.js')) files.push(file);
    }
  };
  if (existsSync(root)) walk(root);
  return files;
}

// Payload's admin panel bundles its own copy of @monaco-editor/loader, which loads the code editor of JSON and code
// fields from jsDelivr (the IP address of every operator would reach it, and the CSP blocks it). The build rewrites
// that address, in Payload's copy and in the package, to the copy this site serves (public/monaco/vs,
// scripts/copy-monaco.mjs).
describe('Monaco of the admin panel', () => {
  it('loads from this site instead of jsDelivr', () => {
    const bundled = 'var we={paths:{vs:"https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs"}};';

    expect(rewriteMonacoBase(bundled)).toBe('var we={paths:{vs:"/monaco/vs"}};');
  });

  it('fails the build when Payload refers to jsDelivr in a form the rewrite does not cover', () => {
    expect(() => rewriteMonacoBase('const base = "https://cdn.jsdelivr.net/npm/monaco-editor/min/vs";')).toThrow(
      /jsDelivr/,
    );
  });

  it('covers every installed file that loads Monaco from jsDelivr: the copy bundled into Payload and the package', () => {
    const files = [...packageFiles('@payloadcms/ui', 'dist'), ...packageFiles('@monaco-editor/loader', 'lib')].filter(
      (file) => monacoCdn.test(readFileSync(file, 'utf8')),
    );

    expect(monacoLoaderFiles).toBeInstanceOf(RegExp);
    expect(files.some((file) => file.includes('@payloadcms/ui'))).toBe(true);
    expect(files.some((file) => file.includes('@monaco-editor/loader'))).toBe(true);
    for (const file of files) {
      const projectPath = path.relative(path.resolve(dashboard, '../..'), file).split(path.sep).join('/');
      expect(projectPath).toMatch(monacoLoaderFiles);
      expect(rewriteMonacoBase(readFileSync(file, 'utf8'))).not.toMatch(/cdn\.jsdelivr\.net/);
    }
  });
});

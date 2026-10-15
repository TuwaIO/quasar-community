// Copies Monaco (the code editor of the Payload admin panel) to public/monaco/vs before `next dev` and `next build`, so
// the admin panel loads it from this site and not from jsDelivr, the default of @monaco-editor/loader. The copy is the
// monaco-editor that @payloadcms/ui resolves, and it is not committed (.gitignore).
import { cpSync, existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dashboard = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The root folder of the package `name` that the file `from` resolves (packages may not export package.json). */
function packageRoot(from, name) {
  let dir = path.dirname(createRequire(from).resolve(name));
  while (dir !== path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json');
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) return dir;
    dir = path.dirname(dir);
  }
  throw new Error(`copy-monaco: no package root for ${name}`);
}

const payloadUi = realpathSync(path.join(dashboard, 'node_modules', '@payloadcms', 'ui'));
const source = path.join(packageRoot(path.join(payloadUi, 'package.json'), 'monaco-editor'), 'min', 'vs');
const target = path.join(dashboard, 'public', 'monaco', 'vs');

if (!existsSync(source)) {
  throw new Error(`copy-monaco: ${source} does not exist`);
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`copy-monaco: ${path.relative(dashboard, source)} -> ${path.relative(dashboard, target)}`);

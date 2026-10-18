import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Every checkbox of Quasar, in the dashboard and in the custom views of the admin panel, is the drawn box of
// components/ui/CheckboxField.tsx, in the style of "Remember this wallet" of Nova Connect. A bare browser checkbox
// looks out of place in both.
const src = path.resolve(__dirname, '..');
const ALLOWED = [path.join('components', 'ui', 'CheckboxField.tsx')];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const file = path.join(dir, entry);
    if (statSync(file).isDirectory()) return entry === 'tests' ? [] : sourceFiles(file);
    return /\.(tsx|jsx)$/.test(entry) ? [file] : [];
  });
}

describe('one checkbox', () => {
  it('draws no bare browser checkbox outside CheckboxField', () => {
    const offenders = sourceFiles(src)
      .map((file) => path.relative(src, file))
      .filter((file) => !ALLOWED.includes(file))
      .filter((file) => /type=["']checkbox["']/.test(readFileSync(path.join(src, file), 'utf8')));

    expect(offenders).toEqual([]);
  });
});

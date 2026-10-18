import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/collections/ContextUsers/Users', () => ({ Users: { slug: 'users' } }));

import { UserAvatar } from '@/components/ui/UserAvatar';
import { adminConfig } from '@/payload/admin';

// Avatars were loaded from www.gravatar.com with the SHA-256 of the user's email: a third-party request that the
// Privacy Policy does not list. The dashboard shows the initial of the account instead.
const src = path.resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const file = path.join(dir, entry);
    if (statSync(file).isDirectory()) return entry === 'tests' ? [] : sourceFiles(file);
    return /\.(tsx?|css)$/.test(entry) ? [file] : [];
  });
}

describe('avatars without Gravatar', () => {
  it('renders the initial of the email and no image', () => {
    const html = renderToStaticMarkup(createElement(UserAvatar, { email: 'alice@example.com' }));

    expect(html).toContain('>A<');
    expect(html).not.toContain('<img');
  });

  it('keeps the admin panel on the built-in avatar of Payload, whose default loads from gravatar.com', () => {
    expect(adminConfig?.avatar).toBe('default');
  });

  it('leaves Gravatar out of the dashboard entirely', () => {
    const offenders = sourceFiles(src)
      .filter((file) => /gravatar/i.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(src, file));

    expect(offenders).toEqual([]);
  });
});

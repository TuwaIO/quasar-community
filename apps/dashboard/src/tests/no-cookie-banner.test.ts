import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { useUIStore } from '@/stores/uiStore';

// The dashboard stores only what it needs (Cookie Policy), so it asks for no cookie consent. The banner claimed
// analytics the dashboard does not have, and accepting it pre-ticked the Terms checkbox of the sign-up form
describe('cookie consent', () => {
  it('is not kept by the dashboard', () => {
    expect('cookieConsent' in useUIStore.getState()).toBe(false);
    expect('setCookieConsent' in useUIStore.getState()).toBe(false);
  });

  it('has no banner', () => {
    expect(existsSync(path.resolve(__dirname, '../components/ui/CookieBanner.tsx'))).toBe(false);
  });
});

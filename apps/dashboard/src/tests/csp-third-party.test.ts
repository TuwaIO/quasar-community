// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/redis', () => ({
  getInternalSecret: vi.fn(),
  validateInternalSecret: vi.fn(),
}));

import { proxy } from '@/proxy';

// The dashboard loads its logo, icons and scripts from itself: no jsDelivr, and no Cloudflare Web Analytics, which
// is off (Cookie and Privacy policies)
describe('Content-Security-Policy of the dashboard', () => {
  it('allows no third-party script, style or worker hosts', async () => {
    const response = await proxy(new NextRequest('https://quasar.example.com/'));
    const csp = response.headers.get('Content-Security-Policy') ?? '';

    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('jsdelivr');
    expect(csp).not.toContain('cloudflareinsights');
  });

  it('allows no jsDelivr in the admin panel either: Monaco is served by this site', async () => {
    const response = await proxy(new NextRequest('https://quasar.example.com/admin/collections/apps'));
    const csp = response.headers.get('Content-Security-Policy') ?? '';

    expect(csp).not.toContain('jsdelivr');
    expect(csp).not.toContain('cloudflareinsights');
  });
});

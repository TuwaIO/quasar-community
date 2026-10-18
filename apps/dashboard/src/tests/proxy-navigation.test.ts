// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/redis', () => ({ getInternalSecret: vi.fn(), validateInternalSecret: vi.fn() }));

// A link from another site (an email, Discord, an alert) opens a page with `Sec-Fetch-Site: cross-site` and no Origin.
// Payload 3.90 refuses the session cookie of such a request (its CSRF check), so the admin panel sent signed-in admins
// to its login and the dashboard sent every deep link to the overview (staging, 2026-10-17).
const navigation = (url: string, site: string, init: { method?: string; dest?: string; mode?: string } = {}) =>
  new NextRequest(url, {
    method: init.method ?? 'GET',
    headers: {
      cookie: 'payload-token=t',
      'sec-fetch-site': site,
      'sec-fetch-mode': init.mode ?? 'navigate',
      'sec-fetch-dest': init.dest ?? 'document',
    },
  });

// What the app receives: Next passes the request headers the proxy overrides as `x-middleware-request-*`
const passedSite = (res: Response) => res.headers.get('x-middleware-request-sec-fetch-site');

describe('a page opened from a link on another site', () => {
  it('reaches the app as a direct navigation, so the session cookie authenticates the first render', async () => {
    const { proxy } = await import('@/proxy');
    expect(
      passedSite(await proxy(navigation('http://localhost:3000/admin/collections/access-reviews', 'cross-site'))),
    ).toBe('none');
    expect(
      passedSite(
        await proxy(navigation('http://localhost:3000/dashboard/organization/o1/data-processing', 'cross-site')),
      ),
    ).toBe('none');
  });

  it('leaves everything else as the browser sent it: same-site navigations, scripts, forms and API routes', async () => {
    const { proxy } = await import('@/proxy');
    expect(passedSite(await proxy(navigation('http://localhost:3000/admin', 'same-origin')))).toBeNull();
    expect(
      passedSite(await proxy(navigation('http://localhost:3000/admin', 'cross-site', { mode: 'cors', dest: 'empty' }))),
    ).toBeNull();
    expect(
      passedSite(await proxy(navigation('http://localhost:3000/admin', 'cross-site', { method: 'POST' }))),
    ).toBeNull();
    expect(passedSite(await proxy(navigation('http://localhost:3000/api/users/me', 'cross-site')))).toBeNull();
  });
});

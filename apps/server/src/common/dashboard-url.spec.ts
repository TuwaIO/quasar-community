import { describe, expect, it } from 'vitest';

import { dashboardUrl } from './dashboard-url';

// The engine calls the internal routes of the dashboard. On staging the public URL sits behind the password of the
// reverse proxy, which answered 401 to every call of the access review collector (2026-10-16); in production it went out
// through the CDN and back. Inside the Docker network neither happens.
const config = (values: Record<string, string>) => ({ get: (key: string) => values[key] });

describe('dashboardUrl', () => {
  it('reaches the dashboard inside the Docker network when that address is set', () => {
    expect(
      dashboardUrl(
        config({
          DASHBOARD_INTERNAL_URL: 'http://quasar-dashboard:3000',
          NEXT_PUBLIC_SERVER_URL: 'https://quasar-stg.example',
        }) as never,
      ),
    ).toBe('http://quasar-dashboard:3000');
  });

  it('falls back to the public URL, as a self-hosted engine without that address does', () => {
    expect(dashboardUrl(config({ NEXT_PUBLIC_SERVER_URL: 'https://quasar.example' }) as never)).toBe(
      'https://quasar.example',
    );
    expect(dashboardUrl(config({}) as never)).toBeUndefined();
  });
});

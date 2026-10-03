// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/redis', () => ({ getInternalSecret: vi.fn(), validateInternalSecret: vi.fn() }));

async function connectSrcFor(engineUrl: string): Promise<string> {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_ENGINE_URL', engineUrl);
  const { proxy } = await import('@/proxy');
  const res = await proxy(
    new NextRequest('http://localhost:3000/dashboard/faq', { headers: { cookie: 'payload-token=t' } }),
  );
  const csp = res.headers.get('content-security-policy') ?? '';
  return csp.split(';').find((directive) => directive.trim().startsWith('connect-src')) ?? '';
}

describe('Content Security Policy of the dashboard pages', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lets the pages reach the engine at the configured URL', async () => {
    expect(await connectSrcFor('http://localhost:6124')).toContain('http://localhost:6124');
  });

  it('keeps the default local engine', async () => {
    expect(await connectSrcFor('http://localhost:3001')).toContain('http://localhost:3001');
  });
});

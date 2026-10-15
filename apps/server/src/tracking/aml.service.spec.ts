import { afterEach, describe, expect, it, vi } from 'vitest';

import { AmlService } from './aml.service';

vi.mock('@tuwaio/shared/encryption', () => ({ decrypt: vi.fn((val: string) => val) }));

function service(env: Record<string, string>) {
  const redis: any = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') };
  const config: any = { get: (key: string) => env[key] };
  return new AmlService(redis, config);
}

describe('AmlService system GoPlus credentials', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does not fall back to the system GoPlus keys unless SYSTEM_PROVIDER_KEYS_ENABLED is true', async () => {
    vi.stubEnv('SYSTEM_PROVIDER_KEYS_ENABLED', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const aml = service({ GOPLUS_APP_KEY: 'system-key', GOPLUS_APP_SECRET: 'system-secret' });

    await expect(aml.checkAml('0xabc', '1')).rejects.toThrow('AML Service configuration missing');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

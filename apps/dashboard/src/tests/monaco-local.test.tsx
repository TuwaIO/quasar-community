import { describe, expect, it, vi } from 'vitest';

const { config } = vi.hoisted(() => ({ config: vi.fn() }));
vi.mock('@monaco-editor/loader', () => ({ default: { config } }));

// The code editor of the admin panel (JSON and code fields of Payload) loads Monaco from this site: its loader
// defaults to jsDelivr, which would get the IP address of every operator
describe('MonacoLocalProvider', () => {
  it('points the Monaco loader at the copy this site serves', async () => {
    await import('@/components/admin/MonacoLocalProvider');

    expect(config).toHaveBeenCalledWith({ paths: { vs: '/monaco/vs' } });
  });
});

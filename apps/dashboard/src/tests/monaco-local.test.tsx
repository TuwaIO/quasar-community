import { describe, expect, it, vi } from 'vitest';

const { config } = vi.hoisted(() => ({ config: vi.fn() }));
vi.mock('@monaco-editor/loader', () => ({ default: { config } }));

// The @monaco-editor/loader package loads Monaco from this site: it defaults to jsDelivr, which would get the IP address
// of every operator. The copy bundled into @payloadcms/ui is covered by monaco-local-build.test.ts.
describe('MonacoLocalProvider', () => {
  it('points the Monaco loader at the copy this site serves', async () => {
    await import('@/components/admin/MonacoLocalProvider');

    expect(config).toHaveBeenCalledWith({ paths: { vs: '/monaco/vs' } });
  });
});

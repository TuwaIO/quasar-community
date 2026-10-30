import type { Field, FieldAccess } from 'payload';
import { describe, expect, it, vi } from 'vitest';

// Collections reach lib modules that load the Payload config, which imports the collections back
vi.mock('@payload-config', () => ({ default: {} }));

import { Apps } from '@/collections/ContextEngine/Apps';
import { WebhookEndpoints } from '@/collections/ContextWebhooks/WebhookEndpoints';

const member = { id: 'user_1', email: 'owner@example.test', roles: ['user'], collection: 'users' };
const admin = { ...member, roles: ['admin'] };

/** The field at `path` (`rpcConfigs.rpcUrl`) of a collection's fields. */
function fieldAt(fields: Field[], path: string): Field {
  const [head, ...rest] = path.split('.');
  const field = fields.find((item) => 'name' in item && item.name === head);
  if (!field) throw new Error(`No field ${path}`);
  return rest.length ? fieldAt((field as { fields: Field[] }).fields, rest.join('.')) : field;
}

const readOf = (fields: Field[], path: string, user: object) => {
  const read = (fieldAt(fields, path) as { access?: { read?: FieldAccess } }).access?.read;
  return read ? read({ req: { user } } as never) : 'default';
};

// Security review 2026-10-30: GET /api/apps and /api/webhook-endpoints gave members of the organization the
// ciphertexts of the keys; the dashboard shows them masked or after a step-up through its own routes
describe('secret ciphertexts stay with system administrators over REST', () => {
  const SECRETS: Array<[string, string, Field[]]> = [
    ...[
      'secretKey',
      'rpcConfigs.rpcUrl',
      'alchemyApiKey',
      'quickNodeApiKey',
      'gelatoApiKey',
      'pimlicoApiKey',
      'paymentSettings.goPlusApiKey',
      'paymentSettings.goPlusApiSecret',
    ].map((path): [string, string, Field[]] => ['apps', path, Apps.fields]),
    ['webhook-endpoints', 'signingSecret', WebhookEndpoints.fields],
  ];

  it.each(SECRETS)('%s.%s is read by system admins only', async (_slug, path, fields) => {
    expect(await readOf(fields, path, member)).toBe(false);
    expect(await readOf(fields, path, admin)).toBe(true);
  });
});

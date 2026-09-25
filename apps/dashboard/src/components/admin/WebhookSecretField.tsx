'use client';

import { useDocumentInfo, useFormFields } from '@payloadcms/ui';

import { RevealSecretField } from './RevealSecretField';

function getRelationshipId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object' && value !== null && 'id' in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>).id);
  }
  return null;
}

/**
 * Reveals `WebhookEndpoints.signingSecret` on demand via the existing
 * step-up-protected `/api/v1/organizations/{orgId}/webhooks/{webhookId}/reveal`
 * endpoint. Unlike Apps, WebhookEndpoints only stores `app` (not
 * `organization` directly), so the org id is resolved through the App
 * document first via Payload's own REST API for the `apps` collection -
 * no new backend endpoint needed, same pattern as SecretField.tsx.
 *
 * See open-source-plans/04-payload-admin-exposure.md, section 2.
 */
export function WebhookSecretField() {
  const { id: webhookId } = useDocumentInfo();
  const appId = useFormFields(([fields]) => getRelationshipId(fields.app?.value));

  return (
    <RevealSecretField
      label="Signing Secret"
      resolveRevealUrl={async () => {
        if (!appId || !webhookId) {
          throw new Error('Save the Webhook before revealing its signing secret.');
        }

        const appRes = await fetch(`/api/apps/${appId}?depth=0`, { credentials: 'include' });
        if (!appRes.ok) {
          throw new Error('Could not resolve the organization for this webhook.');
        }
        const app = await appRes.json();
        const orgId = getRelationshipId(app.organization);
        if (!orgId) {
          throw new Error('Could not resolve the organization for this webhook.');
        }

        return `/api/v1/organizations/${orgId}/webhooks/${webhookId}/reveal`;
      }}
      responseKey="signingSecret"
    />
  );
}

export default WebhookSecretField;

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
 * Reveals `App.secretKey` on demand via the existing step-up-protected
 * `/api/v1/organizations/{orgId}/apps/{appId}/reveal` endpoint. `organization`
 * is a direct field on Apps, so no extra lookup is needed here.
 *
 * See open-source-plans/04-payload-admin-exposure.md, section 2.
 */
export function SecretField() {
  const { id: appId } = useDocumentInfo();
  const orgId = useFormFields(([fields]) => getRelationshipId(fields.organization?.value));

  return (
    <RevealSecretField
      label="Secret Key"
      resolveRevealUrl={async () => {
        if (!orgId || !appId) {
          throw new Error('Save the App before revealing its secret key.');
        }
        return `/api/v1/organizations/${orgId}/apps/${appId}/reveal`;
      }}
      responseKey="secretKey"
    />
  );
}

export default SecretField;

'use client';

import { FieldLabel, useDocumentInfo, useField, useFormFields } from '@payloadcms/ui';
import { useEffect, useState } from 'react';

function getRelationshipId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object' && value !== null && 'id' in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>).id);
  }
  return null;
}

function getPreviewValue(appData: unknown, previewKey: string): string | undefined {
  return previewKey.split('.').reduce<any>((acc, key) => (acc == null ? acc : acc[key]), appData);
}

export interface MaskedSecretFieldProps {
  label: string;
  /** Dot-path into the GET .../apps/{appId} response, e.g. 'alchemyApiKey' or 'paymentSettings.goPlusApiKey'. */
  previewKey: string;
}

/**
 * Write-only masked field for provider API keys (alchemyApiKey, quickNodeApiKey,
 * gelatoApiKey, pimlicoApiKey, paymentSettings.goPlusApiKey/Secret). These are
 * encrypted at rest the same way as secretKey, but unlike secretKey they are
 * never meant to be viewed again - only entered once or rotated.
 *
 * Critical (see open-source-plans/04-payload-admin-exposure.md, section 3):
 * Payload hydrates form state with the raw stored ciphertext for every field
 * regardless of which component renders it. If left untouched, clicking the
 * native Save button would resubmit that ciphertext unchanged, and the
 * existing `beforeChange` encryption hook in Apps.ts would re-encrypt it -
 * double encryption, permanently corrupting the key. This component clears
 * its own field value on mount so it is simply absent from the outgoing
 * update payload unless the admin actually types a new value - the write-only
 * counterpart of what GET/PATCH .../apps/{appId} already do for display.
 */
export function MaskedSecretField({ label, previewKey }: MaskedSecretFieldProps) {
  const field = useField<string>();
  const { id: appId } = useDocumentInfo();
  const orgId = useFormFields(([fields]) => getRelationshipId(fields.organization?.value));

  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    // disableModifyingForm=true: this is a hygiene reset, not a user edit -
    // must not mark an otherwise-untouched document as dirty.
    field.setValue(undefined, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      if (!orgId || !appId) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`/api/v1/organizations/${orgId}/apps/${appId}`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setPreview(getPreviewValue(data, previewKey) ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPreview();

    return () => {
      cancelled = true;
    };
  }, [orgId, appId, previewKey]);

  return (
    <div className="field-type text">
      <FieldLabel label={label} />
      <input
        onChange={(e) => {
          setInputValue(e.target.value);
          field.setValue(e.target.value);
        }}
        placeholder={loading ? 'Loading...' : preview ? `Current: ${preview} (leave blank to keep)` : 'Not set'}
        type="text"
        value={inputValue}
      />
    </div>
  );
}

export default MaskedSecretField;

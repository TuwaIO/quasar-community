'use client';

import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { toast, useDocumentInfo, useFormFields } from '@payloadcms/ui';
import { useState } from 'react';

import { canRetryWebhookDelivery } from '@/lib/webhook-utils';
import type { WebhookDelivery } from '@/payload-types';

function getRelationshipId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object' && value !== null && 'id' in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>).id);
  }
  return null;
}

/**
 * Retry action for a failed WebhookDelivery.
 * Rendered above the document controls on the delivery edit view, under the
 * same condition as the dashboard (`canRetryWebhookDelivery`).
 * Styled prominently with an icon, spin animation, and native toast feedback.
 */
export function WebhookDeliveryRetryButton() {
  const { id: deliveryId } = useDocumentInfo();
  const endpointId = useFormFields(([fields]) => getRelationshipId(fields.endpoint?.value));
  const success = useFormFields(([fields]) => fields.success?.value as WebhookDelivery['success']);
  const [loading, setLoading] = useState(false);

  if (!deliveryId || !canRetryWebhookDelivery({ success })) {
    return null;
  }

  const retry = async () => {
    if (!endpointId) {
      toast.error('Could not resolve the webhook endpoint for this delivery.');
      return;
    }

    setLoading(true);
    const toastId = toast.loading('Scheduling webhook redelivery...');

    try {
      const endpointRes = await fetch(`/api/webhook-endpoints/${endpointId}?depth=2`, { credentials: 'include' });
      if (!endpointRes.ok) throw new Error('Could not resolve the organization for this delivery.');
      const endpoint = await endpointRes.json();
      const orgId = getRelationshipId(typeof endpoint.app === 'object' ? endpoint.app?.organization : undefined);
      if (!orgId) throw new Error('Could not resolve the organization for this delivery.');

      const res = await fetch(`/api/v1/organizations/${orgId}/webhooks/deliveries/${deliveryId}/retry`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to schedule retry.');
      }

      toast.success(data.message || 'Webhook redelivery successfully scheduled.', { id: toastId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to schedule retry.', { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', marginRight: '8px' }}>
      <button
        type="button"
        disabled={loading}
        onClick={retry}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '7px',
          height: '36px',
          padding: '0 14px',
          fontSize: '13px',
          fontWeight: 600,
          letterSpacing: '0.01em',
          borderRadius: '8px',
          cursor: loading ? 'not-allowed' : 'pointer',
          color: 'var(--theme-text)',
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(168, 85, 247, 0.12) 100%)',
          border: '1px solid rgba(99, 102, 241, 0.35)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
          transition: 'all 0.18s ease-in-out',
          opacity: loading ? 0.75 : 1,
        }}
        onMouseEnter={(e) => {
          if (!loading) {
            e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.65)';
            e.currentTarget.style.boxShadow = '0 0 12px rgba(99, 102, 241, 0.25)';
            e.currentTarget.style.transform = 'translateY(-1px)';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.35)';
          e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.08)';
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        <ArrowPathIcon
          style={{
            width: '15px',
            height: '15px',
            color: '#6366f1',
            animation: loading ? 'quasar-spin 1s linear infinite' : 'none',
            flexShrink: 0,
          }}
        />
        <span>{loading ? 'Retrying...' : 'Retry delivery'}</span>
      </button>
      <style>{`
        @keyframes quasar-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default WebhookDeliveryRetryButton;

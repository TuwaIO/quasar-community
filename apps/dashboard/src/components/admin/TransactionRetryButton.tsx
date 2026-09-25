'use client';

import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { toast, useDocumentInfo, useFormFields } from '@payloadcms/ui';
import { useState } from 'react';

import { useTransactionAgeTick } from '@/hooks/useTransactionAgeTick';
import { canRetryTransaction } from '@/lib/transaction-retry';
import type { Transaction } from '@/payload-types';

function getRelationshipId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object' && value !== null && 'id' in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>).id);
  }
  return null;
}

/**
 * Retry action for a stuck or failed Transaction.
 * Rendered above the document controls on the transaction edit view, under the
 * same condition as the dashboard (`canRetryTransaction`).
 * Styled prominently with an icon, spin animation, and native toast feedback.
 */
export function TransactionRetryButton() {
  const { id: txId } = useDocumentInfo();
  const orgId = useFormFields(([fields]) => getRelationshipId(fields.owner?.value));
  const pending = useFormFields(([fields]) => fields.pending?.value as Transaction['pending']);
  const status = useFormFields(([fields]) => fields.status?.value as Transaction['status']);
  const localTimestamp = useFormFields(([fields]) => fields.localTimestamp?.value as Transaction['localTimestamp']);
  // Ticks so a pending transaction gains the button once it crosses the stuck threshold.
  const now = useTransactionAgeTick();
  const [loading, setLoading] = useState(false);

  if (!txId || !canRetryTransaction({ pending, status, localTimestamp }, now)) {
    return null;
  }

  const retry = async () => {
    if (!orgId) {
      toast.error('Could not resolve the organization for this transaction.');
      return;
    }

    setLoading(true);
    const toastId = toast.loading('Scheduling transaction retry...');

    try {
      const res = await fetch(`/api/v1/organizations/${orgId}/transactions/${txId}/retry`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to schedule retry.');
      }

      toast.success(data.message || 'Transaction retry successfully scheduled.', { id: toastId });
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
        <span>{loading ? 'Retrying...' : 'Retry tracking'}</span>
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

export default TransactionRetryButton;

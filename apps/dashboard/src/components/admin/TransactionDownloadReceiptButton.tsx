'use client';

import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { toast, useDocumentInfo, useFormFields } from '@payloadcms/ui';
import { useState } from 'react';

function getRelationshipId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object' && value !== null && 'id' in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>).id);
  }
  return null;
}

/**
 * Download Receipt action button for a Transaction.
 * Rendered in document controls on the transaction edit view.
 * Fetches the transaction receipt PDF from the organization API and triggers a download.
 */
export function TransactionDownloadReceiptButton() {
  const { id: txId } = useDocumentInfo();
  const orgId = useFormFields(([fields]) => getRelationshipId(fields.owner?.value));
  const [downloading, setDownloading] = useState(false);

  if (!txId) {
    return null;
  }

  const downloadReceipt = async () => {
    if (!orgId) {
      toast.error('Could not resolve the organization for this transaction.');
      return;
    }

    setDownloading(true);
    const toastId = toast.loading('Generating transaction receipt PDF...');

    try {
      const res = await fetch(`/api/v1/organizations/${orgId}/transactions/${txId}/pdf`, {
        method: 'GET',
        credentials: 'include',
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || `Failed to download receipt (HTTP ${res.status}).`);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `RECEIPT-${txId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      toast.success('Transaction receipt downloaded successfully.', { id: toastId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to download receipt.', { id: toastId });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', marginRight: '8px' }}>
      <button
        type="button"
        disabled={downloading}
        onClick={downloadReceipt}
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
          cursor: downloading ? 'not-allowed' : 'pointer',
          color: 'var(--theme-text)',
          background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.12) 0%, rgba(16, 185, 129, 0.12) 100%)',
          border: '1px solid rgba(14, 165, 233, 0.35)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
          transition: 'all 0.18s ease-in-out',
          opacity: downloading ? 0.75 : 1,
        }}
        onMouseEnter={(e) => {
          if (!downloading) {
            e.currentTarget.style.borderColor = 'rgba(14, 165, 233, 0.65)';
            e.currentTarget.style.boxShadow = '0 0 12px rgba(14, 165, 233, 0.25)';
            e.currentTarget.style.transform = 'translateY(-1px)';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'rgba(14, 165, 233, 0.35)';
          e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.08)';
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        <ArrowDownTrayIcon
          style={{
            width: '15px',
            height: '15px',
            color: '#0ea5e9',
            flexShrink: 0,
          }}
        />
        <span>{downloading ? 'Downloading...' : 'Download receipt'}</span>
      </button>
    </div>
  );
}

export default TransactionDownloadReceiptButton;

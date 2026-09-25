import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TransactionRetryButton from '@/components/admin/TransactionRetryButton';
import WebhookDeliveryRetryButton from '@/components/admin/WebhookDeliveryRetryButton';

type FormFields = Record<string, { value: unknown }>;

const { form } = vi.hoisted(() => ({
  form: { id: 'doc_1' as string | undefined, fields: {} as FormFields },
}));

// The buttons read the document only through these two hooks, so a plain
// fields object stands in for the Payload edit form.
vi.mock('@payloadcms/ui', () => ({
  useDocumentInfo: () => ({ id: form.id }),
  useFormFields: (selector: (context: [FormFields, () => void]) => unknown) => selector([form.fields, () => {}]),
  toast: { error: vi.fn(), loading: vi.fn(), success: vi.fn() },
}));

const now = 1_700_000_000_000;
const secondsAgo = (seconds: number) => (now - seconds * 1000) / 1000;

const transactionFields = (fields: {
  pending: boolean;
  status: string | null;
  localTimestamp: number;
}): FormFields => ({
  owner: { value: 'org_1' },
  pending: { value: fields.pending },
  status: { value: fields.status },
  localTimestamp: { value: fields.localTimestamp },
});

const retryTracking = () => screen.queryByRole('button', { name: /retry tracking/i });
const retryDelivery = () => screen.queryByRole('button', { name: /retry delivery/i });

describe('Admin retry buttons follow the dashboard retry conditions', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now });
    form.id = 'doc_1';
    form.fields = {};
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('TransactionRetryButton', () => {
    it('is hidden for a successful transaction', () => {
      form.fields = transactionFields({ pending: false, status: 'Success', localTimestamp: secondsAgo(600) });
      render(<TransactionRetryButton />);
      expect(retryTracking()).not.toBeInTheDocument();
    });

    it('is shown for a failed transaction', () => {
      form.fields = transactionFields({ pending: false, status: 'Failed', localTimestamp: secondsAgo(600) });
      render(<TransactionRetryButton />);
      expect(retryTracking()).toBeInTheDocument();
    });

    it('is shown for a replaced transaction', () => {
      form.fields = transactionFields({ pending: false, status: 'Replaced', localTimestamp: secondsAgo(600) });
      render(<TransactionRetryButton />);
      expect(retryTracking()).toBeInTheDocument();
    });

    it('is shown for a transaction stuck in pending', () => {
      form.fields = transactionFields({ pending: true, status: null, localTimestamp: secondsAgo(600) });
      render(<TransactionRetryButton />);
      expect(retryTracking()).toBeInTheDocument();
    });

    it('appears once a fresh pending transaction crosses the stuck threshold', () => {
      form.fields = transactionFields({ pending: true, status: null, localTimestamp: secondsAgo(50) });
      render(<TransactionRetryButton />);
      expect(retryTracking()).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(retryTracking()).toBeInTheDocument();
    });

    it('is hidden before the document has an id', () => {
      form.id = undefined;
      form.fields = transactionFields({ pending: false, status: 'Failed', localTimestamp: secondsAgo(600) });
      render(<TransactionRetryButton />);
      expect(retryTracking()).not.toBeInTheDocument();
    });
  });

  describe('WebhookDeliveryRetryButton', () => {
    it('is hidden for a successful delivery', () => {
      form.fields = { endpoint: { value: 'endpoint_1' }, success: { value: true } };
      render(<WebhookDeliveryRetryButton />);
      expect(retryDelivery()).not.toBeInTheDocument();
    });

    it('is shown for a failed delivery', () => {
      form.fields = { endpoint: { value: 'endpoint_1' }, success: { value: false } };
      render(<WebhookDeliveryRetryButton />);
      expect(retryDelivery()).toBeInTheDocument();
    });
  });
});

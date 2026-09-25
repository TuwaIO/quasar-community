import { WebhookPayload } from '@tuwaio/shared/utils';

export interface QuasarBillingWebhookJob {
  txKey: string;
  status: string;
  metadata?: {
    invoiceId?: string;
    [key: string]: unknown;
  };
}

export interface SystemWebhookEndpoint {
  id: string;
  url: string;
  signingSecret: string;
  organizationId: string;
  appId: string;
}

export interface SystemWebhookDeliveryJob {
  kind: 'system-delivery';
  deliveryId: string;
  endpoint: SystemWebhookEndpoint;
  payload: WebhookPayload;
  txKey: string;
  txType: string;
  appId: string;
}

export type QuasarWebhookJob = QuasarBillingWebhookJob | SystemWebhookDeliveryJob;

export function isSystemWebhookDeliveryJob(data: QuasarWebhookJob): data is SystemWebhookDeliveryJob {
  return 'kind' in data && data.kind === 'system-delivery';
}

import { createHash } from 'node:crypto';

import { assertSafeOutboundUrl, outboundUrlPolicyFromEnv, UnsafeUrlError } from '@tuwaio/shared/ssrf';
import { eq, inArray, or } from 'drizzle-orm';
import type { Payload } from 'payload';

import { isLocalhostUrl } from '@/lib/webhook-utils';
import {
  app_accepted_payments,
  app_invoices,
  apps,
  organizations,
  webhook_endpoints,
} from '@/payload-generated-schema';

import { type ExistingState, slugCandidates, type UrlCheck } from './plan';
import type { ConfigRecords } from './read';

/** The rows of this node an import could collide with (see {@link ExistingState}). Read-only. */
export async function loadExistingState(payload: Payload, config: ConfigRecords): Promise<ExistingState> {
  const db = payload.db.drizzle;
  const orgId = config.organization.id;
  const appIds = config.apps.map((app) => app.id);
  const publicKeys = config.apps.map((app) => app.publicKey).filter((key): key is string => Boolean(key));
  const hashes = config.apps
    .map((app) => app.secretKey)
    .filter((key): key is string => Boolean(key))
    .map((key) => createHash('sha256').update(key).digest('hex'));
  const endpointIds = config.endpoints.map((endpoint) => endpoint.id);
  const paymentIds = config.acceptedPayments.map((row) => row.id);
  const invoiceIds = config.invoices.map((row) => row.id);
  // `IN ()` is not valid SQL: a lookup over an empty list finds nothing without asking the database
  const unless = async <T>(empty: boolean, query: () => Promise<T[]>) => (empty ? [] : query());

  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId));
  const slugs = await db
    .select({ slug: organizations.slug })
    .from(organizations)
    .where(inArray(organizations.slug, slugCandidates(config.organization.name)));
  const appMatches = [
    appIds.length ? inArray(apps.id, appIds) : undefined,
    publicKeys.length ? inArray(apps.publicKey, publicKeys) : undefined,
    hashes.length ? inArray(apps.secretKeyHash, hashes) : undefined,
  ].filter((condition) => condition !== undefined);
  const appRows = await unless(appMatches.length === 0, () =>
    db
      .select({
        id: apps.id,
        organization: apps.organization,
        publicKey: apps.publicKey,
        secretKeyHash: apps.secretKeyHash,
      })
      .from(apps)
      .where(or(...appMatches)),
  );
  const endpointRows = await unless(endpointIds.length === 0, () =>
    db
      .select({ id: webhook_endpoints.id, app: webhook_endpoints.app })
      .from(webhook_endpoints)
      .where(inArray(webhook_endpoints.id, endpointIds)),
  );
  const orgEndpointUrls = org
    ? await db
        .select({ url: webhook_endpoints.url })
        .from(webhook_endpoints)
        .innerJoin(apps, eq(webhook_endpoints.app, apps.id))
        .where(eq(apps.organization, orgId))
    : [];
  const paymentRows = await unless(paymentIds.length === 0, () =>
    db
      .select({ id: app_accepted_payments.id, organization: app_accepted_payments.organization })
      .from(app_accepted_payments)
      .where(inArray(app_accepted_payments.id, paymentIds)),
  );
  const invoiceRows = await unless(invoiceIds.length === 0, () =>
    db
      .select({ id: app_invoices.id, organization: app_invoices.organization })
      .from(app_invoices)
      .where(inArray(app_invoices.id, invoiceIds)),
  );

  return {
    organization: org ?? null,
    takenSlugs: new Set(slugs.map((row) => row.slug).filter((slug): slug is string => Boolean(slug))),
    apps: appRows,
    endpoints: endpointRows,
    localhostEndpointsInOrganization: orgEndpointUrls.filter((row) => isLocalhostUrl(row.url)).length,
    acceptedPayments: paymentRows,
    invoices: invoiceRows,
  };
}

/** The node's outbound URL policy: the check the Apps hook runs on RPC and QuickNode URLs. */
export const checkOutboundUrl: UrlCheck = async (url) => {
  try {
    await assertSafeOutboundUrl(url, outboundUrlPolicyFromEnv());
    return null;
  } catch (error) {
    if (error instanceof UnsafeUrlError) return error.message;
    throw error;
  }
};

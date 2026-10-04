import { createHash } from 'node:crypto';

import { isLocalhostUrl } from '@/lib/webhook-utils';

import type { ExportCounts } from '../records';
import type { ConfigRecords } from './read';

/**
 * What an import will do, decided before it writes anything (open-source-plans/11 §7.3). The same plan backs the
 * analysis the operator confirms and the import itself.
 */

/** Rows of this node that the export's ids, keys and slug could collide with */
export interface ExistingState {
  organization: { id: string } | null;
  /** Organization slugs already in use among the candidates for the imported organization */
  takenSlugs: ReadonlySet<string>;
  /** Apps whose id, public key or secret key hash matches an app of the export */
  apps: { id: string; organization: string | null; publicKey: string | null; secretKeyHash: string | null }[];
  /** Endpoints whose id matches an endpoint of the export */
  endpoints: { id: string; app: string | null }[];
  /** Localhost endpoints the imported organization already has on this node */
  localhostEndpointsInOrganization: number;
  acceptedPayments: { id: string; organization: string | null }[];
  invoices: { id: string; organization: string | null }[];
}

/** Returns why the node's outbound policy refuses `url`, or `null` when it accepts it. */
export type UrlCheck = (url: string) => Promise<string | null>;

export type RowAction = 'create' | 'keep';

export interface ImportPlan {
  organization: { id: string; name: string; mode: 'new' | 'repeat'; slug?: string };
  exportedAt: string;
  deliveriesSince: string;
  members: number;
  counts: ExportCounts;
  apps: {
    id: string;
    name: string;
    action: RowAction;
    skippedRpcConfigs: { chainId: string; reason: string }[];
    quickNodeSkipped?: string;
  }[];
  endpoints: { id: string; app: string; url: string; action: RowAction | 'skip'; reason?: string }[];
  acceptedPayments: { id: string; action: RowAction }[];
  invoices: { id: string; action: RowAction }[];
  /** Reasons the import cannot run; when not empty, nothing is written */
  conflicts: string[];
}

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'organization';

const secretHash = (secret: string | null | undefined) =>
  secret ? createHash('sha256').update(secret).digest('hex') : null;

/** The rule of the endpoint URL field (WebhookEndpoints.ts), so a refused URL is reported instead of failing the import */
export function endpointUrlProblem(url: string, production: boolean): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'not a valid URL';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'the URL must use HTTPS or HTTP';
  if (production && parsed.protocol !== 'https:' && !isLocalhostUrl(url)) {
    return 'production webhooks must use HTTPS';
  }
  return null;
}

/** The candidate slugs of a new organization, in the order the plan tries them */
export function slugCandidates(name: string): string[] {
  const base = slugOf(name);
  return [base, `${base}-cloud`, ...Array.from({ length: 8 }, (_, index) => `${base}-cloud-${index + 2}`)];
}

export async function planImport(
  config: ConfigRecords,
  existing: ExistingState,
  checkUrl: UrlCheck,
  env: { production: boolean },
): Promise<ImportPlan> {
  const orgId = config.organization.id;
  const conflicts: string[] = [];

  const mode = existing.organization ? 'repeat' : 'new';
  const slug =
    mode === 'new' ? slugCandidates(config.organization.name).find((s) => !existing.takenSlugs.has(s)) : undefined;
  if (mode === 'new' && !slug)
    conflicts.push(`No free URL slug is left for the organization ${config.organization.name}.`);

  const apps: ImportPlan['apps'] = [];
  for (const app of config.apps) {
    const byId = existing.apps.find((row) => row.id === app.id);
    if (byId && byId.organization !== orgId) {
      conflicts.push(`App ${app.name} (${app.id}) already exists in another organization of this node.`);
    }
    if (app.publicKey && existing.apps.some((row) => row.publicKey === app.publicKey && row.id !== app.id)) {
      conflicts.push(`The public key of app ${app.name} belongs to another app of this node.`);
    }
    const hash = secretHash(app.secretKey);
    if (hash && existing.apps.some((row) => row.secretKeyHash === hash && row.id !== app.id)) {
      conflicts.push(`The secret key of app ${app.name} belongs to another app of this node.`);
    }

    const skippedRpcConfigs: { chainId: string; reason: string }[] = [];
    for (const rpc of app.rpcConfigs ?? []) {
      const reason = await checkUrl(rpc.rpcUrl);
      if (reason) skippedRpcConfigs.push({ chainId: rpc.chainId, reason });
    }
    const quickNodeSkipped = app.quickNodeApiKey?.startsWith('http')
      ? ((await checkUrl(app.quickNodeApiKey)) ?? undefined)
      : undefined;

    apps.push({
      id: app.id,
      name: app.name,
      action: byId ? 'keep' : 'create',
      skippedRpcConfigs,
      ...(quickNodeSkipped ? { quickNodeSkipped } : {}),
    });
  }

  let localhostEndpoints = existing.localhostEndpointsInOrganization;
  const endpoints: ImportPlan['endpoints'] = [];
  for (const endpoint of config.endpoints) {
    const byId = existing.endpoints.find((row) => row.id === endpoint.id);
    if (byId && byId.app !== endpoint.app) {
      conflicts.push(`Webhook endpoint ${endpoint.id} already exists for another app of this node.`);
    }
    const base = { id: endpoint.id, app: endpoint.app, url: endpoint.url };
    if (byId) {
      endpoints.push({ ...base, action: 'keep' });
      continue;
    }
    const problem = endpointUrlProblem(endpoint.url, env.production);
    if (problem) {
      endpoints.push({ ...base, action: 'skip', reason: problem });
      continue;
    }
    if (isLocalhostUrl(endpoint.url)) {
      if (localhostEndpoints >= 1) {
        endpoints.push({ ...base, action: 'skip', reason: 'only one localhost endpoint per organization' });
        continue;
      }
      localhostEndpoints += 1;
    }
    endpoints.push({ ...base, action: 'create' });
  }

  const rows = (
    records: { id: string }[],
    found: { id: string; organization: string | null }[],
    what: string,
  ): { id: string; action: RowAction }[] =>
    records.map((record) => {
      const byId = found.find((row) => row.id === record.id);
      if (byId && byId.organization !== orgId)
        conflicts.push(`${what} ${record.id} belongs to another organization of this node.`);
      return { id: record.id, action: byId ? 'keep' : 'create' };
    });

  return {
    organization: { id: orgId, name: config.organization.name, mode, ...(slug ? { slug } : {}) },
    exportedAt: config.manifest.exportedAt,
    deliveriesSince: config.manifest.deliveriesSince,
    members: config.manifest.members,
    counts: config.manifest.counts,
    apps,
    endpoints,
    acceptedPayments: rows(config.acceptedPayments, existing.acceptedPayments, 'Accepted payment'),
    invoices: rows(config.invoices, existing.invoices, 'Invoice'),
    conflicts,
  };
}

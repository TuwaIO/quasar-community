import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as chains from 'viem/chains';

import {
  areSystemProviderKeysEnabled,
  isPublicRpcFallbackEnabled,
  isSafeTransactionServiceEnabled,
} from '../common/provider-policy';
import { getAlchemyKey } from '../constants';
import { DRIZZLE } from '../database/database.constants';
import * as schema from '../database/schema/index';
import { alchemyNetworkMap } from '../lib/generated/alchemyNetworkMap';
import { solanaChainIdAliases, solanaClusterOf } from '../lib/solana-chain';

/** The provider settings of an app that decide whether Quasar can track its transactions. */
export interface AppProviderSettings {
  alchemyApiKey: string | null;
  quickNodeApiKey: string | null;
  quickNodeAppName: string | null;
  pimlicoApiKey: string | null;
  gelatoApiKey: string | null;
  /** Chain IDs of the app's own RPC endpoints. */
  rpcChainIds: string[];
}

/** The fields of a synced transaction that choose its tracker. */
export interface TrackedTransaction {
  tracker: string;
  adapter: string;
  chainId: string;
  pimlicoApiKey?: string | null;
  bundlerUrl?: string | null;
}

const RPC_HINT = 'add an RPC endpoint, an Alchemy key or a QuickNode key in the app settings';

function canReadEvm(chainId: string, app: AppProviderSettings): boolean {
  const alchemyNetwork = alchemyNetworkMap[Number(chainId)];
  if (app.rpcChainIds.includes(chainId)) return true;
  if (app.alchemyApiKey && alchemyNetwork) return true;
  if (app.quickNodeApiKey && app.quickNodeAppName) return true;
  if (getAlchemyKey() && alchemyNetwork) return true;
  const viemChain = Object.values(chains).find((chain) => (chain as { id?: number }).id === Number(chainId)) as
    { rpcUrls: { default: { http: readonly string[] } } } | undefined;
  return isPublicRpcFallbackEnabled() && Boolean(viemChain?.rpcUrls.default.http[0]);
}

function canReadSolana(chainId: string, app: AppProviderSettings): boolean {
  const aliases = solanaChainIdAliases(chainId);
  const alchemyNetwork = alchemyNetworkMap[aliases[0]];
  const cluster = solanaClusterOf(chainId);
  if (aliases.some((alias) => app.rpcChainIds.includes(alias))) return true;
  if (app.alchemyApiKey && alchemyNetwork) return true;
  if (app.quickNodeApiKey && app.quickNodeAppName) return true;
  if (getAlchemyKey() && alchemyNetwork) return true;
  return isPublicRpcFallbackEnabled() && (cluster === 'mainnet' || cluster === 'devnet');
}

/**
 * Why Quasar could not track a transaction with the providers available to its app, or `null` when it can. Mirrors
 * the provider choice of the trackers (`trackers/*.ts`): without the app's own providers and with the provider policy
 * off (`common/provider-policy.ts`), Quasar contacts no provider at all, so a transaction it cannot track is refused
 * when it is synced instead of staying pending.
 */
export function missingProvider(tx: TrackedTransaction, app: AppProviderSettings): string | null {
  const noRpc = `No RPC provider for chain ${tx.chainId}: ${RPC_HINT}.`;
  switch (tx.tracker) {
    // An EIP-5792 batch is tracked on-chain by the hash of its transaction, like an Ethereum transaction
    case 'ethereum':
    case 'eip5792':
      return canReadEvm(tx.chainId, app) ? null : noRpc;
    case 'solana':
      return canReadSolana(tx.chainId, app) ? null : noRpc;
    case 'erc4337': {
      const pimlico =
        tx.pimlicoApiKey ||
        app.pimlicoApiKey ||
        tx.bundlerUrl ||
        (areSystemProviderKeysEnabled() ? process.env.PIMLICO_API_KEY : '');
      if (!pimlico) return "Tracking a user operation needs the app's Pimlico API key or a bundler URL.";
      return canReadEvm(tx.chainId, app) ? null : noRpc;
    }
    case 'gelato': {
      const gelato = app.gelatoApiKey || (areSystemProviderKeysEnabled() ? process.env.GELATO_API_KEY : '');
      return gelato ? null : "Tracking a relayed transaction needs the app's Gelato API key.";
    }
    case 'safe':
      return isSafeTransactionServiceEnabled()
        ? null
        : 'Tracking Safe transactions is not available on this deployment.';
    default:
      return null;
  }
}

const SETTINGS_TTL_MS = 30_000;

/**
 * Checks a synced transaction against the provider settings of its app ({@link missingProvider}). The settings are
 * kept in memory for 30 seconds, so a provider added in the dashboard is picked up within that time.
 */
@Injectable()
export class ProviderAvailabilityService {
  private readonly cache = new Map<string, { at: number; settings: AppProviderSettings }>();

  constructor(@Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>) {}

  async check(appId: string, tx: TrackedTransaction): Promise<string | null> {
    return missingProvider(tx, await this.settings(appId));
  }

  private async settings(appId: string): Promise<AppProviderSettings> {
    const cached = this.cache.get(appId);
    if (cached && Date.now() - cached.at < SETTINGS_TTL_MS) return cached.settings;

    const [app] = await this.db
      .select({
        alchemyApiKey: schema.apps.alchemyApiKey,
        quickNodeApiKey: schema.apps.quickNodeApiKey,
        quickNodeAppName: schema.apps.quickNodeAppName,
        pimlicoApiKey: schema.apps.pimlicoApiKey,
        gelatoApiKey: schema.apps.gelatoApiKey,
      })
      .from(schema.apps)
      .where(eq(schema.apps.id, appId))
      .limit(1);
    const rpcConfigs = await this.db
      .select({ chainId: schema.appsRpcConfigs.chainId })
      .from(schema.appsRpcConfigs)
      .where(eq(schema.appsRpcConfigs.parentId, appId));

    const settings: AppProviderSettings = {
      alchemyApiKey: app?.alchemyApiKey ?? null,
      quickNodeApiKey: app?.quickNodeApiKey ?? null,
      quickNodeAppName: app?.quickNodeAppName ?? null,
      pimlicoApiKey: app?.pimlicoApiKey ?? null,
      gelatoApiKey: app?.gelatoApiKey ?? null,
      rpcChainIds: rpcConfigs.map((config) => String(config.chainId)),
    };
    this.cache.set(appId, { at: Date.now(), settings });
    return settings;
  }
}

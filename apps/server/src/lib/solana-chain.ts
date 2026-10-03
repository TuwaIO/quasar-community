import { getSolanaChainId, getSolanaCluster, SOLANA_CHAIN_IDS } from '@tuwaio/orbit-core';

/**
 * Chain IDs of each public Solana cluster other than its Wallet Standard moniker (`solana:devnet`) and its CAIP-2 ID
 * (`solana:EtWT…`, the first 32 characters of the base58 genesis hash, CAIP-30). Pulsar before 0.9 sent the moniker,
 * so rows synced before the 2026-10 data migration may hold it, and some wallets still name testnet by its genesis
 * from before the reset.
 */
const LEGACY_CHAIN_IDS: Record<SolanaCluster, readonly string[]> = {
  mainnet: ['solana:mainnet-beta'],
  devnet: [],
  testnet: ['solana:4uhcVJyU9pJkvQyS88uRfhDSfZSm8DoR'],
};

export type SolanaCluster = keyof typeof SOLANA_CHAIN_IDS;

/**
 * The public cluster a Solana chain ID names, in any form (`solana:devnet`, `solana:EtWT…`, bare `devnet`);
 * `undefined` for localnet, custom clusters and other chains.
 */
export function solanaClusterOf(chainId: string): SolanaCluster | undefined {
  const cluster = getSolanaCluster(chainId);
  return cluster === 'localnet' ? undefined : cluster;
}

/**
 * Every chain ID of the cluster `chainId` names, or just `chainId` when it is not a public cluster. The moniker comes
 * first: it is the key of `alchemyNetworkMap`.
 */
export function solanaChainIdAliases(chainId: string): string[] {
  const cluster = solanaClusterOf(chainId);
  return cluster ? [`solana:${cluster}`, SOLANA_CHAIN_IDS[cluster], ...LEGACY_CHAIN_IDS[cluster]] : [chainId];
}

/**
 * The chain ID Quasar stores and sends in webhooks for a Solana transaction: the CAIP-2 ID with the genesis hash for
 * a public cluster, `solana:localnet` for localnet, and the ID as it was sent for a custom cluster.
 */
export function solanaCaip2ChainId(chainId: string): string {
  return getSolanaChainId(chainId) ?? chainId;
}

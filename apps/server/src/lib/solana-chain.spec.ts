import { describe, expect, it } from 'vitest';

import { solanaCaip2ChainId, solanaChainIdAliases, solanaClusterOf } from './solana-chain';

describe('Solana chain IDs', () => {
  it.each([
    ['solana:mainnet', 'mainnet'],
    ['solana:mainnet-beta', 'mainnet'],
    ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'mainnet'],
    ['solana:devnet', 'devnet'],
    ['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', 'devnet'],
    ['solana:testnet', 'testnet'],
    ['solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z', 'testnet'],
    ['solana:4uhcVJyU9pJkvQyS88uRfhDSfZSm8DoR', 'testnet'],
    ['devnet', 'devnet'],
    ['mainnet', 'mainnet'],
  ])('resolves %s to %s', (chainId, cluster) => {
    expect(solanaClusterOf(chainId)).toBe(cluster);
  });

  it.each(['solana:localnet', 'eip155:1', '1', 'solana:custom', ''])('does not resolve %s', (chainId) => {
    expect(solanaClusterOf(chainId)).toBeUndefined();
  });

  it('lists every ID of a cluster, the Wallet Standard moniker first', () => {
    expect(solanaChainIdAliases('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1')).toEqual([
      'solana:devnet',
      'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    ]);
    expect(solanaChainIdAliases('solana:mainnet')).toEqual([
      'solana:mainnet',
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      'solana:mainnet-beta',
    ]);
    expect(solanaChainIdAliases('testnet')).toEqual([
      'solana:testnet',
      'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z',
      'solana:4uhcVJyU9pJkvQyS88uRfhDSfZSm8DoR',
    ]);
  });

  it('keeps an unknown chain ID as its only alias', () => {
    expect(solanaChainIdAliases('solana:localnet')).toEqual(['solana:localnet']);
  });

  it.each([
    ['solana:devnet', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'],
    ['devnet', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'],
    ['solana:mainnet-beta', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    ['solana:4uhcVJyU9pJkvQyS88uRfhDSfZSm8DoR', 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z'],
    ['localnet', 'solana:localnet'],
    ['solana:localnet', 'solana:localnet'],
  ])('stores %s as %s', (chainId, caip2) => {
    expect(solanaCaip2ChainId(chainId)).toBe(caip2);
  });

  it('keeps a chain ID of a custom cluster as it was sent', () => {
    expect(solanaCaip2ChainId('solana:custom')).toBe('solana:custom');
  });
});

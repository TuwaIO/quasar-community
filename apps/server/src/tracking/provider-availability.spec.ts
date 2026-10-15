import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppProviderSettings, missingProvider } from './provider-availability';

const none: AppProviderSettings = {
  alchemyApiKey: null,
  quickNodeApiKey: null,
  quickNodeAppName: null,
  pimlicoApiKey: null,
  gelatoApiKey: null,
  rpcChainIds: [],
};

const evm = { tracker: 'ethereum', adapter: 'evm', chainId: '8453' };
const MAINNET_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

describe('missingProvider (the provider policy off, the default)', () => {
  beforeEach(() => {
    vi.stubEnv('SYSTEM_PROVIDER_KEYS_ENABLED', '');
    vi.stubEnv('PUBLIC_RPC_FALLBACK_ENABLED', '');
    vi.stubEnv('SAFE_TRANSACTION_SERVICE_ENABLED', '');
    vi.stubEnv('ALCHEMY_API_KEY_FALLBACK', 'system-key');
    vi.stubEnv('PIMLICO_API_KEY', 'system-pimlico');
    vi.stubEnv('GELATO_API_KEY', 'system-gelato');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('EVM', () => {
    it('names the chain when the app has no RPC provider for it', () => {
      expect(missingProvider(evm, none)).toMatch(/No RPC provider for chain 8453/);
    });

    it('accepts an RPC endpoint the app set up for the chain', () => {
      expect(missingProvider(evm, { ...none, rpcChainIds: ['8453'] })).toBeNull();
    });

    it("accepts the app's Alchemy key for a network Alchemy supports", () => {
      expect(missingProvider(evm, { ...none, alchemyApiKey: 'enc' })).toBeNull();
    });

    it("does not count the app's Alchemy key for a network Alchemy does not support", () => {
      expect(missingProvider({ ...evm, chainId: '31337' }, { ...none, alchemyApiKey: 'enc' })).toMatch(
        /No RPC provider/,
      );
    });

    it("accepts the app's QuickNode endpoint", () => {
      expect(missingProvider(evm, { ...none, quickNodeApiKey: 'enc', quickNodeAppName: 'my-app' })).toBeNull();
    });

    it('accepts the system Alchemy key and the public RPC only when they are switched on', () => {
      vi.stubEnv('SYSTEM_PROVIDER_KEYS_ENABLED', 'true');
      expect(missingProvider(evm, none)).toBeNull();
      vi.stubEnv('SYSTEM_PROVIDER_KEYS_ENABLED', '');
      vi.stubEnv('PUBLIC_RPC_FALLBACK_ENABLED', 'true');
      expect(missingProvider(evm, none)).toBeNull();
    });
  });

  describe('EIP-5792 batches', () => {
    const batch = { tracker: 'eip5792', adapter: 'evm', chainId: '8453' };

    it('needs an RPC provider for the chain, like an Ethereum transaction', () => {
      expect(missingProvider(batch, none)).toMatch(/No RPC provider for chain 8453/);
      expect(missingProvider(batch, { ...none, rpcChainIds: ['8453'] })).toBeNull();
    });
  });

  describe('Solana', () => {
    const solana = { tracker: 'solana', adapter: 'solana', chainId: MAINNET_CAIP2 };

    it('names the cluster when the app has no RPC provider for it', () => {
      expect(missingProvider(solana, none)).toMatch(/No RPC provider for chain/);
    });

    it('accepts an RPC endpoint stored under another ID of the same cluster', () => {
      expect(missingProvider(solana, { ...none, rpcChainIds: ['solana:mainnet'] })).toBeNull();
    });

    it("accepts the app's Alchemy key", () => {
      expect(missingProvider(solana, { ...none, alchemyApiKey: 'enc' })).toBeNull();
    });
  });

  describe('ERC-4337 (Pimlico)', () => {
    const userOp = { tracker: 'erc4337', adapter: 'evm', chainId: '8453' };

    it("asks for the app's Pimlico key or a bundler URL", () => {
      expect(missingProvider(userOp, { ...none, alchemyApiKey: 'enc' })).toMatch(/Pimlico API key or a bundler URL/);
    });

    it('accepts a bundler URL from the sync request', () => {
      expect(
        missingProvider(
          { ...userOp, bundlerUrl: 'https://bundler.customer.example/rpc' },
          { ...none, alchemyApiKey: 'enc' },
        ),
      ).toBeNull();
    });

    it('still needs an RPC provider for the on-chain stage', () => {
      expect(missingProvider(userOp, { ...none, pimlicoApiKey: 'enc' })).toMatch(/No RPC provider/);
    });
  });

  describe('Gelato', () => {
    const relayed = { tracker: 'gelato', adapter: 'evm', chainId: '8453' };

    it("asks for the app's Gelato key", () => {
      expect(missingProvider(relayed, none)).toMatch(/Gelato API key/);
    });

    it("accepts the app's Gelato key, or the system key when it is switched on", () => {
      expect(missingProvider(relayed, { ...none, gelatoApiKey: 'enc' })).toBeNull();
      vi.stubEnv('SYSTEM_PROVIDER_KEYS_ENABLED', 'true');
      expect(missingProvider(relayed, none)).toBeNull();
    });
  });

  describe('Safe', () => {
    const multisig = { tracker: 'safe', adapter: 'evm', chainId: '1' };

    it('is unavailable unless SAFE_TRANSACTION_SERVICE_ENABLED is true', () => {
      expect(missingProvider(multisig, none)).toMatch(/Safe/);
      vi.stubEnv('SAFE_TRANSACTION_SERVICE_ENABLED', 'true');
      expect(missingProvider(multisig, none)).toBeNull();
    });
  });
});

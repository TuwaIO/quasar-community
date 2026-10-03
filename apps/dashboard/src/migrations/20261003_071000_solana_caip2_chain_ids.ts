import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// Data only: one chain ID per Solana cluster. Pulsar before 0.9 synced Solana
// transactions under the Wallet Standard moniker (`solana:devnet`); from 0.9
// clients send the CAIP-2 ID with the genesis hash (CAIP-30), and the Engine
// stores every Solana chain ID in that form (apps/server/src/lib/solana-chain.ts).
// Rewriting the stored rows keeps the dashboard's per-chain grouping and
// filters on one value per cluster, and webhooks re-sent for old transactions
// carry the same chain ID as new ones.
//
// `mainnet-beta` and the testnet genesis from before its reset name the same
// clusters. `solana:localnet` and custom clusters have no fixed genesis hash and
// stay as they are. The snapshot is unchanged: no schema change.
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   UPDATE "transactions" SET "chain_id" = CASE "chain_id"
    WHEN 'solana:mainnet' THEN 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
    WHEN 'solana:mainnet-beta' THEN 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
    WHEN 'solana:devnet' THEN 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
    WHEN 'solana:testnet' THEN 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z'
    WHEN 'solana:4uhcVJyU9pJkvQyS88uRfhDSfZSm8DoR' THEN 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z'
  END
  WHERE "chain_id" IN ('solana:mainnet', 'solana:mainnet-beta', 'solana:devnet', 'solana:testnet', 'solana:4uhcVJyU9pJkvQyS88uRfhDSfZSm8DoR');
  UPDATE "apps_rpc_configs" SET "chain_id" = CASE "chain_id"
    WHEN 'solana:mainnet' THEN 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
    WHEN 'solana:mainnet-beta' THEN 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
    WHEN 'solana:devnet' THEN 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
    WHEN 'solana:testnet' THEN 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z'
    WHEN 'solana:4uhcVJyU9pJkvQyS88uRfhDSfZSm8DoR' THEN 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z'
  END
  WHERE "chain_id" IN ('solana:mainnet', 'solana:mainnet-beta', 'solana:devnet', 'solana:testnet', 'solana:4uhcVJyU9pJkvQyS88uRfhDSfZSm8DoR');`)
}

// Back to the monikers, which every Engine version reads, so a release before
// the CAIP-2 IDs finds its RPC overrides and filters again. Rows that were
// `mainnet-beta` or the old testnet genesis come back as the plain moniker.
export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   UPDATE "transactions" SET "chain_id" = CASE "chain_id"
    WHEN 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' THEN 'solana:mainnet'
    WHEN 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' THEN 'solana:devnet'
    WHEN 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z' THEN 'solana:testnet'
  END
  WHERE "chain_id" IN ('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z');
  UPDATE "apps_rpc_configs" SET "chain_id" = CASE "chain_id"
    WHEN 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' THEN 'solana:mainnet'
    WHEN 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' THEN 'solana:devnet'
    WHEN 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z' THEN 'solana:testnet'
  END
  WHERE "chain_id" IN ('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z');`)
}

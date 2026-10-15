import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres';

// The one migration of the policies release (open-source-plans/13-policies-production.md); the FAQ texts of the public
// beta are edited in the admin, not here.
//
// Pulsar 0.10 (TUWA releases of 2026-10-10): an EIP-5792 batch (`tracker: eip5792`) is synced by its batch ID and
// tracked by the hash of its transaction, which the app reports later. A Solana transaction keeps the commitment it
// reached (`confirmed` once, `finalized` on success) and the block height its blockhash is valid until, past which an
// unknown signature can no longer land.
//
// A new organization gets 1,000 free quota units during the public beta (`INITIAL_QUOTA_BALANCE`); Payload writes the
// value itself, and the column default follows the collection.
//
// The data processing status of an organization (`DATA_PROCESSING`): the Cloud engine refuses the transactions of a
// `pending` organization until it concludes the Data Processing Addendum (and the standard contractual clauses where
// they apply). Every existing organization starts as `pending`; a system admin marks the organizations of the operator
// itself `own`.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_transactions_confirmation_status" AS ENUM('processed', 'confirmed', 'finalized');
  ALTER TYPE "public"."enum_transactions_tracker" ADD VALUE 'eip5792';
  ALTER TABLE "transactions" ADD COLUMN "confirmation_status" "enum_transactions_confirmation_status";
  ALTER TABLE "transactions" ADD COLUMN "last_valid_block_height" numeric;
  ALTER TABLE "organizations" ALTER COLUMN "quota_balance" SET DEFAULT 1000;
  CREATE TYPE "public"."enum_organizations_data_processing" AS ENUM('pending', 'own');
  ALTER TABLE "organizations" ADD COLUMN "data_processing" "enum_organizations_data_processing" DEFAULT 'pending';`);
}

// The tracker type loses `eip5792`: the cast fails while batches are stored, because they have no other tracker to
// become
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "organizations" DROP COLUMN IF EXISTS "data_processing";
  DROP TYPE IF EXISTS "public"."enum_organizations_data_processing";
  ALTER TABLE "organizations" ALTER COLUMN "quota_balance" SET DEFAULT 100;
  ALTER TABLE "transactions" ALTER COLUMN "tracker" SET DATA TYPE text;
  DROP TYPE "public"."enum_transactions_tracker";
  CREATE TYPE "public"."enum_transactions_tracker" AS ENUM('ethereum', 'safe', 'gelato', 'solana', 'erc4337');
  ALTER TABLE "transactions" ALTER COLUMN "tracker" SET DATA TYPE "public"."enum_transactions_tracker" USING "tracker"::"public"."enum_transactions_tracker";
  ALTER TABLE "transactions" DROP COLUMN IF EXISTS "confirmation_status";
  ALTER TABLE "transactions" DROP COLUMN IF EXISTS "last_valid_block_height";
  DROP TYPE IF EXISTS "public"."enum_transactions_confirmation_status";`);
}

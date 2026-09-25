# AGENTS.md — Quasar Community Edition

> **Source of Truth for all AI agents operating within the Quasar Community Edition codebase.**
> Read this file completely before modifying any code. Last Update: 2026.

---

## 1. Project Philosophy

**Quasar Community Edition** is the **self-hosted, headless Web3 backend engine** for the TUWA Ecosystem. It provides developer-controlled, privacy-focused Web3 transaction indexing (Pulsar), multi-chain lifecycle tracking, webhook dispatching, and API key management without external SaaS dependencies or subscription billing.

### Core Tenets

| Tenet                   | Meaning                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| **The Iron Dome**       | Dual-Layer security. Next.js Middleware for Payload Admin/Auth. NestJS Fastify Guard for high-performance Engine APIs. |
| **Single-Admin Scoping**| Self-hosted single-tenant / Personal Workspace model. Queries are scoped by `organizationId`.                   |
| **Machine-Only Writes** | Transaction data is written exclusively by Pulsar Sync clients via documented API endpoints (`/v1/engine/*`).   |
| **Self-Sovereignty**    | 100% self-hosted on bare metal or VPS via Docker Compose. Zero cloud provider lock-in, zero external SaaS telemetry. |

### Tech Stack

| Layer            | Technology                              | Version |
| ---------------- | --------------------------------------- | ------- |
| Framework        | Next.js (App Router)                    | 16.3.x  |
| CMS / ORM        | Payload CMS                             | 3.88.x  |
| NestJS Server    | NestJS (Fastify)                        | 12.x    |
| NestJS ORM       | Drizzle ORM                             | 0.45.x  |
| Database         | PostgreSQL (self-hosted)                | 16      |
| Cache / Queue    | Redis 7 (Dual-Layer: API Cluster `noeviction` + UI Single `allkeys-lru`) | 7 |
| Reverse Proxy    | Traefik                                 | 3.6.x   |
| Monitoring       | Prometheus + Loki + Grafana             | 11.x    |
| Auth             | Payload Auth, TOTP 2FA                  | —       |
| Package Manager  | pnpm                                    | 12.x    |
| Language         | TypeScript                              | 6.0.x   |

---

## 2. CRITICAL RULES — Non-Negotiable Guardrails

> [!CAUTION]
> **Violating any rule below is a critical bug. No exceptions.**

### 2.1 Dependency & Schema Integrity

- **FORBIDDEN**: `ethers.js`, `web3.js`, `RainbowKit`, `ConnectKit`, `gill`.
- **REQUIRED**: `viem`, `wagmi`, `@solana/kit` (Solana), `@tuwaio/orbit-solana`.
- **SCHEMA AUTHORITY**: Payload CMS owns the database schema. **NEVER** use Drizzle (`drizzle-kit push` / `pnpm db:push`) to apply schema changes to staging/production databases. All production schema changes must go through Payload migrations (`pnpm db:migrate`), ensuring partitioned tables metadata remains intact. Create them as described in §2.2.1.

### 2.2 Database Partitioning (Time-Series)

- **PARTITIONED TABLES**: `transactions`, `webhook_deliveries`.
- **STRATEGY**: Monthly partitions (e.g., `_y2026_m05`).
- **MANAGEMENT**: Automated by `PartitionManagerService` + `PartitionCronService`.
- **LOCKING**: Distributed Redlock is mandatory for partition creation and usage synchronization.

#### 2.2.1 Creating a Payload migration

The Payload config knows nothing about partitions, but the init migration and its JSON snapshot describe the partitioned shape. A generated migration can therefore contain statements that are right for the config and wrong for the database.

1. Change the collection config, then run `pnpm db:migrate:create <name>`. No database is needed: it diffs the config against the newest `apps/dashboard/src/migrations/*.json` snapshot.
2. **Delete** every generated statement that touches the partitioned tables' keys: `DROP CONSTRAINT "…_id_created_at_pk"` / `ADD PRIMARY KEY ("id")` on `transactions` or `webhook_deliveries`, foreign keys `REFERENCES` either of them, and any `CREATE UNIQUE INDEX` on them without `"created_at"` (with the `DROP INDEX` before it). `apps/dashboard/src/tests/migrations-partitioning.test.ts` fails on them in `pnpm test`.
3. The shipped migration snapshots describe the full upstream schema, including tables this edition's config does not define. If the diff drops those tables, delete those statements too: the tables exist in every database built from these migrations and are harmless.
4. Keep the generated `.json` snapshot as it is. The newest snapshot must describe the config, not the partitioned shape; the same test checks it.
5. Backfill data before `SET NOT NULL`, and check for duplicates before a new unique index. Test with the edge cases seeded.
6. `pnpm generate:db-schema` and `pnpm generate:types`.
7. `pnpm db:migrate:create <anything> --skip-empty` must now create nothing.

### 2.3 State Management & Scaling

- **NEVER** use local `useState` for transaction loading states.
- **ALWAYS** use `usePulsarStore -> executeTxAction` for all blockchain writes.
- **STATELESS APPS**: Both Next.js and NestJS are stateless. Scale them horizontally using `replicas` in Docker Compose.
- **DUAL REDIS ISOLATION**:
  - **`REDIS_API` (`redisApi`)**: Core engine queues (BullMQ `outbox`, `tracking-fast`, `tracking-lazy`, `webhook-delivery`, `aml-screening`), IronDome key resolution (`{secretKeyHash}:meta`), and Redlock usage sync (`{orgId}:usage`). Uses `noeviction` with AOF persistence.
  - **`REDIS_UI` (`redis`)**: Admin panel ephemeral state (Rate Limiting, 2FA Locks, Admin Sessions). Uses `allkeys-lru` eviction policy capped at 256MB.
  - **URL RESOLUTION**: Always use `resolveEnvUrl` from `@tuwaio/shared/utils` to parse nested `${VAR}` placeholders in raw Redis connection strings.

### 2.4 PostgreSQL WAL-G Durability

- PostgreSQL primary and standby images include the pinned, checksum-verified WAL-G binary.
- `archive_command` MUST use encrypted `wal-g wal-push %p`; local WAL copies are not a disaster-recovery mechanism.
- `restore_command` MUST use `wal-g wal-fetch %f %p` for PITR recovery.
- Both PostgreSQL entrypoints MUST normalize the active WAL settings before the supervised PostgreSQL process starts.
- Continuous WAL streaming (`wal-g wal-push %p`) archives in real-time independently with sub-minute RPO. Logical `pg-backup` dumps run on a daily schedule.
- The repository-controlled non-destructive gate is `infra/scripts/test_walg_preflight.sh`; it verifies node role uniqueness, active WAL-G settings, archive telemetry, and base-backup visibility.

### 2.5 PostgreSQL High-Availability & Connection Pooling

- **CONNECTION POOLING MANDATORY**: All application services (`quasar-app`, `quasar-nest-api`, `quasar-worker`) MUST connect to PostgreSQL exclusively via `pgbouncer:5432` in `DATABASE_URL` and `DATABASE_URL_READ`. Direct container connections to individual database nodes (`postgresql-primary` / `postgresql-standby`) are strictly forbidden.
- **DECOUPLED APPLICATION DEPENDENCY**: Application containers MUST depend on `pgbouncer: condition: service_healthy` in Docker Compose, and must never declare direct `condition: service_healthy` dependencies on individual database nodes (`postgresql-primary` / `postgresql-standby`).
- **SAFE BIDIRECTIONAL REJOIN**: After failover and promotion of `postgresql-standby`, `postgresql-primary` must rejoin as a standby of the promoted master using `REPMGR_ROLE=standby REPMGR_PRIMARY_HOST=postgresql-standby` to prevent split-brain and guarantee zero data loss.

---

## 3. The "Iron Dome" Protocol (Dual-Subdomain Architecture)

### Management Layer (`quasar.${DOMAIN}`)
- **Scope**: Payload Admin Panel and Admin Auth (`/admin`).
- **Middleware**: `src/proxy.ts` handles CORS, security headers, and Origin protection.
- **Trust Proxy**: Configured for local Traefik reverse proxy and optional Cloudflare IP ranges.

### Performance Layer (`api.${DOMAIN}`)
- **Scope**: High-performance Fastify Engine API (`/v1/engine/*`).
- **IronDomeGuard**: Handles API Key resolution (SHA-256 hashing for Secret Keys), Whitelisting, and RPS limiting.
- **Smart Degradation**: Zero remaining quota triggers `lazy` trackMode for Pulsar Sync instead of hard blocking.

---

## 4. Directory Structure Map

```
apps/
├── dashboard/                         # Next.js + Payload CMS app
│   ├── src/
│   │   ├── proxy.ts                   # Admin Auth Guarding (Next.js Middleware)
│   │   ├── app/                       # Next.js App Router (Payload Admin UI & APIs)
│   │   ├── collections/               # Payload CMS Schema (Source of Truth)
│   │   │   ├── ContextEngine/         # Apps, Networks, Transactions
│   │   │   ├── ContextOrganizations/  # Organizations, Members
│   │   │   ├── ContextUsers/          # Users, 2FA
│   │   │   └── ContextWebhooks/       # Webhook Endpoints & Deliveries
│   │   └── lib/                       # Server-side logic (Redis, Security)
│   ├── payload.config.ts              # Payload CMS configuration
│   └── tsconfig.json
└── server/                            # NestJS high-performance Fastify server
    ├── src/
    │   ├── common/
    │   │   ├── iron-dome.guard.ts     # High-perf Engine Security & API Key Resolution
    │   │   └── internal.guard.ts      # System-only Guard
    │   ├── cron/                      # Centralized Jobs (Usage Sync, Partitions, Pending Sweeper)
    │   ├── database/
    │   │   └── schema/                # Drizzle Schema (Introspected)
    │   ├── tracking/                  # Pulsar Transaction Indexing
    │   └── worker/                    # BullMQ Background Job Processors
    └── tsconfig.json
packages/
└── shared/                            # Workspace Shared Library (@tuwaio/shared)
    └── src/
        ├── utils.ts                   # resolveEnvUrl, maskKey helpers
        ├── encryption.ts              # AES-256-GCM field encryption
        └── index.ts
```

---

## 5. Security & Data Integrity Patterns

### Key Resolution & Disclosure

- **Listing Apps**: Returns `maskedSecretKey` (`sk_live_1234...5678`).
- **Reveal PK/SK**: Requires a specific `POST .../reveal` call with Admin/Owner role verification.
- **Internal Verification**: `GET /internal/verify` allows checking `INTERNAL_SECRET` validity.

### Quota Consistency ("Swap-and-Sync")

Usage data is synced from Redis to Postgres via `SyncUsageService` using a temporary key pattern to prevent data loss during crashes.

### Quota Weights

Every weight lives in `QUOTA_DEFAULTS` (`packages/shared/src/constants.ts`) and
is applied in `IronDomeGuard.processAuthorizedRequest`. Never inline a number at
a call site.

| What | Constant | Units |
| :--- | :--- | :--- |
| Pulsar sync, `environment: live` | `SYNC_TX_WEIGHT` | 10 |
| Pulsar sync, `environment: test` | `SYNC_TX_WEIGHT_TEST` | 5 |
| Outbound webhook delivery attempt | `WEBHOOK_DELIVERY_WEIGHT` | 1 |
| `/pulsar/history` | — | 0 |
| Anything else | `DEFAULT_WEIGHT` | 1 |

On a self-hosted node quota is a runaway guard rail rather than a bill — the
seed provisions an effectively unlimited balance (see `docs/SEEDING.md`). The
live/test split still matters, because it is what makes an accidental loop
against a staging app cost half of what it would against production.

### Write Surface: Machine-Authored Collections

"Machine-Only Writes" is enforced by collection `access.create`, not by
convention. When adding or reviewing a collection, find its real writer before
touching the gate — most of these are written with `overrideAccess: true` or
outside Payload entirely, and so never consult it:

| Collection | `create` | Real writer |
| :--- | :--- | :--- |
| `transactions` | `machineOnlyCreateAccess` (`sync:write` scope) | Engine, Pulsar sync path. `delete` is `() => false` for everyone — a row is the record of metered work, so removing one by hand desynchronises the ledger from the chain. Cascades from `Apps`/`Organizations` use `overrideAccess: true` and are unaffected. |
| `webhook-deliveries` | `() => false` | Dispatcher and retry worker. `update`/`delete` are also `() => false`: the log is the evidence of what was sent and what came back. A retry does not add a record: the worker updates the delivery it retries (by `deliveryId`, or the latest row for the same `txKey` + endpoint + event), overwriting the status, response and body and bumping `attempts`. The previous attempt's response is not kept. |
| `quota-usage-ledger` | `() => false` | `cron/sync-usage.service.ts`, straight into Drizzle inside the balance-debit transaction. `batchId` is an exactly-once key. |
| `deleted-accounts`, `deleted-organizations`, `deleted-organization-members` | `() => false` | Deletion hooks. They also back the re-registration / org-creation cooldowns. |
| `app-invoices` | `() => false` | Payments-kind apps via the v1 REST API (`overrideAccess: true`). |
| `users` | `() => false` | The seed, once. A Community node is single-admin: no sign-up form, no verification email, no password reset. |
| `organization-members` | `() => false` | `Organizations.afterChange` and the Personal Workspace hook, both with `overrideAccess: true`. `update`/`delete` are closed too: an organization here has exactly one member, and there is no second account to grant membership to. |
| `app-accepted-payments` | `() => false` | Nobody yet — the Payments App is a declared but undelivered feature. `update`/`delete` stay open to org owners. |

Note the hook ordering trap behind `transactions`: Payload runs
`beforeOperation` **before** access control, so the `isAdmin` early return in
that hook is deliberate — without it an admin pressing "Create" would hit a
throw inside `resolveAuthContext` and get a 500 instead of the Forbidden the
access gate produces a step later.

### Retry Conditions

The Retry buttons in the Payload admin appear only where retrying can change
the outcome, and the retry routes refuse everything else. The buttons and the
routes read the same predicate, so never restate the condition at a call site:

| Entity | Predicate | Retry offered when | Route answer otherwise |
| :--- | :--- | :--- | :--- |
| Transaction | `canRetryTransaction` (`apps/dashboard/src/lib/transaction-retry.ts`) | It finished in anything but `Success`, or has been pending for `STUCK_PENDING_THRESHOLD_SECONDS` (60 s, counted from `localTimestamp`) or longer. | 400. Re-tracking a successful transaction would dispatch its terminal webhooks a second time. |
| Webhook delivery | `canRetryWebhookDelivery` (`apps/dashboard/src/lib/webhook-utils.ts`) | `success` is false. | 400 |

The predicates are plain modules with no React, so the route handlers can
import them. The one-second clock that makes a pending transaction's button
appear at the threshold is a separate client hook,
`src/hooks/useTransactionAgeTick.ts`.

The routes behind the admin document buttons (transaction retry, delivery
retry, transaction receipt PDF) authorize with
`verifyOrgAccessOrSystemAdmin`. It admits a system admin (`roles` includes
`'admin'`) without an organization membership check. It only replaces that
check, so every such route must still scope the resource to `orgId` (BOLA).
Do not use it on routes that reveal or rotate secrets.

Tests: `src/tests/retry-conditions.test.ts` covers the predicates and both
routes, `src/tests/admin-retry-buttons.test.tsx` the admin buttons, and
`src/tests/admin-org-access.test.ts` the access helper.

### SSRF/Tarpit Protection

`WebhookDispatcherService` resolves all host IPs (`dns.resolve4/6`) and validates them against internal blacklists before any outbound request. A strict 10s hard timeout is enforced.

---

## 6. Development & Deployment

### Commands

```bash
# Workspace root
pnpm dev                  # Run Dashboard + NestJS simultaneously
pnpm generate:types       # Sync Payload types
pnpm generate:db-schema   # Sync Payload generated Drizzle schema
pnpm seed                 # Seed initial admin user and workspace
pnpm generate:alchemyNetworksMap  # Refresh the chain → Alchemy network map from Alchemy

# Database migrations (procedure: §2.2.1)
pnpm db:migrate:create <name>  # New Payload migration from the config diff
pnpm db:migrate                # Apply Payload migrations
```

### Alchemy Network Map

`apps/server/src/lib/generated/alchemyNetworkMap.ts` maps chain IDs to Alchemy network slugs. The trackers build `https://<slug>.g.alchemy.com/v2/<key>` from it, so a chain missing from the map never uses Alchemy, even with a key configured. **NEVER** edit the file by hand. Run `pnpm generate:alchemyNetworksMap` (`scripts/generateAlchemyNetworksMap.ts`) instead. The script validates Alchemy's response and writes nothing if the response is malformed or empty.

### Self-Hosted Policy (Non-Negotiable)

This project is 100% self-hosted on bare metal/VPS via Docker. Any suggestion to use managed cloud state services (Neon, PlanetScale, Supabase, Vercel KV) is a violation of project strategy.

### Docker Compose Profiles

- **Production Stack**: `docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d`
- **Minimal Stack**: `docker compose --env-file .env -f infra/docker-compose.minimal.yml up -d` (single postgres, single redis, for development and lightweight nodes). It is a standalone file, not an overlay: the production file requires S3, WAL-G and repmgr variables at interpolation time, before any overlay could relax them. Add `--profile observability` for Prometheus, Grafana, Loki and the exporters.

### Grafana Provisioning

- **Dashboards are read in place.** `infra/config/grafana/provisioning/` is mounted read-only at `/etc/grafana/provisioning-templates`; the entrypoint renders only the provider file, datasources and alerting into `GF_PATHS_PROVISIONING` (`/tmp/grafana-provisioning`). `dashboards.yml` MUST point at `/etc/grafana/provisioning-templates/dashboards/json`. `/etc/grafana/provisioning/...` loads nothing, and the rendered tree would freeze dashboards until a restart.
- **Fail loudly.** `docker-compose.yml` and `docker-compose.minimal.yml` carry the same Grafana entrypoint, including the guard that exits when the provider path holds no `*.json`. Grafana alone only logs `Cannot read directory` and serves an empty list. Keep both entrypoints identical.
- **Alert rules live in Prometheus** (`infra/config/prometheus/rules.yml`) and are delivered by Alertmanager. Grafana provisions only the notification policy and the rendered `Notify` contact point.

### Secret and SAST Scanning

- **`.gitleaks.toml` MUST start with `[extend] useDefault = true`.** A gitleaks config that contains only an `[allowlist]` replaces the built-in ruleset instead of extending it, and then every scan passes. Add false positives to the allowlist; never remove the `[extend]` block to silence them.
- **The scanners need no secrets and are never skipped.** Without `GITLEAKS_LICENSE`, `ci.yml` and `deploy.yml` run the pinned gitleaks CLI image instead of `gitleaks-action`. Without `SEMGREP_APP_TOKEN`, they run `semgrep scan --config p/default --error` instead of `semgrep ci`. A finding fails the job in both modes. See `docs/CICD_SETUP.md`, §3.

---

## 7. Security Hardening & Isolation Standards

1. **Tenant-Scoped Access Controls**:
   - `organizations` collection modifications are gated by dedicated helpers (`isOrgOwnerForOrg` for `delete` and `isOrgAdminOrOwnerForOrg` for `update`), verifying strict ownership at the record's primary key (`id`) level.
2. **Parent Resource IDOR/BOLA Protection**:
   - All nested resources (e.g. `PATCH /api/v1/organizations/[orgId]/members/[memberId]`) strictly validate the parent identifier against the database target representation.
3. **Unified Cache-Aside Invalidation**:
   - `IronDomeGuard` caches apps using their SHA-256 secret key hash (`{secretKeyHash}:meta`) and public key (`{publicKey}:meta`).
   - Any create/update/delete operation in the `Apps` collection or `outbox-processor` background queue instantly invalidates these keys.
4. **`overrideAccess: true` Verification Checklist**:
   - Any query using `overrideAccess: true` completely bypasses Payload access control rules.
   - Every use must be accompanied by explicit security checks confirming caller permissions and tenant ownership.

---

## 8. Upcoming Milestones: Payment Applications Integration

The next major feature milestone is the **Payment Applications Integration**. When writing code for upcoming features, align with the following design guidelines:

- **Dormant Milestone in Schema**: `Apps.kind: 'payments'` is declared in schema options for type stability and roadmap visibility, with user selection disabled via `components/admin/AppKindField.tsx`.
- **Cross-Chain Payment Handlers**: Support standard EVM payments via `viem` and Solana payments via `@solana/kit` and `@tuwaio/orbit-solana`.
- **Relaying & Gasless Execution**: Integrate Pimlico (ERC-4337 bundler/paymaster) relaying for EVM transactions to allow gasless payment validation and quota provisioning.
- **AML & Address Screening**: Integrate GoPlus security APIs to perform real-time threat screening on recipient and sender addresses (preventing sanction list exposure and address poisoning).
- **Application Payments Ledger**: Completed on-chain customer payments write to application payments ledger records (`app-invoices`, `app-accepted-payments`).

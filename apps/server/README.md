# Quasar Server — Community Edition (`@tuwaio/quasar-nest`)

> **High-Performance Headless Web3 Tracking Engine**  
> Fastify-powered NestJS microservice executing multi-chain transaction indexing, BullMQ asynchronous worker pipelines, automated PostgreSQL partitioning, and SSRF-safe webhook dispatches.

Copyright (c) 2025 - 2026 TUWA.  
Licensed under the [Apache-2.0 License](../../LICENSE).

---

## 1. Role in Community Edition

The NestJS server (`quasar-nest`) is the stateless, low-latency processing workhorse of the Quasar platform:

1. **Transaction Sync Endpoint (`POST /v1/engine/sync`)**: Ingests transaction tracking requests from dApps and backends, providing instant acknowledgment while offloading state reconciliation to BullMQ queues.
2. **Two-Phase Tracking Pipeline**:
   - **Phase 1: Fast (`tracking-fast`)**: Ingests the transaction immediately, checking mempool and block inclusion, and triggers the initial `transaction.pending` or `transaction.confirmed` webhook.
   - **Phase 2: Lazy (`tracking-lazy`)**: Automatically enqueued with a 10-second delay to verify confirmation depth, handle speed-up/cancellation replacements, and verify finality against chain-specific thresholds.
   - **Smart Account & Relayer Coverage**: Natively tracks standard EVM accounts, Solana transactions, Safe multisigs, Gelato relayers, and ERC-4337 Smart Accounts (UserOperations, paymasters, and bundlers) via Pimlico.
3. **Partition Manager (`PartitionManagerService`)**: Automatically provisions monthly PostgreSQL tables (`transactions_yYYYY_mMM`, `webhook_deliveries_yYYYY_mMM`) to maintain indexed performance under high transaction volumes.
4. **Outbound Webhook Worker**: Delivers event notifications to configured target URLs with DNS-level SSRF protection, strict 10-second tarpit timeouts, and HMAC-SHA256 signatures.

```
apps/server/
├── src/
│   ├── main.ts                        # Fastify bootstrap & global guards
│   ├── app.module.ts                  # Root dependency injection module
│   ├── common/
│   │   ├── iron-dome.guard.ts         # API key validation (SHA-256) & rate limiting
│   │   └── internal.guard.ts          # System guard (x-internal-secret)
│   ├── database/
│   │   ├── database.module.ts         # Drizzle connection to PgBouncer
│   │   └── schema/                    # Introspected Drizzle table definitions
│   ├── engine/
│   │   └── pulsar/                    # Transaction sync controller (POST /v1/engine/sync)
│   ├── lib/
│   │   └── generated/
│   │       └── alchemyNetworkMap.ts   # Chain ID → Alchemy network slug (generated, see §4)
│   ├── tracking/
│   │   ├── trackers/                  # Multi-chain trackers (EVM, Solana, Safe, Gelato, Pimlico)
│   │   ├── tracking.service.ts        # Ingestion logic
│   │   ├── router.service.ts          # Network confirmation thresholds
│   │   └── webhook-dispatcher.service.ts # SSRF-safe outbound dispatcher
│   ├── worker/
│   │   ├── tracking-worker.service.ts # BullMQ workers for Fast & Lazy lifecycle tracking
│   │   ├── webhook.processor.ts       # Webhook delivery processor
│   │   └── webhook-retry.processor.ts # Exponential backoff retry processor
│   ├── cron/
│   │   ├── partition-manager.service.ts # Automated Postgres monthly partitioning
│   │   └── redis-cleanup.service.ts   # Ephemeral cache eviction
│   └── redis/
│       └── redis.module.ts            # API Redis provider
├── test/                              # Vitest integration test suites
├── drizzle.config.ts                  # Drizzle Kit config
├── package.json
└── tsconfig.json
```

---

## 2. Tech Stack

| Component | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Framework** | NestJS (Fastify) | 12.x | High-throughput async HTTP pipeline |
| **Database ORM** | Drizzle ORM | 0.45.x | High-performance SQL query layer |
| **Job Queue** | BullMQ | 6.x | Redis-backed distributed task processing |
| **Connection Pooling**| PgBouncer | 1.23+ | Connection multiplexing on port 5432 |
| **Blockchain Client** | Viem / Solana Kit | 2.x / 8.x | Multi-chain RPC interaction and finality checks |
| **Runtime & Tooling** | Node.js / pnpm | v20–v24 / 12.x | TypeScript 6.0.x |

---

## 3. The Iron Dome Guard Protocol

Incoming engine requests to `/v1/engine/sync` are gated by `IronDomeGuard`:

- **API Key Verification**: Validates the `x-api-key` header (`pk_live_*` or `sk_live_*`). Secret keys are resolved using SHA-256 cryptographic hashes cached in Redis (`{secretKeyHash}:meta`).
- **RPS Limiting**: Enforces token-bucket rate limits per application using Redis atomic primitives.
- **Smart Degradation**: If an application reaches its quota, the engine does not discard incoming transactions; it gracefully falls back to `lazy` tracking mode, guaranteeing transaction telemetry continuity without data loss.

---

## 4. Development & Build

```bash
# Start server in watch mode (requires PostgreSQL and Redis running)
pnpm dev

# Compile TypeScript to dist/
pnpm build

# Start compiled server
pnpm start

# Run unit and integration tests
pnpm test
```

### Alchemy Network Map

When an app has an Alchemy key, or the node sets `ALCHEMY_API_KEY_FALLBACK`, the trackers route a chain through `https://<slug>.g.alchemy.com/v2/<key>`. The slug comes from `src/lib/generated/alchemyNetworkMap.ts`. A chain missing from the map is tracked through the remaining RPC providers only.

A release is normally cut with the network list Alchemy publishes at that moment. To add a network Alchemy launched after your release, regenerate the map from the workspace root:

```bash
pnpm generate:alchemyNetworksMap
```

The file is generated, so do not edit it by hand. The script writes nothing if Alchemy's response is malformed or empty. The map is compiled into the engine, so the change takes effect with the next build: `pnpm dev` reloads it, and a container deployment needs a rebuilt image.

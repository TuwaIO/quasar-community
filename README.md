# Quasar Community Edition

> **The Open-Source, Self-Hosted Web3 Transaction Indexing and Tracking Engine.**  
> Built for sovereign developers, high-throughput dApps, and node operators who require full ownership of their transaction lifecycle data.

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue)](https://www.postgresql.org/)
[![NestJS](https://img.shields.io/badge/NestJS-12-red)](https://nestjs.com/)
[![Payload CMS](https://img.shields.io/badge/Payload_CMS-3.88-black)](https://payloadcms.com/)
[![Live Showcase](https://img.shields.io/badge/Live_Showcase-community--stg.tuwa.io-emerald)](https://community-stg.tuwa.io)

---

## 1. What is Quasar Community Edition?

Quasar Community Edition is a **self-hosted, single-tenant transaction indexing engine** designed to track the entire lifecycle of blockchain transactions (pending, submitted, confirmed, replaced, finality) across EVM and Solana networks without reliance on centralized, proprietary SaaS APIs.

### Live Community Showcase

TUWA runs a public demonstration stand built from this exact tree — the same
generated snapshot, the same `infra/` compose topology, the same images:
- **Administrative Dashboard (/admin):** [https://community-stg.tuwa.io](https://community-stg.tuwa.io)
- **Engine Monitoring & Health Endpoint:** [https://api-community-stg.tuwa.io/v1/engine/monitoring/health](https://api-community-stg.tuwa.io/v1/engine/monitoring/health)

You can explore the self-hosted Payload CMS administration and high-throughput NestJS API in real-time before running your own node.

Two caveats, so the stand is not mistaken for something it is not. It is
**deployed by TUWA's own pipeline, not by this repository's** — the `deploy`
job in `.github/workflows/deploy.yml` here is gated on `DEPLOY_ENABLED`, which
is unset, so a clone of this repository deploys nothing until you point it at
your own server (see [`docs/CICD_SETUP.md`](./docs/CICD_SETUP.md)). And it is a
**staging contour**: it tracks the tip of development, so treat it as a preview
of the edition rather than an uptime-backed service.


### Core Capabilities

- **High-Throughput Ingestion**: NestJS (Fastify) microservice capable of processing high-volume RPC tracking events (`POST /v1/engine/sync`).
- **Deterministic Two-Phase Indexing**: BullMQ queue architecture with Phase 1 (Fast, real-time polling) and Phase 2 (Lazy, delayed consistency check for chain reorgs and RPC lag).
- **Multi-Chain Tracker Support**: Native adapters for EVM (standard accounts and ERC-4337 Smart Accounts via Pimlico/Gelato) and Solana (signature confirmation via `@solana/kit` and `@tuwaio/orbit-solana`).
- **Timeseries Partitioning**: Automatic monthly partitioning on PostgreSQL 16 for `transactions` and `webhook_deliveries` tables, preventing table bloat and ensuring sub-millisecond indexed lookups.
- **SSRF-Protected Webhooks**: Webhook delivery worker with DNS resolution validation against private IP ranges, tarpit timeouts, and HMAC-SHA256 signature verification.
- **Full Payload CMS Administration**: Self-hosted administrative back-office mounted at `/admin` for managing API keys, inspecting transaction logs, and configuring webhook delivery endpoints.
- **Single-Tenant Authentication**: Strictly **Native Payload Auth** (email and password credentials) reinforced with **TOTP Two-Factor Authentication (2FA)**. Zero SIWX / CAIP-122 wallet overhead, zero passkeys, zero third-party OAuth, and zero external email dependencies.
- **Pure Self-Custody**: Runs 100% locally or on your own VPS/Bare-Metal server via Docker Compose with Traefik ingress and optional Cloudflare Tunnels. Zero external cloud vendor lock-in.

### Technology Stack

| Layer | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Workspace / Tooling** | TypeScript / pnpm | 6.0.x / 12.3.x | Monorepo package management and strict type safety |
| **Admin Management** | Payload CMS 3.88 / Next.js 16 | 3.88.x / 16.3.x | PostgreSQL schema authority, migrations, and `/admin` panel |
| **High-Throughput Engine** | NestJS (Fastify) | 12.x | Hot-path transaction ingestion (`POST /v1/engine/sync`) |
| **Database & Pooling** | PostgreSQL 16 + PgBouncer | 16 / 1.23+ | Primary transactional storage with monthly partitions |
| **Caching & Queues** | Redis 7 + BullMQ | 7.x / 6.x | Task processing queues (`tracking-fast`, `tracking-lazy`, `webhooks`) |
| **Authentication** | Native Payload Auth + TOTP 2FA | — | Self-hosted email/password + RFC 6238 TOTP (zero SIWX / passkeys) |
| **Ingress & Edge Routing** | Traefik / Cloudflare Tunnel | 3.6.x | Automatic TLS termination, reverse proxy, and zero-open-port ingress |
| **Telemetry & Observability**| Prometheus + Loki + Grafana | 11.x | Metrics, structured logs, and operational health dashboards |

---

## 2. Repository Architecture

```
quasar-community/
├── apps/
│   ├── dashboard/          # Payload CMS 3.88 administrative dashboard (/admin)
│   │   ├── src/            # Collections, database schema, migrations
│   │   ├── README.md       # Dashboard documentation
│   │   └── package.json
│   └── server/             # NestJS 12 + Fastify high-performance tracking engine
│       ├── src/            # Trackers, BullMQ workers, partition crons, guards
│       ├── README.md       # NestJS engine documentation
│       └── package.json
├── packages/
│   └── shared/             # @tuwaio/shared workspace library (AES-256-GCM, CUIDs)
│       ├── README.md       # Shared library documentation
│       └── package.json
├── infra/                  # Production Docker Compose topology & configurations
│   ├── docker-compose.yml  # Database, Redis, PgBouncer, Engine, Dashboard, Traefik
│   ├── dockerfiles/        # Hardened multi-stage container builds
│   └── README.md           # Infrastructure operational runbook
├── docs/                   # Developer & operator documentation
│   ├── QUICKSTART_LOCAL.md # Local development setup guide
│   ├── PRODUCTION_DEPLOY.md# Production deployment guide
│   ├── CICD_SETUP.md       # GitHub Actions build/scan/sign/deploy pipeline
│   └── SEEDING.md          # Database seeding documentation
├── scripts/                # Server deploy, Cloudflare Tunnel setup, Alchemy network map generator
├── .github/workflows/      # CI quality gate, deploy pipeline, rollback
├── CONTRIBUTING.md         # Open-source contribution guidelines
├── LICENSE                 # Apache License Version 2.0
└── package.json            # Root workspace configuration
```

---

## 3. Quick Start (Local Setup in 5 Minutes)

### Prerequisites

- **Docker Engine** with Compose v2
- **Node.js** `v20` to `v24` (optional for container-only setups)
- **pnpm** `v12.x`

### Step 1: Clone & Configure Environment

```bash
git clone https://github.com/TuwaIO/quasar-community.git
cd quasar-community

# Copy example environment configuration
cp .env.example .env
```

Review `.env` and generate secure random secrets:
```bash
# Generate 64-hex encryption key for AES-256-GCM database columns
openssl rand -hex 32

# Generate secure Payload secret
openssl rand -base64 32
```

### Step 2: Choose Your Execution Mode

#### Option A: Native Development with Live Reload (Recommended for Coding)
Runs Postgres and Redis in Docker, while running Dashboard and Engine natively on your machine with instant Fast Refresh and watch mode:
```bash
# 1. Start state containers
docker compose --env-file .env -f infra/docker-compose.minimal.yml up -d postgres redis-api redis-ui

# 2. Run migrations and seed from host
pnpm db:migrate
pnpm seed

# 3. Start Next.js and NestJS in parallel with live reload
pnpm dev
```

#### Option B: Standalone Containerized Stack (Zero Host Toolchain)
Runs all services in isolated Docker containers:
```bash
# Build and start all services in background
docker compose --env-file .env -f infra/docker-compose.minimal.yml up -d --build

# Run migrations and seed inside container
docker compose --env-file .env -f infra/docker-compose.minimal.yml run --rm migrate
docker compose --env-file .env -f infra/docker-compose.minimal.yml run --rm migrate pnpm --filter @tuwaio/quasar seed
```
> **Note:** The containerized stack uses production-compiled images (`NODE_ENV=production`) without host bind-mounts. For live code reloading, use Option A.

### Step 3: Access Services

- **Payload Admin Panel**: `http://localhost:3000/admin` (or configured hostname)
- **Engine Health Endpoint**: `http://localhost:3001/v1/engine/monitoring/health`
- **Engine Metrics**: `http://localhost:3001/metrics`

For advanced options, see [`docs/QUICKSTART_LOCAL.md`](./docs/QUICKSTART_LOCAL.md).

---

## 4. Production Deployment

Quasar Community Edition is production-ready out of the box with:

- **Traefik v3 Reverse Proxy** handling routing and SSL/TLS termination.
- **PgBouncer** connection pooler preventing connection exhaustion during high-concurrency event bursts.
- **Docker Compose** production overlay for horizontal scaling of stateless workers.
- **Cloudflare Tunnels** blueprint for zero-open-port ingress.

Read the step-by-step production runbook in [`docs/PRODUCTION_DEPLOY.md`](./docs/PRODUCTION_DEPLOY.md).

### Automated Deployment (CI/CD)

The repository ships with a complete GitHub Actions pipeline: lint, typecheck
and tests, Docker image builds pushed to **your own** GHCR namespace, Trivy
vulnerability scanning, SBOM generation and cosign signing — then an SSH
deploy to your server.

The deploy job is **disabled by default** (`DEPLOY_ENABLED` is unset), so a
fresh fork gets a working build and supply-chain gate on day one without being
asked for SSH credentials. A run where `deploy` reports *skipped* is a green
run, not a failed one. Set the `DEPLOY_ENABLED` repository variable to `true`
once your server is ready.

Full setup — secrets, variables, environments, server preparation and
rollback — is in [`docs/CICD_SETUP.md`](./docs/CICD_SETUP.md).

---

## 5. Community vs. Commercial Edition

Quasar is developed with an open-core philosophy:

| Feature | Community Edition (This Repo) | Commercial Cloud SaaS |
| :--- | :---: | :---: |
| **Transaction Indexing & Tracking** | Full Multi-Chain Support | Full Multi-Chain Support |
| **Payload CMS Admin Panel** | ✅ Included (`/admin`) | ✅ Included |
| **High-Throughput Fastify Engine** | ✅ Included (`quasar-nest`) | ✅ Included |
| **Timeseries PostgreSQL Partitioning** | ✅ Included | ✅ Included |
| **BullMQ Distributed Workers** | ✅ Included | ✅ Included |
| **ERC-4337 & Relayer Tracking (Pimlico, Gelato, Safe)** | ✅ Included (Self-Hosted Keys) | ✅ Included (Managed / Bundled) |
| **Self-Hosted Infrastructure** | 100% Bare-Metal / Docker | Managed Cloud Infrastructure |
| **License** | **Apache 2.0 (FOSS)** | Commercial Terms |
| **Authentication Architecture** | **Native Payload Auth + TOTP 2FA** | **Multi-Tenant Auth, SIWX & Passkeys** |
| **Web3 Wallet Sign-In (SIWX)** | ❌ Omitted (Single-Operator Model) | ✅ EVM & Solana Wallet Sign-In (CAIP-122) |
| **Passkeys / WebAuthn** | ❌ Omitted | ✅ Biometric FIDO2 Passkeys |
| **Transactional Email Delivery** | ❌ Omitted (Zero External SMTP) | ✅ Customer Onboarding & Low-Quota Alerts |
| **Multi-Tenant Metered Billing** | ❌ Omitted | ✅ Integrated On-Chain Billing |
| **Customer-Facing SaaS Portal** | ❌ Omitted (Admin Only) | ✅ Multi-Tenant Developer Portal |

### Which release am I running?

The `version` in the root `package.json` is the release number, and every
release is tagged `vX.Y.Z` in this repository. Both are set by the publication
job, not by hand — this repository is a generated snapshot, so a version edited
here would be overwritten by the next publication.

Versions follow SemVer and are derived from the upstream changes each release
carries: a breaking change bumps the major, a new feature the minor, everything
else the patch. While the major is `0`, breaking changes bump the minor instead
— treat `0.x` as "working, but the API and schema may still move".

Please include this version in bug reports.

### Alchemy network coverage

The engine sends a chain through Alchemy only if the chain appears in
`apps/server/src/lib/generated/alchemyNetworkMap.ts`. This applies to an app's
own Alchemy key and to the node-wide `ALCHEMY_API_KEY_FALLBACK`. Chains not in
the map are tracked through the other RPC providers. The publication job
refreshes the map from Alchemy's public network list, so a release is normally
current as of its publication. To pick up a network Alchemy has launched since
then, run this from the repository root:

```bash
pnpm generate:alchemyNetworksMap
```

Commit the regenerated file, then rebuild the engine. The map is compiled
into the engine, and the file is overwritten by every regeneration, so do not
edit it by hand.

### Workspace limits

A Community node is single-tenant, and there is no billing in it to sell quota
or throughput. The limits are therefore set effectively unlimited and pinned:
`quotaBalance` 100,000,000, `rpsLimit` / `rpsPaidLimit` 100,000, and
`rpsForever` enabled so the limit never expires. They survive as rate-limiting
and anti-abuse guard rails for `IronDomeGuard`, nothing more. The numbers live
in one place — `apps/dashboard/src/constants/community.ts` — and apply both to
the workspace the seed creates and to any organization you create later.

---

## 6. What the Admin Panel Will Not Let You Create

The Payload admin is the only write surface in this edition, so a few
collections deliberately have no "Create new" button. Each is either
machine-authored or not yet a feature — never an oversight, and never a
restriction you are meant to work around by editing the database directly.

| Collection | Why creation is closed | Who does write it |
| :--- | :--- | :--- |
| `transactions` | A transaction row is an observation of something that happened on a chain. One typed by hand corresponds to no on-chain fact, cannot be edited afterwards (every core field is immutable), and permanently skews the organization's history and statistics. | The engine, over the Pulsar sync path with a valid API key. `delete` stays available to admins for legal-compliance removals. |
| `users` | The node has exactly one account. There is no sign-up form, no verification email and no password reset in this edition, so a second account would be unverified and unrecoverable — and the single admin is already a global admin, so there is nobody to invite. | The seed, on first run. Change the password from your own profile page. |
| `deleted-accounts`, `deleted-organizations`, `deleted-organization-members` | An audit log is only evidence if entries cannot be authored. These also drive the re-registration and organization-creation cooldowns, so a hand-written row would block a real operation. | Deletion hooks, automatically. |
| `quota-usage-ledger` | `batchId` is the idempotency key for Redis → Postgres usage reconciliation. A row carrying a batch ID the reconciler later generates would make that batch look already-applied and silently drop real usage. | The engine's `sync-usage` cron, inside the same transaction that debits the balance. |
| `app-invoices` | An invoice is a financial record generated against a real charge. `update` and `delete` were already closed; an invoice that matches no payment and cannot be corrected is worse than no invoice. | Payments-kind apps, through the REST API. |
| `app-accepted-payments` | **Future feature.** The Payments App is declared but not yet delivered. A row here advertises a wallet address as a live payment destination for a flow that does not exist yet, so funds sent to it would arrive with nothing to settle them against. Existing rows stay editable and deletable so a configuration can still be corrected. | Nothing yet — by design, until the payment flow ships. |

Reads are unaffected: every collection above is fully visible in the admin, and
the REST API under `/api/v1/...` is unchanged. What is closed is authorship.

---

## 7. Contributing

Contributions are warmly welcomed! Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for guidelines on how to open issues, submit pull requests, and follow our code quality standards.

---

## 8. License

Quasar Community Edition is licensed under the **Apache License, Version 2.0** ([LICENSE](./LICENSE)).  
You are free to use, modify, distribute, and self-host this software for personal or commercial applications.

# Local Quickstart

Bring up a complete, self-hosted Quasar node on one machine — Postgres, Redis,
the Payload admin panel, the tracking engine and its worker — with no cloud
accounts, no S3 bucket and no domain.

This uses `infra/docker-compose.minimal.yml`. It is a **standalone** compose
file, not an overlay on `infra/docker-compose.yml`: the production file
requires an S3/R2 bucket, a WAL-G encryption key and a repmgr password before
it will parse at all, which is exactly what a local start should not need.

> Running this on a real server? Read [Going to production](#going-to-production)
> first. The minimal profile has **no replication and no backups** by design.

## Prerequisites

- Docker Engine with Compose v2 (`docker compose version`)
- ~4 GB free RAM and ~5 GB disk for the default profile
- `git`

No Node.js or pnpm needed on the host: migrations and seeding run inside a
container.

## 1. Configure

```bash
git clone <your-fork-or-clone-url> quasar
cd quasar
cp .env.example .env
```

Open `.env` and set, at minimum:

| Variable | Why |
|---|---|
| `PG_PASSWORD` | Postgres superuser password. The stack refuses to start while it is unset. |
| `REDIS_API_PASSWORD`, `REDIS_UI_PASSWORD` | Redis auth for the engine and UI instances. |
| `PAYLOAD_SECRET` | Signs admin sessions. Use a long random string. |
| `ENCRYPTION_KEY` | 64-char hex. Encrypts provider API keys and app secrets **at rest** — changing it later orphans existing ciphertext, so set it before the first run. |
| `INTERNAL_SECRET` | Shared secret between the dashboard and the engine. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | The single admin account created in step 3. |

Every value shipped in `.env.example` is a placeholder — `change-me`,
`your-payload-secret` and so on. Replace them.

Generate the random ones with:

```bash
openssl rand -hex 32   # ENCRYPTION_KEY (64 hex chars)
openssl rand -base64 36 # PAYLOAD_SECRET / INTERNAL_SECRET
```

The remaining `.env` entries (Alchemy, Pimlico, Sentry, Cloudflare, S3, …) are
optional for a local node and can stay at their placeholder values.

## 2. Choose Your Execution Workflow

You can run Quasar locally in two ways depending on your goal:

### Workflow A: Native Development with Instant Live Reload (Recommended for Coding)

If you are writing code, modifying UI components, or developing features, run the stateful dependencies in Docker and run the application services natively on your host. This gives you **instant Hot Module Replacement (HMR)** and sub-second Fast Refresh without container rebuild delays.

```bash
# 1. Start only database and cache services in Docker
docker compose --env-file .env -f infra/docker-compose.minimal.yml up -d postgres redis-api redis-ui

# 2. Run database migrations and seed from host
pnpm db:migrate
pnpm seed

# 3. Start Next.js (Dashboard) and NestJS (Engine) in parallel with live reload
pnpm dev
```

- **Dashboard & Admin Panel**: <http://localhost:3000/admin> (Instant Next.js Fast Refresh)
- **Engine API**: <http://localhost:3001> (NestJS watch mode with automatic restart on file change)
- **Postgres**: `127.0.0.1:5432`
- **Redis API**: `127.0.0.1:6379`
- **Redis UI**: `127.0.0.1:6380`

---

### Workflow B: Standalone Containerized Stack (Zero Host Dependencies)

If you want to run the entire system in isolated containers without installing Node.js/pnpm on your host machine, or to test production-parity behavior before deploying to a server:

```bash
# Start all 6 services inside Docker
docker compose --env-file .env -f infra/docker-compose.minimal.yml up -d --build
```

> [!IMPORTANT]
> **Does `docker-compose.minimal.yml` have Live Reload?**  
> **No.** This compose profile builds **immutable, production-hardened standalone container images** (`NODE_ENV: production`, `read_only: true`, pre-compiled Next.js standalone and compiled NestJS `dist/`). Host source directories are **not bind-mounted**.  
> If you edit code while running in this mode, the container will **not** automatically reload. You must rebuild the modified service:
> ```bash
> # Rebuild and restart only the modified service (e.g. quasar-app)
> docker compose --env-file .env -f infra/docker-compose.minimal.yml up -d --build quasar-app
> ```

When the minimal stack settles, you have six containers:

| Service | Purpose | Host address |
|---|---|---|
| `postgres` | Database (vanilla `postgres:16-alpine`) | `127.0.0.1:5432` |
| `redis-api` | Engine state: queues, quotas, tracking | `127.0.0.1:6379` |
| `redis-ui` | Sessions, rate limits, 2FA locks | `127.0.0.1:6380` |
| `quasar-app` | Payload admin + REST API | http://localhost:3000 |
| `quasar-nest-api` | Tracking engine | http://localhost:3001 |
| `quasar-worker` | Background jobs | — |

Everything is bound to `127.0.0.1`, so nothing is exposed off-machine.

Check progress with:

```bash
docker compose --env-file .env -f infra/docker-compose.minimal.yml ps
```

`quasar-app` reports `healthy` once `/api/health/ready` passes.

## 3. Migrate and seed (Containerized Workflow)

If you chose **Workflow B (Containerized Stack)**, run schema migrations and initial seeding using the one-shot `migrate` container:

```bash
# Apply the Payload schema
docker compose --env-file .env -f infra/docker-compose.minimal.yml \
  run --rm migrate

# Create the admin user and their workspace
docker compose --env-file .env -f infra/docker-compose.minimal.yml \
  run --rm migrate pnpm --filter @tuwaio/quasar seed
```

Both are safe to re-run: migrations are versioned and the seed is idempotent,
protected by a Postgres advisory lock. What the community seed creates, and
the full list of `SEED_*` variables, is in [SEEDING.md](./SEEDING.md).

If `SEED_ADMIN_EMAIL` or `SEED_ADMIN_PASSWORD` is missing the seed fails
loudly rather than skipping — a community node has no other way to get an
account, since there is no self-registration and no password-reset email.

## 4. Log in

Open <http://localhost:3000/admin> and sign in with `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD`.

From there:

1. **Apps → Create** — gives you a public key and a secret key.
2. Reveal the secret with the **Show** button. It asks for your password (and
   your 2FA code if you enabled it) before decrypting.
3. Point an SDK client at `http://localhost:3001` with that secret key.
4. **Webhook Endpoints → Create** to receive transaction events. Failed
   deliveries can be retried from the admin panel.
5. **Users → your account** to turn on 2FA. The QR code, confirmation step and
   backup code are all in the admin UI.

Changing the admin password later is done here too — `SEED_ADMIN_PASSWORD`
only applies when the account is first created, and re-running the seed will
not reset it.

## 5. Metrics and logs (optional)

```bash
docker compose --env-file .env -f infra/docker-compose.minimal.yml \
  --profile observability up -d
```

Adds Prometheus, Grafana, Loki, Promtail and the Postgres/Redis/host
exporters. Grafana is at <http://localhost:3002> (`GF_ADMIN_USER` /
`GF_ADMIN_PASSWORD`, default `admin`/`admin`); **Dashboards** should list the
provisioned dashboards — NestJS server, PostgreSQL, Redis, containers, host
and logs (details in
[`infra/README.md`](../infra/README.md#provisioned-dashboards)). Prometheus is
at <http://localhost:9090>.

Panels for services this stack does not run stay empty, and that is expected:
it has a single Postgres and a single, non-cluster Redis, so for example the
Redis dashboard's *Cluster Status (API)* shows no data. If Grafana keeps
restarting instead, `docker compose -f infra/docker-compose.minimal.yml logs
grafana` names the dashboards path it could not read — it refuses to start
without its dashboards rather than come up empty.

Alert *notifications* are off unless you set `DISCORD_WEBHOOK_URL` and/or
`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`; Grafana logs a warning and serves
dashboards normally without them. Alertmanager is not part of this profile —
it exists only to deliver notifications, so it belongs to the production
stack.

## 6. End-to-End Local Testing with a Client App (Optional)

You do not need to build a UI from scratch to watch the node work. The TUWA ecosystem
provides benchmark templates (such as `cosmos-playground`) that wire Pulsar transaction
lifecycle tracking, the Nova UI kit, and SIWX authentication directly to a local Quasar backend:

```bash
npx @tuwaio/create-cosmos-playground
# Select the nextjs-tuwa-quasar example
```

When running a local client application alongside Quasar, keep the following architectural
rules and networking boundaries in mind to avoid common local development pitfalls.

### 6.1 Port Allocation

The minimal profile binds Quasar services to fixed ports on `127.0.0.1`:
- **Payload Admin & REST API**: `http://localhost:3000`
- **Quasar Engine API (NestJS)**: `http://localhost:3001`
- **Grafana Monitoring**: `http://localhost:3002`

Because port `3000` is reserved for the Quasar Dashboard, **your client application must run on a distinct port** (e.g., `3012` or `4002`):

```bash
# Start your Next.js client on port 3012
pnpm dev -- -p 3012
# or using the PORT environment variable:
PORT=3012 pnpm dev
```

### 6.2 Client Environment Configuration (`.env`)

In your client application's `.env` file, configure the connection to your local Quasar node:

```env
# 1. Base URL for Quasar Engine API (NestJS)
NEXT_PUBLIC_QUASAR_BASE_URL=http://127.0.0.1:3001

# 2. Secret Key of the App created in Quasar Admin (Apps -> Reveal Secret)
QUASAR_SECRET_KEY=sk_test_... # or sk_live_...

# 3. Webhook Signing Secret from Quasar Admin (Webhook Endpoints -> Signing Secret)
WEBHOOK_SIGNING_SECRET=whsec_...

# 4. Client Application URL (matches the custom dev port for SIWX CAIP-122 alignment)
NEXT_PUBLIC_APP_URL=http://localhost:3012
```

> [!NOTE]
> `QUASAR_SECRET_KEY` and `WEBHOOK_SIGNING_SECRET` belong to the **client app's `.env`**, not Quasar's. Always restart your client's Next.js dev server after modifying `.env` so environment variables are reloaded.

### 6.3 Webhook Registration & The Docker Networking Rule

When transactions reach a terminal state (`success` or `failed`), Quasar's background worker (`quasar-worker`) dispatches an authenticated HMAC-SHA256 webhook to registered endpoints.

> [!IMPORTANT]
> **Docker Container Loopback vs. Host Machine (`host.docker.internal`)**  
> `quasar-worker` runs **inside a Docker container**. Inside a container, `localhost` and `127.0.0.1` resolve to the container itself, **not** your host machine.  
> Attempting to deliver webhooks to `http://localhost:3012/...` will fail with `connect ECONNREFUSED 127.0.0.1:3012`.

To receive webhooks locally from containerized Quasar services:

1. Open Quasar Admin at <http://localhost:3000/admin>.
2. Go to **Webhook Endpoints → Create**:
   - **App**: Select the **exact same App** whose secret key (`QUASAR_SECRET_KEY`) is used by your client. (Webhooks registered to a different App will not receive events).
   - **URL**: Use Docker's host loopback hostname instead of localhost:
     ```text
     http://host.docker.internal:3012/api/webhooks/quasar
     ```
     *(On Linux hosts without Docker Desktop, use your Docker gateway bridge IP, typically `http://172.17.0.1:3012/...`, or host networking).*
   - **Events**: Select `*` (or individual events like `transaction:confirmed`, `transaction:success`).
   - **Transaction Type**: Set to `*` or leave blank to receive all transaction types.
   - **Is Active**: Checked.
3. Save the endpoint and copy the auto-generated **Signing Secret** (`whsec_...`) into your client's `WEBHOOK_SIGNING_SECRET`.

> [!TIP]
> **SSRF Protection in Local Development**:  
> Quasar enforces strict SSRF and tarpit protection (`WebhookProcessor.isPrivateOrBlockedIP`), blocking private/internal IP ranges by default in production.  
> In local development and minimal profiles, `ALLOW_INTERNAL_WEBHOOKS=true` is set in the Quasar environment, enabling webhook deliveries to loopback and private subnets (`host.docker.internal`, `127.0.0.1`, RFC 1918).

### 6.4 SIWX (Sign-In With X) Local Port Alignment

When using the CAIP-122 SIWX authentication profile in client applications:
- The browser wallet signs a structured CAIP-122 message containing the active browser origin (`domain: "localhost:3012"`, `uri: "http://localhost:3012"`).
- The client server route (`POST /api/siwx/verify`) verifies this message against its configured verification policy (`expectedDomain` and `expectedUri`).

If your client runs on a non-default port (e.g. `3012` or `4002`), ensure the client's SIWX policy allows that port:
```ts
// Example: src/app/api/siwx/[...siwx]/route.ts
const handler = createStatelessDemoSiwxHandler({
  signingSecret: DEMO_SIGNING_SECRET,
  policy: {
    expectedDomain: ['localhost:3012', 'localhost:3000', 'localhost', 'example.com'],
    expectedUri: ['http://localhost:3012', 'http://localhost:3012/', 'http://localhost:3000', 'https://example.com'],
    allowedChainIds: [/* supported chains e.g. eip155:1, eip155:11155111, solana:mainnet */],
  },
});
```
*Failure to include your development port in `expectedDomain`/`expectedUri` will result in `401 Unauthorized` (`SiwxDomainMismatchError`) during wallet sign-in.*

### 6.5 Live Verification Workflow

Once configured, verify the complete interaction loop:

1. **Connect & Sign In**: Open <http://localhost:3012>, connect your wallet, and complete SIWX sign-in.
2. **Execute Transaction**: Send an on-chain transaction or trigger a simulation in the client UI.
3. **Ingestion**: The client preflights the node health (`GET http://127.0.0.1:3001/v1/engine/monitoring/health`) and syncs the transaction via `POST http://127.0.0.1:3001/v1/engine/pulsar/sync`.
4. **Tracking & Delivery**: Quasar indexes the transaction state. Upon confirmation, `quasar-worker` signs and posts the webhook to `http://host.docker.internal:3012/api/webhooks/quasar`.
5. **Inspect Audit Trail**: Open Quasar Admin at <http://localhost:3000/admin>:
   - **Transactions**: Verify the stored transaction record and status. **Retry tracking** appears only for a transaction that failed or was replaced, or one still pending a minute after it was sent. A successful transaction has no Retry button.
   - **Webhook Deliveries**: View the delivery payload, HTTP status code (`200 OK`), response body, and latency metrics. **Retry delivery** appears only on a failed delivery. It re-dispatches the webhook and records the new attempt on the same row.


## Going to production

The minimal profile deliberately omits everything that makes a node
survivable: no replication, no WAL archiving, no backups, no TLS, no
reverse proxy. Do not leave production data on it.

The production stack is `infra/docker-compose.yml` (plus
`docker-compose.prod.yml`), which adds a repmgr primary/standby pair, PgBouncer,
a 6-node Redis cluster, WAL-G continuous archiving to S3/R2, Traefik and
optionally a Cloudflare Tunnel. It requires the S3 and repmgr variables the
minimal profile does without.

**Moving your data across is a migration, not a compose-file swap.** The two
profiles run *different Postgres images* — `postgres:16-alpine` versus
`quasar/postgresql-repmgr:16` — with different on-disk layouts and startup
behaviour. You cannot point the production compose file at the minimal
profile's volume.

Both are PostgreSQL 16, so a logical dump restores cleanly:

```bash
MINIMAL="docker compose --env-file .env -f infra/docker-compose.minimal.yml"

# 1. Stop writers, leave the database up
$MINIMAL stop quasar-app quasar-nest-api quasar-worker

# 2. Dump (custom format, compressed)
$MINIMAL exec -T postgres \
  pg_dump -U "${PG_USER:-quasar}" -d "${PG_DB:-quasar}" -Fc > quasar-$(date +%F).dump

# 3. Fill in the production-only variables in .env:
#    REPMGR_PASSWORD, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
#    WALG_LIBSODIUM_KEY, DOMAIN, and Traefik/Cloudflare settings.
$MINIMAL down

# 4. Start production and apply the schema
PROD="docker compose --env-file .env -f infra/docker-compose.yml"
$PROD up -d postgresql-primary postgresql-standby pgbouncer
$PROD run --rm migrate

# 5. Restore
$PROD exec -T postgresql-primary \
  pg_restore -U "${PG_USER:-quasar}" -d "${PG_DB:-quasar}" \
  --clean --if-exists --no-owner < quasar-$(date +%F).dump

# 6. Bring up the rest
$PROD up -d
```

Afterwards, verify before trusting it:

- `$PROD exec postgresql-primary repmgr -f /etc/repmgr.conf cluster show` —
  the standby should be `running` and streaming.
- Confirm WAL-G is archiving (objects appearing under your S3 prefix), then
  run a real restore drill with `infra/scripts/test_backup_restore.sh`.
- Keep `ENCRYPTION_KEY` **identical** to the one used on the minimal profile.
  Every app secret and provider key in the dump is ciphertext bound to it; a
  different key silently makes them undecryptable.

## Server Deployment Profiles (Local vs Server)

When moving from local development to a live server, choose the profile that matches your availability requirements:

### Profile 1: Single-Node Community VPS (Minimal)

Ideal for independent developers, community node operators, or low-to-medium throughput environments:
- **Topology**: Single vanilla Postgres (`postgres:16-alpine`), standalone Redis API and Redis UI, compiled app and engine containers.
- **Resource Requirement**: 4–8 GB RAM, 2–4 vCPU.
- **How to Run on Server**:
  ```bash
  # 1. Start minimal stack in background
  docker compose --env-file .env -f infra/docker-compose.minimal.yml up -d --build

  # 2. Run migrations and seed
  docker compose --env-file .env -f infra/docker-compose.minimal.yml run --rm migrate
  docker compose --env-file .env -f infra/docker-compose.minimal.yml run --rm migrate pnpm --filter @tuwaio/quasar seed
  ```
- **How to Apply Updates on Server**:
  ```bash
  git pull origin main
  # Rebuild and restart application containers
  docker compose --env-file .env -f infra/docker-compose.minimal.yml up -d --build quasar-app quasar-nest-api quasar-worker
  # Apply any new schema migrations
  docker compose --env-file .env -f infra/docker-compose.minimal.yml run --rm migrate
  ```

### Profile 2: High-Availability Multi-Node Cluster (Production)

Required for multi-tenant SaaS, mission-critical indexing, and high-concurrency commercial deployments:
- **Topology**: Active-standby PostgreSQL with automated repmgr failover, WAL-G continuous archiving to S3/R2 with PITR, PgBouncer connection pooling, 6-node Redis API cluster, Traefik edge routing, and Cloudflare Tunnels.
- **Resource Requirement**: 12–24 GB RAM, 4–6 vCPU.
- **Documentation**: Full bootstrapping instructions, security hardening, and deployment procedures are detailed in [PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md) and [deploy_to_server_guide.md](./deploy_to_server_guide.md).

---

## Troubleshooting

**`PG_PASSWORD must be set in .env`** — you skipped step 1, or you are running
the command from somewhere other than the repository root, so `--env-file .env`
points at nothing.

**`S3_ENDPOINT must be set`** — you used `infra/docker-compose.yml` instead of
`infra/docker-compose.minimal.yml`, or layered both with two `-f` flags. The
minimal profile must be used on its own.

**`quasar-app` never becomes healthy** — check `docker compose ... logs
quasar-app`. The usual cause is a `.env` value left at its placeholder:
`ENCRYPTION_KEY` must be 64 hex characters and `PAYLOAD_SECRET` must be long
enough to sign sessions.

**Port already in use** — something else holds 3000/3001/5432/6379. Override
per-service with `APP_HOST_PORT`, `ENGINE_HOST_PORT`, `PG_HOST_PORT`,
`REDIS_API_HOST_PORT`, `REDIS_UI_HOST_PORT`, `GRAFANA_HOST_PORT` or
`PROMETHEUS_HOST_PORT` in `.env`.

**`cannot connect to Postgres: connect ECONNREFUSED 127.0.0.1:6432`** — your host `.env` has `DATABASE_URL` targeting port `6432` (the standard PgBouncer port). `infra/docker-compose.minimal.yml` maps both `5432` and `6432` to the Postgres container for dual compatibility. If you see this error, ensure the container was started with the latest compose definition:
```bash
docker compose --env-file .env -f infra/docker-compose.minimal.yml up -d postgres redis-api redis-ui
```

**Start over from scratch** — this deletes all local data:

```bash
docker compose --env-file .env -f infra/docker-compose.minimal.yml down -v
```

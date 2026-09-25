# Quasar Infrastructure — The Runbook

> **The definitive operational manual for the Quasar production stack.**
> Philosophy: 100% self-hosted. No managed databases. No exceptions.

---

| Service | Image | Purpose |
|---|---|---|
| **Traefik** | `traefik:v3.6.x` | Reverse proxy, routing |
| **PostgreSQL Primary/Standby** | `quasar/postgresql-repmgr:16` | HA Database cluster with Repmgr |
| **PgBouncer** | `edoburu/pgbouncer:latest` | Connection pooling for Postgres |
| **Redis API Cluster** | `redis:7-alpine` | 6-node Redis cluster (`noeviction`, AOF) for BullMQ & IronDome |
| **Redis UI Instance** | `redis:7-alpine` | Ephemeral Redis instance (`allkeys-lru`, 256MB) for RateLimit/2FA |
| **Quasar App** | Custom (Next.js 16.3 Standalone) | Payload CMS + API Engine |
| **Quasar NestJS** | Custom (NestJS 12 + Fastify) | High-performance hot-path microservice |
| **Prometheus** | `prom/prometheus:v3.3.x` | Metrics collection (30-day retention) |
| **Loki** | `grafana/loki:3.6.x` | Log aggregation (7-day retention) |
| **Promtail** | `grafana/promtail:latest` | Log shipper (Docker → Loki) |
| **Grafana 11** | `grafana/grafana:11.6.x` | Dashboards, alerting |
| **Node Exporter** | `prom/node-exporter:latest` | Host-level metrics |
| **cAdvisor** | `gcr.io/cadvisor/cadvisor:latest` | Container-level metrics |
| **Postgres Exporter** | `prometheuscommunity/postgres-exporter:v0.16.x` | PostgreSQL metrics |
| **pg-backup** | `eeshugerman/postgres-backup-s3:16` | Scheduled Postgres dumps → S3/R2 |
| **pgAdmin** | `dpage/pgadmin4` | PostgreSQL management UI |
| **RedisInsight** | `redis/redisinsight:latest` | Redis browser UI |

---

## Prerequisites

- Docker Engine ≥ 24.0
- Docker Compose v2
- A VPS or bare-metal server with SSH access
- Domain with DNS pointing to the server
- Cloudflare R2 (or any S3-compatible) bucket for backups

> [!IMPORTANT]
> **No Node.js installation required on the host.** All application logic runs inside containers. Migrations use ephemeral containers.

---

## Compose Profiles: High-Availability vs Minimal

The repository provides two Docker Compose configurations tailored for different deployment tiers:

### 1. High-Availability Profile (`infra/docker-compose.yml`)
- **Use Case**: Production SaaS, staging environments, enterprise deployments.
- **Topology**:
  - Active-Standby PostgreSQL with repmgr automated failover.
  - WAL-G continuous real-time WAL streaming to S3/R2 with automated base backups and PITR disaster recovery.
  - PgBouncer connection pooler in transaction mode on host port `6432`.
  - 6-node Redis API cluster (`noeviction`, AOF) with ports `6371–6376`.
  - 2-node Redis UI cluster (`allkeys-lru`) on ports `6380–6381`.
  - Traefik reverse proxy with automatic TLS and Cloudflare Tunnels integration.

### 2. Minimal Single-Node Profile (`infra/docker-compose.minimal.yml`)
- **Use Case**: Local development, open-source community nodes, single VPS instances (4–8 GB RAM).
- **Topology**:
  - Single vanilla PostgreSQL node (`postgres:16-alpine`), no repmgr, no S3 dependency.
  - Standalone Redis API and Redis UI instances.
  - Compiled application containers with `read_only: true` and security hardening.
- **Dual-Port Compatibility Mapping**:
  To support seamless local development where `.env` holds host URLs configured for either setup:
  - **PostgreSQL**: Binds both `127.0.0.1:5432` and `127.0.0.1:6432` (so connections targeting either direct Postgres or PgBouncer succeed out of the box).
  - **Redis API**: Binds both `127.0.0.1:6379` and `127.0.0.1:6371` (matching cluster node 1).
  - **Redis UI**: Binds `127.0.0.1:6380`.

---

## Network & Routing

Application services communicate on Docker bridge networks, including the shared `public_net` used by the dashboard and Engine. The NestJS port is not published on the host; the dashboard reaches it through Docker service DNS.

Traefik handles all external routing via Docker labels. Each service that needs external access declares its own Traefik labels in `docker-compose.yml`.

Routing rules are defined in `infra/config/traefik/traefik.yml`.

### Public and internal Engine URLs

Use two different Engine URLs depending on where the request originates:

| Caller | URL | Reason |
|---|---|---|
| Browser/client code | `https://api.${DOMAIN}` | Public Cloudflare Tunnel and Traefik route |
| Dashboard server actions and email queueing | `http://quasar-nest-api:3001` | Direct Docker service-to-service route |

Set these values in the root `.env` file:

```env
NEXT_PUBLIC_ENGINE_URL=https://api.example.com
INTERNAL_ENGINE_URL=http://quasar-nest-api:3001
```

Do not use the public Engine URL for server-side requests from the VPS. That creates a hairpin route through the Cloudflare Tunnel and can result in `502 Bad Gateway` even when the Engine, database, and public API are healthy. The internal URL is still authenticated by the Engine's `IronDomeGuard`; the SDK sends the configured secret key in its normal request header.

---

## Environment Setup

The `.env` file lives at the **project root** (not inside `infra/`).

```bash
cp .env.example .env
# Fill in ALL values. No defaults are safe for production.
```

### Required Environment Variables

| Variable                                    | Purpose                                      |
| ------------------------------------------- | -------------------------------------------- |
| `DOMAIN`                                    | Production domain (e.g., `example.com`)      |
| `TRAEFIK_USER` / `TRAEFIK_PASSWORD`         | Traefik dashboard BasicAuth credentials      |
| `PG_USER` / `PG_PASSWORD` / `PG_DB`         | PostgreSQL credentials                       |
| `REDIS_API_PASSWORD` / `REDIS_UI_PASSWORD` | API Redis and UI Redis AUTH passwords       |
| `PGADMIN_EMAIL` / `PGADMIN_PASSWORD`        | pgAdmin login                                |
| `GF_ADMIN_USER` / `GF_ADMIN_PASSWORD`       | Grafana admin credentials                    |
| `DISCORD_WEBHOOK_URL`                       | Discord channel webhook for ops alerts (Grafana + Alertmanager) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`   | Telegram bot token + chat ID for ops alerts (Grafana + Alertmanager) |
| `S3_ENDPOINT`                               | S3-compatible endpoint (e.g., Cloudflare R2) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | S3 credentials                               |
| `S3_BUCKET_POSTGRES`                        | Bucket for Postgres backups                  |
| `S3_REGION`                                 | Set to `auto` for Cloudflare R2              |
| `WALG_S3_PREFIX`                             | Dedicated encrypted WAL-G archive prefix     |
| `WALG_LIBSODIUM_KEY`                         | Base64-encoded 32-byte WAL-G encryption key  |
| `WALG_RETAIN_FULL_BACKUPS`                   | Number of verified full backups to retain    |
| `NEXT_PUBLIC_SERVER_URL`                    | Public-facing app URL                        |
| `PAYLOAD_SECRET`                            | Payload CMS encryption key                   |
| `INTERNAL_SECRET`                           | Bootstrap-only internal-auth secret (minimum 32 random characters); active/previous rotation keys are managed in API Redis |

---

## Cloudflare Tunnels (External Access)

In the current architecture, **Cloudflare Tunnel (cloudflared)** is the primary entry point. It creates a secure outbound connection from the server to the Cloudflare edge, eliminating the need to open ports on your router or manage SSL certificates manually on the host.

### Why we use it:

- **No Manual SSL:** We don't use Let's Encrypt (`certresolver`) or `tlschallenge` inside Traefik. Cloudflare handles the HTTPS layer globally.
- **Security:** The server does not need a public IP or open incoming ports (80/443).
- **Flexible Routing:** Hostnames are managed via the Cloudflare Dashboard and forwarded to the `traefik` service inside the Docker network.

### Configuration

1. **Tunnel Runtime:** Quasar runs `cloudflared` as a Docker service on `backend_net`. Set the tunnel token in the shared `.env` file:

```bash
CLOUDFLARE_TUNNEL_TOKEN=<YOUR_TUNNEL_TOKEN>
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d cloudflared
```

2. **DNS and Public Hostnames:** Create or select the tunnel in Cloudflare Zero Trust and configure the public hostnames there. The DNS records are managed by Cloudflare; do not add host-level port forwarding.

3. **Internal Routing:** For every Quasar public hostname, configure the Cloudflare Service URL as:

- **Public Hostname:** `api.${DOMAIN}` (and others)
- **Service:** `http://traefik:80`
- **Origin Settings:** No TLS required (Traffic is secure within the tunnel).

The hostname `traefik` is resolved by Docker DNS because `cloudflared` and `traefik` share `backend_net`. The Compose bindings `127.0.0.1:80:80` and `127.0.0.1:443:443` are host-only diagnostic bindings and are not Cloudflare Service URLs.

### Traefik Interaction

Since Cloudflare terminates SSL, Traefik is configured to listen on the **HTTP (web)** entrypoint for all production routers. It acts as a layer-7 router that distributes traffic based on the `Host` header provided by the tunnel.

---

## Service URLs (Production)

All services are routed through **Cloudflare Tunnel → Traefik**.

| Service               | Public URL                  | Traefik Entrypoint | SSL Source      |
| --------------------- | --------------------------- | ------------------ | --------------- |
| **Quasar Dashboard (UI/Auth)** | `https://quasar.${DOMAIN}` | `web` (80)         | Cloudflare Edge |
| **Quasar Engine (API)** | `https://api.${DOMAIN}`     | `web` (80)         | Cloudflare Edge |
| **Traefik Dashboard** | `https://traefik.${DOMAIN}` | `web` (80)         | Cloudflare Edge |
| **pgAdmin**           | `https://pgadmin.${DOMAIN}` | `web` (80)         | Cloudflare Edge |
| **RedisInsight**      | `https://redis.${DOMAIN}`   | `web` (80)         | Cloudflare Edge |
| **Grafana**           | `https://grafana.${DOMAIN}` | `web` (80)         | Cloudflare Edge |

> [!NOTE]
> When accessing these URLs, you might see `SSL_ERROR_NO_CYPHER_OVERLAP` if you try to use 4th-level subdomains (e.g., `traefik.api.${DOMAIN}`) on a free Cloudflare plan. Always use 3rd-level subdomains (`service.${DOMAIN}`).

---

## Migrating to Cloudflare Dashboard Management

Cloudflare Tunnel configuration is managed remotely in the Cloudflare Zero Trust Dashboard. The repository YAML files under `infra/cloudflare/` are reference blueprints only; the active Public Hostnames and Service URLs are configured in Cloudflare.

**Prefer not to click through the dashboard?** `scripts/setup-cloudflare-tunnel.sh`
does steps 1–3 below non-interactively through the Cloudflare API — it creates
(or reuses) the tunnel, publishes the ingress rules, creates the DNS records,
and prints the token to put in `CLOUDFLARE_TUNNEL_TOKEN`. It needs
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID` and
`DOMAIN` in `.env`. Run it with `--dry-run` first to see what it would change.
The manual path below remains fully supported for anyone who would rather not
hand out a token with DNS/tunnel permissions.

**The API token must be user-owned, and two permissions are enough:**

| Where | Scope | Permission | Level |
| --- | --- | --- | --- |
| My Profile → API Tokens → Create Token → Custom token | Account | Cloudflare Tunnel | Edit |
| the same token | Zone | DNS | Edit |

Scope the account permission to your account and the zone permission to the
single zone you are publishing. `Edit` implies `Read`; nothing else is needed.

An **account-owned** token (Manage Account → API Tokens) does not work here,
and the way it fails is misleading. Such a token can hold an `allow` policy on
the correct `com.cloudflare.api.account.zone.<id>` resource with `DNS Write` in
it, sail through the tunnel calls — which are account-scoped — and then reject
every zone call with `[10000] Authentication error`. That reads as a missing
DNS permission when the permission is demonstrably present. The script's
preflight checks zone access up front and names this case, because it would
otherwise surface only after the tunnel ingress had already been rewritten.

> `PUT /configurations` replaces the ingress list wholesale. `TUNNEL_HOSTNAMES`
> must therefore list **every** hostname the tunnel serves, not just the ones
> you are adding — anything omitted stops resolving. Read the live list first:
>
> ```bash
> curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
>   "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/cfd_tunnel/<tunnel-id>/configurations" \
>   | jq -r '.result.config.ingress[] | "\(.hostname // "catch-all") -> \(.service)"'
> ```

### Step 1: Prepare the Tunnel

1. Ensure your tunnel is **Healthy** and visible in the [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/).
2. Navigate to **Networks** -> **Connectors**.
3. Select the tunnel used by the Docker `cloudflared` service.

### Step 2: Configure the Tunnel Token

1. Open the tunnel configuration and copy its **Tunnel Token**.
2. Store the token as `CLOUDFLARE_TUNNEL_TOKEN` in the VPS `.env` file.
3. Restart only the Docker tunnel service after changing the token:

```bash
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d cloudflared
```

### Step 3: Configure Public Hostnames

For each hostname, use the HTTP service type and the Docker service origin:

- **Service Type:** `HTTP`
- **URL:** `traefik:80`
- **No TLS verification:** Cloudflare terminates HTTPS at the edge and the tunnel connects to Traefik over HTTP.

Required production hostnames are `quasar`, `api`, `traefik`, `pgadmin`, `redis`, and `grafana`. Staging uses the corresponding `*-stg` hostnames.

Do not use `localhost:80` here: inside the `cloudflared` container, `localhost` means the cloudflared container itself, not Traefik.

---

## Why this is the Quasar Standard:

1. **Infrastructure as Code (at the Edge):** You no longer risk "configuration drift" where the server's YAML file differs from what you think is deployed.
2. **No Restart Required:** When you add a new subdomain (e.g., `api-v2.${DOMAIN}`), the change propagates to your server in seconds without restarting the `cloudflared` process.
3. **Zero-Touch SSL:** You never have to worry about `acme.json`, certificate expiration, or `SSL_ERROR_NO_CYPHER_OVERLAP`. If the domain is in Cloudflare, it has a valid certificate.
4. **Traefik Simplicity:** Traefik remains a pure Layer-7 router. It receives requests on port 80, looks at the `Host` header, and routes to the correct container.

> [!CAUTION]
> **Cloudflare Tunnel (Remote Management) is the mandatory standard.** Local `config.yml` files are deprecated. All tunnel configurations (Public Hostnames, Service URLs) MUST be managed via the Cloudflare Zero Trust Dashboard.

> [!NOTE]
> **Reference Templates**: The files located in `infra/cloudflare/` (e.g., `tunnel.prod.yml`, `tunnel.stg.yml`) are static reference helpers illustrating the required ingress routing configurations. They are not active config files on the host, but should be used as blueprints when setting up the Public Hostnames routes inside the Cloudflare Zero Trust Dashboard.

> [!TIP]
> **Production Consistency:** Even though management is now "Remote", your Docker Compose labels in `prod.yml` must still match the Hostnames you define in the UI. Traefik relies on those labels to know which container belongs to which domain.

## Deployment

### GitHub Actions CI/CD Secrets

Before running the deployment or rollback workflows, the following GitHub Repository Secrets must be configured:

- `PROD_SSH_HOST` / `STAGING_SSH_HOST` — Server IP or domain
- `PROD_SSH_USER` / `STAGING_SSH_USER` — SSH login username
- `PROD_SSH_KEY` / `STAGING_SSH_KEY` — Private SSH Key
- `PROD_SSH_FINGERPRINT` / `STAGING_SSH_FINGERPRINT` — Host Key Fingerprint (for MITM validation)

#### Generating the SSH Host Key Fingerprint

The CI/CD pipeline validates the destination server's host key to protect against Man-in-the-Middle (MITM) attacks.
To extract and hash the host key fingerprints of your server, run the following command from your local machine:

```bash
ssh-keyscan <YOUR_SERVER_IP_OR_HOST> 2>/dev/null | ssh-keygen -lf -
```

This will output the fingerprints for all supported key types (RSA, ECDSA, ED25519). Copy the middle token (e.g., `SHA256:BzLO++...`) that matches the algorithm negotiated by the GitHub Actions client (typically **ECDSA** or **RSA** depending on your daemon preferences) and save it as the secret value. If the pipeline reports a mismatch, check the workflow logs to see the exact fingerprint presented by the host.

### Production Launch

All commands run from the **project root**:

```bash
# Shorthand alias (recommended to add to shell profile)
export DC="docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml"

# Start the full stack (detached)
$DC up -d --build

# Force recreate after config changes
$DC up -d --force-recreate --build

# Check status
$DC ps

# Tail logs
$DC logs -f --tail=100
```

Or without the alias:

```bash
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d --build
```

### Stopping

```bash
$DC down        # Stop containers, preserve volumes
$DC down -v     # ⚠️ DESTRUCTIVE: Stop + delete all volumes
```

---

## Server Migrations (Payload CMS)

> [!CAUTION]
> **Node.js is NEVER installed on the production host.** All migrations run inside ephemeral Docker containers that are destroyed after execution.

### Running Migrations

Payload v3 migrations are generated locally and committed to Git. On the server, they are executed via an ephemeral `node:22-alpine` container connected to the `quasar_net` network.

**Step 1: Generate migrations locally (dev machine)**

```bash
# `payload` is a workspace script, not a root one — running it from the
# repository root fails with "command not found".
pnpm --filter @tuwaio/quasar payload migrate:create
git add -A && git commit -m "chore: add payload migration"
git push
```

**Step 2: Pull and execute on production server**

```bash
cd /path/to/quasar
git pull origin main
```

```bash
docker run --rm -it \
  --network backend_net \
  -v $(pwd):/app \
  -w /app \
  --env-file .env \
  node:22-alpine sh -c \
  'export DATABASE_URL="postgresql://${PG_USER}:${PG_PASSWORD}@postgres:5432/${PG_DB}" && export REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379/0" && npm install -g pnpm && pnpm install && pnpm payload migrate'
```

The container:

1. Connects to the running `postgres` and `redis` services on `backend_net`.
2. Installs dependencies, runs pending migrations.
3. Is destroyed (`--rm`) immediately after completion. Zero residue.

**Step 3: Restart the app to pick up schema changes**

```bash
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d --build quasar-app
```

---

## NestJS Server — Drizzle Schema Sync

> [!IMPORTANT]
> **The NestJS server does NOT manage database migrations.**
> All schema changes are applied exclusively via **Payload CMS migrations** (see section above).
> Drizzle ORM is used as a **read-only query layer** — it never generates or applies migrations.

After Payload CMS migrations have been applied, sync the Drizzle schema locally:

```bash
cd apps/server
pnpm db:pull
```

This runs `drizzle-kit introspect` against the live database and regenerates `src/database/schema/schema.ts` to reflect the current schema. Commit the updated `schema.ts` if it changed.

**Rebuild the NestJS server after a schema sync:**

```bash
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d --build quasar-nest
```

---

## Backups & Disaster Recovery

> All commands below use the `$DC` alias defined in the [Deployment](#deployment) section.

### PostgreSQL Backups

**Engine:** `eeshugerman/postgres-backup-s3:16` container.
**Destination:** Cloudflare R2 (`S3_REGION=auto`).
**Schedule:** Configurable via `PG_BACKUP_SCHEDULE` env var (default: `@daily`).
**Retention:** `PG_BACKUP_KEEP_DAYS` (default: `7`).

### WAL-G Continuous Archiving

The PostgreSQL image contains pinned WAL-G v3.0.8 with architecture-specific
SHA-256 verification. Both repmgr nodes use encrypted `wal-push` and
`wal-fetch`; the `wal-g-backup` scheduler mounts both data volumes read-only and
creates a verified base backup from whichever node is currently writable. After
success it applies WAL-G full-backup retention. `WALG_S3_PREFIX` is intentionally
separate from the logical dump prefix. The configured archive target is
approximately 60 seconds during active WAL generation, but staging must prove
actual lag and PITR recovery before this becomes an approved RPO.

The physical base-backup scheduler runs daily (24 hours / 86400s) in staging and every
6 hours (21600s) in production (`WALG_BACKUP_INTERVAL_SECONDS` in the environment
overlays). Continuous WAL archiving streams in real-time (`wal-g wal-push %p`), providing
sub-minute RPO. The independent logical `pg-backup` dump remains daily.

Both PostgreSQL entrypoints normalize the active WAL settings before the main
PostgreSQL process starts. The check ignores commented configuration examples,
corrects wrong active values, and treats `archive_mode` as a startup-only
setting. The scheduler safely replaces only its own empty data-path directory
with a symlink to the selected read-only volume; unexpected files stop the
backup instead of being deleted.

Verify the pipeline with:

```bash
$DC exec postgresql-primary wal-g wal-show
$DC logs --tail=100 wal-g-backup
# Non-destructive WAL-G and replication preflight.
EXPECTED_INTERVAL_SECONDS=86400 ./infra/scripts/test_walg_preflight.sh
# Run wal-g-pitr-restore.sh inside a separate clean PostgreSQL recovery container.
$DC exec postgresql-primary psql -U "$PG_USER" -d "$PG_DB" -c \
  "SHOW archive_mode; SHOW archive_command; SHOW restore_command; SHOW archive_timeout; SHOW wal_compression;"
```

The deployment script rebuilds the PostgreSQL image when the Dockerfile,
PostgreSQL entrypoints, or image-bundled PITR helper changes. The scheduler
loop is bind-mounted and is picked up on container recreation.

#### Manual Backup

```bash
$DC exec pg-backup sh backup.sh
```

#### Restore from Backup

```bash
$DC exec pg-backup sh restore.sh
```

This downloads the latest dump from S3/R2 and restores it to the configured Postgres database. The repository-controlled wrapper fails closed on download, decryption, and `pg_restore` errors; use `infra/scripts/test_remote_backup_restore.sh` for an isolated restore test.

---

### Redis Cluster Data Persistence

**Architecture:** 6-Node Redis Cluster (3 Masters, 3 Replicas) on the same startup host.
**Mechanism:** Replication and configured failover; this is not independent-host HA.
**Persistence:** AOF (Append Only File) and RDB snapshots are enabled natively.

Since Redis is running in cluster mode, a simple single-node RDB copy is no longer sufficient. High-availability is guaranteed by the replica nodes. For point-in-time recovery, you can manually trigger `BGSAVE` on each master node and backup the `/data` directory.

> [!WARNING]
> Automated offsite backups to S3/R2 are **NOT** configured or scheduled for the Redis cluster. Redis relies on local AOF/RDB persistence and same-host replication; host-loss recovery for Redis remains a separate operational gate.

---

## Monitoring (Infrastructure as Code)

> [!IMPORTANT]
> **All Grafana configuration is provisioned via code.** Manual UI configuration of datasources, dashboards, or alert rules is **strictly prohibited**. Any manual changes will be overwritten on container restart.

### Provisioning Structure

```
infra/config/grafana/provisioning/
├── alerting/          # Notification policy (policies.yml); the contact point is rendered at start
├── dashboards/
│   ├── dashboards.yml # File provider: where Grafana looks for dashboard JSON
│   └── json/          # The dashboards themselves
└── datasources/       # Prometheus + Loki datasource definitions
```

### How It Works

The whole directory is mounted read-only at `/etc/grafana/provisioning-templates`.
The `grafana` entrypoint (same script in `docker-compose.yml` and
`docker-compose.minimal.yml`) renders a writable provisioning tree at
`/tmp/grafana-provisioning` (`GF_PATHS_PROVISIONING`), because the alerting
contact point has to be generated from environment variables.

1. **Datasources** (`datasources/`): copied into the rendered tree; Prometheus (uid `Prometheus`) and Loki (uid `loki`) are registered on startup.
2. **Dashboards** (`dashboards/`): only `dashboards.yml` is copied. The JSON is read **in place** from `/etc/grafana/provisioning-templates/dashboards/json`, the path in `dashboards.yml`, and re-read every 30 seconds — an edited or added dashboard appears without restarting Grafana, including after a deploy that only changed JSON. To add a dashboard, export it as JSON into `json/`; reference datasources by the uids above.
3. **Alerting** (`alerting/`): the notification policy routes everything to the `Notify` contact point, which the entrypoint renders from `DISCORD_WEBHOOK_URL` / `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` (see below). No alert *rules* are provisioned in Grafana: every alert rule lives in Prometheus (`infra/config/prometheus/rules.yml`) and is delivered by Alertmanager.

Changes to `datasources/` or `alerting/` apply on the next container start (`docker compose restart grafana`), since they are copied at startup.

> [!NOTE]
> **Grafana refuses to start if it cannot find its dashboards.** The entrypoint reads the path out of `dashboards.yml` and exits with `[Grafana] ERROR: dashboards.yml points at '…', which holds no *.json dashboards.` if nothing is there. Grafana on its own does not fail on a wrong provider path — it logs `Cannot read directory` every 30 seconds and serves an empty dashboard list, which is how every dashboard once went missing unnoticed. If `docker compose ps` shows Grafana restarting, `docker compose logs grafana` names the path it looked at.
>
> Provisioned dashboards are tracked by file path. Moving the JSON directory makes Grafana re-create them once on the next start: same UIDs, so links and bookmarks keep working, but stars on them reset.

### Provisioned Dashboards

| Dashboard | UID | Data source |
| --- | --- | --- |
| NestJS Server Health | `nest-server-health` | `quasar-nest-api` `/metrics`: throughput, latency, event loop, memory, requests per endpoint |
| PostgreSQL Database | `000000039` | Postgres exporter |
| Redis Metrics | `quasar-redis-metrics` | Redis exporters (API cluster and UI) |
| Docker Containers (cAdvisor) | `quasar-cadvisor` | cAdvisor |
| Node Exporter Full | `rYdddlPWk` | Node exporter |
| Loki Logs Explorer | `quasar-loki-logs` | Loki (container logs via Promtail) |

On the minimal stack (`docker-compose.minimal.yml --profile observability`),
panels for services it does not run stay empty, and that is expected: it has a
single Postgres and a single, non-cluster Redis, and no PgBouncer or Cloudflare
Tunnel — so, for example, the Redis dashboard's *Cluster Status (API)* shows no
data. Everything else has data.

### Alert Delivery

No email/SMTP is involved. Both Grafana Alerting and Prometheus Alertmanager notify via **Discord and/or Telegram**, rendered at container startup from environment variables — the `grafana` and `alertmanager` service entrypoints in `docker-compose.yml` build the contact point/receiver config from whichever of these are set (at least one is required, both may be set to notify both):

| Variable               | Purpose                                  |
| ---------------------- | ----------------------------------------- |
| `DISCORD_WEBHOOK_URL`  | Discord channel webhook URL               |
| `TELEGRAM_BOT_TOKEN`   | Telegram bot token (from @BotFather)      |
| `TELEGRAM_CHAT_ID`     | Telegram chat/channel ID to post alerts to |

### Metrics Pipeline

```
Host/Containers → Node Exporter / cAdvisor / Postgres, PgBouncer & Redis exporters → Prometheus → Grafana
Applications    → quasar-app & quasar-nest-api /metrics                            → Prometheus → Grafana
Containers      → Promtail → Loki → Grafana
```

---

## Volumes

All persistent data lives in named Docker volumes. Destroying volumes means data loss.

| Volume              | Service              | Data                                               |
| ------------------- | -------------------- | -------------------------------------------------- |
| `pg_data`           | PostgreSQL           | Database files                                     |
| `pg_backups`        | pg-backup            | Local dump cache                                   |
| `pgadmin_data`      | pgAdmin              | Sessions & config                                  |
| `redis_data_1` to `6`| Redis Cluster Nodes | RDB snapshots & appendonly files per node          |
| `redisinsight_data` | RedisInsight         | UI state                                           |
| `prometheus_data`   | Prometheus           | TSDB metrics (30d retention)                       |
| `grafana_data`      | Grafana              | Users, stars, preferences, plugins (dashboards come from code) |
| `loki_data`         | Loki                 | Log chunks                                         |
| `traefik_auth`      | Traefik              | Generated BasicAuth credentials                    |

---

## Service URLs (Production)

All services are routed through Traefik via Docker labels. Subdomains are derived from the `DOMAIN` env var.

| Service           | URL                                               |
| ----------------- | ------------------------------------------------- |
| Quasar Dashboard (UI/Auth) | `https://quasar.${DOMAIN}`                       |
| Quasar Engine (API) | `https://api.${DOMAIN}`                             |
| Traefik Dashboard | `https://traefik.${DOMAIN}` (BasicAuth)           |
| pgAdmin           | `https://pgadmin.${DOMAIN}`                       |
| RedisInsight      | `https://redis.${DOMAIN}`                         |
| Grafana           | `https://grafana.${DOMAIN}`                       |
| Prometheus        | Internal only (`prometheus:9090` on `backend_net`) |
| Loki              | Internal only (`loki:3100` on `backend_net`)       |

---

## Operational Checklist

- [ ] All `.env` values are set and strong
- [ ] Cloudflare Public Hostnames point to `http://traefik:80`
- [ ] `docker compose up -d --build` runs without errors
- [ ] `cloudflared` is healthy and connected to the tunnel
- [ ] Traefik routers answer the expected Host headers
- [ ] Grafana datasources are green (Connections → Data sources → Test)
- [ ] Grafana → Dashboards lists every provisioned dashboard (see [Provisioned Dashboards](#provisioned-dashboards))
- [ ] PG backup runs successfully (`docker compose logs pg-backup`)
- [ ] Redis cluster replication is healthy (run `redis-cli --cluster info` or check metrics)
- [ ] Alert delivery reaches Discord/Telegram (Grafana → Alerting → Contact points → `Notify` → Test)

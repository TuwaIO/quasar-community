# Production Deployment

Bootstrap a bare-metal or VPS server and run the full high-availability
profile — repmgr Postgres primary/standby, a clustered Redis, PgBouncer,
WAL-G continuous archiving, Traefik and (optionally) a Cloudflare Tunnel.

This is the `infra/docker-compose.yml` + `infra/docker-compose.prod.yml`
profile. If you have not already run the single-node profile locally, do
that first — [QUICKSTART_LOCAL.md](./QUICKSTART_LOCAL.md) covers the
concepts (env vars, seeding, first login) this guide builds on, and the
[migration section](./QUICKSTART_LOCAL.md#going-to-production) there covers
moving data from a local node to a server provisioned with this guide.

## Hardware baseline

| Specification | Recommended |
| :--- | :--- |
| CPU | 6 vCPU (x86_64 / ARM64) |
| RAM | 24 GB |
| Disk | 200+ GB NVMe SSD |
| Swap | 4 GB |
| Network | 1 Gbps |

### Approximate memory budget

| Service group | Target | Purpose |
| :--- | :--- | :--- |
| PostgreSQL (primary + standby) | 2.5–3.0 GB | Transaction indexing, Payload CMS, repmgr HA |
| Redis API cluster (6 nodes) | 1.5 GB | BullMQ queues, tracking dedup, IronDome quotas |
| Redis UI cluster (2 nodes) | 512 MB | Dashboard sessions, rate limits, 2FA state |
| App services (Next.js + NestJS + workers) | ~4.5 GB | 2× Next.js, 2× NestJS, 2× worker replicas |
| Observability | ~2.5 GB | Prometheus, Grafana, Loki, Promtail, exporters |
| Proxy & backups | ~1.0 GB | Traefik, PgBouncer, WAL-G, pg-backup, cloudflared |
| OS / page cache headroom | ~12 GB | Buffers, kernel cache, sockets |

Running on less is possible but untested by this project — scale the
`deploy.resources.limits` in your own compose overlay if you do.

## 1. Server access

Generate an SSH key for the server (and, separately, a deploy key for pulling
your repository — step 5) and add the server one to the machine's
`authorized_keys`:

```bash
ssh-keygen -t ed25519 -C "quasar-server"
```

Add a host alias locally (`~/.ssh/config`) so you are not retyping the IP:

```text
Host quasar
    HostName <SERVER_IP>
    User quasar-deploy
    IdentityFile ~/.ssh/quasar-server
```

## 2. Non-root deploy user

Connect as `root` once to create a deploy user, then never use `root` again:

```bash
ssh root@<SERVER_IP>

adduser quasar-deploy
usermod -aG sudo,docker quasar-deploy
mkdir -p /home/quasar-deploy/.ssh
cp ~/.ssh/authorized_keys /home/quasar-deploy/.ssh/
chown -R quasar-deploy:quasar-deploy /home/quasar-deploy/.ssh
chmod 700 /home/quasar-deploy/.ssh
chmod 600 /home/quasar-deploy/.ssh/authorized_keys
exit
```

From now on: `ssh quasar` (the alias from step 1).

## 3. System packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y libatomic1   # required by the tracking engine's native deps
sudo reboot
```

Install Docker:

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
docker --version && docker compose version
```

Node.js and pnpm are only needed on the server if you plan to run
`scripts/rotate-encryption-keys.ts` directly on the host (see
[runbooks/operations.md](./runbooks/operations.md)); everything else — build,
migrate, seed — runs inside containers. Skip this if you don't need key
rotation from the host:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
curl -fsSL https://get.pnpm.io/install.sh | sh -
source ~/.bashrc
```

## 4. Clone the repository

```bash
# If you use a private deploy key instead of HTTPS, add it under your
# repository's Settings -> Deploy Keys with write access left UNCHECKED.
cd /home/quasar-deploy
git clone <your-repository-url> quasar
cd quasar
```

## 5. Cloudflare Tunnel (optional)

Traefik can terminate TLS directly on `80`/`443` if you would rather not use
Cloudflare at all — skip to step 6 in that case.

There are two ways to set one up: the non-interactive script, or the Cloudflare
Zero Trust dashboard by hand.

### Option A — the script

> [!IMPORTANT]
> **Create the API token from your user profile, not from the account.**
> Cloudflare offers two places that both produce something called an API token,
> and only one of them works here:
>
> | | Path | Works? |
> |---|---|---|
> | **User-owned** | **My Profile → API Tokens → Create Token → Custom token** | **yes — use this** |
> | Account-owned | Manage Account → API Tokens | no |
>
> An account-owned token passes the tunnel calls and then fails **every DNS
> call** with `[10000] Authentication error`, even when its zone policy grants
> `DNS Write` — so the tunnel gets created and then nothing points at it. This
> is a Cloudflare platform limitation, not a permission you can add. The script
> detects it and refuses before changing anything.

Give that token exactly two permissions, both at **Edit** (which implies Read):

| Scope | Resource | Level | Applies to |
|---|---|---|---|
| Account | Cloudflare Tunnel | Edit | your account |
| Zone | DNS | Edit | your zone |

Then fill in `.env`. All four are required — the script exits before touching
anything if any is missing:

```dotenv
DOMAIN=example.com
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_ZONE_ID=
```

`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_ZONE_ID` are both on the **Overview**
page of your domain in the Cloudflare dashboard, in the right-hand sidebar under
*API*. `CLOUDFLARE_TUNNEL_TOKEN` is **not** an input — the script prints it at
the end for you to paste back into `.env`.

```bash
./scripts/setup-cloudflare-tunnel.sh --dry-run   # review, then re-run without the flag
```

### Option B — by hand

In the Cloudflare Zero Trust dashboard: create a tunnel, point every public
hostname (`quasar`, `api`, `grafana`, `pgadmin`, `redis` — or whichever subset
you expose — under your domain) at the HTTP service `traefik:80`, and put the
tunnel token in `.env`:

```dotenv
CLOUDFLARE_TUNNEL_TOKEN=<your-tunnel-token>
```

This path needs no API token at all, which is the reason to prefer it if you
would rather not hand out DNS and tunnel permissions.

`traefik:80` is the Docker-network origin — do not enter `localhost:80`, that
would route the tunnel back to itself. The host bindings
`127.0.0.1:80:80`/`127.0.0.1:443:443` stay local-only either way.

## 6. Configure `.env`

```bash
cp .env.example .env
nano .env
```

At minimum, set real values for everything [QUICKSTART_LOCAL.md](./QUICKSTART_LOCAL.md#1-configure)
lists, plus the production-only variables the base compose file requires:
`REPMGR_PASSWORD`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`WALG_LIBSODIUM_KEY` (WAL-G continuous archiving needs a real S3-compatible
bucket — Cloudflare R2, MinIO, AWS S3, anything with an S3-compatible API).

Keep the public and internal engine URLs separate:

```dotenv
# Used by browser-side dashboard code, through your reverse proxy/tunnel
NEXT_PUBLIC_ENGINE_URL=https://api.<your-domain>

# Used by dashboard Server Actions inside Docker — stays on the internal network
INTERNAL_ENGINE_URL=http://quasar-nest-api:3001
```

Do not point server-side calls at the public hostname from the server itself
— that routes back out through your tunnel/proxy and back in, which can
produce `502` even when the engine and database are both healthy.

`INTERNAL_SECRET` only seeds the rotation state on first boot — once API
Redis holds an active/previous pair, further rotations happen there, not by
editing `.env` again. See
[runbooks/operations.md](./runbooks/operations.md#1-api-key--encryption-key-rotation).

## 7. Build or pull images

Two ways to get application images onto the server:

- **Build locally on the server** (simplest to start with):
  ```bash
  docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml \
    build quasar-app quasar-nest-api migrate
  ```
- **Build in CI and pull a signed digest** — set up your own pipeline (see
  `.github/workflows/` for the reference implementation this project uses:
  quality checks, SBOM, Cosign signing, then a digest-pinned deploy), export
  `QUASAR_APP_IMAGE`/`QUASAR_NEST_IMAGE`/`QUASAR_MIGRATE_IMAGE` as full
  `ghcr.io/...@sha256:...` references, and use `scripts/deploy.sh` instead of
  the manual steps below.

## 8. Migrate, seed, start

```bash
COMPOSE="docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml"

$COMPOSE run --rm migrate
$COMPOSE run --rm migrate pnpm --filter @tuwaio/quasar seed

$COMPOSE up -d --remove-orphans --scale quasar-app=2 --scale quasar-nest-api=2
```

What the seed creates and which `.env` variables it reads is in
[SEEDING.md](./SEEDING.md). As with the local profile, it fails loudly if
`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` are missing — there is no
self-registration or email-based password reset to fall back on.

## 9. Verify

```bash
docker compose ps cloudflared traefik   # if you configured a tunnel
docker compose logs --tail=100 cloudflared
docker compose logs --tail=100 traefik
curl -I https://api.<your-domain>/v1/engine/monitoring/health
```

Then log into `/admin`, create your first `App`, and reveal its secret key
— same flow as [QUICKSTART_LOCAL.md, step 4](./QUICKSTART_LOCAL.md#4-log-in).

## 10. Updating the Server (Routine Updates & Rolling Deploys)

To deploy new code, fixes, or updates to an existing live server:

### Option A: Direct Server Build (Source Pull)
```bash
cd /home/quasar-deploy/quasar
git pull origin main

# 1. Rebuild application containers with new code
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml \
  build quasar-app quasar-nest-api migrate

# 2. Run new database migrations safely before traffic switches
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml \
  run --rm migrate

# 3. Rolling update of running application services without touching Postgres/Redis
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml \
  up -d --no-deps --scale quasar-app=2 --scale quasar-nest-api=2 quasar-app quasar-nest-api quasar-worker
```

### Option B: Immutable Digest Deployment (CI/CD)
When deploying pre-built, signed container images from GitHub Container Registry (GHCR):
```bash
# Pulls pinned digests and performs zero-downtime container swap
./scripts/deploy.sh
```

## Observability

```bash
$COMPOSE up -d prometheus grafana loki promtail node-exporter cadvisor \
  postgres-exporter-primary postgres-exporter-standby \
  redis-exporter-api redis-exporter-ui pgbouncer-exporter blackbox-exporter alertmanager
```

Grafana is reachable at `https://grafana.<your-domain>` (behind Traefik
basic-auth by default). Alert notifications go to Discord and/or Telegram —
set `DISCORD_WEBHOOK_URL` and/or `TELEGRAM_BOT_TOKEN`+`TELEGRAM_CHAT_ID` in
`.env` before starting `alertmanager`, which refuses to start without at
least one channel configured. Grafana itself starts either way and simply
skips alert provisioning if neither is set.

Grafana → **Dashboards** should list the provisioned dashboards (NestJS
server, PostgreSQL, Redis, containers, host, logs — see
[`infra/README.md`](../infra/README.md#provisioned-dashboards)).
Unlike a missing alert channel, missing dashboards are fatal: if the
dashboards path in `infra/config/grafana/provisioning/dashboards/dashboards.yml`
holds no JSON, the container exits and `$COMPOSE logs grafana` names the path.
Dashboard JSON is re-read every 30 seconds, so an updated dashboard appears
after `git pull` without restarting Grafana.

## Ongoing operations

Key rotation, Redis outage recovery, PostgreSQL failover, and backup/restore
drills are in [runbooks/operations.md](./runbooks/operations.md) and
[runbooks/alerts.md](./runbooks/alerts.md). Both are written for this
project's own infrastructure in general — skip any section that references
functionality your deployment doesn't use (for example, billing webhooks,
which only exist if you have built payment functionality on top of the
`ContextPayments` scaffolding).

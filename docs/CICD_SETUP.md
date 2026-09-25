# CI/CD Setup

Quasar Community Edition ships with a complete GitHub Actions pipeline. Out of
the box it builds, scans and signs your images on every push — but it does
**not** deploy anywhere, because it has no idea where your server is. This
document is the path from "I forked it" to "pushing to `main` deploys my node".

If you only want to run Quasar locally, you do not need any of this — see
[`QUICKSTART_LOCAL.md`](./QUICKSTART_LOCAL.md). If you have a server but would
rather deploy by hand, see [`PRODUCTION_DEPLOY.md`](./PRODUCTION_DEPLOY.md);
this document automates exactly what that one does manually.

---

## 1. What the pipeline does

Three workflows, all in `.github/workflows/`:

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | pull request to `main`/`staging` | lint, typecheck, test, secret scan, SAST |
| `deploy.yml` | push to `main`/`staging` | the above, then build → scan → sign → **deploy** |
| `rollback.yml` | manual (`workflow_dispatch`) | redeploy a previous image tag |

`deploy.yml` runs as a chain of jobs, each gating the next:

```
quality-check  ──┬──▶ build-app   ──┐
                 └──▶ build-nest  ──┴──▶ release-security ──▶ deploy
```

- **quality-check** — `pnpm lint`, `pnpm typecheck`, `pnpm test`, Gitleaks,
  Semgrep. Skips itself if `ci.yml` already passed on the same commit.
- **build-app / build-nest** — build the Docker images, push them to GHCR, scan
  with Trivy (fails on HIGH/CRITICAL), emit an SBOM. Nothing about the image
  name is hardcoded: both the namespace and the package name come from your own
  repository, as `ghcr.io/<owner>/<repo>-app`, `-nest` and `-migrate`. Clone
  this into `acme/quasar` and you get `ghcr.io/acme/quasar-app`; rename the
  repository and the packages follow.

  > GHCR packages belong to the **owner**, not to the repository. If you keep
  > several repositories built from this codebase under one account, a hardcoded
  > package name would have them overwriting each other's `:staging` tag —
  > deriving the name from the repository is what prevents that. `rollback.yml`
  > resolves images exactly the same way, so the two never disagree.
- **release-security** — signs the images and the release manifest with cosign,
  then verifies its own signatures.
- **deploy** — SSHes to your server and runs `scripts/deploy.sh`.

**The `deploy` job is disabled by default.** It carries
`if: ${{ vars.DEPLOY_ENABLED == 'true' }}`, so until you opt in, GitHub reports
it as *skipped* — which is a green run, not a failed one. Everything before it
still executes in full. That is deliberate: a fork should get a working build
and supply-chain gate on day one without being asked for SSH credentials it
does not have yet.

---

## 2. Branch model

`staging` and `main` are both deploy branches, and the pipeline picks its
target from the branch name:

| Branch | GitHub Environment (build) | Environment (deploy) | SSH secrets used |
|---|---|---|---|
| `staging` | `staging` | `staging-deploy` | `STAGING_SSH_*` |
| `main` | `production` | `production-deploy` | `PROD_SSH_*` |

If you only run one server, use `main` alone and ignore every `STAGING_*`
secret — the `staging` branch simply never gets pushed.

---

## 3. Repository secrets

Settings → Secrets and variables → Actions → **Secrets**.

### Required for deployment

| Secret | What it is |
|---|---|
| `PROD_SSH_HOST` | server hostname or IP |
| `PROD_SSH_USER` | SSH user (needs Docker access) |
| `PROD_SSH_KEY` | private key, full PEM including the BEGIN/END lines |
| `PROD_SSH_FINGERPRINT` | host key fingerprint — get it with `ssh-keyscan -t rsa <host> \| ssh-keygen -lf -` |
| `PROJECT_PATH` | absolute path of the repo clone on the server, e.g. `/opt/quasar` |
| `GHCR_PAT` | GitHub PAT with `read:packages`, used **by the server** to pull images |

`GHCR_PAT` is worth a note: inside the workflow, pushing to GHCR uses the
automatic `GITHUB_TOKEN`. `GHCR_PAT` is passed through to the server so it can
authenticate to `ghcr.io` on its own — a classic PAT with `read:packages` is
enough, and it should not have write scopes.

### Required only if you use a `staging` server

`STAGING_SSH_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_KEY`,
`STAGING_SSH_FINGERPRINT` — same meanings as their `PROD_` counterparts.

### Optional

| Secret | Effect if unset |
|---|---|
| `DISCORD_WEBHOOK` | no Discord deploy notification |
| `TELEGRAM_TOKEN`, `TELEGRAM_TO` | no Telegram deploy notification |
| `GITLEAKS_LICENSE` | Gitleaks runs as a CLI container instead of `gitleaks-action` |
| `SEMGREP_APP_TOKEN` | Semgrep scans with the public `p/default` ruleset instead of your Semgrep Cloud Platform policy |

Both scanners work with no secrets at all, and both stay blocking gates in
either mode. Neither is ever skipped.

**Gitleaks.** `gitleaks-action` requires `GITLEAKS_LICENSE` on
organization-owned repositories. The gitleaks binary itself needs no key, so
without the license the workflow runs the pinned `zricethezav/gitleaks` image.
Like the action, it scans only the commits under review: the PR's
`base..head` in `ci.yml` and the pushed `before..sha` in `deploy.yml`. When a
push has no usable `before`, such as a branch's first push, it scans the whole
history instead. Findings are printed redacted. Both paths read
`.gitleaks.toml` and `.gitleaksignore`. `.gitleaks.toml` must keep its
`[extend] useDefault = true` block: a gitleaks config that contains only an
`[allowlist]` replaces the built-in ruleset instead of extending it, and then
every scan passes.

**Semgrep.** With `SEMGREP_APP_TOKEN`, `semgrep ci` applies the policy
configured in Semgrep Cloud Platform. Without it, the workflow runs
`semgrep scan --config p/default --error --metrics=off`, which uses the public
registry ruleset, needs no account and sends no metrics. To use your own rules
instead, change that `--config` in `ci.yml` and `deploy.yml`.

---

## 4. Repository variables

Settings → Secrets and variables → Actions → **Variables**. Unlike secrets,
these are visible in logs — put no credentials here.

| Variable | Required | Notes |
|---|---|---|
| `DEPLOY_ENABLED` | **yes, to deploy** | set to exactly `true`. Anything else (including unset) skips the `deploy` job. |
| `NEXT_PUBLIC_SERVER_URL` | yes | public URL of the dashboard, e.g. `https://quasar.example.com` |
| `NEXT_PUBLIC_APP_URL` | yes | same as above unless you split domains |
| `NEXT_PUBLIC_ENGINE_URL` | yes | public URL of the NestJS engine |
| `NEXT_PUBLIC_SENTRY_DSN` | no | leave unset to disable browser error reporting |

These are baked into the image at build time, which is why they are build args
and not runtime `.env` entries. Everything else — database URL, Redis, secrets,
encryption key — is read from the `.env` file **on the server** at runtime and
never passes through GitHub.

---

## 5. GitHub Environments

Settings → **Environments**. Create the ones your branches use:
`production`, `production-deploy`, and — only if you deploy `staging` —
`staging`, `staging-deploy`.

They can be empty; the workflow references them for grouping and log clarity.
The `*-deploy` pair is separate from the build pair for one reason: add a
**required reviewer** on `production-deploy` and every production deploy waits
for a human click, while builds and scans keep running unattended. That is the
recommended setup for anything handling real traffic.

---

## 6. Server preparation

The deploy job does not provision anything; it expects a prepared host.

1. **Docker and Compose v2.** Verify with `docker compose version`.
2. **Clone the repository** to the path you put in `PROJECT_PATH`:
   ```bash
   sudo git clone https://github.com/<your-account>/<your-repo>.git /opt/quasar
   ```
   The deploy script checks out a detached commit on every run, so this clone
   must have no local modifications — it refuses to deploy over uncommitted
   changes rather than silently discarding someone's hotfix.
3. **Log in to GHCR** as the deploy user:
   ```bash
   echo "$GHCR_PAT" | docker login ghcr.io -u <your-account> --password-stdin
   ```
4. **Create `.env`** in `PROJECT_PATH`, based on `.env.example`. Every variable
   is documented there; `SEEDING.md` covers the `SEED_*` group specifically.
   Generate the two that must be random:
   ```bash
   openssl rand -hex 32   # ENCRYPTION_KEY
   openssl rand -hex 32   # PAYLOAD_SECRET
   ```
   Keep `ENCRYPTION_KEY` backed up somewhere safe. Every provider API key and
   webhook secret in the database is encrypted with it; lose it and that data
   is unrecoverable, including from a database dump.

---

## 7. First run

Do the first start by hand, so a broken `.env` surfaces as a shell error rather
than as a failed deploy job:

```bash
cd /opt/quasar
docker compose -f infra/docker-compose.yml up -d
pnpm db:migrate
pnpm seed
```

`pnpm seed` creates the single admin account from `SEED_ADMIN_EMAIL` and
`SEED_ADMIN_PASSWORD` in your `.env`. Re-running it never resets an existing
password — see [`SEEDING.md`](./SEEDING.md).

Log in at `https://<your-domain>/admin` and confirm the account works. Community
Edition has no email transport, so password reset goes through the Payload admin
Account page, not through an email link — make sure you can get in before you
depend on it.

---

## 8. Switching the pipeline on

1. Set `DEPLOY_ENABLED=true` in repository variables.
2. `git push origin main`.

From here every push to `main` builds, scans, signs and deploys. Watch the run
under the Actions tab; the `deploy` job should now execute instead of reporting
*skipped*.

### If a deploy goes wrong

Run the **Rollback** workflow manually (Actions → Rollback → *Run workflow*).
It takes the target environment and an image tag — any previous commit SHA that
was built by this pipeline — and redeploys it.

Rollback covers application code, not the database. Migrations are checked for a
`down()` function at build time and the result is recorded as `rollback_safe` in
the release manifest; if a release is marked unsafe, restore the database from a
backup rather than assuming the rollback undid the schema change.

---

## 9. Contributing changes back

Pull requests to the upstream community repository are reviewed there but
merged through the private upstream, so your commit arrives in the public
history as part of a later sync rather than as a merge commit. This is expected
behaviour, not a lost PR — `CONTRIBUTING.md` explains the protocol.

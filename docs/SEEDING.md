# Database Seeding

> **Scope.** This document describes **Community Edition**. The upstream SaaS
> edition maps the same `pnpm seed` command onto a different, multi-tenant seed
> that additionally populates billing settings and demo data — none of which
> exists here. Everything below is what a Community node actually runs.

Quasar ships an idempotent database seed runner that initializes the platform:

| Command | Runner | Seed Function | Purpose |
|---|---|---|---|
| `pnpm seed` | `src/payload/seed-runner.community.ts` | `seedCommunity()` | Admin user + their workspace |

The seed loads `.env` from the repository root and executes through a synchronized runner (`run-seed-with-lock.ts`):

1. Boots the `Payload` instance from `payload.config.ts`.
2. Takes a PostgreSQL advisory lock (`pg_try_advisory_lock`) before making mutations. If another process already holds the lock (e.g., multiple container replicas starting simultaneously), the runner logs a notice and exits cleanly with code `0`.
3. Runs the seed function.
4. Releases the lock in a `finally` block and exits.

The seed is **never** executed automatically on container or application startup. It is an explicit, one-off command you trigger manually (locally, in CI, or during first-time deployment).

## What the Seed Creates

`seedCommunity()` creates exactly two foundational entities, both completely idempotent:

1. **Admin User** — searches for an existing user matching `SEED_ADMIN_EMAIL`, or creates a new one with `roles: ['admin']` if not found. If the user already exists, it is left untouched (preserving its current password).
2. **Workspace** — the organization the admin owns, raised to the Community limits.

`seedCommunity()` **throws an error and halts execution** if either `SEED_ADMIN_EMAIL` or `SEED_ADMIN_PASSWORD` is missing. Because the Community Edition runs without public self-registration or email password resets, missing credentials would leave the instance inaccessible.

It does not generate demo applications, webhooks, or sample data — administrators configure their first App directly via the Payload Admin panel upon initial login.

### Workspace limits

The three numbers live in `src/constants/community.ts` and are applied in two
places, so a workspace gets the same limits whether the seed made it or you did:

| Field | Value | Meaning |
|---|---|---|
| `quotaBalance` | 100,000,000 | Effectively unlimited. There is no $-billing in this edition to top a balance up, so the balance exists only as a runaway guard rail. |
| `rpsLimit` / `rpsPaidLimit` | 100,000 | Global requests-per-second ceiling across every app in the organization. |
| `rpsForever` | `true` | The RPS limit never expires. The paid-lease expiry cron is not part of this edition, so nothing would ever renew a lease — an expiring limit would have no way back up. |

These are rate-limiting and anti-abuse parameters for `IronDomeGuard`, not a
monetized quota.

**Creating the workspace is not the only path.** Creating the admin user fires a
hook that immediately provisions an organization for them, so by the time the
seed looks for a workspace there is normally already one. When that happens the
seed **raises** the existing organization to the limits above rather than
creating a second one.

That is why the organization is named **"Personal Workspace"** in the admin
panel on a fresh node: the hook names it, and the raise only touches limits — it
never renames an organization that already exists. Rename it freely from the
Organizations collection; nothing keys off the name.

The raise is a floor, never a cap:

- a field already **above** the target is left alone — if you raised a limit by
  hand, the next deploy will not reset it;
- a field **below** the target is raised — which is what makes re-running the
  seed after an upgrade a safe way to pick up new defaults;
- `rpsForever` is set once and never unset.

Re-running the seed is therefore still idempotent: on an already-correct
workspace it logs that the limits are met and writes nothing.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SEED_ADMIN_EMAIL` | Yes | Email for the primary administrator account created on initial run. |
| `SEED_ADMIN_PASSWORD` | Yes | Initial password for the administrator account. Only used upon creation — changing this value later does not modify an existing user. |

Configure `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in your `.env` file prior to running the seed. If either variable is undefined, `pnpm seed` will fail immediately.

## Running the Seed

```bash
# Workspace root
pnpm seed

# Or inside container environment
docker compose --env-file .env -f infra/docker-compose.minimal.yml run --rm migrate pnpm --filter @tuwaio/quasar seed
```

This command is safe to execute repeatedly across deployments, server reboots, and upgrades. Existing organizations, credentials, and configuration remain preserved.

## Changing the Administrator Password

`SEED_ADMIN_PASSWORD` is only read during initial account creation. To update the password later, log into the Payload Admin panel (`/admin`), navigate to your profile in the Users collection, and update the password directly within your authenticated session.

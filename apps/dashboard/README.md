# Quasar Dashboard — Community Edition (`@tuwaio/quasar`)

> **Payload CMS 3.88 Administrative Interface**  
> Provides the administrative back-office mounted at `/admin` for self-hosted Quasar nodes, handling API key provisioning, webhook endpoint management, and database schema migrations.

Copyright (c) 2025 - 2026 TUWA.  
Licensed under the [Apache-2.0 License](../../LICENSE).

---

## 1. Role in Community Edition

In Quasar Community Edition, `apps/dashboard` functions purely as the **administrative management layer** for a single-tenant node:

1. **Payload CMS Admin Panel (`/admin`)**: A clean, accessible web interface for operators to create and manage applications (`Apps`), reveal secret API keys (`sk_live_*`), inspect real-time transaction records, configure webhook delivery targets, and view delivery attempts.
2. **Schema Authority**: Payload CMS is the sole authority over the PostgreSQL database schema. All tables, foreign key constraints, indexes, and migrations are declared here and executed via Payload migration commands.
3. **Single-Tenant Authentication**: Relies exclusively on **Native Payload Auth** (email and password credentials) reinforced with **TOTP Two-Factor Authentication (2FA)**. No external OAuth providers, third-party authentication services, passkeys, or wallet session overhead.

> **Authorship is narrower than visibility.** Several collections are readable
> in the admin but cannot be created from it, because their only legitimate
> author is code: `transactions` (written by the engine's sync path),
> `quota-usage-ledger` (written by the usage-reconciliation cron), the three
> audit logs, `app-invoices`, and `users` — the node has exactly one account and
> no way to recover a second. `app-accepted-payments` is closed for a different
> reason: the Payments App is a future feature. The root `README.md` has the
> full table with the reasoning for each.

```
apps/dashboard/
├── public/                     # Static assets (neutral, unbranded icon0.svg & manifest.json)
├── src/
│   ├── app/
│   │   ├── (payload)/          # Payload CMS Admin panel (/admin)
│   │   ├── api/                # Core REST endpoints (Apps, Webhooks, 2FA)
│   │   ├── global-error.tsx    # Root error boundaries
│   │   └── not-found.tsx       # 404 handler
│   ├── collections/            # Active Community Collections
│   │   ├── ContextEngine/      # Apps (API keys, tracking mode, quotas)
│   │   ├── ContextOrganizations/ # Organizations, OrganizationMembers
│   │   ├── ContextUsers/       # Users (Single admin account with 2FA)
│   │   └── ContextWebhooks/    # WebhookEndpoints, WebhookDeliveries
│   ├── components/admin/       # Custom admin UI fields (SecretField, 2FA setup, Retry)
│   ├── hooks/                  # Client hooks for admin components (retry button clock)
│   ├── lib/                    # Encryption, Redis UI, webhook and retry-condition helpers
│   ├── migrations/             # Timestamped PostgreSQL migrations
│   ├── payload/                # Payload configuration & community seed runner
│   └── styles/                 # Global styles
├── payload.config.ts           # Payload CMS configuration
├── next.config.mjs             # Next.js standalone build configuration
└── package.json
```

---

## 2. Tech Stack

| Component | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Framework** | Next.js | 16.3.x | App Router, Standalone container build |
| **CMS / Schema** | Payload CMS | 3.88.x | PostgreSQL adapter (`@payloadcms/db-postgres`) |
| **Styling** | Tailwind CSS / Radix UI | 4.x / 1.x | Headless UI primitives for custom admin fields |
| **Authentication** | Native Payload Auth + TOTP 2FA | — | Self-hosted email/password + RFC 6238 TOTP (zero SIWX / CAIP-122, zero passkeys) |
| **Database Driver** | Node-Postgres (`pg`) | 8.x | Connection pooling via PgBouncer |
| **Runtime & Tooling** | Node.js / pnpm | v20–v24 / 12.x | TypeScript 6.0.x |

---

## 3. Database Schema Management

> [!IMPORTANT]
> **Payload CMS owns the database schema.** The NestJS server in `apps/server` introspects this schema using Drizzle ORM. Never run `drizzle-kit push` against production databases.

### Running Migrations
```bash
# Apply pending migrations to the PostgreSQL database
pnpm db:migrate
```

### Seeding Community Data
Community Edition includes an idempotent, single-tenant seed script that creates the initial admin account and default application workspace:

```bash
# Seed initial admin user and default workspace
pnpm seed
```

Credentials are read directly from your `.env` configuration (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`).

The seed also raises the admin's workspace to the Community limits —
`quotaBalance` 100,000,000, `rpsLimit` / `rpsPaidLimit` 100,000, `rpsForever`
enabled — reading them from `src/constants/community.ts`. Creating the admin
provisions an organization through a hook, so on a fresh node the seed normally
finds that organization and raises it rather than creating a second one. The
raise only ever increases a value, so limits you adjusted by hand survive the
next deploy. See `docs/SEEDING.md`.

---

## 4. Development & Build

```bash
# Start Next.js development server
pnpm dev

# Compile production standalone bundle
pnpm build

# Start production standalone server
pnpm start
```

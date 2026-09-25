# Quasar Shared Utilities — Community Edition (`@tuwaio/shared`)

> **Workspace Core Shared Library**  
> Provides zero-circularity internal utilities: AES-256-GCM symmetric database field encryption, collision-resistant CUID entity IDs, blockchain finality constants, and SSRF-safe URL resolution.

Copyright (c) 2025 - 2026 TUWA.  
Licensed under the [Apache-2.0 License](../../LICENSE).

---

## 1. Package Overview

`@tuwaio/shared` is an internal library built using `tsup` into dual ECMAScript Modules (`.js`) and CommonJS (`.cjs`) formats, accompanied by complete TypeScript declarations (`.d.ts` / `.d.cts`).

```
packages/shared/
├── src/
│   ├── constants.ts        # Finality confirmation counts & TUWA HTTP headers
│   ├── cuid.ts             # Cryptographically secure entity ID generator
│   ├── encryption.ts       # AES-256-GCM symmetric encryption for DB columns
│   ├── utils.ts            # URL parsing, key masking, webhook serialization
│   └── fixtures/           # Shared testing fixtures
├── tsup.config.ts          # Build configuration (ESM + CJS + DTS)
├── package.json
└── README.md
```

---

## 2. Core Modules

### `@tuwaio/shared/encryption`
Symmetric AES-256-GCM encryption with per-record random 12-byte initialization vectors (IV) and 16-byte authentication tags. Used across PostgreSQL columns storing secret API keys, webhook signing secrets, and custom RPC URLs.

```typescript
import { encrypt, decrypt } from '@tuwaio/shared/encryption';

const encryptedCipher = encrypt(plainSecret);
const decryptedPlain = decrypt(encryptedCipher);
```

### `@tuwaio/shared/cuid`
Generates collision-resistant, sortable 24-character primary keys using `@paralleldrive/cuid2`.

```typescript
import { createCuid } from '@tuwaio/shared/cuid';

const id = createCuid();
```

### `@tuwaio/shared/constants`
- `CHAIN_FINALITY_CONFIRMATIONS`: Number of block confirmations required for irreversible transaction finality.
- `DEFAULT_FINALITY_CONFIRMATIONS`: Fallback threshold (12 blocks).
- `TUWA_HEADERS`: Standard HTTP headers (`x-api-key`, `x-internal-secret`, `x-quasar-request-id`, `x-signature-sha256`).

### `@tuwaio/shared/utils`
- `resolveEnvUrl(rawUrl)`: Expands `${VAR}` placeholders in connection strings (e.g. `redis://:${PASSWORD}@redis:6379`).
- `maskKey(key)`: Safely masks API keys for display (e.g. `sk_live_1234...5678`).
- `constructWebhookPayload(...)`: Builds standard CAIP-compliant webhook payloads.
- `isLocalhostUrl(url)`: SSRF validation preventing webhooks from targeting internal RFC 1918 addresses or loopback adapters.

---

## 3. Build & Testing

```bash
# Build subpath exports with tsup
pnpm build

# Run unit tests
pnpm test
```

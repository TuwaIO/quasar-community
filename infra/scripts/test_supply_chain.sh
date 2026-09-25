#!/usr/bin/env bash
# =============================================================================
# Quasar Supply Chain & Immutable Deployment Verification Suite
# Verifies:
#   1. Production application services accept only image@sha256 references.
#   2. Pinned immutable SHA-256 digests for all third-party base images.
#   3. Pinned 40-character commit SHAs for all GitHub Actions workflows.
#   4. Mandatory SBOM, signing, provenance, manifest, and verification gates.
#   5. pnpm lockfile integrity.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "===================================================================="
echo " Quasar Supply Chain & Deployment Verification Suite"
echo "===================================================================="

FAILED=0

# --- 1. Verify production application images are digest-only ---
echo -n "[Check 1/5] Verifying production compose requires image@sha256 references... "
if grep -q 'QUASAR_IMAGE_TAG' infra/docker-compose.prod.yml \
  || ! grep -q 'QUASAR_APP_IMAGE:?QUASAR_APP_IMAGE must be a signed ghcr.io image@sha256 reference' infra/docker-compose.prod.yml \
  || ! grep -q 'QUASAR_NEST_IMAGE:?QUASAR_NEST_IMAGE must be a signed ghcr.io image@sha256 reference' infra/docker-compose.prod.yml \
  || ! grep -q 'QUASAR_MIGRATE_IMAGE:?QUASAR_MIGRATE_IMAGE must be a signed ghcr.io image@sha256 reference' infra/docker-compose.prod.yml; then
  echo "FAIL: Production compose does not require dedicated digest-pinned image references."
  FAILED=1
else
  echo "PASS: Production compose strictly requires digest-pinned application references."
fi

# --- 2. Verify Pinned SHA-256 Digests for Third-Party Images ---
echo -n "[Check 2/5] Verifying third-party base images use immutable @sha256 digests... "
UNPINNED_IMAGES=$(grep -E 'image:\s+[a-zA-Z0-9_\./-]+:[a-zA-Z0-9_\.-]+' infra/docker-compose.yml \
  | grep -v 'quasar/postgresql-repmgr' \
  | grep -v '@sha256:' || true)

if [ -n "$UNPINNED_IMAGES" ]; then
  echo "FAIL: Found unpinned images without @sha256 digests:"
  echo "$UNPINNED_IMAGES"
  FAILED=1
else
  echo "PASS: All third-party images use pinned @sha256 digests."
fi

# --- 3. Verify Pinned Commit SHAs in GitHub Actions ---
echo -n "[Check 3/5] Verifying GitHub Actions are pinned to immutable 40-char commit SHAs... "
MUTABLE_ACTIONS=$(grep -rhoE 'uses:[[:space:]]*[^[:space:]#]+' .github/workflows/ \
  | awk '{print $2}' \
  | grep -vE '^\./' \
  | grep -vE '@[0-9a-fA-F]{40}$' || true)

if [ -n "$MUTABLE_ACTIONS" ]; then
  echo "FAIL: Found unpinned GitHub Actions with mutable tags:"
  echo "$MUTABLE_ACTIONS"
  FAILED=1
else
  echo "PASS: All external GitHub Actions are pinned to full commit SHAs."
fi

# --- 4. Verify mandatory release gates ---
echo -n "[Check 4/5] Verifying mandatory SBOM, signing, provenance, and deployment verification... "
RELEASE_GATES_OK=true
if grep -Rqn 'continue-on-error:[[:space:]]*true' .github/workflows/; then
  echo "FAIL: A workflow step is allowed to fail with continue-on-error=true." >&2
  RELEASE_GATES_OK=false
fi
if ! grep -q 'cosign sign --yes' .github/workflows/deploy.yml \
  || ! grep -q 'cosign verify' .github/workflows/deploy.yml \
  || ! grep -q 'anchore/sbom-action@' .github/workflows/deploy.yml \
  || ! grep -q 'cosign sign-blob --yes' .github/workflows/deploy.yml \
  || ! grep -q 'cosign verify-blob' .github/workflows/deploy.yml; then
  echo "FAIL: Deploy workflow is missing a mandatory signing, provenance, or signed-manifest gate." >&2
  RELEASE_GATES_OK=false
fi
if ! grep -q 'require_digest_reference' scripts/deploy.sh \
  || ! grep -q 'verify_running_image_reference' scripts/deploy.sh \
  || ! grep -q 'cosign verify' .github/workflows/rollback.yml; then
  echo "FAIL: Deploy or rollback path does not verify signed immutable artifact references." >&2
  RELEASE_GATES_OK=false
fi
if [ "$RELEASE_GATES_OK" = true ]; then
  echo "PASS: Mandatory release gates and digest verification are configured."
else
  FAILED=1
fi

# --- 5. Verify pnpm Lockfile Integrity ---
echo -n "[Check 5/5] Verifying pnpm frozen lockfile integrity... "
if pnpm install --frozen-lockfile >/dev/null 2>&1; then
  echo "PASS: pnpm-lock.yaml is strictly in sync with workspace packages."
else
  echo "FAIL: pnpm-lock.yaml is out of sync with package.json files!"
  FAILED=1
fi

echo "===================================================================="
if [ "$FAILED" -eq 0 ]; then
  echo " ✓ ALL 5 SUPPLY CHAIN AUDIT GATES PASSED (100% SUCCESS)"
  echo "===================================================================="
  exit 0
else
  echo " ✗ ONE OR MORE SUPPLY CHAIN CHECKS FAILED"
  echo "===================================================================="
  exit 1
fi

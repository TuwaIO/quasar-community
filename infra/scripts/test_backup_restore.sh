#!/bin/sh
set -eu

# ==============================================================================
# Quasar Automated Backup & Disaster Recovery Sandbox Validation Suite
# ==============================================================================
# Tests:
# 1. Atomic PostgreSQL snapshot generation.
# 2. Local AES-256 encryption/decryption sanity check (with fail-closed validation).
# 3. Non-destructive restore into isolated sandbox database (quasar_restore_test).
# 4. Schema, Partition, FK, and Tenant Isolation validation.
# 5. Granular local restore benchmark. WAL-G archive RPO is tested separately.
# ==============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

TARGET_CONTAINER="${TARGET_CONTAINER:-}"
if [ -z "${TARGET_CONTAINER}" ]; then
  TARGET_CONTAINER="$(docker ps --filter 'label=com.docker.compose.service=postgresql-primary' --format '{{.Names}}' | head -n1 || true)"
fi
if [ -z "${TARGET_CONTAINER}" ]; then
  TARGET_CONTAINER="$(docker ps --filter "name=postgresql-primary" --format '{{.Names}}' | head -n1 || true)"
fi

if [ -z "${TARGET_CONTAINER}" ]; then
  echo "${RED}Could not find running postgresql-primary container.${NC}" >&2
  exit 1
fi

PG_USER="${PG_USER:-quasar}"
PG_DB="${PG_DB:-quasar}"
TEST_DB="${TEST_DB:-quasar_restore_test}"
BACKUP_PASSPHRASE="${PG_BACKUP_PASSPHRASE:-}"
export PG_BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE}"

DUMP_DIR="/tmp/quasar_backup_test_$$"
RAW_DUMP="${DUMP_DIR}/snapshot_raw.dump"
ENC_DUMP="${DUMP_DIR}/snapshot_enc.dump.gpg"
DEC_DUMP="${DUMP_DIR}/snapshot_dec.dump"

case "${TEST_DB}" in
  ''|*[!A-Za-z0-9_]* )
    echo "${RED}TEST_DB must contain only ASCII letters, digits, and underscores.${NC}" >&2
    exit 1
    ;;
esac

if [ -z "${BACKUP_PASSPHRASE}" ]; then
  echo "${RED}PG_BACKUP_PASSPHRASE is required; refusing to run encryption validation with a built-in fallback.${NC}" >&2
  exit 1
fi

echo "${BLUE}====================================================================${NC}"
echo "${BLUE} Quasar S3 / Cloudflare R2 Backup & Restore Sandbox Test Suite${NC}"
echo "${BLUE}====================================================================${NC}"
echo "Target Container:  ${TARGET_CONTAINER}"
echo "Production DB:     ${PG_DB}"
echo "Isolated Test DB:  ${TEST_DB}"
echo "Logical Backup Frequency:  @daily"
echo "WAL-G RPO:                  Not measured by this local snapshot test"
echo "RTO Target SLA:    < 30 minutes (1800s)"
echo "Timestamp:         $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo ""

START_TIME=$(date +%s)

cleanup() {
  echo ""
  echo "${BLUE}[Cleanup] Tearing down temporary files and sandbox database...${NC}"
  rm -rf "${DUMP_DIR}" 2>/dev/null || true
  docker exec "${TARGET_CONTAINER}" psql -U "${PG_USER}" -d postgres -c "
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB}' AND pid <> pg_backend_pid();
    DROP DATABASE IF EXISTS \"${TEST_DB}\" WITH (FORCE);
  " >/dev/null 2>&1 || true
  echo "${GREEN}[Cleanup] Sandbox cleaned up successfully.${NC}"
}
trap cleanup EXIT INT TERM

mkdir -p "${DUMP_DIR}"

# ------------------------------------------------------------------------------
# 1. Capture Database Snapshot
# ------------------------------------------------------------------------------
echo "${YELLOW}[Step 1/6] Generating atomic custom-format snapshot from ${PG_DB}...${NC}"
SNAPSHOT_START=$(date +%s)
docker exec "${TARGET_CONTAINER}" pg_dump -U "${PG_USER}" -d "${PG_DB}" -Fc -f "/tmp/quasar_snapshot_$$.dump"
docker cp "${TARGET_CONTAINER}:/tmp/quasar_snapshot_$$.dump" "${RAW_DUMP}"
docker exec "${TARGET_CONTAINER}" rm -f "/tmp/quasar_snapshot_$$.dump"
SNAPSHOT_END=$(date +%s)

RAW_SIZE=$(ls -lh "${RAW_DUMP}" | awk '{print $5}')
RAW_SHA256=$(sha256sum "${RAW_DUMP}" 2>/dev/null | awk '{print $1}' || shasum -a 256 "${RAW_DUMP}" | awk '{print $1}')
echo "${GREEN}✓ Snapshot generated in $((SNAPSHOT_END - SNAPSHOT_START))s (Size: ${RAW_SIZE}, SHA-256: ${RAW_SHA256})${NC}"

# ------------------------------------------------------------------------------
# 2. Local AES-256 Encryption & Fail-Closed Validation
# ------------------------------------------------------------------------------
echo "${YELLOW}[Step 2/6] Validating local AES-256 encryption and decryption...${NC}"
ENC_START=$(date +%s)

# Encrypt dump using OpenSSL AES-256-CBC with PBKDF2
openssl enc -aes-256-cbc -salt -pbkdf2 -in "${RAW_DUMP}" -out "${ENC_DUMP}" -pass env:PG_BACKUP_PASSPHRASE

ENC_SIZE=$(ls -lh "${ENC_DUMP}" | awk '{print $5}')
echo "  Encrypted ciphertext generated (Size: ${ENC_SIZE})"

# Verify fail-closed behavior on wrong passphrase
if openssl enc -d -aes-256-cbc -pbkdf2 -in "${ENC_DUMP}" -out /dev/null -pass "pass:WRONG_PASSPHRASE_CANARY" >/dev/null 2>&1; then
  echo "${RED}✗ Critical Security Failure: Decryption succeeded with invalid passphrase!${NC}"
  exit 1
fi
echo "${GREEN}  ✓ Fail-closed verified: Invalid passphrase strictly rejected.${NC}"

# Decrypt with valid passphrase
openssl enc -d -aes-256-cbc -pbkdf2 -in "${ENC_DUMP}" -out "${DEC_DUMP}" -pass env:PG_BACKUP_PASSPHRASE
DEC_SHA256=$(sha256sum "${DEC_DUMP}" 2>/dev/null | awk '{print $1}' || shasum -a 256 "${DEC_DUMP}" | awk '{print $1}')

if [ "${RAW_SHA256}" != "${DEC_SHA256}" ]; then
  echo "${RED}✗ Checksum mismatch after decryption! Expected: ${RAW_SHA256}, Got: ${DEC_SHA256}${NC}"
  exit 1
fi
ENC_END=$(date +%s)
echo "${GREEN}✓ Encryption and cryptographic verification passed in $((ENC_END - ENC_START))s.${NC}"

# ------------------------------------------------------------------------------
# 3. Provision Isolated Database Sandbox
# ------------------------------------------------------------------------------
echo "${YELLOW}[Step 3/6] Provisioning isolated database sandbox ${TEST_DB}...${NC}"
docker exec "${TARGET_CONTAINER}" psql -U "${PG_USER}" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${TEST_DB}\" WITH (FORCE);" >/dev/null
docker exec "${TARGET_CONTAINER}" psql -U "${PG_USER}" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${TEST_DB}\" OWNER \"${PG_USER}\";" >/dev/null
echo "${GREEN}✓ Sandbox ${TEST_DB} created without impacting production.${NC}"

# ------------------------------------------------------------------------------
# 4. Restore Snapshot into Sandbox & Measure RTO
# ------------------------------------------------------------------------------
echo "${YELLOW}[Step 4/6] Restoring decrypted snapshot into sandbox database...${NC}"
RESTORE_START=$(date +%s)
docker cp "${DEC_DUMP}" "${TARGET_CONTAINER}:/tmp/quasar_restore_$$.dump"
docker exec "${TARGET_CONTAINER}" pg_restore --exit-on-error -U "${PG_USER}" -d "${TEST_DB}" --no-owner --no-privileges "/tmp/quasar_restore_$$.dump" >/dev/null
docker exec "${TARGET_CONTAINER}" rm -f "/tmp/quasar_restore_$$.dump"
RESTORE_END=$(date +%s)
RESTORE_DURATION=$((RESTORE_END - RESTORE_START))
echo "${GREEN}✓ Restoration completed in ${RESTORE_DURATION}s.${NC}"

# ------------------------------------------------------------------------------
# 5. Integrity Verification Suite (Schema, Partitions, Constraints, Tenants)
# ------------------------------------------------------------------------------
echo "${YELLOW}[Step 5/6] Running 5-point data integrity validation suite...${NC}"

# 5.1 Required Tables
REQUIRED_TABLES="users organizations apps transactions webhook_endpoints webhook_deliveries billing_history"
for tbl in ${REQUIRED_TABLES}; do
  TABLE_COUNT=$(docker exec "${TARGET_CONTAINER}" psql -U "${PG_USER}" -d "${TEST_DB}" -t -A -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${tbl}';")
  if [ "${TABLE_COUNT}" -eq 0 ]; then
    echo "${RED}✗ Missing required table: ${tbl}${NC}"
    exit 1
  fi
done
echo "  ✓ Core tables present (${REQUIRED_TABLES})"

# 5.2 Partitions
PARTITION_COUNT=$(docker exec "${TARGET_CONTAINER}" psql -U "${PG_USER}" -d "${TEST_DB}" -t -A -c "
  SELECT COUNT(*) FROM pg_inherits i
  JOIN pg_class p ON p.oid = i.inhparent
  WHERE p.relname IN ('transactions', 'webhook_deliveries');
")
if [ "${PARTITION_COUNT}" -lt 1 ]; then
  echo "${RED}✗ No active partitions found for transactions/webhook_deliveries.${NC}"
  exit 1
fi
echo "  ✓ Partition child tables attached: ${PARTITION_COUNT} active partitions"

# 5.3 Foreign Key Integrity
ORPHAN_APPS=$(docker exec "${TARGET_CONTAINER}" psql -U "${PG_USER}" -d "${TEST_DB}" -t -A -v ON_ERROR_STOP=1 -c "
  SELECT COUNT(*) FROM apps a
  LEFT JOIN organizations o ON a.organization_id = o.id
  WHERE o.id IS NULL;
")
if [ "${ORPHAN_APPS}" -gt 0 ]; then
  echo "${RED}✗ Orphaned app records detected!${NC}"
  exit 1
fi

ORPHAN_ENDPOINTS=$(docker exec "${TARGET_CONTAINER}" psql -U "${PG_USER}" -d "${TEST_DB}" -t -A -v ON_ERROR_STOP=1 -c "
  SELECT COUNT(*) FROM webhook_endpoints we
  LEFT JOIN apps a ON we.app_id = a.id
  WHERE a.id IS NULL;
")
if [ "${ORPHAN_ENDPOINTS}" -gt 0 ]; then
  echo "${RED}✗ Orphaned webhook endpoint records detected!${NC}"
  exit 1
fi

ORPHAN_DELIVERIES=$(docker exec "${TARGET_CONTAINER}" psql -U "${PG_USER}" -d "${TEST_DB}" -t -A -v ON_ERROR_STOP=1 -c "
  SELECT COUNT(*) FROM webhook_deliveries wd
  LEFT JOIN webhook_endpoints we ON wd.endpoint_id = we.id
  WHERE we.id IS NULL;
")
if [ "${ORPHAN_DELIVERIES}" -gt 0 ]; then
  echo "${RED}✗ Orphaned webhook delivery records detected!${NC}"
  exit 1
fi
echo "  ✓ Foreign key and relation graph integrity verified"

# 5.4 Tenant Scoping
INVALID_APPS=$(docker exec "${TARGET_CONTAINER}" psql -U "${PG_USER}" -d "${TEST_DB}" -t -A -v ON_ERROR_STOP=1 -c \
  'SELECT COUNT(*) FROM apps WHERE organization_id IS NULL;')
if [ "${INVALID_APPS}" -gt 0 ]; then
  echo "${RED}✗ Tenant isolation violation in apps!${NC}"
  exit 1
fi

INVALID_WEBHOOK_ENDPOINTS=$(docker exec "${TARGET_CONTAINER}" psql -U "${PG_USER}" -d "${TEST_DB}" -t -A -v ON_ERROR_STOP=1 -c '
  SELECT COUNT(*)
  FROM webhook_endpoints we
  LEFT JOIN apps a ON a.id = we.app_id
  WHERE a.id IS NULL OR a.organization_id IS NULL;
')
if [ "${INVALID_WEBHOOK_ENDPOINTS}" -gt 0 ]; then
  echo "${RED}✗ Tenant isolation violation in webhook_endpoints!${NC}"
  exit 1
fi

INVALID_WEBHOOK_DELIVERIES=$(docker exec "${TARGET_CONTAINER}" psql -U "${PG_USER}" -d "${TEST_DB}" -t -A -v ON_ERROR_STOP=1 -c '
  SELECT COUNT(*)
  FROM webhook_deliveries wd
  LEFT JOIN webhook_endpoints we ON we.id = wd.endpoint_id
  LEFT JOIN apps a ON a.id = we.app_id
  WHERE a.id IS NULL OR a.organization_id IS NULL;
')
if [ "${INVALID_WEBHOOK_DELIVERIES}" -gt 0 ]; then
  echo "${RED}✗ Tenant isolation violation in webhook_deliveries!${NC}"
  exit 1
fi

INVALID_BILLING=$(docker exec "${TARGET_CONTAINER}" psql -U "${PG_USER}" -d "${TEST_DB}" -t -A -v ON_ERROR_STOP=1 -c \
  'SELECT COUNT(*) FROM billing_history WHERE organization_id IS NULL;')
if [ "${INVALID_BILLING}" -gt 0 ]; then
  echo "${RED}✗ Tenant isolation violation in billing_history!${NC}"
  exit 1
fi
echo "  ✓ Strict tenant isolation confirmed across all tenant tables"

# 5.5 Billing ledger presence (append-only behavior requires a separate
# application/database authorization test and is not proven by pg_restore).
BILLING_ENTRIES=$(docker exec "${TARGET_CONTAINER}" psql -U "${PG_USER}" -d "${TEST_DB}" -t -A -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) FROM billing_history;")
echo "  ✓ Billing ledger restored: ${BILLING_ENTRIES} records present"

# ------------------------------------------------------------------------------
# 6. Empirical Telemetry & Benchmark Report
# ------------------------------------------------------------------------------
END_TIME=$(date +%s)
TOTAL_DURATION=$((END_TIME - START_TIME))

echo ""
echo "${GREEN}====================================================================${NC}"
echo "${GREEN} ✓ LOCAL SNAPSHOT ENCRYPTION & RESTORE TESTS PASSED${NC}"
echo "${GREEN}====================================================================${NC}"
echo "Snapshot Checksum:  ${RAW_SHA256}"
echo "Encryption Check:   Local AES-256-CBC with PBKDF2 only (not pg-backup GPG or WAL-G encryption evidence)"
echo "Restore Time (RTO): ${RESTORE_DURATION}s (SLA Target: < 1800s / 30m)"
echo "Total Suite Time:   ${TOTAL_DURATION}s"
echo "Production Status:  NOT A SIGN-OFF (WAL-G/PITR, remote logical restore, and deployment encryption are separate gates)"

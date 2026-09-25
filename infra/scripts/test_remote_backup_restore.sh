#!/bin/sh
set -eu

# Restores the latest real S3/R2 object into an isolated PostgreSQL database.
# This is the production-relevant DR check; test_backup_restore.sh remains a
# local snapshot/schema sanity check.

TARGET_CONTAINER="${TARGET_CONTAINER:-}"
if [ -z "${TARGET_CONTAINER}" ]; then
  TARGET_CONTAINER="$(docker ps --filter 'label=com.docker.compose.service=postgresql-primary' --format '{{.Names}}' | head -n1 || true)"
fi
if [ -z "${TARGET_CONTAINER}" ]; then
  TARGET_CONTAINER="$(docker ps --filter "name=postgresql-primary" --format '{{.Names}}' | head -n1 || true)"
fi

if [ -z "${TARGET_CONTAINER}" ]; then
  echo "Could not find running postgresql-primary container." >&2
  exit 1
fi

PG_BACKUP_CONTAINER="${PG_BACKUP_CONTAINER:-}"
if [ -z "${PG_BACKUP_CONTAINER}" ]; then
  PG_BACKUP_CONTAINER="$(docker ps --filter 'label=com.docker.compose.service=pg-backup' --format '{{.Names}}' | head -n1 || true)"
fi
if [ -z "${PG_BACKUP_CONTAINER}" ]; then
  PG_BACKUP_CONTAINER="$(docker ps --filter "name=pg-backup" --format '{{.Names}}' | head -n1 || true)"
fi

if [ -z "${PG_BACKUP_CONTAINER}" ]; then
  echo "Could not find running pg-backup container." >&2
  exit 1
fi

PG_USER="${PG_USER:-quasar}"
TEST_DB="${TEST_DB:-quasar_remote_restore_test}"
REMOTE_BACKUP_KEY="${REMOTE_BACKUP_KEY:-}"

case "${TEST_DB}" in
  ''|*[!A-Za-z0-9_]* )
    echo "TEST_DB must contain only ASCII letters, digits, and underscores." >&2
    exit 1
    ;;
esac

cleanup() {
  docker exec "${TARGET_CONTAINER}" psql -U "${PG_USER}" -d postgres \
    -c "DROP DATABASE IF EXISTS \"${TEST_DB}\" WITH (FORCE);" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "Creating isolated database ${TEST_DB}..."
docker exec "${TARGET_CONTAINER}" psql -U "${PG_USER}" -d postgres \
  -c "DROP DATABASE IF EXISTS \"${TEST_DB}\" WITH (FORCE);" >/dev/null 2>&1 || true
docker exec "${TARGET_CONTAINER}" psql -U "${PG_USER}" -d postgres \
  -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${TEST_DB}\" OWNER \"${PG_USER}\";" >/dev/null

echo "Downloading and restoring a real S3/R2 backup object..."
if [ -n "${REMOTE_BACKUP_KEY}" ]; then
  docker exec \
    -e "RESTORE_DATABASE=${TEST_DB}" \
    -e "REQUIRE_ENCRYPTED_BACKUP=yes" \
    -e "REMOTE_BACKUP_KEY=${REMOTE_BACKUP_KEY}" \
    "${PG_BACKUP_CONTAINER}" sh /restore.sh
else
  docker exec \
    -e "RESTORE_DATABASE=${TEST_DB}" \
    -e "REQUIRE_ENCRYPTED_BACKUP=yes" \
    "${PG_BACKUP_CONTAINER}" sh /restore.sh
fi

echo "Validating restored schema and tenant relationships..."
docker exec "${TARGET_CONTAINER}" psql -U "${PG_USER}" -d "${TEST_DB}" \
  -v ON_ERROR_STOP=1 -c "
    DO \$$
    DECLARE
      required text;
      present integer;
    BEGIN
      FOREACH required IN ARRAY ARRAY['users','organizations','apps','transactions','webhook_endpoints','webhook_deliveries','billing_history'] LOOP
        SELECT COUNT(*) INTO present
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = required;
        IF present = 0 THEN RAISE EXCEPTION 'Missing required table: %', required; END IF;
      END LOOP;
    END
    \$$;

    DO \$$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_inherits i
        JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname IN ('transactions', 'webhook_deliveries')
      ) THEN
        RAISE EXCEPTION 'No active transaction/webhook partitions found';
      END IF;
    END
    \$$;

    DO \$$
    BEGIN
      IF EXISTS (SELECT 1 FROM apps WHERE organization_id IS NULL) THEN
        RAISE EXCEPTION 'apps contains rows without organization_id';
      END IF;
      IF EXISTS (
        SELECT 1 FROM webhook_endpoints we
        LEFT JOIN apps a ON a.id = we.app_id
        WHERE a.id IS NULL OR a.organization_id IS NULL
      ) THEN RAISE EXCEPTION 'webhook_endpoints tenant relationship is invalid'; END IF;
      IF EXISTS (
        SELECT 1 FROM webhook_deliveries wd
        LEFT JOIN webhook_endpoints we ON we.id = wd.endpoint_id
        LEFT JOIN apps a ON a.id = we.app_id
        WHERE a.id IS NULL OR a.organization_id IS NULL
      ) THEN RAISE EXCEPTION 'webhook_deliveries tenant relationship is invalid'; END IF;
      IF EXISTS (SELECT 1 FROM billing_history WHERE organization_id IS NULL) THEN
        RAISE EXCEPTION 'billing_history contains rows without organization_id';
      END IF;
    END
    \$$;
  " >/dev/null

echo "Remote S3/R2 backup restore validation passed for ${TEST_DB}."

#!/bin/sh
set -eu

# Run inside a clean PostgreSQL 16 recovery container. This deliberately
# refuses to overwrite an existing PGDATA directory.

: "${PGDATA:=/var/lib/postgresql/data}"
: "${WALG_S3_PREFIX:?WALG_S3_PREFIX must be set}"
: "${WALG_LIBSODIUM_KEY:?WALG_LIBSODIUM_KEY must be set}"
: "${WALG_PITR_TARGET_TIME:?WALG_PITR_TARGET_TIME must be set (UTC RFC3339)}"

case "${WALG_PITR_TARGET_TIME}" in
  ''|*[!0-9T:Z.+-]*|*[!Z])
    echo "WALG_PITR_TARGET_TIME must be a UTC RFC3339 timestamp ending in Z." >&2
    exit 1
    ;;
esac
if ! date -u -d "${WALG_PITR_TARGET_TIME}" +%s >/dev/null 2>&1; then
  echo "WALG_PITR_TARGET_TIME is not a valid UTC timestamp." >&2
  exit 1
fi

if [ -L "${PGDATA}" ]; then
  echo "Refusing to use a symlink as PostgreSQL data directory: ${PGDATA}" >&2
  exit 1
fi
if [ -e "${PGDATA}" ] && [ -n "$(find "${PGDATA}" -mindepth 1 -print -quit 2>/dev/null)" ]; then
  echo "Refusing to overwrite a non-empty PostgreSQL data directory: ${PGDATA}" >&2
  exit 1
fi

mkdir -p "${PGDATA}"
chmod 0700 "${PGDATA}"

echo "Available WAL-G backups:"
wal-g backup-list

echo "Fetching WAL-G base backup ${WALG_BACKUP_NAME:-LATEST}..."
wal-g backup-fetch "${PGDATA}" "${WALG_BACKUP_NAME:-LATEST}"

cat >> "${PGDATA}/postgresql.auto.conf" <<'CONF'
restore_command = 'wal-g wal-fetch %f %p'
recovery_target_action = 'promote'
CONF
PG_RECOVERY_TIME="$(date -u -d "${WALG_PITR_TARGET_TIME}" '+%Y-%m-%d %H:%M:%S UTC')"
printf "recovery_target_time = '%s'\n" "${PG_RECOVERY_TIME}" >> "${PGDATA}/postgresql.auto.conf"
touch "${PGDATA}/recovery.signal"
chown -R postgres:postgres "${PGDATA}"
chmod 0700 "${PGDATA}"

echo "PITR data directory prepared. Start PostgreSQL and verify recovery_target_time=${WALG_PITR_TARGET_TIME}."

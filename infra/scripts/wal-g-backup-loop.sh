#!/bin/sh
set -eu

# WAL-G base-backup scheduler. It discovers the writable repmgr node instead
# of assuming that postgresql-primary remains the primary after failover.

: "${REPMGR_PASSWORD:?REPMGR_PASSWORD is required}"
: "${WALG_S3_PREFIX:?WALG_S3_PREFIX is required}"
: "${WALG_LIBSODIUM_KEY:?WALG_LIBSODIUM_KEY is required}"

PGUSER="${PGUSER:-repmgr}"
PGPASSWORD="${PGPASSWORD:-${REPMGR_PASSWORD}}"
PGDATABASE="${PGDATABASE:-repmgr}"
PGPORT="${PGPORT:-5432}"
export PGUSER PGPASSWORD PGDATABASE PGPORT

INTERVAL="${WALG_BACKUP_INTERVAL_SECONDS:-86400}"
INITIAL_BACKUP="${WALG_BACKUP_ON_START:-yes}"
RETAIN_FULL_BACKUPS="${WALG_RETAIN_FULL_BACKUPS:-7}"

case "${INTERVAL}" in ''|*[!0-9]*) echo "[wal-g] WALG_BACKUP_INTERVAL_SECONDS must be an integer." >&2; exit 1 ;; esac
case "${RETAIN_FULL_BACKUPS}" in ''|*[!0-9]*) echo "[wal-g] WALG_RETAIN_FULL_BACKUPS must be an integer." >&2; exit 1 ;; esac
if [ "${RETAIN_FULL_BACKUPS}" -lt 1 ]; then
  echo "[wal-g] WALG_RETAIN_FULL_BACKUPS must be at least 1." >&2
  exit 1
fi
if [ "${INTERVAL}" -lt 1 ]; then
  echo "[wal-g] WALG_BACKUP_INTERVAL_SECONDS must be at least 1 second." >&2
  exit 1
fi
case "${INITIAL_BACKUP}" in
  yes|no) ;;
  *) echo "[wal-g] WALG_BACKUP_ON_START must be yes or no." >&2; exit 1 ;;
esac

find_writable_primary() {
  for host in postgresql-primary postgresql-standby; do
    state="$(PGHOST="${host}" psql -h "${host}" -p "${PGPORT}" -d "${PGDATABASE}" \
      -tAc 'SELECT pg_is_in_recovery();' 2>/dev/null | tr -d '[:space:]' || true)"
    if [ "${state}" = "f" ]; then
      printf '%s\n' "${host}"
      return 0
    fi
  done
  return 1
}

run_backup() {
  host="$(find_writable_primary || true)"
  if [ -z "${host}" ]; then
    echo "[wal-g] No writable PostgreSQL primary discovered; backup postponed." >&2
    return 1
  fi

  case "${host}" in
    postgresql-primary) data_dir="/var/lib/postgresql/primary" ;;
    postgresql-standby) data_dir="/var/lib/postgresql/standby" ;;
    *) echo "[wal-g] Refusing unknown PostgreSQL host: ${host}" >&2; return 1 ;;
  esac

  if [ ! -f "${data_dir}/PG_VERSION" ]; then
    echo "[wal-g] Data directory for ${host} is not mounted or initialized: ${data_dir}" >&2
    return 1
  fi

  echo "[wal-g] Starting base backup from ${host} (${data_dir})..."
  mkdir -p /var/lib/postgresql/data
  umount /var/lib/postgresql/data 2>/dev/null || true
  mount --bind -o ro "${data_dir}" /var/lib/postgresql/data

  if ! PGHOST="${host}" PGDATA="/var/lib/postgresql/data" wal-g backup-push /var/lib/postgresql/data --verify; then
    echo "[wal-g] ERROR: Base backup failed from ${host}." >&2
    return 1
  fi

  # Retention is applied only after a verified base backup exists. WAL-G keeps
  # the WAL required by the retained full backups; never delete WAL directly.
  if ! PGHOST="${host}" wal-g delete retain FULL "${RETAIN_FULL_BACKUPS}" --confirm; then
    echo "[wal-g] WARNING: WAL-G retention cleanup encountered an error." >&2
  fi

  echo "[wal-g] Base backup completed successfully from ${host}."
}

if [ "${INITIAL_BACKUP}" = "yes" ]; then
  run_backup || true
fi

while :; do
  sleep "${INTERVAL}"
  run_backup || true
done

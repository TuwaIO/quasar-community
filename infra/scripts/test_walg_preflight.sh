#!/bin/sh
set -eu

# Non-destructive PostgreSQL/WAL-G preflight verification suite.
# This script never stops containers, changes PostgreSQL configuration, writes
# application data, deletes objects, or performs a restore.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PRIMARY_CONTAINER="${PRIMARY_CONTAINER:-}"
STANDBY_CONTAINER="${STANDBY_CONTAINER:-}"
WALG_CONTAINER="${WALG_CONTAINER:-}"
EXPECTED_INTERVAL_SECONDS="${EXPECTED_INTERVAL_SECONDS:-86400}"

find_container() {
  service="$1"
  docker ps --filter "label=com.docker.compose.service=${service}" --filter "label=com.docker.compose.oneoff=False" --format '{{.Names}}' | head -n1
}

[ -n "${PRIMARY_CONTAINER}" ] || PRIMARY_CONTAINER="$(find_container postgresql-primary)"
[ -n "${STANDBY_CONTAINER}" ] || STANDBY_CONTAINER="$(find_container postgresql-standby)"
[ -n "${WALG_CONTAINER}" ] || WALG_CONTAINER="$(find_container wal-g-backup)"

: "${PRIMARY_CONTAINER:?postgresql-primary container was not found}"
: "${STANDBY_CONTAINER:?postgresql-standby container was not found}"
: "${WALG_CONTAINER:?wal-g-backup container was not found}"

PGUSER="${PGUSER:-${PG_USER:-quasar}}"
PGDATABASE="${PGDATABASE:-${PG_DB:-quasar}}"

psql_value() {
  container="$1"
  sql="$2"
  docker exec "${container}" psql -U "${PGUSER}" -d "${PGDATABASE}" -tA -v ON_ERROR_STOP=1 -c "${sql}" \
    | tr -d '[:space:]'
}

assert_equal() {
  expected="$1"
  actual="$2"
  label="$3"
  if [ "${expected}" != "${actual}" ]; then
    echo "${RED}FAIL: ${label}: expected '${expected}', got '${actual}'.${NC}" >&2
    exit 1
  fi
  echo "${GREEN}PASS: ${label}: ${actual}${NC}"
}

case "${EXPECTED_INTERVAL_SECONDS}" in
  ''|*[!0-9]*|0) echo "EXPECTED_INTERVAL_SECONDS must be a positive integer." >&2; exit 1 ;;
esac

echo "${YELLOW}Quasar non-destructive PostgreSQL/WAL-G preflight${NC}"
echo "Primary: ${PRIMARY_CONTAINER}"
echo "Standby: ${STANDBY_CONTAINER}"
echo "Scheduler: ${WALG_CONTAINER}"

primary_state="$(psql_value "${PRIMARY_CONTAINER}" 'SELECT pg_is_in_recovery();')"
standby_state="$(psql_value "${STANDBY_CONTAINER}" 'SELECT pg_is_in_recovery();')"
assert_equal f "${primary_state}" "Configured primary is writable"
assert_equal t "${standby_state}" "Configured standby is in recovery"

primary_count=0
standby_count=0
for container in "${PRIMARY_CONTAINER}" "${STANDBY_CONTAINER}"; do
  state="$(psql_value "${container}" 'SELECT pg_is_in_recovery();')"
  if [ "${state}" = f ]; then primary_count=$((primary_count + 1)); fi
  if [ "${state}" = t ]; then standby_count=$((standby_count + 1)); fi
done
assert_equal 1 "${primary_count}" "Exactly one writable node exists"
assert_equal 1 "${standby_count}" "Exactly one standby exists"

archive_mode="$(psql_value "${PRIMARY_CONTAINER}" 'SHOW archive_mode;')"
archive_command="$(psql_value "${PRIMARY_CONTAINER}" 'SHOW archive_command;')"
restore_command="$(psql_value "${PRIMARY_CONTAINER}" 'SHOW restore_command;')"
archive_timeout="$(psql_value "${PRIMARY_CONTAINER}" 'SHOW archive_timeout;')"
wal_compression="$(psql_value "${PRIMARY_CONTAINER}" 'SHOW wal_compression;')"
assert_equal on "${archive_mode}" "archive_mode"
assert_equal "wal-gwal-push%p" "$(printf '%s' "${archive_command}" | tr -d " '\"")" "archive_command uses WAL-G"
assert_equal "wal-gwal-fetch%f%p" "$(printf '%s' "${restore_command}" | tr -d " '\"")" "restore_command uses WAL-G"
case "${archive_timeout}" in
  1min) archive_timeout="60s" ;;
esac
assert_equal 60s "${archive_timeout}" "archive_timeout"
case "${wal_compression}" in
  pglz|lz4|zstd) wal_compression="on" ;;
esac
assert_equal on "${wal_compression}" "wal_compression"

docker exec "${PRIMARY_CONTAINER}" wal-g --version >/dev/null
docker exec "${PRIMARY_CONTAINER}" wal-g wal-show >/dev/null
docker exec "${PRIMARY_CONTAINER}" wal-g backup-list >/dev/null
echo "${GREEN}PASS: WAL-G binary, wal-show, and backup-list are available.${NC}"

last_archived="$(psql_value "${PRIMARY_CONTAINER}" "SELECT COALESCE(last_archived_time::text, '') FROM pg_stat_archiver;")"
if [ -z "${last_archived}" ]; then
  echo "${RED}FAIL: PostgreSQL has not recorded a successful WAL archive yet.${NC}" >&2
  exit 1
fi
echo "${GREEN}PASS: PostgreSQL recorded a successful WAL archive at ${last_archived}.${NC}"

interval="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "${WALG_CONTAINER}" \
  | awk -F= '$1 == "WALG_BACKUP_INTERVAL_SECONDS" {print $2; exit}')"
assert_equal "${EXPECTED_INTERVAL_SECONDS}" "${interval}" "WAL-G scheduler interval"

if ! docker logs --tail=300 "${WALG_CONTAINER}" 2>&1 | grep -q 'Base backup completed successfully'; then
  echo "${RED}FAIL: scheduler has no successful verified base-backup message in its recent logs.${NC}" >&2
  exit 1
fi
echo "${GREEN}PASS: scheduler recently completed a verified base backup.${NC}"

echo "${GREEN}WAL-G preflight passed. Destructive failover, PITR, retention, and host-loss tests remain mandatory.${NC}"

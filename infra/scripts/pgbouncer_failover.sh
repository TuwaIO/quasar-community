#!/bin/bash
# =========================================================================
# pgbouncer_failover.sh — Automated PgBouncer Failover Script
# =========================================================================
#
# RUNBOOK: Manual Validation Before Production Use
# -------------------------------------------------
# 1. Verify repmgr is configured: `repmgr cluster show`
# 2. Identify the current primary: `repmgr node status`
# 3. Test with DRY_RUN=true: `DRY_RUN=true ./pgbouncer_failover.sh promote replica2 10.0.0.2 "$(date)" "manual test"`
# 4. Verify PgBouncer routing:  `psql -h pgbouncer -p 6432 pgbouncer -c "SHOW DATABASES;"`
# 5. Confirm new master is writable: `psql -h <new_primary> -c "SELECT pg_is_in_recovery();"`
#    -> Expected: `f` (false = writable master)
#
# Usage: pgbouncer_failover.sh %e %n %h "%t" "%d"
# =========================================================================

set -euo pipefail

if (( $# < 4 )); then
    echo "Usage: $0 %e %n %h \"%t\" [\"%d\"]" >&2
    exit 2
fi

EVENT=$1
NODE_NAME=$2
NODE_HOST=$3
TIMESTAMP=$4
DETAILS=${5:-""}

# If repmgr passes unexpanded %h or %a placeholder, empty host, or shifted timestamp, fallback to environment node name
if [[ "$NODE_HOST" == "%h" || "$NODE_HOST" == "%a" || -z "$NODE_HOST" || "$NODE_HOST" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2} ]]; then
    NODE_HOST="${REPMGR_NODE_NETWORK_NAME:-${REPMGR_NODE_NAME:-$(hostname)}}"
fi

# repmgr supplies these values, but they are later interpolated into SQL.
# Reject anything outside the Docker/DNS/IP hostname and SQL identifier
# character sets before it can reach the PgBouncer admin console.
if [[ ! "$NODE_HOST" =~ ^[A-Za-z0-9_.:-]+$ ]]; then
    echo "ERROR: invalid promoted node host: $NODE_HOST" >&2
    exit 1
fi

LOGGER_TAG="repmgr-pgbouncer"
LOG_FILE="/var/log/postgresql/repmgr_events.log"
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true

log() {
    echo "[$TIMESTAMP] $1" >> "$LOG_FILE" 2>/dev/null || echo "[$TIMESTAMP] $1"
}

log "Event: $EVENT, Node: $NODE_NAME, Host: $NODE_HOST, Details: $DETAILS"

# Handled promotion event variants from repmgr/repmgrd
if [[ "$EVENT" == "promote" ]] || [[ "$EVENT" == "standby_promote" ]] || [[ "$EVENT" == "repmgrd_failover_promote" ]] || [[ "$EVENT" == "child_node_new_primary" ]]; then

    PGBOUNCER_HOST="${PGBOUNCER_HOST:-pgbouncer}"
    PGBOUNCER_PORT="${PGBOUNCER_PORT:-5432}"

    # ── Dry-run mode ──
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        log "[DRY RUN] Would promote $NODE_HOST to primary in pgbouncer ($PGBOUNCER_HOST:$PGBOUNCER_PORT)."
        log "[DRY RUN] Command: psql -h $PGBOUNCER_HOST -p $PGBOUNCER_PORT -U \$DB_USER pgbouncer -c \"ALTER DATABASE \$DB_NAME SET host = '$NODE_HOST';\""
        log "[DRY RUN] Exiting without changes."
        exit 0
    fi

    log "Promoting $NODE_HOST to primary in pgbouncer ($PGBOUNCER_HOST:$PGBOUNCER_PORT)..."

    # Use psql to talk to pgbouncer admin console
    DB_USER="${PG_USER:-${POSTGRES_USER:-quasar}}"
    DB_NAME="${PG_DB:-${POSTGRES_DB:-quasar}}"
    export PGPASSWORD="${PG_PASSWORD:-${POSTGRES_PASSWORD:-}}"

    if [[ ! "$DB_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
        log "ERROR: invalid database name; refusing to alter PgBouncer routing"
        exit 1
    fi

    # Do not route clients to a node until it has proved that it is writable.
    # This keeps a promotion race or a stale standby from becoming the new
    # write target.
    RECOVERY_STATUS=$(PGCONNECT_TIMEOUT="${PG_CONNECT_TIMEOUT:-5}" psql -h "$NODE_HOST" -p "${PG_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT pg_is_in_recovery();" 2>/dev/null | tr -d '[:space:]' || true)
    if [[ "$RECOVERY_STATUS" != "f" ]]; then
        log "ERROR: promoted node $NODE_HOST is not confirmed writable (pg_is_in_recovery=$RECOVERY_STATUS); refusing to update PgBouncer"
        exit 1
    fi

    if psql -h "$PGBOUNCER_HOST" -p "$PGBOUNCER_PORT" -U "$DB_USER" pgbouncer -c "ALTER DATABASE $DB_NAME SET host = '$NODE_HOST';"; then
        log "Successfully updated pgbouncer to new primary: $NODE_HOST"
        log "Health check PASSED: $NODE_HOST is writable (pg_is_in_recovery=false)."
    else
        log "ERROR: Failed to update pgbouncer"
        exit 1
    fi
fi

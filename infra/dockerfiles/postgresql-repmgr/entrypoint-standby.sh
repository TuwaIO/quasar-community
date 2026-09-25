#!/bin/bash
set -e

PGDATA="${PGDATA:-/var/lib/postgresql/data}"
REPMGR_CONF="/etc/repmgr.conf"
PG_BIN="/usr/lib/postgresql/16/bin"

write_repmgr_conf() {
    cat > "$REPMGR_CONF" <<CONF
node_id=${REPMGR_NODE_ID:-2}
node_name='${REPMGR_NODE_NAME:-postgresql-standby}'
conninfo='host=${REPMGR_NODE_NETWORK_NAME:-postgresql-standby} port=5432 user=repmgr dbname=repmgr password=${REPMGR_PASSWORD}'
data_directory='${PGDATA}'
pg_bindir='${PG_BIN}'
log_level=INFO
failover=automatic
promote_command='repmgr standby promote -f ${REPMGR_CONF} --log-to-file'
follow_command='repmgr standby follow -f ${REPMGR_CONF} --log-to-file --upstream-node-id=%n'
reconnect_attempts=6
reconnect_interval=5
monitoring_history=yes
connection_check_type=ping
partner_nodes='${REPMGR_PARTNER_NODES:-postgresql-primary,postgresql-standby}'
# Automatic promotion must require a quorum-capable deployment. A two-node
# Compose deployment remains failover-capable for testing, but is not a safe
# production topology without an external witness or fencing controller.
primary_visibility_consensus=${REPMGR_PRIMARY_VISIBILITY_CONSENSUS:-yes}
standby_disconnect_on_failover=${REPMGR_STANDBY_DISCONNECT_ON_FAILOVER:-yes}
event_notification_command='${REPMGR_EVENT_NOTIFICATION_COMMAND:-/usr/local/bin/pgbouncer_failover.sh %e %n %a "%t" "%d"}'
CONF
    chown postgres:postgres "$REPMGR_CONF"
    chmod 600 "$REPMGR_CONF"
}

# Wait for primary to accept connections
echo "[standby] Waiting for primary at ${REPMGR_PRIMARY_HOST}:${REPMGR_PRIMARY_PORT:-5432}..."
until PGPASSWORD="$REPMGR_PASSWORD" psql -h "${REPMGR_PRIMARY_HOST}" -p "${REPMGR_PRIMARY_PORT:-5432}" -U repmgr -d repmgr -c "SELECT 1" >/dev/null 2>&1; do
    sleep 2
done
echo "[standby] Primary is ready."

write_repmgr_conf

if [ ! -f "$PGDATA/PG_VERSION" ] || [ ! -f "$PGDATA/standby.signal" ] || [ "${REPMGR_FORCE_RECLONE:-no}" = "yes" ]; then
    echo "[standby] Standby data missing or node was previously promoted. Cloning from primary via repmgr..."
    rm -rf "${PGDATA:?}"/* "${PGDATA:?}"/.* 2>/dev/null || true

    # repmgr standby clone must run as postgres user
    gosu postgres env PGPASSWORD="$REPMGR_PASSWORD" repmgr \
        -h "${REPMGR_PRIMARY_HOST}" \
        -p "${REPMGR_PRIMARY_PORT:-5432}" \
        -U repmgr \
        -d repmgr \
        -f "$REPMGR_CONF" \
        standby clone --fast-checkpoint --force

    echo "[standby] Clone complete. Starting postgres temporarily to register..."

    # Start postgres temporarily to register standby
    gosu postgres "$PG_BIN/pg_ctl" -D "$PGDATA" -w start

    # Register standby
    if ! gosu postgres env PGPASSWORD="$REPMGR_PASSWORD" repmgr -f "$REPMGR_CONF" standby register --force; then
        echo "[standby] ERROR: initial repmgr standby registration failed; refusing to continue."
        exit 1
    fi

    gosu postgres "$PG_BIN/pg_ctl" -D "$PGDATA" -w stop

    echo "[standby] Registration complete. Starting supervised postgres and repmgrd..."
else
    echo "[standby] Restarting existing standby..."
fi

ensure_postgresql_conf() {
    [ -f "$PGDATA/postgresql.conf" ] || return 0

    ensure_setting() {
        key="$1"
        value="$2"
        if grep -Eq "^[[:space:]]*${key}[[:space:]]*=" "$PGDATA/postgresql.conf"; then
            sed -i -E "s|^[[:space:]]*${key}[[:space:]]*=.*$|${key} = ${value}|" "$PGDATA/postgresql.conf"
        else
            printf '%s = %s\n' "$key" "$value" >> "$PGDATA/postgresql.conf"
        fi
    }

    # Match active settings only. The stock PostgreSQL file contains
    # commented examples such as '#archive_mode = off', which must not count.
    ensure_setting archive_mode on
    ensure_setting archive_command "'wal-g wal-push %p'"
    ensure_setting restore_command "'wal-g wal-fetch %f %p'"
    ensure_setting archive_timeout "'60s'"
    ensure_setting wal_compression on
    ensure_setting recovery_target_timeline "'current'"
}

ensure_postgresql_conf

# Ensure runtime directories
mkdir -p /var/run/postgresql /var/log/postgresql
chown -R postgres:postgres /var/run/postgresql /var/log/postgresql

POSTGRES_PID=""
REPMGRD_PID=""

cleanup() {
    echo "[standby] Received termination signal. Stopping repmgrd and postgres..."
    if [ -n "$REPMGRD_PID" ] && kill -0 "$REPMGRD_PID" 2>/dev/null; then
        echo "[standby] Stopping repmgrd (PID $REPMGRD_PID)..."
        kill -TERM "$REPMGRD_PID" 2>/dev/null || true
        wait "$REPMGRD_PID" 2>/dev/null || true
    fi
    if [ -n "$POSTGRES_PID" ] && kill -0 "$POSTGRES_PID" 2>/dev/null; then
        echo "[standby] Stopping postgres (PID $POSTGRES_PID)..."
        gosu postgres "$PG_BIN/pg_ctl" -D "$PGDATA" -m fast stop || kill -TERM "$POSTGRES_PID" 2>/dev/null || true
        wait "$POSTGRES_PID" 2>/dev/null || true
    fi
    rm -f /var/run/postgresql/repmgrd.pid
    echo "[standby] Clean shutdown finished."
    exit 0
}

trap cleanup SIGTERM SIGINT SIGHUP SIGQUIT

# Start postgres in background
echo "[standby] Starting postgres server..."
gosu postgres "$PG_BIN/postgres" -D "$PGDATA" -c statement_timeout=10000 &
POSTGRES_PID=$!

# Wait until postgres is ready to accept connections
echo "[standby] Waiting for postgres to become ready..."
until gosu postgres "$PG_BIN/pg_isready" -h 127.0.0.1 -p 5432 >/dev/null 2>&1; do
    if ! kill -0 "$POSTGRES_PID" 2>/dev/null; then
        echo "[standby] ERROR: postgres failed to start."
        exit 1
    fi
    sleep 1
done
echo "[standby] Postgres is ready."

configure_wal_g() {
    : "${WALG_S3_PREFIX:?WALG_S3_PREFIX must be set}"
    : "${WALG_LIBSODIUM_KEY:?WALG_LIBSODIUM_KEY must be set}"
    command -v wal-g >/dev/null 2>&1 || { echo "[standby] ERROR: wal-g binary is missing." >&2; exit 1; }

    gosu postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres <<'SQL'
ALTER SYSTEM SET archive_command = 'wal-g wal-push %p';
ALTER SYSTEM SET restore_command = 'wal-g wal-fetch %f %p';
ALTER SYSTEM SET archive_timeout = '60s';
ALTER SYSTEM SET wal_compression = 'on';
SQL
    gosu postgres "$PG_BIN/pg_ctl" -D "$PGDATA" reload
}

echo "[standby] Configuring encrypted WAL-G archiving..."
configure_wal_g

# Ensure standby node is registered in repmgr metadata
RECOVERY_STATE=$(gosu postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT pg_is_in_recovery();" | tr -d '[:space:]')
if [[ "$RECOVERY_STATE" == "t" ]]; then
    if ! gosu postgres env PGPASSWORD="$REPMGR_PASSWORD" repmgr -f "$REPMGR_CONF" standby register --force; then
        echo "[standby] ERROR: repmgr standby registration failed; refusing to start the HA supervisor."
        exit 1
    fi
elif [[ "$RECOVERY_STATE" == "f" ]]; then
    echo "[standby] Node is already promoted; registering it as the current primary."
    if ! gosu postgres env PGPASSWORD="$REPMGR_PASSWORD" repmgr -f "$REPMGR_CONF" primary register --force; then
        echo "[standby] ERROR: promoted primary registration failed; refusing to start the HA supervisor."
        exit 1
    fi
else
    echo "[standby] ERROR: could not determine recovery state; refusing to start the HA supervisor."
    exit 1
fi

# Start repmgrd daemon in background
echo "[standby] Starting repmgrd daemon..."
rm -f /var/run/postgresql/repmgrd.pid
gosu postgres "$PG_BIN/repmgrd" -f "$REPMGR_CONF" --daemonize=false --pid-file /var/run/postgresql/repmgrd.pid --log-level INFO &
REPMGRD_PID=$!

echo "[standby] Postgres (PID $POSTGRES_PID) and repmgrd (PID $REPMGRD_PID) running. Entering supervision loop..."

while kill -0 "$POSTGRES_PID" 2>/dev/null; do
    if [ -n "$REPMGRD_PID" ] && ! kill -0 "$REPMGRD_PID" 2>/dev/null; then
        echo "[standby] WARNING: repmgrd exited unexpectedly. Restarting repmgrd..."
        rm -f /var/run/postgresql/repmgrd.pid
        gosu postgres "$PG_BIN/repmgrd" -f "$REPMGR_CONF" --daemonize=false --pid-file /var/run/postgresql/repmgrd.pid --log-level INFO &
        REPMGRD_PID=$!
    fi
    sleep 2
done

wait "$POSTGRES_PID"

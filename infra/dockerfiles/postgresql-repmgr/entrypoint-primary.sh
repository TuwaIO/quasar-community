#!/bin/bash
set -e

PGDATA="${PGDATA:-/var/lib/postgresql/data}"
REPMGR_CONF="/etc/repmgr.conf"
PG_BIN="/usr/lib/postgresql/16/bin"
SETUP_SENTINEL="$PGDATA/.repmgr_setup_complete"

# Ensure WAL archive directory exists on every boot
mkdir -p /var/lib/postgresql/wal_archive
chown postgres:postgres /var/lib/postgresql/wal_archive

write_repmgr_conf() {
    cat > "$REPMGR_CONF" <<CONF
node_id=${REPMGR_NODE_ID:-1}
node_name='${REPMGR_NODE_NAME:-postgresql-primary}'
conninfo='host=${REPMGR_NODE_NETWORK_NAME:-postgresql-primary} port=5432 user=repmgr dbname=repmgr password=${REPMGR_PASSWORD}'
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

if [ "${REPMGR_ROLE:-primary}" = "standby" ]; then
    echo "[primary-as-standby] Starting node in standby mode, cloning from ${REPMGR_PRIMARY_HOST:-postgresql-standby}..."
    write_repmgr_conf
    rm -rf "${PGDATA:?}"/* "${PGDATA:?}"/.* 2>/dev/null || true

    gosu postgres env PGPASSWORD="$REPMGR_PASSWORD" repmgr \
        -h "${REPMGR_PRIMARY_HOST:-postgresql-standby}" \
        -p "${REPMGR_PRIMARY_PORT:-5432}" \
        -U repmgr \
        -d repmgr \
        -f "$REPMGR_CONF" \
        standby clone --fast-checkpoint --force

    gosu postgres "$PG_BIN/pg_ctl" -D "$PGDATA" -w start
    gosu postgres env PGPASSWORD="$REPMGR_PASSWORD" repmgr -f "$REPMGR_CONF" standby register --force || true
    gosu postgres "$PG_BIN/pg_ctl" -D "$PGDATA" -w stop
    echo "[primary-as-standby] Standby registration complete. Starting supervised postgres..."
elif [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "[primary] First boot — initializing cluster..."

    # Initialize data directory as postgres user
    PWFILE=$(mktemp)
    echo "$POSTGRES_PASSWORD" > "$PWFILE"
    chown postgres:postgres "$PWFILE"
    gosu postgres "$PG_BIN/initdb" -D "$PGDATA" --username="$POSTGRES_USER" --pwfile="$PWFILE"
    rm -f "$PWFILE"

    # Configure pg_hba.conf BEFORE starting postgres
    cat >> "$PGDATA/pg_hba.conf" <<HBA
host    all         all         172.16.0.0/12   scram-sha-256
host    replication repmgr      172.16.0.0/12   scram-sha-256
host    repmgr      repmgr      172.16.0.0/12   scram-sha-256
HBA

    # Configure postgresql.conf
    cat >> "$PGDATA/postgresql.conf" <<PGCONF
listen_addresses = '*'
password_encryption = scram-sha-256
wal_level = replica
max_wal_senders = 10
max_replication_slots = 10
wal_keep_size = 2048MB
hot_standby = on
archive_mode = on
archive_command = 'wal-g wal-push %p'
restore_command = 'wal-g wal-fetch %f %p'
archive_timeout = '60s'
wal_compression = 'on'
shared_preload_libraries = 'repmgr'
PGCONF

    # Start postgres temporarily for setup
    gosu postgres "$PG_BIN/pg_ctl" -D "$PGDATA" -w start

    # Create application DB, repmgr user and DB
    gosu postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres <<SQL
CREATE DATABASE "${POSTGRES_DB}";
CREATE USER repmgr WITH SUPERUSER REPLICATION LOGIN PASSWORD '${REPMGR_PASSWORD}';
CREATE DATABASE repmgr OWNER repmgr;
SQL

    write_repmgr_conf

    # Register primary node
    gosu postgres env PGPASSWORD="$REPMGR_PASSWORD" repmgr -f "$REPMGR_CONF" primary register --force

    # Mark setup as complete
    touch "$SETUP_SENTINEL"
    chown postgres:postgres "$SETUP_SENTINEL"

    # Stop temporary instance and hand off to permanent supervised process
    gosu postgres "$PG_BIN/pg_ctl" -D "$PGDATA" -w stop
    echo "[primary] Initialization complete. Starting supervised postgres and repmgrd..."

elif [ ! -f "$SETUP_SENTINEL" ]; then
    echo "[primary] Data dir exists but setup incomplete — completing setup..."

    # pg_hba.conf may already have our entries; add only if missing
    if ! grep -q "repmgr" "$PGDATA/pg_hba.conf"; then
        cat >> "$PGDATA/pg_hba.conf" <<HBA
host    all         all         172.16.0.0/12   scram-sha-256
host    replication repmgr      172.16.0.0/12   scram-sha-256
host    repmgr      repmgr      172.16.0.0/12   scram-sha-256
HBA
    fi

    # postgresql.conf: add missing settings
    if ! grep -q "shared_preload_libraries" "$PGDATA/postgresql.conf"; then
        cat >> "$PGDATA/postgresql.conf" <<PGCONF
listen_addresses = '*'
password_encryption = scram-sha-256
wal_level = replica
max_wal_senders = 10
max_replication_slots = 10
wal_keep_size = 2048MB
hot_standby = on
archive_mode = on
archive_command = 'wal-g wal-push %p'
restore_command = 'wal-g wal-fetch %f %p'
archive_timeout = '60s'
wal_compression = 'on'
shared_preload_libraries = 'repmgr'
PGCONF
    fi

    write_repmgr_conf

    # Start postgres temporarily
    gosu postgres "$PG_BIN/pg_ctl" -D "$PGDATA" -w start

    # Create missing objects idempotently
    gosu postgres psql -U "$POSTGRES_USER" -c "CREATE DATABASE \"${POSTGRES_DB}\";" 2>/dev/null || true
    gosu postgres psql -U "$POSTGRES_USER" -c "CREATE USER repmgr WITH SUPERUSER REPLICATION LOGIN PASSWORD '${REPMGR_PASSWORD}';" 2>/dev/null || true
    gosu postgres psql -U "$POSTGRES_USER" -c "CREATE DATABASE repmgr OWNER repmgr;" 2>/dev/null || true

    # Register primary node
    gosu postgres env PGPASSWORD="$REPMGR_PASSWORD" repmgr -f "$REPMGR_CONF" primary register --force

    # Mark setup as complete
    touch "$SETUP_SENTINEL"
    chown postgres:postgres "$SETUP_SENTINEL"

    gosu postgres "$PG_BIN/pg_ctl" -D "$PGDATA" -w stop
    echo "[primary] Recovery setup complete. Starting supervised postgres and repmgrd..."

else
    echo "[primary] Restarting existing cluster..."
    if [ "${REPMGR_ROLE:-primary}" = "primary" ] && [ -f "$PGDATA/standby.signal" ]; then
        echo "[primary] Promoting existing standby data volume to primary (removing standby.signal)..."
        rm -f "$PGDATA/standby.signal"
    fi
    write_repmgr_conf
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
    echo "[primary] Received termination signal. Stopping repmgrd and postgres..."
    if [ -n "$REPMGRD_PID" ] && kill -0 "$REPMGRD_PID" 2>/dev/null; then
        echo "[primary] Stopping repmgrd (PID $REPMGRD_PID)..."
        kill -TERM "$REPMGRD_PID" 2>/dev/null || true
        wait "$REPMGRD_PID" 2>/dev/null || true
    fi
    if [ -n "$POSTGRES_PID" ] && kill -0 "$POSTGRES_PID" 2>/dev/null; then
        echo "[primary] Stopping postgres (PID $POSTGRES_PID)..."
        gosu postgres "$PG_BIN/pg_ctl" -D "$PGDATA" -m fast stop || kill -TERM "$POSTGRES_PID" 2>/dev/null || true
        wait "$POSTGRES_PID" 2>/dev/null || true
    fi
    rm -f /var/run/postgresql/repmgrd.pid
    echo "[primary] Clean shutdown finished."
    exit 0
}

trap cleanup SIGTERM SIGINT SIGHUP SIGQUIT

# Start postgres in background
echo "[primary] Starting postgres server..."
gosu postgres "$PG_BIN/postgres" -D "$PGDATA" -c statement_timeout=10000 &
POSTGRES_PID=$!

# Wait until postgres is ready to accept connections
echo "[primary] Waiting for postgres to become ready..."
until gosu postgres "$PG_BIN/pg_isready" -h 127.0.0.1 -p 5432 >/dev/null 2>&1; do
    if ! kill -0 "$POSTGRES_PID" 2>/dev/null; then
        echo "[primary] ERROR: postgres failed to start."
        exit 1
    fi
    sleep 1
done
echo "[primary] Postgres is ready."

configure_wal_g() {
    : "${WALG_S3_PREFIX:?WALG_S3_PREFIX must be set}"
    : "${WALG_LIBSODIUM_KEY:?WALG_LIBSODIUM_KEY must be set}"
    command -v wal-g >/dev/null 2>&1 || { echo "[primary] ERROR: wal-g binary is missing." >&2; exit 1; }

    gosu postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres <<'SQL'
ALTER SYSTEM SET archive_command = 'wal-g wal-push %p';
ALTER SYSTEM SET restore_command = 'wal-g wal-fetch %f %p';
ALTER SYSTEM SET archive_timeout = '60s';
ALTER SYSTEM SET wal_compression = 'on';
SQL
    gosu postgres "$PG_BIN/pg_ctl" -D "$PGDATA" reload
}

if [ "${REPMGR_ROLE:-primary}" != "standby" ]; then
    echo "[primary] Configuring encrypted WAL-G archiving..."
    configure_wal_g

    # Ensure primary node is registered in repmgr metadata
    if ! gosu postgres env PGPASSWORD="$REPMGR_PASSWORD" repmgr -f "$REPMGR_CONF" primary register --force; then
        echo "[primary] ERROR: repmgr primary registration failed; refusing to start the HA supervisor."
        exit 1
    fi
else
    echo "[primary-as-standby] Registering standby in repmgr metadata..."
    gosu postgres env PGPASSWORD="$REPMGR_PASSWORD" repmgr -f "$REPMGR_CONF" standby register --force || true
fi

# Start repmgrd daemon in background
echo "[primary] Starting repmgrd daemon..."
rm -f /var/run/postgresql/repmgrd.pid
gosu postgres "$PG_BIN/repmgrd" -f "$REPMGR_CONF" --daemonize=false --pid-file /var/run/postgresql/repmgrd.pid --log-level INFO &
REPMGRD_PID=$!

echo "[primary] Postgres (PID $POSTGRES_PID) and repmgrd (PID $REPMGRD_PID) running. Entering supervision loop..."

while kill -0 "$POSTGRES_PID" 2>/dev/null; do
    if [ -n "$REPMGRD_PID" ] && ! kill -0 "$REPMGRD_PID" 2>/dev/null; then
        echo "[primary] WARNING: repmgrd exited unexpectedly. Restarting repmgrd..."
        rm -f /var/run/postgresql/repmgrd.pid
        gosu postgres "$PG_BIN/repmgrd" -f "$REPMGR_CONF" --daemonize=false --pid-file /var/run/postgresql/repmgrd.pid --log-level INFO &
        REPMGRD_PID=$!
    fi
    sleep 2
done

wait "$POSTGRES_PID"

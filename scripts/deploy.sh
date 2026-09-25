#!/usr/bin/env bash
# =============================================================================
# Quasar Deploy Script
# Executed on the target server by the CI/CD pipeline via SSH.
#
# Required environment variables (injected by appleboy/ssh-action):
#   PROJECT_PATH      - Absolute path to the project root on the server
#   ENV_SUFFIX        - "prod" or "stg"
#   REPO_OWNER        - Lowercase GitHub org/user name
#   BRANCH_NAME       - Git branch being deployed (main / staging)
#   QUASAR_IMAGE_TAG  - Docker image tag (git SHA), staging only
#   QUASAR_APP_IMAGE  - Signed ghcr.io application image@sha256 reference, production only
#   QUASAR_NEST_IMAGE - Signed ghcr.io Nest image@sha256 reference, production only
#   QUASAR_MIGRATE_IMAGE - Signed ghcr.io migration image@sha256 reference, production only
#   GHCR_PAT          - GitHub Personal Access Token for GHCR login
#   ACTOR             - GitHub actor name triggering the deploy
# =============================================================================
set -euo pipefail

export REPO_OWNER
export QUASAR_IMAGE_TAG
export QUASAR_APP_IMAGE="${QUASAR_APP_IMAGE:-}"
export QUASAR_NEST_IMAGE="${QUASAR_NEST_IMAGE:-}"
export QUASAR_MIGRATE_IMAGE="${QUASAR_MIGRATE_IMAGE:-}"

COMPOSE_CMD="docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.${ENV_SUFFIX}.yml"
COMPOSE_PROJECT_FILTER=(--filter label=com.docker.compose.project=quasar)

echo "Starting deployment to ${ENV_SUFFIX} environment..."

cd "$PROJECT_PATH" || { echo "ERROR: Project path '${PROJECT_PATH}' not found"; exit 1; }

require_digest_reference() {
  local image_reference=$1
  if [[ ! "$image_reference" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]]; then
    echo "ERROR: Production application images must use a full ghcr.io image@sha256 reference."
    exit 1
  fi
}

if [ "$ENV_SUFFIX" = "prod" ]; then
  require_digest_reference "$QUASAR_APP_IMAGE"
  require_digest_reference "$QUASAR_NEST_IMAGE"
  require_digest_reference "$QUASAR_MIGRATE_IMAGE"
fi

if ! $COMPOSE_CMD config >/dev/null; then
  echo "ERROR: Invalid or unsupported Docker Compose configuration."
  exit 1
fi

echo "$GHCR_PAT" | docker login ghcr.io -u "$ACTOR" --password-stdin

# ---------------------------------------------------------------------------
# Helper: cleanup_redis
# Synchronously removes orphaned bull:{outbox}:repeat:* keys that accumulate
# in Redis after each deploy (BullMQ upsertJobScheduler leaves TTL=-1 keys).
# Safe to call repeatedly — it skips the two known legitimate scheduler keys.
# ---------------------------------------------------------------------------
cleanup_redis() {
  echo "[Redis] Starting orphaned key cleanup..."
  local REDIS_PASS
  REDIS_PASS=$(grep -m1 '^REDIS_API_PASSWORD=' .env | cut -d= -f2- | tr -d '"' || true)

  for i in 1 2 3 4 5 6; do
    local NODE
    NODE=$(docker ps -q "${COMPOSE_PROJECT_FILTER[@]}" --filter "name=redis-api-node-${i}" | head -n1)
    [ -z "$NODE" ] && continue

    docker exec -e REDIS_PASS="$REDIS_PASS" "$NODE" sh -c '
      KEYS=$(redis-cli -a "$REDIS_PASS" --scan --pattern "bull:{outbox}:repeat:*" 2>/dev/null \
        | grep -v "unique-outbox-processor-job\|unique-outbox-cleanup-job" || true)
      if [ -z "$KEYS" ]; then exit 0; fi
      echo "$KEYS" | xargs -n 100 | while read -r batch; do
        [ -n "$batch" ] && redis-cli -c -a "$REDIS_PASS" DEL $batch >/dev/null 2>&1 || true
        sleep 0.05
      done
    '
  done
  echo "[Redis] Orphaned key cleanup complete."
}

# ---------------------------------------------------------------------------
# 1. Pull prebuilt application images & build Postgres (no prebuilt image in CI)
if [ -n "${QUASAR_APP_IMAGE:-}" ] && [ -n "${QUASAR_NEST_IMAGE:-}" ] && [ -n "${QUASAR_MIGRATE_IMAGE:-}" ]; then
  REQUIRED_IMAGES=(
    "$QUASAR_APP_IMAGE"
    "$QUASAR_NEST_IMAGE"
    "$QUASAR_MIGRATE_IMAGE"
  )
  echo "Pulling digest-pinned application images..."
else
  REQUIRED_IMAGES=(
    "ghcr.io/${REPO_OWNER}/quasar-app:${QUASAR_IMAGE_TAG}"
    "ghcr.io/${REPO_OWNER}/quasar-nest:${QUASAR_IMAGE_TAG}"
    "ghcr.io/${REPO_OWNER}/quasar-migrate:${QUASAR_IMAGE_TAG}"
  )
  echo "Pulling prebuilt application images for ${QUASAR_IMAGE_TAG}..."
fi

for IMAGE in "${REQUIRED_IMAGES[@]}"; do
  echo "Pulling image: $IMAGE..."
  docker pull "$IMAGE"
done

$COMPOSE_CMD pull quasar-app quasar-nest-api quasar-worker migrate || true

for IMAGE in "${REQUIRED_IMAGES[@]}"; do
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "ERROR: Required prebuilt image is not available locally: $IMAGE"
    exit 1
  fi
done
echo "All required prebuilt application images are available."

POSTGRES_INFRA_CHANGED=true
if [ -n "${PREVIOUS_DEPLOY_SHA:-}" ] \
  && git cat-file -e "${PREVIOUS_DEPLOY_SHA}^{commit}" 2>/dev/null \
  && git diff --quiet "$PREVIOUS_DEPLOY_SHA" HEAD -- \
    infra/dockerfiles/postgresql-repmgr \
    infra/scripts/wal-g-pitr-restore.sh; then
  POSTGRES_INFRA_CHANGED=false
fi

if [ "$POSTGRES_INFRA_CHANGED" = true ] \
  || ! docker image inspect quasar/postgresql-repmgr:16 >/dev/null 2>&1; then
  echo "Building local PostgreSQL image (infrastructure files changed or image is missing)..."
  $COMPOSE_CMD build postgresql-primary postgresql-standby wal-g-backup
else
  echo "PostgreSQL infrastructure is unchanged; reusing the existing local image."
fi

# ---------------------------------------------------------------------------
# 2. Ensure database infrastructure is healthy before migrations
# ---------------------------------------------------------------------------
echo "Ensuring database infrastructure is running..."
set +e
UP_ERROR=$(${COMPOSE_CMD} up -d --no-build postgresql-primary postgresql-standby pgbouncer 2>&1)
UP_STATUS=$?
set -e
echo "$UP_ERROR"
if [ "$UP_STATUS" -ne 0 ]; then
  echo "ERROR: Failed to start database infrastructure. Printing logs..."
  $COMPOSE_CMD logs pgbouncer || true
  $COMPOSE_CMD logs postgresql-primary || true
  $COMPOSE_CMD logs postgresql-standby || true
  exit "$UP_STATUS"
fi

# Wait for pgbouncer to be healthy
echo "Waiting for pgbouncer to be healthy..."
for i in $(seq 1 30); do
  HEALTH_STATUS=$(docker inspect \
    --format='{{json .State.Health.Status}}' \
    "$(${COMPOSE_CMD} ps -q pgbouncer)" 2>/dev/null || echo '"unknown"')
  if [ "$HEALTH_STATUS" = '"healthy"' ]; then
    echo "pgbouncer is healthy!"
    break
  fi
  echo "pgbouncer is ${HEALTH_STATUS}, waiting 2s... (${i}/30)"
  sleep 2
  if [ "$i" -eq 30 ]; then
    echo "ERROR: pgbouncer failed to become healthy in time!"
    $COMPOSE_CMD logs pgbouncer
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# 3. Run database migrations & idempotent seed (Payload CMS schema authority)
# ---------------------------------------------------------------------------
echo "Running database migrations..."
$COMPOSE_CMD run --rm --pull never migrate

echo "Running idempotent database seed (distributed lock protected)..."
$COMPOSE_CMD run --rm --pull never migrate pnpm --filter @tuwaio/quasar seed


# ---------------------------------------------------------------------------
# 4. Bring up infrastructure services
# ---------------------------------------------------------------------------
echo "Updating infrastructure services..."
set +e
UP_ERROR=$(${COMPOSE_CMD} up -d --no-build --remove-orphans \
  postgresql-primary postgresql-standby pgbouncer \
  pg-backup wal-g-backup \
  redis-api-node-1 redis-api-node-2 redis-api-node-3 \
  redis-api-node-4 redis-api-node-5 redis-api-node-6 \
  redis-api-cluster-creator \
  redis-ui-node-1 redis-ui-node-2 \
  redis-exporter-api redis-exporter-ui pgbouncer-exporter \
  prometheus grafana loki promtail cadvisor node-exporter blackbox-exporter \
  cloudflared cloudflared-2 alertmanager traefik 2>&1)
UP_STATUS=$?
set -e
echo "$UP_ERROR"
if [ "$UP_STATUS" -ne 0 ]; then
  echo "ERROR: Failed to update infrastructure services. Exiting without stopping the running stack."
  exit "$UP_STATUS"
fi

wait_for_database_service() {
  local SERVICE=$1
  local CONTAINER_ID
  local HEALTH_STATUS

  for i in $(seq 1 30); do
    CONTAINER_ID=$(${COMPOSE_CMD} ps -q "$SERVICE" 2>/dev/null || true)
    HEALTH_STATUS=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
      "$CONTAINER_ID" 2>/dev/null || echo 'missing')
    if [ "$HEALTH_STATUS" = "healthy" ]; then
      echo "${SERVICE} is healthy."
      return 0
    fi
    if [ "$HEALTH_STATUS" = "unhealthy" ] || [ "$HEALTH_STATUS" = "missing" ]; then
      echo "ERROR: ${SERVICE} is ${HEALTH_STATUS}. Printing recent logs..."
      $COMPOSE_CMD logs --tail=100 "$SERVICE" || true
      return 1
    fi
    echo "${SERVICE} is ${HEALTH_STATUS}; waiting 2s... (${i}/30)"
    sleep 2
  done

  echo "ERROR: ${SERVICE} did not become healthy in time. Printing recent logs..."
  $COMPOSE_CMD logs --tail=100 "$SERVICE" || true
  return 1
}

for DATABASE_SERVICE in postgresql-primary postgresql-standby pgbouncer; do
  wait_for_database_service "$DATABASE_SERVICE" || exit 1
done

# These exporters are prerequisites for the host, container, and availability
# dashboards. They do not expose Docker healthchecks, so verify their process
# state explicitly before rolling out the application services.
check_monitoring_service_running() {
  local SERVICE=$1
  local CONTAINER_ID
  local CONTAINER_STATE

  CONTAINER_ID=$($COMPOSE_CMD ps -q "$SERVICE" 2>/dev/null || true)
  if [ -z "$CONTAINER_ID" ]; then
    echo "ERROR: Monitoring service ${SERVICE} has no container after bootstrap."
    $COMPOSE_CMD logs --tail=80 "$SERVICE" || true
    return 1
  fi

  CONTAINER_STATE=$(docker inspect --format='{{.State.Status}}' "$CONTAINER_ID" 2>/dev/null || echo 'missing')
  if [ "$CONTAINER_STATE" != "running" ]; then
    echo "ERROR: Monitoring service ${SERVICE} is ${CONTAINER_STATE}, expected running."
    $COMPOSE_CMD logs --tail=80 "$SERVICE" || true
    return 1
  fi

  echo "Monitoring service ${SERVICE} is running."
}

for MONITORING_SERVICE in prometheus cadvisor node-exporter blackbox-exporter; do
  check_monitoring_service_running "$MONITORING_SERVICE" || exit 1
done

# ---------------------------------------------------------------------------
# 5. Rolling update for application services
# ---------------------------------------------------------------------------
echo "Deploying application services with rolling update..."

# check_healthy: 2-phase container health verification.
#   Phase 1: wait for container to be in "running" state (max 30s).
#   Phase 2: deep health check via curl inside the container (30x5s = 150s).
#   Fallback: Docker inspect healthcheck status if curl fails.
check_healthy() {
  local CNAME=$1
  local PORT=$2
  local HEALTH_PATH=$3
  local MAX_ATTEMPTS=30
  local SLEEP_INTERVAL=5

  echo "Verifying health of new container ${CNAME} (max ${MAX_ATTEMPTS}x${SLEEP_INTERVAL}s = $((MAX_ATTEMPTS * SLEEP_INTERVAL))s)..."

  # Phase 1: Wait for "running" state (max 30s)
  for i in $(seq 1 10); do
    CONTAINER_STATE=$(docker inspect --format='{{.State.Status}}' "$CNAME" 2>/dev/null || echo 'missing')
    if [ "$CONTAINER_STATE" = "running" ]; then break; fi
    if [ "$CONTAINER_STATE" = "exited" ] || [ "$CONTAINER_STATE" = "dead" ]; then
      echo "ERROR: Container ${CNAME} is ${CONTAINER_STATE}!"
      docker logs --tail 80 "$CNAME"
      return 1
    fi
    echo "Waiting for container ${CNAME} to start... (${i}/10, state=${CONTAINER_STATE})"
    sleep 3
  done

  # Phase 2: Wait for application readiness
  for j in $(seq 1 $MAX_ATTEMPTS); do
    local HEALTH_RES HTTP_CODE HEALTH_BODY
    HEALTH_RES=$(docker exec -T "$CNAME" curl -s -w "\n%{http_code}" --max-time 5 \
      "http://127.0.0.1:${PORT}${HEALTH_PATH}" 2>/dev/null || echo -e "curl_error\n000")
    HTTP_CODE=$(echo "$HEALTH_RES" | tail -n 1)
    HEALTH_BODY=$(echo "$HEALTH_RES" | sed '$d')

    if [ "$HTTP_CODE" = "200" ]; then
      echo "Container ${CNAME} is healthy (curl 200)!"
      return 0
    fi
    echo "Waiting for ${CNAME} health... (${j}/${MAX_ATTEMPTS}, HTTP=${HTTP_CODE}, Body=${HEALTH_BODY})"

    # Fallback: Docker's own healthcheck
    STATUS=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CNAME" 2>/dev/null || echo 'missing')
    if [ "$STATUS" = "healthy" ]; then echo "Container ${CNAME} is healthy (docker inspect)!"; return 0; fi
    if [ "$STATUS" = "unhealthy" ]; then
      echo "ERROR: Container ${CNAME} is unhealthy!"
      docker logs --tail 80 "$CNAME"
      return 1
    fi

    sleep $SLEEP_INTERVAL
  done

  echo "ERROR: Container ${CNAME} failed health check after $((MAX_ATTEMPTS * SLEEP_INTERVAL))s!"
  docker logs --tail 80 "$CNAME"
  return 1
}

rollout_service() {
  local SERVICE=$1
  local PORT=$2
  local HEALTH_PATH=$3

  # Auto-detect desired replica count from docker-compose config
  local DESIRED
  DESIRED=$(${COMPOSE_CMD} config --format json | jq -r ".services.\"${SERVICE}\".deploy.replicas // 1")
  local ROLLING_SCALE=$((DESIRED + 1))
  echo "Starting rolling update for service: ${SERVICE} (desired replicas: ${DESIRED})..."

  # Step 1: FORCE-CAP — kill excess containers from past failed deploys
  local RUNNING_CONTAINERS RUNNING_COUNT
  RUNNING_CONTAINERS=$(docker ps "${COMPOSE_PROJECT_FILTER[@]}" --filter "label=com.docker.compose.service=${SERVICE}" --format "{{.Names}}" | sort)
  RUNNING_COUNT=$(echo "$RUNNING_CONTAINERS" | grep -c . || true)

  if [ "$RUNNING_COUNT" -gt "$DESIRED" ]; then
    echo "WARNING: Found ${RUNNING_COUNT} containers, expected ${DESIRED}. Force-capping..."
    local EXCESS
    EXCESS=$(echo "$RUNNING_CONTAINERS" | tail -n +"$((DESIRED + 1))")
    for EXCESS_C in $EXCESS; do
      echo "Removing excess container: ${EXCESS_C}"
      docker stop "$EXCESS_C" 2>/dev/null || true
      docker rm -f "$EXCESS_C" 2>/dev/null || true
    done
  fi

  # Remove stopped/dead containers for this service
  local DEAD_CONTAINERS
  DEAD_CONTAINERS=$(docker ps -a "${COMPOSE_PROJECT_FILTER[@]}" \
    --filter "label=com.docker.compose.service=${SERVICE}" \
    --filter "status=exited" --filter "status=dead" --filter "status=created" \
    --format "{{.Names}}")
  for DC in $DEAD_CONTAINERS; do
    echo "Removing dead container: ${DC}"
    docker rm -f "$DC" 2>/dev/null || true
  done

  # Step 2: Get current live containers
  local SNAPSHOT_NAMES CURRENT_COUNT
  SNAPSHOT_NAMES=$(docker ps "${COMPOSE_PROJECT_FILTER[@]}" --filter "label=com.docker.compose.service=${SERVICE}" --format "{{.Names}}" | sort)
  CURRENT_COUNT=$(echo -n "$SNAPSHOT_NAMES" | grep -c . || true)

  # Cold start: no containers running
  if [ "$CURRENT_COUNT" -eq 0 ]; then
    echo "No active containers found for ${SERVICE}. Cold start with ${DESIRED} replicas..."
    ${COMPOSE_CMD} up -d --no-build --no-deps --scale "${SERVICE}=${DESIRED}" "$SERVICE"
    local NEW_CONTAINERS
    NEW_CONTAINERS=$(docker ps "${COMPOSE_PROJECT_FILTER[@]}" --filter "label=com.docker.compose.service=${SERVICE}" --format "{{.Names}}")
    for NC in $NEW_CONTAINERS; do
      check_healthy "$NC" "$PORT" "$HEALTH_PATH" || exit 1
    done
    return 0
  fi

  # Step 3: Rolling update — replace containers one by one
  for CNAME in $SNAPSHOT_NAMES; do
    echo "Rolling container: ${CNAME}"

    local BEFORE_IDS
    BEFORE_IDS=$(docker ps -q "${COMPOSE_PROJECT_FILTER[@]}" --filter "label=com.docker.compose.service=${SERVICE}" | sort)

    # Start one extra container before removing the old one. This keeps the
    # current container available if the new image fails to become healthy.
    ${COMPOSE_CMD} up -d --no-build --no-deps --no-recreate --scale "${SERVICE}=${ROLLING_SCALE}" "$SERVICE"

    local AFTER_IDS NEW_IDS NEW_ID
    AFTER_IDS=$(docker ps -q "${COMPOSE_PROJECT_FILTER[@]}" --filter "label=com.docker.compose.service=${SERVICE}" | sort)
    NEW_IDS=$(comm -13 <(echo "$BEFORE_IDS") <(echo "$AFTER_IDS"))

    if [ -z "$NEW_IDS" ]; then
      echo "ERROR: Could not find new container for ${SERVICE} after rolling ${CNAME}"
      echo "BEFORE_IDS: ${BEFORE_IDS}"
      echo "AFTER_IDS:  ${AFTER_IDS}"
      docker ps "${COMPOSE_PROJECT_FILTER[@]}" --filter "label=com.docker.compose.service=${SERVICE}"
      exit 1
    fi

    for NEW_ID in $NEW_IDS; do
      local NEW_CNAME
      NEW_CNAME=$(docker inspect --format='{{.Name}}' "$NEW_ID" | sed 's|^/||')
      echo "New container: ${NEW_CNAME} (${NEW_ID})"
      check_healthy "$NEW_CNAME" "$PORT" "$HEALTH_PATH" || exit 1
    done

    # Only remove the old container after every newly-created container is healthy.
    docker stop "$CNAME"
    docker rm -f "$CNAME"
  done

  # Step 4: Final cap — ensure exactly DESIRED containers are running
  local FINAL_COUNT
  FINAL_COUNT=$(docker ps "${COMPOSE_PROJECT_FILTER[@]}" --filter "label=com.docker.compose.service=${SERVICE}" --format "{{.Names}}" | grep -c . || true)
  if [ "$FINAL_COUNT" -gt "$DESIRED" ]; then
    echo "Post-rollout cap: ${FINAL_COUNT} > ${DESIRED}, trimming..."
    local EXTRAS
    EXTRAS=$(docker ps "${COMPOSE_PROJECT_FILTER[@]}" --filter "label=com.docker.compose.service=${SERVICE}" --format "{{.Names}}" | sort | tail -n +"$((DESIRED + 1))")
    for E in $EXTRAS; do
      docker stop "$E" 2>/dev/null || true
      docker rm -f "$E" 2>/dev/null || true
    done
  fi
  echo "Rolling update for ${SERVICE} completed. Final replicas: ${DESIRED}"
}

# rollout_worker: rolling update for the worker using the Nest health endpoint.
rollout_worker() {
  local SERVICE=$1

  local DESIRED
  DESIRED=$(${COMPOSE_CMD} config --format json | jq -r ".services.\"${SERVICE}\".deploy.replicas // 1")
  local ROLLING_SCALE=$((DESIRED + 1))
  echo "Starting rolling update for worker: ${SERVICE} (desired replicas: ${DESIRED})..."

  local RUNNING_CONTAINERS RUNNING_COUNT
  RUNNING_CONTAINERS=$(docker ps "${COMPOSE_PROJECT_FILTER[@]}" --filter "label=com.docker.compose.service=${SERVICE}" --format "{{.Names}}" | sort)
  RUNNING_COUNT=$(echo "$RUNNING_CONTAINERS" | grep -c . || true)

  if [ "$RUNNING_COUNT" -gt "$DESIRED" ]; then
    echo "WARNING: Found ${RUNNING_COUNT} worker containers, expected ${DESIRED}. Force-capping..."
    local EXCESS
    EXCESS=$(echo "$RUNNING_CONTAINERS" | tail -n +"$((DESIRED + 1))")
    for EXCESS_C in $EXCESS; do
      docker stop "$EXCESS_C" 2>/dev/null || true
      docker rm -f "$EXCESS_C" 2>/dev/null || true
    done
  fi

  local DEAD_CONTAINERS
  DEAD_CONTAINERS=$(docker ps -a "${COMPOSE_PROJECT_FILTER[@]}" \
    --filter "label=com.docker.compose.service=${SERVICE}" \
    --filter "status=exited" --filter "status=dead" --filter "status=created" \
    --format "{{.Names}}")
  for DC in $DEAD_CONTAINERS; do
    docker rm -f "$DC" 2>/dev/null || true
  done

  local SNAPSHOT_NAMES CURRENT_COUNT
  SNAPSHOT_NAMES=$(docker ps "${COMPOSE_PROJECT_FILTER[@]}" --filter "label=com.docker.compose.service=${SERVICE}" --format "{{.Names}}" | sort)
  CURRENT_COUNT=$(echo -n "$SNAPSHOT_NAMES" | grep -c . || true)

  if [ "$CURRENT_COUNT" -eq 0 ]; then
    echo "No active worker containers for ${SERVICE}. Cold start..."
    ${COMPOSE_CMD} up -d --no-build --no-deps --scale "${SERVICE}=${DESIRED}" "$SERVICE"
    local NEW_CONTAINERS
    NEW_CONTAINERS=$(docker ps "${COMPOSE_PROJECT_FILTER[@]}" --filter "label=com.docker.compose.service=${SERVICE}" --format "{{.Names}}")
    for NC in $NEW_CONTAINERS; do
      check_healthy "$NC" "3001" "/v1/engine/monitoring/health" || exit 1
    done
    return 0
  fi

  for CNAME in $SNAPSHOT_NAMES; do
    echo "Rolling worker container: ${CNAME}"

    local BEFORE_IDS
    BEFORE_IDS=$(docker ps -q "${COMPOSE_PROJECT_FILTER[@]}" --filter "label=com.docker.compose.service=${SERVICE}" | sort)

    # Keep the old worker alive until the replacement passes its real healthcheck.
    ${COMPOSE_CMD} up -d --no-build --no-deps --no-recreate --scale "${SERVICE}=${ROLLING_SCALE}" "$SERVICE"

    local AFTER_IDS NEW_IDS NEW_ID
    AFTER_IDS=$(docker ps -q "${COMPOSE_PROJECT_FILTER[@]}" --filter "label=com.docker.compose.service=${SERVICE}" | sort)
    NEW_IDS=$(comm -13 <(echo "$BEFORE_IDS") <(echo "$AFTER_IDS"))

    if [ -z "$NEW_IDS" ]; then
      echo "ERROR: Could not find new worker container for ${SERVICE} after rolling ${CNAME}"
      exit 1
    fi

    for NEW_ID in $NEW_IDS; do
      local NEW_CNAME
      NEW_CNAME=$(docker inspect --format='{{.Name}}' "$NEW_ID" | sed 's|^/||')
      echo "New worker container: ${NEW_CNAME} (${NEW_ID})"
      check_healthy "$NEW_CNAME" "3001" "/v1/engine/monitoring/health" || exit 1
    done

    docker stop "$CNAME"
    docker rm -f "$CNAME"
  done

  local FINAL_COUNT
  FINAL_COUNT=$(docker ps "${COMPOSE_PROJECT_FILTER[@]}" --filter "label=com.docker.compose.service=${SERVICE}" --format "{{.Names}}" | grep -c . || true)
  if [ "$FINAL_COUNT" -gt "$DESIRED" ]; then
    local EXTRAS
    EXTRAS=$(docker ps "${COMPOSE_PROJECT_FILTER[@]}" --filter "label=com.docker.compose.service=${SERVICE}" --format "{{.Names}}" | sort | tail -n +"$((DESIRED + 1))")
    for E in $EXTRAS; do
      docker stop "$E" 2>/dev/null || true
      docker rm -f "$E" 2>/dev/null || true
    done
  fi
  echo "Rolling update for worker ${SERVICE} completed. Final replicas: ${DESIRED}"
}

rollout_service "quasar-nest-api" "3001" "/v1/engine/monitoring/health"
rollout_worker  "quasar-worker"
rollout_service "quasar-app"      "3000" "/api/health"

verify_running_image_reference() {
  local service=$1
  local expected_reference=$2
  local container
  local configured_reference

  for container in $(docker ps "${COMPOSE_PROJECT_FILTER[@]}" --filter "label=com.docker.compose.service=${service}" --format "{{.Names}}"); do
    configured_reference=$(docker inspect --format '{{.Config.Image}}' "$container")
    if [ "$configured_reference" != "$expected_reference" ]; then
      echo "ERROR: ${service} container ${container} uses ${configured_reference}, expected ${expected_reference}."
      exit 1
    fi
  done
}

if [ "$ENV_SUFFIX" = "prod" ]; then
  verify_running_image_reference "quasar-app" "$QUASAR_APP_IMAGE"
  verify_running_image_reference "quasar-nest-api" "$QUASAR_NEST_IMAGE"
  verify_running_image_reference "quasar-worker" "$QUASAR_NEST_IMAGE"
  echo "Verified all running production application containers use the approved digest references."
fi
cleanup_redis

echo "Cleaning up dangling Docker images..."
# The prune is host-wide: `-a` deletes every image no container uses, in every
# Compose project on this daemon. Another stack deploying on the same host
# holds its freshly pulled images unused between its `pull` and its `up`, and a
# prune in that window deletes them — its `up` then fails with "No such image".
# Such a stack takes this lock around that window.
#
# The prune waits for the lock detached, on the server: the CI runner holding
# this SSH session is billed by the minute and must not sit through the wait.
# stdin/stdout/stderr are all redirected, or the session would stay open.
DOCKER_IMAGE_LOCK=/var/lock/quasar-docker-images.lock
DOCKER_PRUNE_LOG=/tmp/quasar-docker-prune.log
if command -v flock >/dev/null 2>&1 && command -v setsid >/dev/null 2>&1; then
  setsid nohup flock -w 1800 "$DOCKER_IMAGE_LOCK" docker system prune -a -f \
    </dev/null >"$DOCKER_PRUNE_LOG" 2>&1 &
  echo "Prune runs in the background once ${DOCKER_IMAGE_LOCK} is free (log: ${DOCKER_PRUNE_LOG})."
else
  docker system prune -a -f
fi

echo "Deployment to ${ENV_SUFFIX} completed successfully."

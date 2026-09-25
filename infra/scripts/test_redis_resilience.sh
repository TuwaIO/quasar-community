#!/bin/sh
set -eu

# ==============================================================================
# Quasar Redis Resilience, Memory Pressure & Durability Test Suite
# ==============================================================================
# This script is a non-disruptive preflight. It verifies configured policies,
# current memory telemetry, AOF configuration, and a canary read/write. It intentionally does
# not force OOM, evict keys, or restart production Redis containers. Those
# destructive tests require an isolated environment and explicit operator approval.
# ==============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

REDIS_API_CONTAINER="${REDIS_API_CONTAINER:-}"
REDIS_UI_CONTAINER="${REDIS_UI_CONTAINER:-}"
REDIS_API_PASSWORD="${REDIS_API_PASSWORD:-}"
REDIS_UI_PASSWORD="${REDIS_UI_PASSWORD:-}"

if [ -z "${REDIS_API_CONTAINER}" ]; then
  REDIS_API_CONTAINER="$(docker ps --filter 'label=com.docker.compose.service=redis-api-node-1' --format '{{.Names}}' | head -n1 || true)"
fi
if [ -z "${REDIS_UI_CONTAINER}" ]; then
  REDIS_UI_CONTAINER="$(docker ps --filter 'label=com.docker.compose.service=redis-ui-node-1' --format '{{.Names}}' | head -n1 || true)"
fi

: "${REDIS_API_CONTAINER:?Could not find Redis API container; set REDIS_API_CONTAINER explicitly}"
: "${REDIS_UI_CONTAINER:?Could not find Redis UI container; set REDIS_UI_CONTAINER explicitly}"
: "${REDIS_API_PASSWORD:?REDIS_API_PASSWORD is required; refusing to use a fallback credential}"
: "${REDIS_UI_PASSWORD:?REDIS_UI_PASSWORD is required; refusing to use a fallback credential}"

api_redis() { docker exec -e "REDISCLI_AUTH=${REDIS_API_PASSWORD}" "${REDIS_API_CONTAINER}" redis-cli -c --no-auth-warning "$@"; }
ui_redis() { docker exec -e "REDISCLI_AUTH=${REDIS_UI_PASSWORD}" "${REDIS_UI_CONTAINER}" redis-cli --no-auth-warning "$@"; }

echo "${BLUE}====================================================================${NC}"
echo "${BLUE} Quasar Redis Resilience & Memory Pressure Test Suite${NC}"
echo "${BLUE}====================================================================${NC}"
echo "API Redis Container: ${REDIS_API_CONTAINER}"
echo "UI Redis Container:  ${REDIS_UI_CONTAINER}"
echo "Timestamp:           $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo ""

START_TIME=$(date +%s)

cleanup() {
  echo ""
  echo "${BLUE}[Cleanup] Flushing temporary test namespaces...${NC}"
  for key in $(api_redis --scan --pattern 'test:resilience:*'); do api_redis del "$key" >/dev/null; done
  for key in $(ui_redis --scan --pattern 'test:resilience:*'); do ui_redis del "$key" >/dev/null; done
  echo "${GREEN}[Cleanup] Temporary keys cleared.${NC}"
}
trap cleanup EXIT INT TERM

# ------------------------------------------------------------------------------
# 1. Verify Memory & Policy Configuration
# ------------------------------------------------------------------------------
echo "${YELLOW}[Test 1/4] Verifying Redis API memory capacity and noeviction policy...${NC}"
API_POLICY=$(api_redis config get maxmemory-policy | tail -n1)
API_MAXMEM=$(api_redis config get maxmemory | tail -n1)

echo "  API Redis maxmemory: ${API_MAXMEM} bytes (~$((API_MAXMEM / 1024 / 1024)) MB)"
echo "  API Redis policy:    ${API_POLICY}"

if [ "${API_POLICY}" != "noeviction" ]; then
  echo "${RED}✗ API Redis must be configured with maxmemory-policy noeviction, got: ${API_POLICY}${NC}"
  exit 1
fi
echo "${GREEN}✓ API Redis noeviction policy verified (Zero silent queue/quota loss).${NC}"

# ------------------------------------------------------------------------------
# 2. Verify UI Redis Configuration & LRU Policy
# ------------------------------------------------------------------------------
echo "${YELLOW}[Test 2/4] Verifying UI Redis memory capacity and allkeys-lru policy...${NC}"
UI_POLICY=$(ui_redis config get maxmemory-policy | tail -n1)
UI_MAXMEM=$(ui_redis config get maxmemory | tail -n1)

echo "  UI Redis maxmemory: ${UI_MAXMEM} bytes (~$((UI_MAXMEM / 1024 / 1024)) MB)"
echo "  UI Redis policy:    ${UI_POLICY}"

if [ "${UI_POLICY}" != "allkeys-lru" ]; then
  echo "${RED}✗ UI Redis must be configured with maxmemory-policy allkeys-lru, got: ${UI_POLICY}${NC}"
  exit 1
fi
echo "${GREEN}✓ UI Redis allkeys-lru policy verified.${NC}"

# ------------------------------------------------------------------------------
# 3. AOF Persistence Configuration & Canary Test
# ------------------------------------------------------------------------------
echo "${YELLOW}[Test 3/4] Validating AOF configuration and canary read/write...${NC}"
CANARY_KEY="test:resilience:aof_canary_$$"
CANARY_VAL="quasar_persisted_state_$(date +%s)"

API_APPENDONLY=$(api_redis config get appendonly | tail -n1)
if [ "${API_APPENDONLY}" != "yes" ]; then
  echo "${RED}✗ API Redis must have appendonly yes, got: ${API_APPENDONLY}${NC}"
  exit 1
fi
api_redis set "${CANARY_KEY}" "${CANARY_VAL}" >/dev/null

FETCHED_VAL=$(api_redis get "${CANARY_KEY}")
if [ "${FETCHED_VAL}" != "${CANARY_VAL}" ]; then
  echo "${RED}✗ AOF canary key write/read failed!${NC}"
  exit 1
fi
echo "${GREEN}✓ AOF is enabled and canary state is readable.${NC}"

# ------------------------------------------------------------------------------
# 4. Memory Pressure & Safe Fail-Closed Rejection
# ------------------------------------------------------------------------------
echo "${YELLOW}[Test 4/4] Collecting memory pressure telemetry (non-disruptive)...${NC}"
USED_MEM=$(api_redis info memory | grep "^used_memory:" | cut -d: -f2 | tr -d '\r')
FRAG_RATIO=$(api_redis info memory | grep "^mem_fragmentation_ratio:" | cut -d: -f2 | tr -d '\r')

echo "  Used Memory:          $((USED_MEM / 1024)) KB"
echo "  Fragmentation Ratio:  ${FRAG_RATIO}"
echo "${GREEN}✓ Memory metrics collected. No forced OOM/eviction test was executed.${NC}"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "${GREEN}====================================================================${NC}"
echo "${GREEN} ✓ REDIS PREFLIGHT PASSED (${DURATION}s)${NC}"
echo "${YELLOW}   Forced pressure, eviction, and restart recovery remain isolated-environment tests.${NC}"
echo "${GREEN}====================================================================${NC}"

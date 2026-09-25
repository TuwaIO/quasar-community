#!/usr/bin/env bash
# Download popular Grafana dashboards from grafana.com by ID.
# Patches all datasource UIDs/variables so dashboards work with provisioned datasources.
# Usage: bash infra/scripts/download-dashboards.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${SCRIPT_DIR}/../config/grafana/provisioning/dashboards/json"

mkdir -p "$DEST_DIR"

# ── Datasource names (must match provisioning/datasources/datasources.yml) ──
DS_PROMETHEUS="Prometheus"
DS_LOKI="Loki"

# ── Dashboard registry ──
# Format: "ID:FILENAME:DATASOURCE_TYPE"
#   DATASOURCE_TYPE is "prometheus" or "loki" — determines which datasource name to inject
#
# NOTE: cadvisor.json and loki-logs.json are CUSTOM dashboards (not from grafana.com).
#       They live in the json/ folder and should NOT be overwritten by this script.
DASHBOARDS=(
  "1860:node-exporter-full.json:prometheus"
  "9628:postgresql.json:prometheus"
)

BASE_URL="https://grafana.com/api/dashboards"

# ── Portable sed -i ──
sed_inplace() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}

# ── Patch datasource references in downloaded JSON ──
# Grafana.com dashboards use templated variables like ${DS_PROMETHEUS}, ${DS_LOKI},
# or hardcoded UIDs. This function normalizes them to the provisioned datasource name.
patch_datasources() {
  local file="$1"
  local ds_type="$2"

  if [[ "$ds_type" == "prometheus" ]]; then
    DS_NAME="$DS_PROMETHEUS"
    # Replace all known Prometheus datasource variable patterns
    sed_inplace 's/\${DS_PROMETHEUS}/'"${DS_NAME}"'/g' "$file"
    sed_inplace 's/\${ds_prometheus}/'"${DS_NAME}"'/g' "$file"
    sed_inplace 's/\${datasource}/'"${DS_NAME}"'/g' "$file"

    # Replace datasource objects that use uid with the provisioned name
    # Pattern: "uid": "${DS_PROMETHEUS}" → "uid": "Prometheus"
    # Already handled above. Also fix type-based selectors:
    sed_inplace 's/"uid":[[:space:]]*"\${[^"]*}"/"uid": "'"${DS_NAME}"'"/g' "$file"

  elif [[ "$ds_type" == "loki" ]]; then
    DS_NAME="$DS_LOKI"
    sed_inplace 's/\${DS_LOKI}/'"${DS_NAME}"'/g' "$file"
    sed_inplace 's/\${ds_loki}/'"${DS_NAME}"'/g' "$file"
    sed_inplace 's/\${datasource}/'"${DS_NAME}"'/g' "$file"
  fi

  # Remove __inputs block (causes "datasource not found" errors when the
  # downloaded JSON expects the user to select a datasource on import)
  # We use python for JSON manipulation if available, otherwise leave as-is
  if command -v python3 &>/dev/null; then
    python3 - "$file" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    dashboard = json.load(handle)
dashboard.pop("__inputs", None)
dashboard.pop("__elements", None)
dashboard.pop("__requires", None)
dashboard["id"] = None
with open(path, "w", encoding="utf-8") as handle:
    json.dump(dashboard, handle, indent=2)
    handle.write("\n")
PY
  else
    echo "[✗] python3 is required to validate and normalize ${file}." >&2
    return 1
  fi
}

echo "═══════════════════════════════════════════════"
echo "  Grafana Dashboard Downloader"
echo "═══════════════════════════════════════════════"
echo ""

for entry in "${DASHBOARDS[@]}"; do
  IFS=':' read -r ID FILE DS_TYPE <<< "$entry"
  DEST="${DEST_DIR}/${FILE}"

  echo "[↓] Downloading dashboard ${ID} → ${FILE}"

  curl -sSfL "${BASE_URL}/${ID}/revisions/latest/download" -o "${DEST}"

  patch_datasources "$DEST" "$DS_TYPE"

  echo "[✓] Patched and saved → ${FILE}"
done

echo ""
echo "Done. Downloaded to ${DEST_DIR}"
echo ""
ls -lh "$DEST_DIR"

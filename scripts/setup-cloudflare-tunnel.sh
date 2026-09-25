#!/usr/bin/env bash
#
# setup-cloudflare-tunnel.sh
# =============================================================================
# Creates (or re-uses) a Cloudflare Tunnel for a Quasar node, publishes its
# ingress rules, points DNS at it, and prints the connector token to put in
# CLOUDFLARE_TUNNEL_TOKEN.
#
# Fully non-interactive: it talks to the Cloudflare REST API with an API token
# and never runs `cloudflared tunnel login`, which would require a human to
# click "Authorize" in a browser.
#
# Idempotent: re-running reuses a tunnel of the same name and updates existing
# DNS records in place instead of failing or duplicating them.
#
# Cloudflare Tunnel is OPTIONAL. Traefik can terminate TLS directly if you would
# rather not hand out an API token with DNS and tunnel permissions. The manual
# path (Zero Trust dashboard) stays fully supported — see the infra README.
#
# Required environment (set them in .env, which this script auto-loads):
#   CLOUDFLARE_API_TOKEN    Must be a USER-OWNED token: My Profile -> API Tokens
#                           -> Create Token -> Custom token. Exactly two
#                           permissions, both at Edit (which implies Read):
#                             Account | Cloudflare Tunnel | Edit  -> your account
#                             Zone    | DNS               | Edit  -> your zone
#
#                           An ACCOUNT-OWNED token (Manage Account -> API Tokens)
#                           does NOT work, even with an identical zone policy.
#                           Verified against the live API: such a token carries
#                           `effect: allow` on the correct
#                           `com.cloudflare.api.account.zone.<id>` resource with
#                           `DNS Write` in its permission groups, authenticates
#                           fine against the account endpoints this script uses
#                           for the tunnel, and then fails every zone endpoint
#                           with [10000] Authentication error. The failure looks
#                           like a missing permission and is not one, which is
#                           why the preflight below names the token type.
#   CLOUDFLARE_ACCOUNT_ID   Cloudflare dashboard -> Account Home -> Account ID
#   CLOUDFLARE_ZONE_ID      Cloudflare dashboard -> your domain -> Zone ID
#   DOMAIN                  e.g. example.com
#
# Optional:
#   TUNNEL_NAME             default: quasar-<domain with dots as dashes>
#   TUNNEL_HOSTNAMES        default: "quasar api grafana pgadmin redis"
#
# Usage:
#   ./scripts/setup-cloudflare-tunnel.sh            # create/update
#   ./scripts/setup-cloudflare-tunnel.sh --dry-run  # show what would change
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="https://api.cloudflare.com/client/v4"
DRY_RUN=0

[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

log()  { printf '%s\n' "$*"; }
err()  { printf 'ERROR: %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

# --- preflight ---------------------------------------------------------------

for tool in curl jq; do
  command -v "$tool" >/dev/null 2>&1 || die "'$tool' is required but not installed."
done

# Load .env without executing it: only KEY=VALUE lines, comments skipped.
if [[ -f "$REPO_ROOT/.env" ]]; then
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$line" != *=* ]] && continue
    key="${line%%=*}"; key="${key//[[:space:]]/}"
    [[ "$key" =~ ^(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_ZONE_ID|DOMAIN|TUNNEL_NAME|TUNNEL_HOSTNAMES)$ ]] || continue
    value="${line#*=}"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    [[ -z "${!key:-}" ]] && export "$key=$value"
  done < "$REPO_ROOT/.env"
fi

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN must be set (Account:Cloudflare Tunnel:Edit + Zone:DNS:Edit)}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID must be set}"
: "${CLOUDFLARE_ZONE_ID:?CLOUDFLARE_ZONE_ID must be set}"
: "${DOMAIN:?DOMAIN must be set (e.g. example.com)}"

TUNNEL_NAME="${TUNNEL_NAME:-quasar-${DOMAIN//./-}}"
TUNNEL_HOSTNAMES="${TUNNEL_HOSTNAMES:-quasar api grafana pgadmin redis}"
# Split once into an array rather than relying on implicit word splitting.
read -ra HOSTS <<< "$TUNNEL_HOSTNAMES"
[[ ${#HOSTS[@]} -gt 0 ]] || die "TUNNEL_HOSTNAMES is empty."

# --- API helper --------------------------------------------------------------
# Verifies Cloudflare's own success flag, not just the HTTP status.
cf() {
  local method="$1" path="$2" body="${3:-}"
  local response
  if [[ -n "$body" ]]; then
    response=$(curl -sS -X "$method" "$API$path" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json" \
      --data "$body")
  else
    response=$(curl -sS -X "$method" "$API$path" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json")
  fi

  if [[ "$(jq -r '.success' <<<"$response")" != "true" ]]; then
    err "Cloudflare API $method $path failed:"
    jq -r '.errors[]? | "  [\(.code)] \(.message)"' <<<"$response" >&2
    exit 1
  fi
  printf '%s' "$response"
}

# Non-fatal counterpart of cf(): returns 1 instead of exiting. Used by the
# preflight probes, where a failure is a question being answered, not an error.
cf_ok() {
  local method="$1" path="$2" response
  response=$(curl -sS -X "$method" "$API$path" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" 2>/dev/null || true)
  [[ "$(jq -r '.success // false' <<<"${response:-{\}}" 2>/dev/null)" == "true" ]]
}

log "Cloudflare Tunnel setup"
log "  domain     $DOMAIN"
log "  tunnel     $TUNNEL_NAME"
log "  hostnames  $(for h in "${HOSTS[@]}"; do printf '%s.%s ' "$h" "$DOMAIN"; done)"
[[ $DRY_RUN -eq 1 ]] && log "  MODE       dry run, nothing will be changed"
log ""

# --- 1. verify the token before making changes -------------------------------
# Cloudflare has two kinds of API token and they verify at different endpoints.
# A user token (My Profile -> API Tokens) answers at /user/tokens/verify; an
# account-owned token (Manage Account -> API Tokens, the newer "Permission
# policies" UI) answers there with [1000] Invalid API Token and verifies at
# /accounts/<id>/tokens/verify instead. Probing only the first rejected
# perfectly valid account tokens before the script had made a single real call,
# which reads as "bad credentials" when nothing is wrong with them.
#
# Not routed through cf(): that helper exits on the first failure, and here the
# first failure is an expected outcome.
verify_token() {
  local path
  for path in "/user/tokens/verify" "/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify"; do
    if cf_ok GET "$path"; then
      log "API token verified (${path})."
      return 0
    fi
  done
  err "API token rejected by both verify endpoints:"
  err "  /user/tokens/verify                                (user tokens)"
  err "  /accounts/\$CLOUDFLARE_ACCOUNT_ID/tokens/verify     (account-owned tokens)"
  die "Check the token value, that CLOUDFLARE_ACCOUNT_ID matches the account that owns it, and that it carries Account:Cloudflare Tunnel:Edit + Zone:DNS:Edit."
}

verify_token

# Verifying the token proves it is a token, not that it can do both halves of
# this script. The two permissions live in different scopes: the tunnel calls
# need Account:Cloudflare Tunnel:Edit, the CNAMEs need Zone:DNS:Edit. Probe the
# zone half here, because step 3 (publishing ingress) MUTATES and step 4 (DNS)
# is where a missing zone permission would otherwise surface — leaving the
# tunnel advertising hostnames that nothing resolves to.
if ! cf_ok GET "/zones/$CLOUDFLARE_ZONE_ID/dns_records?per_page=1"; then
  err "The token cannot read DNS records in zone $CLOUDFLARE_ZONE_ID."
  err "Step 4 writes CNAMEs there, and step 3 rewrites the tunnel ingress before it,"
  err "so continuing would half-apply the change."
  err ""
  err "Check, in this order — the last one is the least obvious and the most likely"
  err "if the tunnel calls above succeeded:"
  err "  1. CLOUDFLARE_ZONE_ID belongs to CLOUDFLARE_ACCOUNT_ID;"
  err "  2. the token carries Zone -> DNS -> Edit scoped to that zone;"
  err "  3. the token is USER-owned (My Profile -> API Tokens), not account-owned"
  err "     (Manage Account -> API Tokens). Account-owned tokens pass the account"
  err "     endpoints this script uses for the tunnel and then fail every zone"
  err "     endpoint with [10000], no matter how their zone policy is written."
  die "See the token requirements at the top of this script."
fi
log "Zone DNS access verified."

# --- 2. create or reuse the tunnel -------------------------------------------

existing=$(cf GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/cfd_tunnel?name=$TUNNEL_NAME&is_deleted=false")
tunnel_id=$(jq -r '.result[0].id // empty' <<<"$existing")

if [[ -n "$tunnel_id" ]]; then
  log "Reusing existing tunnel: $tunnel_id"
else
  if [[ $DRY_RUN -eq 1 ]]; then
    log "[dry-run] would create tunnel '$TUNNEL_NAME'"
    tunnel_id="<new-tunnel-id>"
  else
    # config_src=cloudflare: ingress lives in Cloudflare, which is what the
    # token-only `cloudflared tunnel run` in docker-compose.yml expects. The
    # container mounts no config file, so local ingress rules would be ignored.
    created=$(cf POST "/accounts/$CLOUDFLARE_ACCOUNT_ID/cfd_tunnel" \
      "$(jq -nc --arg n "$TUNNEL_NAME" '{name: $n, config_src: "cloudflare"}')")
    tunnel_id=$(jq -r '.result.id' <<<"$created")
    log "Created tunnel: $tunnel_id"
  fi
fi

# --- 3. publish ingress rules ------------------------------------------------

ingress=$(
  for host in "${HOSTS[@]}"; do
    jq -nc --arg h "$host.$DOMAIN" '{hostname: $h, service: "http://traefik:80"}'
  done | jq -sc '. + [{service: "http_status:404"}]'
)
config_body=$(jq -nc --argjson ing "$ingress" '{config: {ingress: $ing}}')

if [[ $DRY_RUN -eq 1 ]]; then
  log "[dry-run] would publish ingress:"
  jq -r '.config.ingress[] | "    \(.hostname // "catch-all") -> \(.service)"' <<<"$config_body"
else
  cf PUT "/accounts/$CLOUDFLARE_ACCOUNT_ID/cfd_tunnel/$tunnel_id/configurations" "$config_body" >/dev/null
  log "Ingress rules published ($(jq '.config.ingress | length' <<<"$config_body") entries)."
fi

# --- 4. DNS CNAMEs -----------------------------------------------------------

target="$tunnel_id.cfargotunnel.com"

for host in "${HOSTS[@]}"; do
  fqdn="$host.$DOMAIN"
  record_body=$(jq -nc --arg n "$fqdn" --arg c "$target" \
    '{type: "CNAME", name: $n, content: $c, proxied: true, comment: "Quasar node (managed by setup-cloudflare-tunnel.sh)"}')

  found=$(cf GET "/zones/$CLOUDFLARE_ZONE_ID/dns_records?name=$fqdn")
  record_id=$(jq -r '.result[0].id // empty' <<<"$found")
  current=$(jq -r '.result[0].content // empty' <<<"$found")

  if [[ -n "$record_id" && "$current" == "$target" ]]; then
    log "  DNS ok       $fqdn"
  elif [[ -n "$record_id" ]]; then
    if [[ $DRY_RUN -eq 1 ]]; then
      log "  [dry-run] would repoint $fqdn ($current -> $target)"
    else
      cf PUT "/zones/$CLOUDFLARE_ZONE_ID/dns_records/$record_id" "$record_body" >/dev/null
      log "  DNS updated  $fqdn"
    fi
  else
    if [[ $DRY_RUN -eq 1 ]]; then
      log "  [dry-run] would create $fqdn -> $target"
    else
      cf POST "/zones/$CLOUDFLARE_ZONE_ID/dns_records" "$record_body" >/dev/null
      log "  DNS created  $fqdn"
    fi
  fi
done

# --- 5. local reference copy of the ingress ----------------------------------
# Cloudflare holds the authoritative config (step 3). This file is written so
# the topology is reviewable in the repository and in version control.

if [[ $DRY_RUN -eq 0 ]]; then
  mkdir -p "$REPO_ROOT/infra/cloudflare"
  reference="$REPO_ROOT/infra/cloudflare/tunnel.generated.yml"
  {
    echo "# Generated by scripts/setup-cloudflare-tunnel.sh - do not edit by hand."
    echo "#"
    echo "# REFERENCE ONLY. The authoritative ingress lives in Cloudflare"
    echo "# (config_src=cloudflare) because the cloudflared container runs with"
    echo "# TUNNEL_TOKEN and mounts no config file. Re-run this script to change"
    echo "# the routing; editing this file has no effect."
    echo ""
    echo "tunnel: $TUNNEL_NAME"
    echo "tunnel-id: $tunnel_id"
    echo ""
    echo "ingress:"
    for host in "${HOSTS[@]}"; do
      echo "  - hostname: $host.$DOMAIN"
      echo "    service: http://traefik:80"
    done
    echo "  - service: http_status:404"
  } > "$reference"
  log ""
  log "Wrote reference copy: infra/cloudflare/tunnel.generated.yml"
fi

# --- 6. connector token ------------------------------------------------------

log ""
if [[ $DRY_RUN -eq 1 ]]; then
  log "Dry run complete. Nothing was changed."
  exit 0
fi

token=$(cf GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/cfd_tunnel/$tunnel_id/token" | jq -r '.result')

log "Done. Add this to your .env, then start the stack:"
log ""
log "  CLOUDFLARE_TUNNEL_TOKEN=$token"
log ""
log "The token is a credential: it authorises a connector for this tunnel."
log "Keep it out of version control and rotate it if it leaks."

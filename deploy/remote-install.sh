#!/usr/bin/env bash
# Run locally: deploy/remote-install.sh HOST DOMAIN
set -euo pipefail

HOST="${1:?usage: remote-install.sh HOST DOMAIN}"
DOMAIN="${2:?usage: remote-install.sh HOST DOMAIN}"
PUBKEY="${HOME}/.ssh/id_rsa.pub"
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_TMP="/tmp/spup-install"

[[ -f "$PUBKEY" ]] || { echo "missing $PUBKEY"; exit 1; }

CADDYFILE="$(mktemp)"
trap 'rm -f "$CADDYFILE"' EXIT
sed "s/{{DOMAIN}}/${DOMAIN}/" "${DEPLOY_DIR}/Caddyfile" > "$CADDYFILE"

ssh "$HOST" "mkdir -p ${REMOTE_TMP}"
scp "${DEPLOY_DIR}/install.sh" "${DEPLOY_DIR}/post-receive" "${DEPLOY_DIR}/spup.service" "${DEPLOY_DIR}/nftables.conf" "${HOST}:${REMOTE_TMP}/"
scp "$CADDYFILE" "${HOST}:${REMOTE_TMP}/Caddyfile"
scp "$PUBKEY" "${HOST}:${REMOTE_TMP}/authorized_key"
ssh -t "$HOST" "sudo bash ${REMOTE_TMP}/install.sh && rm -rf ${REMOTE_TMP}"

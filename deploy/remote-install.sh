#!/usr/bin/env bash
# Run locally: deploy/remote-install.sh HOST DOMAIN NAME
set -euo pipefail

HOST="${1:?usage: remote-install.sh HOST DOMAIN NAME}"
DOMAIN="${2:?usage: remote-install.sh HOST DOMAIN NAME}"
NAME="${3:?usage: remote-install.sh HOST DOMAIN NAME}"
PUBKEY="${HOME}/.ssh/id_rsa.pub"
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RCLONE_CONF="${DEPLOY_DIR}/rclone.conf"
REMOTE_TMP="/tmp/spup-install"

[[ -f "$PUBKEY" ]] || { echo "missing $PUBKEY"; exit 1; }
[[ -f "$RCLONE_CONF" ]] || { echo "missing $RCLONE_CONF"; exit 1; }

CADDYFILE="$(mktemp)"
trap 'rm -f "$CADDYFILE"' EXIT
sed "s/{{DOMAIN}}/${DOMAIN}/" "${DEPLOY_DIR}/Caddyfile" > "$CADDYFILE"

FILES=(
    "${DEPLOY_DIR}/bootstrap.sh" "${DEPLOY_DIR}/install.sh" "${DEPLOY_DIR}/post-receive" "${DEPLOY_DIR}/spup.service" "${DEPLOY_DIR}/nftables.conf"
    "${DEPLOY_DIR}/sysctl-network.conf" "${DEPLOY_DIR}/unattended-upgrades-reboot.conf" "${DEPLOY_DIR}/sshd-access.conf"
    "${DEPLOY_DIR}/backup.sh" "${DEPLOY_DIR}/spup-backup.service" "${DEPLOY_DIR}/spup-backup.timer"
)

ssh "$HOST" "mkdir -p ${REMOTE_TMP}"
scp "${FILES[@]}" "${HOST}:${REMOTE_TMP}/"
scp "$CADDYFILE" "${HOST}:${REMOTE_TMP}/Caddyfile"
scp "$PUBKEY" "${HOST}:${REMOTE_TMP}/authorized_key"
scp "$RCLONE_CONF" "${HOST}:${REMOTE_TMP}/rclone.conf"
ssh -t "$HOST" "sudo bash ${REMOTE_TMP}/install.sh ${DOMAIN} '${NAME}' && rm -rf ${REMOTE_TMP}"

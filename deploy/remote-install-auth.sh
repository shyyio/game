#!/usr/bin/env bash
# Run locally: deploy/remote-install-auth.sh HOST AUTH_DOMAIN
set -euo pipefail

HOST="${1:?usage: remote-install-auth.sh HOST AUTH_DOMAIN}"
AUTH_DOMAIN="${2:?usage: remote-install-auth.sh HOST AUTH_DOMAIN}"
PUBKEY="${HOME}/.ssh/id_rsa.pub"
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RCLONE_CONF="${DEPLOY_DIR}/rclone.conf"
REMOTE_TMP="/tmp/spup-auth-install"

[[ -f "$PUBKEY" ]] || { echo "missing $PUBKEY"; exit 1; }
[[ -f "$RCLONE_CONF" ]] || { echo "missing $RCLONE_CONF"; exit 1; }

FILES=(
    "${DEPLOY_DIR}/bootstrap.sh" "${DEPLOY_DIR}/install-auth.sh" "${DEPLOY_DIR}/post-receive-auth" "${DEPLOY_DIR}/spup-auth.service"
    "${DEPLOY_DIR}/nginx-auth.conf" "${DEPLOY_DIR}/nginx-ratelimit-auth.conf" "${DEPLOY_DIR}/nftables.conf" "${DEPLOY_DIR}/sysctl-network.conf"
    "${DEPLOY_DIR}/unattended-upgrades-reboot.conf" "${DEPLOY_DIR}/sshd-access.conf"
    "${DEPLOY_DIR}/backup-auth.sh" "${DEPLOY_DIR}/spup-auth-backup.service" "${DEPLOY_DIR}/spup-auth-backup.timer"
)

ssh "$HOST" "mkdir -p ${REMOTE_TMP}"
scp "${FILES[@]}" "${HOST}:${REMOTE_TMP}/"
scp "$PUBKEY" "${HOST}:${REMOTE_TMP}/authorized_key"
scp "$RCLONE_CONF" "${HOST}:${REMOTE_TMP}/rclone.conf"
ssh -t "$HOST" "sudo bash ${REMOTE_TMP}/install-auth.sh ${AUTH_DOMAIN} && rm -rf ${REMOTE_TMP}"

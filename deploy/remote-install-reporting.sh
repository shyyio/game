#!/usr/bin/env bash
# Run locally: deploy/remote-install-reporting.sh HOST REPORTING_DOMAIN
set -euo pipefail

HOST="${1:?usage: remote-install-reporting.sh HOST REPORTING_DOMAIN}"
REPORTING_DOMAIN="${2:?usage: remote-install-reporting.sh HOST REPORTING_DOMAIN}"
PUBKEY="${HOME}/.ssh/id_rsa.pub"
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RCLONE_CONF="${DEPLOY_DIR}/rclone.conf"
REMOTE_TMP="/tmp/spup-reporting-install"

[[ -f "$PUBKEY" ]] || { echo "missing $PUBKEY"; exit 1; }
[[ -f "$RCLONE_CONF" ]] || { echo "missing $RCLONE_CONF"; exit 1; }

FILES=(
    "${DEPLOY_DIR}/bootstrap.sh" "${DEPLOY_DIR}/logrotate-nginx.conf" "${DEPLOY_DIR}/install-reporting.sh" "${DEPLOY_DIR}/post-receive-reporting" "${DEPLOY_DIR}/spup-reporting.service"
    "${DEPLOY_DIR}/nginx-reporting.conf" "${DEPLOY_DIR}/nginx-ratelimit-reporting.conf" "${DEPLOY_DIR}/nftables.conf" "${DEPLOY_DIR}/sysctl-network.conf"
    "${DEPLOY_DIR}/unattended-upgrades-reboot.conf" "${DEPLOY_DIR}/sshd-access.conf"
)

ssh "$HOST" "mkdir -p ${REMOTE_TMP}"
scp "${FILES[@]}" "${HOST}:${REMOTE_TMP}/"
scp "$PUBKEY" "${HOST}:${REMOTE_TMP}/authorized_key"
scp "$RCLONE_CONF" "${HOST}:${REMOTE_TMP}/rclone.conf"
ssh -t "$HOST" "sudo bash ${REMOTE_TMP}/install-reporting.sh ${REPORTING_DOMAIN} && rm -rf ${REMOTE_TMP}"

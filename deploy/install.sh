#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(dirname "$0")"
DOMAIN="${1:?usage: install.sh DOMAIN NAME}"
NAME="${2:?usage: install.sh DOMAIN NAME}"

hostnamectl set-hostname "$DOMAIN"
grep -qE "^127\.0\.1\.1\s+${DOMAIN}$" /etc/hosts || echo "127.0.1.1 ${DOMAIN}" >> /etc/hosts

"${SCRIPT_DIR}/bootstrap.sh"

install -d -o app -g app /home/app/spup

sudo -u app git init --bare /home/app/spup.git

install -m 755 -o app -g app "${SCRIPT_DIR}/post-receive" /home/app/spup.git/hooks/post-receive

echo "app ALL=(root) NOPASSWD: /usr/bin/systemctl restart spup" > /etc/sudoers.d/app-restart
chmod 440 /etc/sudoers.d/app-restart

sed -e "s/{{DOMAIN}}/${DOMAIN}/" -e "s/{{NAME}}/${NAME}/" "${SCRIPT_DIR}/spup.service" > /etc/systemd/system/spup.service
systemctl daemon-reload
systemctl enable spup

cp "${SCRIPT_DIR}/Caddyfile" /etc/caddy/sites/spup.conf
systemctl reload caddy

install -m 755 "${SCRIPT_DIR}/backup.sh" /usr/local/bin/spup-backup.sh
install -m 644 "${SCRIPT_DIR}/spup-backup.service" /etc/systemd/system/spup-backup.service
install -m 644 "${SCRIPT_DIR}/spup-backup.timer" /etc/systemd/system/spup-backup.timer
systemctl daemon-reload
systemctl enable --now spup-backup.timer

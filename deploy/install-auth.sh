#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(dirname "$0")"
AUTH_DOMAIN="${1:?usage: install-auth.sh AUTH_DOMAIN}"

"${SCRIPT_DIR}/bootstrap.sh"

install -d -o app -g app /home/app/spup-auth

sudo -u app git init --bare /home/app/spup-auth.git

install -m 755 -o app -g app "${SCRIPT_DIR}/post-receive-auth" /home/app/spup-auth.git/hooks/post-receive

echo "app ALL=(root) NOPASSWD: /usr/bin/systemctl restart spup-auth" > /etc/sudoers.d/app-restart-auth
chmod 440 /etc/sudoers.d/app-restart-auth

cp "${SCRIPT_DIR}/spup-auth.service" /etc/systemd/system/spup-auth.service
systemctl daemon-reload
systemctl enable spup-auth

sed "s/{{AUTH_DOMAIN}}/${AUTH_DOMAIN}/" "${SCRIPT_DIR}/Caddyfile-auth" > /etc/caddy/sites/spup-auth.conf
systemctl reload caddy

install -m 755 "${SCRIPT_DIR}/backup-auth.sh" /usr/local/bin/spup-auth-backup.sh
install -m 644 "${SCRIPT_DIR}/spup-auth-backup.service" /etc/systemd/system/spup-auth-backup.service
install -m 644 "${SCRIPT_DIR}/spup-auth-backup.timer" /etc/systemd/system/spup-auth-backup.timer
systemctl daemon-reload
systemctl enable --now spup-auth-backup.timer

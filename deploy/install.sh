#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(dirname "$0")"

apt-get update -y
apt-get full-upgrade -y

if ! command -v node >/dev/null || [[ "$(node -v)" != v24.* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
    apt-get install -y nodejs
fi

apt-get install -y git nftables debian-keyring debian-archive-keyring apt-transport-https curl

if ! command -v caddy >/dev/null; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y
    apt-get install -y caddy
fi

GIT_SHELL="$(command -v git-shell)"
grep -qxF "$GIT_SHELL" /etc/shells || echo "$GIT_SHELL" >> /etc/shells
id -u app >/dev/null 2>&1 || useradd --system --create-home --shell "$GIT_SHELL" app

install -d -o app -g app /home/app/data /home/app/spup

if [[ -f "${SCRIPT_DIR}/authorized_key" ]]; then
    install -d -m 700 -o app -g app /home/app/.ssh
    install -m 600 -o app -g app "${SCRIPT_DIR}/authorized_key" /home/app/.ssh/authorized_keys
fi

sudo -u app git init --bare /home/app/spup.git

install -m 755 -o app -g app "${SCRIPT_DIR}/post-receive" /home/app/spup.git/hooks/post-receive

echo "app ALL=(root) NOPASSWD: /usr/bin/systemctl restart spup" > /etc/sudoers.d/app-restart
chmod 440 /etc/sudoers.d/app-restart

cp "${SCRIPT_DIR}/spup.service" /etc/systemd/system/spup.service
systemctl daemon-reload
systemctl enable spup

cp "${SCRIPT_DIR}/Caddyfile" /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy

cp "${SCRIPT_DIR}/nftables.conf" /etc/nftables.conf
systemctl enable nftables
systemctl restart nftables

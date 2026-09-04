#!/usr/bin/env bash
# Shared host bootstrap: base packages, Node, nginx, nftables,
# the "app" service user, sshd hardening. Called by install.sh and install-auth.sh;
# safe to run more than once and safe to run on a completely fresh host.
set -euo pipefail

SCRIPT_DIR="$(dirname "$0")"

apt-get update -y
apt-get full-upgrade -y

if ! command -v node >/dev/null || [[ "$(node -v)" != v24.* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
    apt-get install -y nodejs
fi

apt-get install -y git nftables debian-archive-keyring apt-transport-https curl unattended-upgrades sqlite3 zstd unzip logrotate

if ! command -v rclone >/dev/null; then
    curl -fsSL https://rclone.org/install.sh | bash
fi

apt-get install -y nginx libnginx-mod-http-headers-more-filter certbot python3-certbot-nginx apache2-utils

GIT_SHELL="$(command -v git-shell)"
grep -qxF "$GIT_SHELL" /etc/shells || echo "$GIT_SHELL" >> /etc/shells
id -u app >/dev/null 2>&1 || useradd --system --create-home --shell "$GIT_SHELL" app

install -d -o app -g app /home/app/data

if [[ -f "${SCRIPT_DIR}/authorized_key" ]]; then
    install -d -m 700 -o app -g app /home/app/.ssh
    install -m 600 -o app -g app "${SCRIPT_DIR}/authorized_key" /home/app/.ssh/authorized_keys
fi

install -d -m 700 -o app -g app /home/app/.config/rclone
install -m 600 -o app -g app "${SCRIPT_DIR}/rclone.conf" /home/app/.config/rclone/rclone.conf

# nginx is fronted per-service: each install script drops its own sites-available/*.conf
# and conf.d rate-limit zone file, so installing the auth server never clobbers the game
# server's config (or vice versa).
rm -f /etc/nginx/sites-enabled/default
systemctl enable nginx
systemctl restart nginx

# Access logs hold client IPs (personal data); cap retention to 14 days across all
# services on this host, overriding the distro default.
install -m 644 "${SCRIPT_DIR}/logrotate-nginx.conf" /etc/logrotate.d/nginx

# nft -f flushes the ruleset before it parses, so a syntax error would leave the host with a
# bare drop policy and no way back in.
nft -c -f "${SCRIPT_DIR}/nftables.conf"
cp "${SCRIPT_DIR}/nftables.conf" /etc/nftables.conf
systemctl enable nftables
systemctl restart nftables

install -m 644 "${SCRIPT_DIR}/sysctl-network.conf" /etc/sysctl.d/99-network.conf
sysctl --system

ADMIN_USER="${SUDO_USER:?bootstrap.sh must be run via sudo}"
sed "s/{{ADMIN_USER}}/${ADMIN_USER}/" "${SCRIPT_DIR}/sshd-access.conf" > /etc/ssh/sshd_config.d/access.conf
sshd -t
rm -f /root/.ssh/authorized_keys
systemctl reload ssh

install -m 644 "${SCRIPT_DIR}/unattended-upgrades-reboot.conf" /etc/apt/apt.conf.d/51-unattended-upgrades-reboot.conf

#!/usr/bin/env bash
# Shared host bootstrap: base packages, Node, Caddy, nftables,
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

apt-get install -y git nftables debian-archive-keyring apt-transport-https curl unattended-upgrades sqlite3 zstd unzip

if ! command -v rclone >/dev/null; then
    curl -fsSL https://rclone.org/install.sh | bash
fi

if ! command -v caddy >/dev/null; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y
    apt-get install -y caddy
fi

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

# Caddy is fronted per-service: each install script drops its own /etc/caddy/sites/*.conf
# so installing the auth server never clobbers the game server's config (or vice versa).
# Migrate an old single-block Caddyfile (pre-split) into sites/spup.conf on first run.
install -d -m 755 /etc/caddy/sites
if [[ -f /etc/caddy/Caddyfile ]] && ! grep -q '^import /etc/caddy/sites/' /etc/caddy/Caddyfile; then
    mv /etc/caddy/Caddyfile /etc/caddy/sites/spup.conf
fi
printf 'import /etc/caddy/sites/*.conf\n' > /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy

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

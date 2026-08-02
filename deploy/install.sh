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

# nginx-game.conf (below) references the cert certbot obtains here, so it can't be deployed
# until the cert exists. First run only: stand up an interim HTTP-only vhost so certbot's
# nginx authenticator has something valid to serve the ACME challenge through. Once the
# cert exists this whole block is skipped on every later redeploy — certonly never rewrites
# our nginx config, so it's the only thing keeping repeat deploys from burning Let's Encrypt's
# per-domain issuance rate limit.
if [[ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]]; then
    cat > /etc/nginx/sites-available/spup.conf <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    location / {
        proxy_pass http://127.0.0.1:27500;
        proxy_http_version 1.1;
    }
}
EOF
    ln -sf /etc/nginx/sites-available/spup.conf /etc/nginx/sites-enabled/spup.conf
    nginx -t
    systemctl reload nginx

    certbot certonly --nginx -d "${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email \
        --deploy-hook "systemctl reload nginx"
fi

install -m 644 "${SCRIPT_DIR}/nginx-ratelimit-game.conf" /etc/nginx/conf.d/spup-ratelimit.conf
cp "${SCRIPT_DIR}/nginx-game.conf" /etc/nginx/sites-available/spup.conf
ln -sf /etc/nginx/sites-available/spup.conf /etc/nginx/sites-enabled/spup.conf
nginx -t
systemctl reload nginx

install -m 755 "${SCRIPT_DIR}/backup.sh" /usr/local/bin/spup-backup.sh
install -m 644 "${SCRIPT_DIR}/spup-backup.service" /etc/systemd/system/spup-backup.service
install -m 644 "${SCRIPT_DIR}/spup-backup.timer" /etc/systemd/system/spup-backup.timer
systemctl daemon-reload
systemctl enable --now spup-backup.timer

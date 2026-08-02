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

# nginx-auth.conf (below) references the cert certbot obtains here, so it can't be deployed
# until the cert exists. First run only: stand up an interim HTTP-only vhost so certbot's
# nginx authenticator has something valid to serve the ACME challenge through. Once the
# cert exists this whole block is skipped on every later redeploy — certonly never rewrites
# our nginx config, so it's the only thing keeping repeat deploys from burning Let's Encrypt's
# per-domain issuance rate limit.
if [[ ! -d "/etc/letsencrypt/live/${AUTH_DOMAIN}" ]]; then
    cat > /etc/nginx/sites-available/spup-auth.conf <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${AUTH_DOMAIN};
    location / {
        proxy_pass http://127.0.0.1:27501;
        proxy_http_version 1.1;
    }
}
EOF
    ln -sf /etc/nginx/sites-available/spup-auth.conf /etc/nginx/sites-enabled/spup-auth.conf
    nginx -t
    systemctl reload nginx

    certbot certonly --nginx -d "${AUTH_DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email \
        --deploy-hook "systemctl reload nginx"
fi

install -m 644 "${SCRIPT_DIR}/nginx-ratelimit-auth.conf" /etc/nginx/conf.d/spup-auth-ratelimit.conf
sed "s/{{AUTH_DOMAIN}}/${AUTH_DOMAIN}/" "${SCRIPT_DIR}/nginx-auth.conf" > /etc/nginx/sites-available/spup-auth.conf
ln -sf /etc/nginx/sites-available/spup-auth.conf /etc/nginx/sites-enabled/spup-auth.conf
nginx -t
systemctl reload nginx

install -m 755 "${SCRIPT_DIR}/backup-auth.sh" /usr/local/bin/spup-auth-backup.sh
install -m 644 "${SCRIPT_DIR}/spup-auth-backup.service" /etc/systemd/system/spup-auth-backup.service
install -m 644 "${SCRIPT_DIR}/spup-auth-backup.timer" /etc/systemd/system/spup-auth-backup.timer
systemctl daemon-reload
systemctl enable --now spup-auth-backup.timer

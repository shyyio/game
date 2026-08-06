#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(dirname "$0")"
REPORTING_DOMAIN="${1:?usage: install-reporting.sh REPORTING_DOMAIN}"

"${SCRIPT_DIR}/bootstrap.sh"

install -d -o app -g app /home/app/spup-reporting
install -d -o app -g app /home/app/data/reporting

sudo -u app git init --bare /home/app/spup-reporting.git

install -m 755 -o app -g app "${SCRIPT_DIR}/post-receive-reporting" /home/app/spup-reporting.git/hooks/post-receive

echo "app ALL=(root) NOPASSWD: /usr/bin/systemctl restart spup-reporting" > /etc/sudoers.d/app-restart-reporting
chmod 440 /etc/sudoers.d/app-restart-reporting

cp "${SCRIPT_DIR}/spup-reporting.service" /etc/systemd/system/spup-reporting.service
systemctl daemon-reload
systemctl enable spup-reporting

# Locks out every admin request until a real user is added — fail-secure default.
if [[ ! -f /etc/nginx/spup-reporting.htpasswd ]]; then
    : > /etc/nginx/spup-reporting.htpasswd
    echo "No admin user set yet. Run: htpasswd /etc/nginx/spup-reporting.htpasswd <name>"
fi

# nginx-reporting.conf (below) references the cert certbot obtains here, so it can't be deployed
# until the cert exists. First run only: stand up an interim HTTP-only vhost so certbot's
# nginx authenticator has something valid to serve the ACME challenge through. Once the
# cert exists this whole block is skipped on every later redeploy — certonly never rewrites
# our nginx config, so it's the only thing keeping repeat deploys from burning Let's Encrypt's
# per-domain issuance rate limit.
if [[ ! -d "/etc/letsencrypt/live/${REPORTING_DOMAIN}" ]]; then
    cat > /etc/nginx/sites-available/spup-reporting.conf <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${REPORTING_DOMAIN};
    location / {
        proxy_pass http://127.0.0.1:27502;
        proxy_http_version 1.1;
    }
}
EOF
    ln -sf /etc/nginx/sites-available/spup-reporting.conf /etc/nginx/sites-enabled/spup-reporting.conf
    nginx -t
    systemctl reload nginx

    certbot certonly --nginx -d "${REPORTING_DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email \
        --deploy-hook "systemctl reload nginx"
fi

install -m 644 "${SCRIPT_DIR}/nginx-ratelimit-reporting.conf" /etc/nginx/conf.d/spup-reporting-ratelimit.conf
sed "s/{{REPORTING_DOMAIN}}/${REPORTING_DOMAIN}/" "${SCRIPT_DIR}/nginx-reporting.conf" > /etc/nginx/sites-available/spup-reporting.conf
ln -sf /etc/nginx/sites-available/spup-reporting.conf /etc/nginx/sites-enabled/spup-reporting.conf
nginx -t
systemctl reload nginx

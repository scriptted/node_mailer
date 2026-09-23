#!/bin/sh
# À lancer une fois : sudo sh ~/node_mailer/install-service.sh
# Sort les clés Mailjet de l'unité (lisible par tous) vers /etc/vtvr/mailer.env (600),
# fait tourner le mailer en scriptted au lieu de root, puis redémarre.
set -eu
UNIT=/etc/systemd/system/node-mailer.service
ENV=/etc/vtvr/mailer.env

mkdir -p /etc/vtvr
if [ ! -f "$ENV" ]; then
  grep -oE 'MJ_APIKEY_(PUBLIC|PRIVATE)=[^[:space:]]+' "$UNIT" > "$ENV"
  echo "CONTACT_URL=https://www.therapie-vr.fr/contact" >> "$ENV"
  echo "# TURNSTILE_SECRET=..." >> "$ENV"
  chmod 600 "$ENV"
fi
[ "$(grep -c MJ_APIKEY "$ENV")" = 2 ] || { echo "Clés Mailjet introuvables dans $ENV" >&2; exit 1; }

cp "$UNIT" "$UNIT.bak"
cat > "$UNIT" <<'EOF'
[Unit]
Description=VTVR Node Mailer
After=network-online.target

[Service]
Type=simple
User=scriptted
EnvironmentFile=/etc/vtvr/mailer.env
ExecStart=/home/scriptted/.nvm/versions/node/v20.2.0/bin/node /home/scriptted/node_mailer/server.js
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl restart node-mailer
sleep 1
systemctl --no-pager status node-mailer | head -5
curl -s -o /dev/null -w "token: %{http_code}\n" http://localhost:11000/mail/token

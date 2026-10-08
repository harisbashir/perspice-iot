#!/bin/sh
# Keeps EMQX's TLS certificate in step with the one Caddy manages for mqtt.$BASE_DOMAIN.
# Until Caddy has a certificate, a self-signed placeholder lets EMQX start its TLS listener.
set -eu

: "${BASE_DOMAIN:?}" "${EMQX_API_KEY:?}" "${EMQX_API_SECRET:?}"
name="mqtt.${BASE_DOMAIN}"
certs=/certs
interval="${CERT_SYNC_INTERVAL:-300}"

if [ ! -s "$certs/cert.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=${name}" \
    -keyout "$certs/key.pem" -out "$certs/cert.pem" 2>/dev/null
  chmod 644 "$certs/cert.pem" "$certs/key.pem"
  echo "cert-sync: wrote a temporary self-signed certificate for ${name}"
fi

restart_listener() {
  curl -fsS -u "${EMQX_API_KEY}:${EMQX_API_SECRET}" -X POST \
    "http://emqx:18083/api/v5/listeners/ssl:default/restart" >/dev/null \
    && echo "cert-sync: EMQX TLS listener reloaded" \
    || echo "cert-sync: could not reload the EMQX TLS listener (will retry)"
}

while true; do
  crt=$(find /caddy-data/caddy/certificates -path "*/${name}/${name}.crt" 2>/dev/null | head -n 1)
  if [ -n "$crt" ] && ! cmp -s "$crt" "$certs/cert.pem"; then
    cp "${crt%.crt}.key" "$certs/key.pem.new"
    cp "$crt" "$certs/cert.pem.new"
    chmod 644 "$certs/cert.pem.new" "$certs/key.pem.new"
    mv "$certs/key.pem.new" "$certs/key.pem"
    mv "$certs/cert.pem.new" "$certs/cert.pem"
    echo "cert-sync: installed certificate from ${crt}"
    restart_listener
  fi
  sleep "$interval"
done

#!/bin/sh
# Renders the Perspice EMQX config from environment variables, then starts EMQX.
# Required: PERSPICE_API_URL, INTERNAL_SECRET, PERSPICE_EMQX_API_KEY, PERSPICE_EMQX_API_SECRET.
# (Not EMQX_*: EMQX treats every EMQX_-prefixed variable as a config override.)
set -eu

: "${PERSPICE_API_URL:?}" "${INTERNAL_SECRET:?}" "${PERSPICE_EMQX_API_KEY:?}" "${PERSPICE_EMQX_API_SECRET:?}"

# TLS certificate: the one provided by cert-sync if mounted, else EMQX's bundled test cert.
certdir=/opt/emqx/etc/certs
if [ -s /opt/perspice/certs/cert.pem ] && [ -s /opt/perspice/certs/key.pem ]; then
  certdir=/opt/perspice/certs
fi

sed -e "s|__PERSPICE_API_URL__|${PERSPICE_API_URL}|g" \
    -e "s|__INTERNAL_SECRET__|${INTERNAL_SECRET}|g" \
    -e "s|__MQTT_CERTFILE__|${certdir}/cert.pem|g" \
    -e "s|__MQTT_KEYFILE__|${certdir}/key.pem|g" \
    /opt/perspice/emqx.conf.tmpl > /opt/emqx/etc/emqx.conf

umask 077
printf '%s:%s:administrator\n' "$PERSPICE_EMQX_API_KEY" "$PERSPICE_EMQX_API_SECRET" > /opt/emqx/etc/api_key.bootstrap

exec /usr/bin/docker-entrypoint.sh /opt/emqx/bin/emqx foreground

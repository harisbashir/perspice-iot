FROM alpine:3.20
RUN apk add --no-cache openssl curl
COPY sync.sh /usr/local/bin/cert-sync
ENTRYPOINT ["/usr/local/bin/cert-sync"]

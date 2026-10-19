# Installing Perspice IoT

Perspice runs as a Docker Compose stack on one Linux server.

## Requirements

- Ubuntu 22.04+ or Debian 12+, amd64 or arm64
- 2 vCPU, 4 GB RAM, 20 GB free disk (2 GB RAM is the hard minimum)
- A domain you control and root access

## DNS

Point these records at the server's public IP:

| Record | Purpose |
|---|---|
| `A  iot.example.com` | platform UI and API |
| `A  *.iot.example.com` | customer subdomains (`acme.iot.example.com`) |
| `A  mqtt.iot.example.com` | MQTT broker |

### Without DNS records (a LAN or a test server)

Pass the server's IPv4 address as the domain: `install.sh --domain 192.168.1.50`. The platform is
then served on `192-168-1-50.sslip.io`, a public name that resolves to that address, as do its
subdomains (`acme.192-168-1-50.sslip.io`), so customer sign-in works with no records to create.
Opening `http://192.168.1.50` redirects there.

The platform can't be served on the bare IP itself: customers sign in on their own subdomain, and
an IP has none.

For a private address (10.x, 172.16–31.x, 192.168.x, 100.64–127.x, 127.x) the installer also turns
on `--local-certs`, since Let's Encrypt can't reach the server; see [Certificates](#certificates).

Some routers refuse DNS answers that point at private addresses ("DNS rebinding protection"). If
the name doesn't resolve, allow `sslip.io` in the router, or add the names to the hosts file of the
computer you browse from.

## Ports

| Port | Use |
|---|---|
| 80, 443 (TCP), 443 (UDP) | web UI, API, certificate issuance |
| 8883 | MQTT over TLS |
| 1883 | plain MQTT (optional, `--mqtt-plain=false` disables it) |

The installer opens these in `ufw` when it is active; open them in any cloud firewall yourself.

## Install

```bash
git clone https://github.com/harisbashir/perspice-iot.git
cd perspice-iot
sudo scripts/install.sh --domain iot.example.com --admin-email you@example.com
```

Useful options (see `scripts/install.sh --help`):

- `--version v0.1.0` pins a release (needed when GitHub is unreachable)
- `--smtp-host … --smtp-port … --smtp-user … --smtp-pass … --smtp-from …` configures email now
  (otherwise use **Settings → Email** later)
- `--build` builds images from the checkout instead of pulling them
- `--storage=s3 --s3-bucket … --s3-region …` keeps files in S3; `--mqtt=aws-iot` connects devices
  through AWS IoT Core instead of the bundled broker (see [aws.md](aws.md))
- `--non-interactive`, `--dry-run`, `--reinstall`

The installer checks the system, installs Docker if missing, writes `/opt/perspice/.env`
(mode 600, random secrets), starts the stack, migrates and seeds the database, and creates the
super admin. With SMTP configured the activation link is emailed; otherwise it is printed.

## First sign-in

1. Open the activation link and choose a password (valid 72 hours).
2. Sign in at `https://iot.example.com`. Super admins must enrol two-factor authentication
   before they can do anything else.
3. Configure email under **Settings → Email** and send a test message.
4. Create a customer, invite its admin, create a device profile and devices.

## Certificates

Caddy obtains Let's Encrypt certificates automatically. Customer subdomains get certificates on
demand, but only for slugs of active customers (Caddy asks the API first). A certificate for
`mqtt.<domain>` is copied to the broker by the `cert-sync` service; until it exists the broker
uses a temporary self-signed certificate.

### Local certificates

`--local-certs` (`LOCAL_CERTS=true` in `.env`) makes Caddy issue every certificate from its own
authority instead of Let's Encrypt, for servers the internet can't reach. Browsers warn until they
trust the authority's root certificate, and devices connecting with TLS on 8883 need it too:

```bash
cd /opt/perspice && docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./perspice-root.crt
```

Import `perspice-root.crt` as a trusted root on each computer (and give it to device firmware as
the CA). Names ending in `.home.arpa`, `.local` or `localhost` always get local certificates.

For a single wildcard certificate via DNS-01 (Cloudflare, Route 53), build `deploy/Dockerfile.caddy`
and use `deploy/caddy/Caddyfile.dns`.

## Back up the master key and backup passphrase

`MASTER_KEY` in `/opt/perspice/.env` encrypts stored secrets (SMTP passwords, TOTP secrets), and
`BACKUP_PASSPHRASE` encrypts backups. Keep a copy of `.env` somewhere other than the server:
without them a backup can't be read or fully restored. Then schedule backups under
**System → Backups** ([backups.md](backups.md)).

Optional: Prometheus and Grafana ([monitoring.md](monitoring.md)).

# Security

How Perspice protects data, what the v1.0 review checked, and what operators should do.

## Model

- **Tenancy.** Every customer-owned query goes through one scoping helper (customer, and the
  user's group subtree when the user is limited to a group); another tenant's ids answer 404.
  Isolation is tested for every resource type (devices, telemetry, alarms, dashboards, exports,
  assets, tariffs, OTA status, websockets).
- **Permissions.** Roles are lists of permissions; built-in roles are re-synced from code at
  startup, custom roles can only grant what their creator holds. Every API route either requires
  a permission, acts on the caller's own account, or is a deliberate public endpoint (health,
  branding, map tile settings, signed file links, device API with its own token).
- **Sessions.** Passwords are hashed with Argon2id; access tokens live 15 minutes and are checked
  against a revocation list, so logging out, changing a password, disabling a user or changing a
  role ends their sessions at once. Refresh tokens rotate; reusing one revokes the whole family.
  Two-factor authentication (TOTP) is available to every user and enforced for the super admin.
- **Devices.** Device tokens and claim codes are stored as hashes. On MQTT a device may only use
  its own topic subtree (enforced by the broker with rules returned at connection time); the
  internal ingest account is separate. OTA images are checked by SHA-256 on the device.
- **Outbound requests.** Webhooks may not reach private, loopback, link-local (cloud metadata) or
  other non-public addresses, checked again at connection time against DNS rebinding.
- **Content.** Markdown widgets are sanitised (DOMPurify), uploaded SVG logos are sanitised,
  CSV exports neutralise formula cells, formulas in calculated keys run in a sandboxed evaluator.
- **Transport and headers.** Caddy terminates TLS (automatic certificates), sends HSTS,
  `X-Frame-Options: DENY`, `nosniff`, a strict Content-Security-Policy and no server banner, and
  answers 404 for internal hooks. Cookies are HttpOnly, Secure and SameSite=Lax.
- **Secrets at rest.** `.env` is mode 600; backups are encrypted with `BACKUP_PASSPHRASE`; stored
  TOTP secrets and webhook signing secrets are encrypted with `MASTER_KEY`.
- **Containers.** Application processes run as the unprivileged `node` user; only Caddy (80/443)
  and EMQX (1883/8883) publish ports.

## v1.0 review

| Area | Checked | Result |
|---|---|---|
| Route permissions | every controller handler without a permission decorator | all deliberate (own account, public, device token, internal secret) — except below |
| Dashboard data | `POST /dashboards/data` | **fixed**: widgets now need the permissions of the equivalent API (`telemetry.read` for values, `alarm.read` for alarms); before, a custom role without them could read them through widgets |
| Live updates | websocket subscriptions | **fixed**: device rooms need `device.read` and `telemetry.read`, status needs `device.read` |
| Self-service | users editing themselves, API keys | can't change their own role, status or group; keys can't mint keys or grant more than their creator holds |
| SSRF | webhooks | private ranges blocked, rebinding-safe lookup |
| XSS | markdown, branding, chart tooltips | sanitised; no widget uses the affected ECharts series (below) |
| Internal endpoints | EMQX hooks, Caddy ask, metrics | internal secret and/or not routed by Caddy |
| Files | signed download links | HMAC-signed, expiring, `nosniff`, downloads as attachments |
| Dependencies | `pnpm audit --prod` | js-yaml updated; two moderate findings don't apply (below) |
| Deployment | database readiness | **fixed**: PostgreSQL's healthcheck could report ready during first-time initialisation |

### Audit findings that don't apply

- **uuid < 11.1.1** (via exceljs): missing bounds check in v3/v5/v6 when a buffer is passed;
  exceljs only generates v4 identifiers.
- **echarts < 6.1.0**: HTML in a Lines series tooltip; no Perspice widget uses Lines series.
  ECharts 6 is a major upgrade, planned separately.

## For operators

- Keep `.env` and the `BACKUP_PASSPHRASE` somewhere safe and separate: backups can't be read
  without it.
- Turn off plain MQTT (`--mqtt-plain=false`) when devices can use TLS on 8883.
- Keep the server updated (`perspice update`); updates take a backup first and roll back on
  failure.
- Use custom roles for least privilege; review the audit log (Audit log page) for sensitive
  actions (users, roles, API keys, claim codes, tariffs, backups).
- Regenerate a device's token (Credentials tab) if a device is lost; disabling a device stops it
  at once.

Report a vulnerability privately to the maintainers rather than in a public issue.

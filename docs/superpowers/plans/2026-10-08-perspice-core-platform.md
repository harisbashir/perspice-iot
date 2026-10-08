# Perspice IoT — Sub-project 1: Core Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.1.0: an installable, white-label, multi-tenant platform where ESP32/Arduino devices connect over MQTT or HTTP, telemetry is stored and shown live, offline devices are detected and notified, and the install/update/test scripts work on Ubuntu/Debian.

**Architecture:** pnpm monorepo. A single NestJS app (`apps/server`) runs as `api`, `ingest`, `rules`, `scheduler` or `all` depending on `PERSPICE_ROLE`. It uses PostgreSQL 16 + TimescaleDB (Drizzle ORM), Redis 7 (cache, presence, BullMQ, pub/sub, streams) and EMQX 5.8 (HTTP auth/ACL hooked back to the API). React SPA (`apps/web`). Docker Compose behind Caddy.

**Tech Stack:** Node 24 LTS, TypeScript 5.x strict, pnpm 9, NestJS 11, Drizzle ORM + `pg`, ioredis, BullMQ, mqtt.js 5, zod 3, argon2, jose, otplib, nodemailer, @aws-sdk/client-sesv2, mjml, handlebars, socket.io 4 + @socket.io/redis-adapter, nestjs-pino. Web: React 18, Vite 6, React Router 7, TanStack Query 5, Tailwind 3 + shadcn/ui, ECharts 5, socket.io-client. Tests: Vitest 3 (+ unplugin-swc for Nest decorators), Testcontainers, Supertest, Testing Library, Playwright, bats-core, shellcheck. Firmware: Arduino C++, PubSubClient, ArduinoJson 7, arduino-cli.

**Spec:** `docs/superpowers/specs/2026-10-08-perspice-iot-design.md` (this plan implements §13 row 1; section refs below are to that spec).

## Global Constraints

- Target OS for scripts: Ubuntu 22.04+ / Debian 12+, amd64 and arm64.
- Images pinned: `timescale/timescaledb:2.17.2-pg16`, `redis:7.4-alpine`, `emqx/emqx:5.8.6` (stay on 5.8.x — 5.9+ is BSL-licensed), `caddy:2.8`, `axllent/mailpit:v1.21` (tests only).
- Alarm rules are out of scope (sub-project 3); sub-project 1 only sends **device status notifications** (online/offline/dead). Device credentials are token-only here; X.509 and basic auth arrive with AWS IoT in sub-project 4.
- Tenant isolation: cross-tenant object access returns **404**, never 403 (§12).
- Error shape everywhere: `{ code: ErrorCode, message: string, details?: unknown }` (§12).
- Passwords: Argon2id, minimum length 10 (§9). Access JWT 15 min; refresh token 30 days, rotating, reuse revokes the family (§9).
- Invite links expire after 72 h; password reset tokens after 1 h, single-use, and the response is identical whether the email exists or not (§6.3).
- Login lockout: 5 consecutive failures → locked 15 min, doubling on each further lockout, max 24 h.
- Email addresses are globally unique across platform and customers.
- Device presence defaults: `offline_timeout_s = 300`, `dead_timeout_s = 86400`; sweep every 30 s (§5.3).
- Ingest batching: flush every 250 ms or 1,000 rows (§4.1). Duplicates dropped on `(device_id, key, ts)`.
- MQTT topic root `perspice/v1/{deviceId}/…` exactly as in §5.1; ingest uses shared subscription group `ingest`.
- Device token format: `pdt_` + 43-char base64url (32 random bytes); stored as SHA-256 hex; shown once.
- API key/secret encryption: AES-256-GCM with `MASTER_KEY` (32 bytes, base64) (§9).
- All timestamps in ms since epoch (UTC) on the wire; `timestamptz` in the DB.
- Semantic versioning; `VERSION` file at repo root is the single source of truth for the version.
- Every customer-owned query goes through `ScopedRepo` (Task 8); no handler builds an unscoped query on tenant tables.

## Review Focus

1. **Bad device timestamps** — devices before NTP sync send `ts` in 1970, or in seconds instead of ms. Expect: `ts < 1e11` → treated as seconds (×1000); a resulting ts before 2020-01-01 or more than 1 h in the future → replaced by server receive time and flagged in the debug log. Test in Task 12.
2. **Stale disconnect after reconnect** — a device reconnects quickly and EMQX's `disconnected` event for the old session arrives after the new `connected`. Expect: device stays online (disconnect ignored if its `connected_at` is older than the stored session's). Test in Task 13.
3. **Oversized/hostile payloads** — 1 MB payloads, 10,000 keys, key names with `/` or SQL characters. Expect: messages > 64 KB rejected, > 200 keys rejected, keys must match `^[A-Za-z0-9_.-]{1,64}$`; rejection logged to the device debug view, worker keeps running. Test in Task 12.
4. **Device deleted or token regenerated while connected** — expect the existing MQTT session to be kicked (EMQX REST `DELETE /api/v5/clients/{id}`) and new auth to fail within the 60 s EMQX auth cache window. Test in Task 11.
5. **Cross-subdomain account confusion** — a password reset or login for a user of customer B submitted on customer A's subdomain (or a platform user on a customer subdomain). Expect: login fails with the generic invalid-credentials error, reset sends no email and returns the same 202 response. Test in Task 6.

---

## File Structure

```
package.json  pnpm-workspace.yaml  tsconfig.base.json  vitest.workspace.ts  .eslintrc.cjs  .prettierrc
VERSION  CHANGELOG.md  .gitignore  .github/workflows/ci.yml
packages/shared/src/
  index.ts  permissions.ts  roles.ts  errors.ts  protocol.ts  api-types.ts
apps/server/
  src/main.ts                     role bootstrap
  src/app.module.ts               module composition per role
  src/config/config.ts            zod-validated env
  src/common/                     problem filter, health, crypto, redis, logger, internal-secret guard
  src/db/schema/*.ts              Drizzle tables (one file per domain)
  src/db/migrations/              generated SQL + hand-written timescale SQL
  src/db/db.module.ts  scoped-repo.ts
  src/settings/                   system_setting service (encrypted)
  src/storage/                    StorageDriver + local driver
  src/email/                      drivers, templates, queue
  src/auth/                       login, sessions, tokens, totp, guards
  src/rbac/                       roles, permissions guard, scope
  src/customers/  src/users/  src/branding/  src/audit/
  src/devices/                    profiles, devices, credentials, attributes, debug log
  src/emqx/                       auth/acl hook, EMQX REST client
  src/ingest/                     mqtt client, topic router, normalizer, batch writer
  src/presence/                   presence service, sweep
  src/commands/
  src/telemetry/                  query API
  src/events/                     redis stream publisher/consumer
  src/notifications/              in-app, status notifier
  src/realtime/                   socket.io gateway
  src/scheduler/                  leader lock, job registry
  test/harness.ts  test/global-setup.ts  test/factories.ts
apps/web/src/
  main.tsx  router.tsx  api/  auth/  branding/  layout/  pages/  components/ui/
apps/simulator/src/index.ts
firmware/PerspiceClient/
deploy/docker-compose.yml  deploy/caddy/Caddyfile  deploy/emqx/emqx.conf  deploy/Dockerfile.server  deploy/Dockerfile.web
scripts/install.sh  update.sh  test.sh  perspice  lib/common.sh  test/*.bats
e2e/  (Playwright)
```

---

### Task 1: Monorepo scaffold and CI skeleton

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.workspace.ts`, `.eslintrc.cjs`, `.prettierrc`, `.gitignore`, `.gitattributes` (`* text=auto eol=lf`; `*.sh` must be LF), `VERSION` (`0.1.0-dev`), `CHANGELOG.md` (Keep a Changelog, `## [Unreleased]`), `.github/workflows/ci.yml`
- Create: `packages/shared/package.json`, `packages/shared/src/index.ts`, `packages/shared/test/version.test.ts`

**Interfaces:**
- Produces: workspace package names `@perspice/shared`, `@perspice/server`, `@perspice/web`, `@perspice/simulator`; root scripts `lint`, `typecheck`, `test:unit`, `test:integration`, `build`.

- [ ] **Step 1:** Write `packages/shared/test/version.test.ts`: reads `VERSION` from repo root and asserts it matches `/^\d+\.\d+\.\d+(-[\w.]+)?$/`.
- [ ] **Step 2:** Run `pnpm -w test:unit` — Expected: FAIL (no workspace yet / no VERSION).
- [ ] **Step 3:** Create the workspace files. `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `target ES2023`, `module NodeNext`. CI workflow jobs: `lint`, `typecheck`, `unit`, `integration` (ubuntu-latest, Docker available), each `pnpm install --frozen-lockfile` with Node 24 and pnpm 9.
- [ ] **Step 4:** Run `pnpm install && pnpm -w test:unit` — Expected: PASS (1 test).
- [ ] **Step 5:** Commit `chore: scaffold pnpm monorepo and CI`.

---

### Task 2: Shared contracts — permissions, roles, errors, protocol schemas

**Files:**
- Create: `packages/shared/src/{permissions,roles,errors,protocol,api-types}.ts`, tests `packages/shared/test/{roles,protocol}.test.ts`

**Interfaces:**
- Produces:
  - `PERMISSIONS` const array and `type Permission`: `customer.read, customer.manage, user.read, user.manage, role.manage, device.read, device.write, device.credentials, device.command, profile.read, profile.write, telemetry.read, export.data, branding.edit, system.settings, audit.read, backup.manage, notification.read`.
  - `BUILT_IN_ROLES: Record<BuiltInRoleKey, { scope: 'platform'|'customer'; permissions: Permission[] }>` with keys `super_admin` (all), `platform_admin` (all except `system.settings`, `backup.manage`), `support` (all `*.read` + `audit.read`), `customer_admin` (`user.read, user.manage, device.read, device.write, device.command, profile.read, telemetry.read, export.data, branding.edit, notification.read, audit.read`), `customer_operator` (`device.read, device.command, profile.read, telemetry.read, export.data, notification.read`), `customer_viewer` (`device.read, profile.read, telemetry.read, notification.read`).
  - `canGrant(granter: Permission[], target: Permission[]): boolean` — subset check.
  - `enum ErrorCode { VALIDATION, UNAUTHENTICATED, INVALID_CREDENTIALS, ACCOUNT_LOCKED, TOTP_REQUIRED, FORBIDDEN, NOT_FOUND, CONFLICT, RATE_LIMITED, TOKEN_INVALID, INTERNAL }`; `type Problem = { code: ErrorCode; message: string; details?: unknown }`.
  - `protocol.ts`: `TOPIC_ROOT = 'perspice/v1'`; `parseTopic(topic: string): { deviceId: string; channel: 'telemetry'|'attributes'|'status'|'cmd/ack'|'ota/progress' } | null`; `deviceTopic(deviceId, channel: 'cmd'|'config'|'ota'): string`; zod schemas `TelemetryMessage` (`{ ts?: number; values: Record<string, number|string|boolean|object> }`), `TelemetryPayload = TelemetryMessage | TelemetryMessage[]` (array max 500), `AttributesPayload`, `CommandMessage {cid, name, params}`, `CommandAck {cid, status: 'success'|'failed', result?}`, `OtaProgress`; constants `MAX_PAYLOAD_BYTES = 65536`, `MAX_KEYS_PER_MESSAGE = 200`, `KEY_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/`.
  - `api-types.ts`: DTO types shared by server/web: `MeResponse`, `BrandingDto`, `DeviceDto`, `DeviceProfileDto`, `TelemetryKeyDef {key,label,unit?,type:'number'|'string'|'boolean'|'json',decimals?}`, `CommandDef {name,label,paramsSchema?:JSONSchema,confirm:boolean}`, `DeviceStatus = 'never'|'online'|'offline'|'dead'`.

- [ ] **Step 1:** Write tests: `roles.test.ts` — `canGrant(customer_admin, customer_viewer) === true`, `canGrant(customer_viewer, customer_admin) === false`, `super_admin` contains every permission. `protocol.test.ts` — `parseTopic('perspice/v1/abc/telemetry')` → `{deviceId:'abc',channel:'telemetry'}`; `parseTopic('perspice/v1/abc/cmd/ack').channel === 'cmd/ack'`; `parseTopic('perspice/v2/abc/telemetry') === null`; `parseTopic('perspice/v1/a/b/telemetry') === null`; `TelemetryPayload.safeParse({values:{t:1}}).success`; array of 501 fails.
- [ ] **Step 2:** Run `pnpm --filter @perspice/shared test` — Expected: FAIL.
- [ ] **Step 3:** Implement the files listed above.
- [ ] **Step 4:** Run tests — Expected: PASS.
- [ ] **Step 5:** Commit `feat(shared): permissions, roles, errors, protocol contracts`.

---

### Task 3: Server skeleton — config, roles, health, problem filter, logging

**Files:**
- Create: `apps/server/package.json`, `vitest.config.ts` (unplugin-swc), `src/main.ts`, `src/app.module.ts`, `src/config/config.ts`, `src/common/{problem.filter.ts,app-error.ts,health.controller.ts,internal-secret.guard.ts,redis.module.ts}`
- Test: `apps/server/test/unit/config.test.ts`, `test/unit/problem.filter.test.ts`

**Interfaces:**
- Produces:
  - `loadConfig(env: NodeJS.ProcessEnv): Config` (zod). Keys: `PERSPICE_ROLE: 'api'|'ingest'|'rules'|'scheduler'|'all'` (default `all`), `PORT` (3000), `DATABASE_URL`, `REDIS_URL`, `MQTT_URL`, `MQTT_INGEST_USERNAME` (`perspice-ingest`), `MQTT_INGEST_PASSWORD`, `EMQX_API_URL`, `EMQX_API_KEY`, `EMQX_API_SECRET`, `INTERNAL_SECRET`, `JWT_SECRET` (≥ 32 chars), `MASTER_KEY` (base64 decoding to 32 bytes), `PUBLIC_URL`, `BASE_DOMAIN`, `STORAGE_DRIVER` (`local`), `STORAGE_LOCAL_PATH` (`/var/lib/perspice/storage`), `LOG_LEVEL` (`info`), `VAPID_*` optional.
  - `class AppError extends Error { constructor(code: ErrorCode, message: string, status: number, details?) }` plus helpers `notFound()`, `forbidden()`, `conflict(msg)`, `validation(details)`.
  - `ProblemFilter` maps `AppError`, `ZodError` (→ 400 `VALIDATION`), Nest `HttpException`, unknown (→ 500 `INTERNAL`, message `"Internal error"`, stack logged not returned).
  - `GET /health` → `{status:'ok', role, version}`; `GET /ready` → checks DB and Redis, 503 with failing deps listed.
  - `InternalSecretGuard` — requires header `x-internal-secret === INTERNAL_SECRET` (constant-time compare).
  - `REDIS` injection token (ioredis instance).
  - `main.ts`: `bootstrap(role)` — `api`/`all` start HTTP; other roles create an application context and also expose `/health` on `PORT` via a minimal HTTP listener.

- [ ] **Step 1:** Write tests: config rejects missing `DATABASE_URL`, rejects `MASTER_KEY` that is not 32 bytes, defaults role to `all`; problem filter returns 404 `{code:'NOT_FOUND'}` for `notFound()`, 400 with zod issues in `details`, 500 without stack for `new Error('x')`.
- [ ] **Step 2:** Run `pnpm --filter @perspice/server test:unit` — Expected: FAIL.
- [ ] **Step 3:** Implement. Global prefix `/api` for HTTP controllers except `/health`, `/ready`, `/internal/*`.
- [ ] **Step 4:** Run tests — Expected: PASS.
- [ ] **Step 5:** Commit `feat(server): config, role bootstrap, health, problem errors`.

---

### Task 4: Database schema, migrations, TimescaleDB, test harness

**Files:**
- Create: `apps/server/src/db/schema/{customers,users,auth,roles,devices,telemetry,notifications,audit,settings}.ts`, `src/db/schema/index.ts`, `src/db/db.module.ts`, `src/db/migrate.ts`, `drizzle.config.ts`, `src/db/migrations/0001_init.sql` (generated), `src/db/migrations/0002_timescale.sql` (hand-written)
- Create: `apps/server/test/global-setup.ts`, `test/harness.ts`, `test/factories.ts`
- Test: `apps/server/test/integration/db.test.ts`

**Interfaces:**
- Produces:
  - Drizzle tables per spec §4 for sub-project 1 entities: `customer`, `customerGroup`, `user`, `role`, `session` (id, userId, familyId, tokenHash, expiresAt, revokedAt, replacedById, userAgent, ip), `userToken` (id, userId, type `'invite'|'reset'`, tokenHash, expiresAt, usedAt), `deviceProfile`, `device` (plus `mqttSessionConnectedAt timestamptz`), `telemetry`, `telemetryLatest`, `command`, `notification`, `auditLog`, `systemSetting`, `apiKey`, `emailTemplate`. Column names snake_case in SQL.
  - `0002_timescale.sql`: `CREATE EXTENSION IF NOT EXISTS timescaledb`; `create_hypertable('telemetry','ts', chunk_time_interval => interval '1 day')`; compression `segmentby device_id,key`, policy after 7 days; continuous aggregates `telemetry_1m`, `telemetry_1h`, `telemetry_1d` over `value_num` (avg, min, max, last, count) with refresh policies (1m: every 1 min, lag 2 min; 1h: every 30 min; 1d: every 6 h).
  - `DB` injection token → `NodePgDatabase<typeof schema>`; `runMigrations(databaseUrl): Promise<void>`.
  - Test harness: `global-setup.ts` starts Timescale, Redis, EMQX (with `deploy/emqx/emqx.conf` mounted once Task 11 lands — until then EMQX optional flag), Mailpit via Testcontainers; exports URLs through `process.env`. `createTestApp(opts?: { role?: Role; overrides?: Partial<Config> }): Promise<TestApp>` where `TestApp = { app: INestApplication; http: supertest.Agent; db: DB; redis: Redis; config: Config; close(): Promise<void> }` — each call creates a fresh database `perspice_test_<random>` and runs migrations.
  - `factories.ts`: `createCustomer(db, overrides?)`, `createUser(db, {customerId?, roleKey, password?})`, `createProfile(db, overrides?)`, `createDevice(db, {profileId, customerId?})` returning rows (+ plaintext token for devices).

- [ ] **Step 1:** Write `db.test.ts`: after `createTestApp()`, `SELECT hypertable_name FROM timescaledb_information.hypertables` contains `telemetry`; inserting the same `(device_id,key,ts)` twice with `ON CONFLICT DO NOTHING` yields 1 row; `telemetry_1m` view exists.
- [ ] **Step 2:** Run `pnpm --filter @perspice/server test:integration` — Expected: FAIL.
- [ ] **Step 3:** Implement schema, generate `0001` with `drizzle-kit generate`, write `0002`, implement harness.
- [ ] **Step 4:** Run integration tests — Expected: PASS.
- [ ] **Step 5:** Commit `feat(server): database schema, timescale hypertable, test harness`.

---

### Task 5: Crypto, system settings, storage driver (local), email module

**Files:**
- Create: `src/common/crypto.ts`, `src/settings/{settings.service.ts,settings.module.ts}`, `src/storage/{storage.driver.ts,local.driver.ts,storage.module.ts}`, `src/email/{email.module.ts,email.service.ts,drivers/smtp.driver.ts,drivers/ses.driver.ts,templates/*.mjml,template.renderer.ts,email.processor.ts}`
- Test: `test/unit/crypto.test.ts`, `test/unit/template.renderer.test.ts`, `test/unit/local.driver.test.ts`, `test/integration/email.test.ts`

**Interfaces:**
- Produces:
  - `encryptSecret(plain: string, key: Buffer): string` (`v1:<iv b64>:<tag b64>:<ct b64>`), `decryptSecret(blob, key): string`; `randomToken(prefix: string, bytes = 32): string`; `sha256Hex(s): string`.
  - `SettingsService.get<T>(key: SettingKey): Promise<T|undefined>`, `set(key, value, {secret?: boolean})`. Keys: `email.driver` (`'smtp'|'ses'`), `email.smtp` (`{host,port,secure,user,pass,from}` — `pass` encrypted), `email.ses` (`{region,accessKeyId,secretAccessKey,from}`), `platform.branding`.
  - `interface StorageDriver { put(key: string, body: Buffer, contentType: string): Promise<void>; get(key): Promise<{body: Buffer; contentType: string}>; delete(key): Promise<void>; getSignedUrl(key, ttlSeconds): Promise<string>; list(prefix): Promise<string[]> }`; `LocalStorageDriver` rejects keys containing `..` or absolute paths; signed URLs are `/api/files/{key}?exp=&sig=` HMAC-SHA256 with `JWT_SECRET`; controller `GET /api/files/*` verifies.
  - `EmailService.send(templateKey: EmailTemplateKey, to: string, vars: Record<string, unknown>, ctx: { customerId?: string }): Promise<void>` — enqueues BullMQ job `email` (attempts 5, exponential backoff 30 s); `EmailService.sendTest(to)` synchronous.
  - `EmailTemplateKey = 'user_invite'|'password_reset'|'password_changed'|'device_offline'|'device_online'|'device_dead'|'test'`.
  - `renderTemplate(key, vars, branding: BrandingDto): { subject: string; html: string; text: string }` — MJML layout with logo, primary colour, product name, footer support email; Handlebars variables; customer DB override in `email_template` takes precedence over file template.
  - `POST /api/settings/email/test` (perm `system.settings`) → sends test email.

- [ ] **Step 1:** Write tests: crypto round-trip and tamper detection (flipping one ct byte throws); renderer output contains branding `productName` and a `{{link}}` variable substituted; local driver rejects `../x`; integration — configure SMTP to Mailpit, `send('password_reset', 'a@b.c', {link:'http://x'})`, poll Mailpit API `GET /api/v1/messages` until one message with subject containing "Reset" arrives (timeout 10 s).
- [ ] **Step 2:** Run unit + integration — Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit `feat(server): encrypted settings, local storage driver, email system`.

---

### Task 6: Authentication — login, sessions, lockout, invite, reset, TOTP

**Files:**
- Create: `src/auth/{auth.module.ts,auth.controller.ts,auth.service.ts,session.service.ts,password.ts,token.service.ts,totp.service.ts,jwt.guard.ts,current-user.decorator.ts,tenant-host.middleware.ts,lockout.service.ts}`
- Test: `test/integration/auth.test.ts`, `test/unit/password.test.ts`

**Interfaces:**
- Consumes: `EmailService.send`, factories, `randomToken`, `sha256Hex`.
- Produces:
  - `TenantHostMiddleware` sets `req.tenantHost: { kind: 'platform' } | { kind: 'customer'; customerId: string; slug: string } | { kind: 'unknown' }` from `Host` vs `BASE_DOMAIN` (`{slug}.{BASE_DOMAIN}` → customer, `BASE_DOMAIN` or `localhost` → platform).
  - `type AuthUser = { id; email; name; scopeType: 'platform'|'customer'; customerId: string|null; groupId: string|null; permissions: Permission[]; roleId }`; `@CurrentUser()` decorator; `JwtGuard` (global, opt-out with `@Public()`); also accepts `Authorization: Bearer pk_…` API keys (hash lookup, `last_used` update).
  - Endpoints (all under `/api/auth`):
    - `POST /login {email,password,totp?}` → `200 {accessToken, user: MeResponse}` + `Set-Cookie: pr_refresh=…; HttpOnly; Secure; SameSite=Lax; Path=/api/auth` ; `401 INVALID_CREDENTIALS` (also for wrong-host users); `401 TOTP_REQUIRED` when 2FA enabled and no code; `423 ACCOUNT_LOCKED` with `details.retryAfterSeconds`.
    - `POST /refresh` → rotates; reuse of a replaced token revokes the whole family and returns 401.
    - `POST /logout` → revokes session.
    - `POST /forgot {email}` → always `202 {}`; sends `password_reset` only if user exists, is active, and belongs to the request's tenant host.
    - `POST /reset {token,password}` → sets password, revokes all sessions, sends `password_changed`.
    - `POST /activate {token,password,name?}` → activates invited user.
    - `GET /me` → `MeResponse`.
    - `POST /totp/setup` → `{otpauthUrl, secret}`; `POST /totp/enable {code}`; `POST /totp/disable {code}`.
  - `LockoutService.registerFailure(userId)`, `.reset(userId)`, `.lockedUntil(userId): Date|null` (Redis keys `lock:fail:{id}`, `lock:until:{id}`, `lock:count:{id}`).
  - `TokenService.issue(userId, type: 'invite'|'reset'): Promise<string>`; `consume(token, type): Promise<userId>` (throws `TOKEN_INVALID` when expired/used).
  - `hashPassword(p)`, `verifyPassword(hash, p)`, `assertPasswordPolicy(p)` (min 10 chars).
  - Login rate limit: 10 req/min per IP on `/login`, `/forgot` → 429 `RATE_LIMITED` (Redis fixed-window counter `rl:{route}:{ip}`).
  - Seeded `super_admin` must have TOTP enabled before accessing anything other than `/auth/*` and `/me` once `auth.enforceTotpForSuperAdmin` setting is true (default true); otherwise 403 `TOTP_REQUIRED` with `details.setup = true`.

- [ ] **Step 1:** Write integration tests in `auth.test.ts`:
  - `login succeeds and returns access token + refresh cookie`
  - `wrong password → 401 INVALID_CREDENTIALS; 5 failures → 423 with retryAfterSeconds ≈ 900`
  - `refresh rotates; reusing old refresh token revokes family (next refresh with new token → 401)`
  - `forgot for unknown email → 202 and Mailpit receives nothing`
  - **Review Focus 5:** `customer B user logging in on customer A host → 401 INVALID_CREDENTIALS`; `platform user on customer host → 401`; `forgot for customer B user on customer A host → 202 and no email`
  - `reset token works once; second use → 400 TOKEN_INVALID; token older than 1 h → TOKEN_INVALID` (advance time with `vi.setSystemTime`)
  - `invite token valid 72 h then invalid`
  - `TOTP: enable then login without code → 401 TOTP_REQUIRED; with valid code → 200`
  - `password shorter than 10 → 400 VALIDATION`
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implement. Access JWT HS256 via `jose`, claims `{sub, sid, scope, cid}`, 15 min; permissions are loaded per request from role (cached in Redis 60 s, key `perm:{roleId}`, invalidated on role change).
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit `feat(auth): login, rotating sessions, lockout, invite/reset, TOTP`.

---

### Task 7: Audit log

**Files:**
- Create: `src/audit/{audit.module.ts,audit.service.ts,audit.interceptor.ts,audit.controller.ts,audited.decorator.ts}`
- Test: `test/integration/audit.test.ts`

**Interfaces:**
- Produces:
  - `AuditService.record(e: { actorType: 'user'|'apikey'|'system'|'device'; actorId: string|null; customerId: string|null; action: string; targetType: string; targetId: string|null; diff?: unknown; ip?: string }): Promise<void>`.
  - `@Audited(action: string, targetType: string)` method decorator + global `AuditInterceptor`: records after a successful handler using `req.params.id` or the returned `id`; `diff` = request body with keys matching `/password|token|secret|totp/i` replaced by `"[redacted]"`.
  - Auth service calls `record` directly for `auth.login`, `auth.login_failed`, `auth.logout`, `auth.password_reset`.
  - `GET /api/audit?targetType&targetId&actorId&from&to&cursor` (perm `audit.read`), scoped by customer for customer users.

- [ ] **Step 1:** Write tests: a decorated test endpoint creates an audit row with redacted `password`; customer user listing sees only own-customer rows; login failure produces `auth.login_failed`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(audit): audit log service, interceptor and API`.

---

### Task 8: RBAC, scope, ScopedRepo, customers & users API, tenant-isolation suite

**Files:**
- Create: `src/rbac/{rbac.module.ts,permissions.guard.ts,require.decorator.ts,scope.ts,roles.controller.ts,roles.service.ts,seed-roles.ts}`, `src/db/scoped-repo.ts`, `src/customers/{customers.controller.ts,customers.service.ts}`, `src/users/{users.controller.ts,users.service.ts}`
- Test: `test/unit/scope.test.ts`, `test/integration/rbac.test.ts`, `test/integration/tenant-isolation.test.ts`

**Interfaces:**
- Consumes: `AuthUser`, `canGrant`, `BUILT_IN_ROLES`, `TokenService.issue`, `EmailService.send`, `@Audited`.
- Produces:
  - `@Require(...perms: Permission[])` + `PermissionsGuard` (403 `FORBIDDEN`).
  - `type Scope = { kind: 'platform' } | { kind: 'customer'; customerId: string; groupIds: string[] | null }`; `scopeOf(user: AuthUser): Scope` (`groupIds` = user's group plus descendants, null = whole customer).
  - `ScopedRepo<T>` factory: `scoped(table, scope).where(extra?)` returns a Drizzle condition combining `customer_id = scope.customerId` (and group filter when the table has `group_id`); `findOneOr404(table, id, scope)`; platform scope passes through.
  - `seedRoles(db)` idempotent upsert of `BUILT_IN_ROLES` (`role.key` unique for built-ins).
  - Customers (`customer.manage`, platform only): `POST/GET/PATCH/DELETE /api/customers[/:id]`, body `{name, slug (^[a-z0-9-]{3,40}$, unique, not in reserved list ['www','api','admin','mqtt','app','mail']), status}`. Customer groups: `/api/customers/:id/groups` CRUD.
  - Users: `GET /api/users`, `POST /api/users/invite {email,name,roleId,customerId?,groupId?}` (customer users can only invite into their own customer; role must satisfy `canGrant`), `PATCH /api/users/:id {name,roleId,status}`, `DELETE /api/users/:id`, `POST /api/users/:id/resend-invite`. 409 `CONFLICT` on duplicate email.
  - Roles: `GET /api/roles`, `POST/PATCH/DELETE /api/roles[/:id]` (`role.manage`) for custom roles; built-ins immutable.
  - API keys: `GET/POST/DELETE /api/api-keys[/:id]` — body `{name, permissions: Permission[], expiresAt?}`; permissions must satisfy `canGrant(creator, requested)`; key `pk_` + 43-char base64url returned once, stored as SHA-256; scope = creator's scope.
  - Tenant-isolation suite: a table-driven test `describe.each(TENANT_ENDPOINTS)` where `TENANT_ENDPOINTS: Array<{ name; method; path: (ids) => string; body?; create: (ctx) => Promise<ids> }>` lives in `test/tenant-endpoints.ts`; every later task that adds a customer-owned endpoint **appends an entry**. Asserts customer-A admin gets 404 on customer-B objects for GET/PATCH/DELETE and that list endpoints never include B's rows.

- [ ] **Step 1:** Write tests: viewer calling `POST /users/invite` → 403; customer admin inviting `customer_admin` succeeds, inviting `platform_admin` → 403; customer admin inviting into another customer → 404; duplicate email → 409; invite sends `user_invite` email to Mailpit; slug `admin` rejected; API key with a permission the creator lacks → 403, created key authenticates `GET /api/devices`, expired key → 401; tenant-isolation suite with entries for users and customer groups.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(rbac): permissions, scoped repo, customers/users/roles API, isolation suite`.

---

### Task 9: Branding (platform + customer), subdomain resolution, Caddy ask

**Files:**
- Create: `src/branding/{branding.controller.ts,branding.service.ts,palette.ts}`
- Test: `test/unit/palette.test.ts`, `test/integration/branding.test.ts`

**Interfaces:**
- Consumes: `StorageDriver`, `SettingsService`, `req.tenantHost`.
- Produces:
  - `BrandingDto = { productName; logoLightUrl|null; logoDarkUrl|null; faviconUrl|null; primaryColor (#RRGGBB); accentColor; loginBackgroundUrl|null; supportEmail|null; customCss|null }`.
  - `BrandingService.resolve(customerId: string|null): Promise<BrandingDto>` — customer fields override platform fields where non-null; defaults `productName 'Perspice IoT'`, `primaryColor '#0F766E'`, `accentColor '#F59E0B'`.
  - `generatePalette(hex): Record<'50'|'100'|…|'950', string>` and `contrastRatio(a,b): number` (WCAG); editor rejects primary colour with contrast < 3:1 against white with 400 `VALIDATION` `details.contrast`.
  - `GET /api/public/branding` (public) resolves by host; `PUT /api/branding/platform` (`branding.edit` + platform scope); `PUT /api/customers/:id/branding` (platform, or `branding.edit` on own customer); `POST /api/branding/assets` multipart (png/svg/ico ≤ 1 MB; SVG sanitised with DOMPurify server-side) → `{url}`.
  - `customCss` sanitised: strip `@import`, `url(` pointing to non-relative hosts, and `expression(`.
  - `GET /internal/caddy/ask?domain=` → 200 if `domain` is `BASE_DOMAIN` or `{active customer slug}.{BASE_DOMAIN}`, else 404 (no auth; only reachable on the internal network).

- [ ] **Step 1:** Write tests: customer override merges correctly; unknown host → platform branding; ask endpoint 200 for active slug, 404 for unknown/suspended slug; `customCss` with `@import url(http://evil)` is stripped; low-contrast colour rejected.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(branding): platform/customer branding, palette, caddy ask endpoint`.

---

### Task 10: Device profiles and devices API, credentials, attributes, debug log

**Files:**
- Create: `src/devices/{devices.module.ts,profiles.controller.ts,profiles.service.ts,devices.controller.ts,devices.service.ts,credentials.service.ts,debug-log.service.ts}`
- Test: `test/integration/devices.test.ts`; append entries to `test/tenant-endpoints.ts`

**Interfaces:**
- Consumes: `ScopedRepo`, `@Require`, `@Audited`, `randomToken`, `sha256Hex`.
- Produces:
  - Profiles (`profile.write` platform-only for write; `profile.read` for read, customers see only profiles of devices they own): `/api/device-profiles` CRUD. Body: `{ name; description?; telemetrySchema: TelemetryKeyDef[]; commands: CommandDef[]; offlineTimeoutS (≥ 10, default 300); deadTimeoutS (> offlineTimeoutS, default 86400); sleepy: boolean; transport: 'mqtt'|'http'; retentionDays (default 365); statusNotify: { enabled: boolean; roleKeys: BuiltInRoleKey[]; channels: ('email'|'inapp')[] } }`.
  - Devices: `GET /api/devices?search&profileId&status&customerId&tag&cursor&limit` (returns `DeviceDto[]` with `status`, `lastSeen`, latest values from Redis), `POST /api/devices {name, profileId, customerId?, groupId?, tags?, offlineTimeoutS?, deadTimeoutS?}` → `{device, token}` (token shown once), `GET/PATCH/DELETE /api/devices/:id`, `POST /api/devices/:id/credentials/regenerate` → `{token}` (perm `device.credentials`), `PUT /api/devices/:id/attributes/server {…}`, `PUT /api/devices/:id/attributes/shared {…}` (published retained to `config` topic once Task 12 exists via `CommandsPublisher.publishConfig` — call through an `OnDeviceConfigChanged` event), `GET /api/devices/:id/debug` → last 100 entries.
  - Customer users can `PATCH` only `name`, `tags`, `groupId`, server attributes; assignment to customers is platform-only.
  - `CredentialsService.verifyToken(deviceId: string, token: string): Promise<boolean>` (Redis cache `devtok:{id}` → hash, 60 s).
  - `DevicesService.effectiveTimeouts(device, profile): { offlineS; deadS; sleepy }`.
  - `DebugLogService.push(deviceId, entry: { ts: number; kind: 'telemetry'|'attributes'|'rejected'|'connect'|'disconnect'|'command'|'ts_adjusted'; summary: string; raw?: string })` → Redis list `debug:{id}` LTRIM to 100, raw truncated to 2 KB; `list(deviceId)`.
  - Emits domain event `device.deleted` / `device.credentials_changed` via `EventBus` (Task 13 defines `EventBus`; here import the interface from `src/events/event-bus.ts` created in this task as `EventBus.publish(event: DomainEvent): Promise<void>` writing to Redis Stream `events:device` with `MAXLEN ~ 100000`). `DomainEvent` union starts with `{type:'device.deleted'|'device.credentials_changed', deviceId, customerId|null, ts}`.

- [ ] **Step 1:** Write tests: create device returns `pdt_` token of length 47 and DB stores only hash; regenerate invalidates old token for `verifyToken`; customer viewer cannot create; customer admin cannot reassign customer (403); `deadTimeoutS <= offlineTimeoutS` → 400; tenant-isolation entries for devices and attributes; debug log trims to 100.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(devices): profiles, devices, credentials, attributes, debug log`.

---

### Task 11: EMQX integration — auth/ACL hook, REST client, broker config

**Files:**
- Create: `src/emqx/{emqx.controller.ts,emqx.client.ts,emqx.module.ts,emqx-kick.listener.ts}`, `deploy/emqx/emqx.conf`
- Modify: `test/global-setup.ts` (start EMQX with `emqx.conf`, network alias so EMQX can reach the test API on a fixed port)
- Test: `test/integration/emqx-auth.test.ts`

**Interfaces:**
- Consumes: `CredentialsService.verifyToken`, `InternalSecretGuard`, `EventBus` consumer.
- Produces:
  - `POST /internal/emqx/auth {clientid, username, password}` → `{"result":"allow"|"deny","is_superuser":false}`. Rules: ingest user (`MQTT_INGEST_USERNAME` + password) → allow; device: `username === clientid === deviceId` and `verifyToken` → allow; device must exist and not be disabled.
  - `POST /internal/emqx/acl {clientid, username, topic, action}` → device may publish only `perspice/v1/{own}/(telemetry|attributes|status|cmd/ack|ota/progress)` and subscribe only `perspice/v1/{own}/(cmd|config|ota)`; ingest user may subscribe `$share/ingest/perspice/v1/#`, `$share/ingest/$SYS/brokers/+/clients/+/(connected|disconnected)` and publish `perspice/v1/+/(cmd|config|ota)`.
  - `emqx.conf`: HTTP authenticator (`POST http://api:3000/internal/emqx/auth`, header `x-internal-secret: ${INTERNAL_SECRET}`), HTTP authorizer (`/internal/emqx/acl`, `no_match = deny`, cache TTL 60 s), listeners `tcp:default` 1883, `ssl:default` 8883 (certs mounted from `/opt/emqx/etc/certs`), `ws:default` disabled, `sys_topics.sys_event_messages.client_connected = true`, `client_disconnected = true`, `mqtt.max_packet_size = 64KB`, API key bootstrap file for `EMQX_API_KEY:EMQX_API_SECRET`.
  - `EmqxClient.kick(clientId: string): Promise<void>` (`DELETE /api/v5/clients/{id}`, 404 ignored); `EmqxClient.listClients()` for the system page.
  - `EmqxKickListener` consumes `device.deleted` and `device.credentials_changed` events (consumer group `api-emqx`) → `kick(deviceId)`.

- [ ] **Step 1:** Write tests (using real EMQX container + mqtt.js): valid device connects; wrong token → connection refused (CONNACK 0x86/0x87); device publishing to another device's telemetry topic is dropped (subscribed ingest client receives nothing within 1 s); **Review Focus 4:** connected device is disconnected within 5 s after `DELETE /api/devices/:id`, and after token regenerate the old token is rejected on reconnect.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(emqx): broker auth/ACL hook, kick on revoke, broker config`.

---

### Task 12: Ingest pipeline — MQTT consumer, normaliser, batch writer, latest cache

**Files:**
- Create: `src/ingest/{ingest.module.ts,mqtt-ingest.client.ts,message-router.ts,normalize.ts,telemetry-writer.ts,latest-cache.ts,ingest.metrics.ts}`, `src/events/{event-bus.ts (extend),events.ts}`
- Test: `test/unit/normalize.test.ts`, `test/unit/telemetry-writer.test.ts`, `test/integration/ingest.test.ts`

**Interfaces:**
- Consumes: `parseTopic`, protocol schemas, `DebugLogService.push`, `EventBus.publish`, `PresenceService.touch` (Task 13 — define the interface here as `PresenceTouch { touch(deviceId: string, ts: number): Promise<void> }` and inject a no-op until Task 13 binds it).
- Produces:
  - `normalizeTelemetry(raw: Buffer, now: number): { ok: true; rows: TelemetryRow[]; adjusted: number } | { ok: false; reason: string }` where `TelemetryRow = { key; ts; valueNum|null; valueStr|null; valueBool|null; valueJson|null }`. Rules: payload > `MAX_PAYLOAD_BYTES` → reject; invalid JSON / schema → reject; any key failing `KEY_PATTERN` or > `MAX_KEYS_PER_MESSAGE` keys in a message → reject message; `ts` absent → `now`; `ts < 1e11` → `ts*1000`; resulting `ts < 1577836800000` (2020-01-01) or `ts > now + 3_600_000` → `now` and `adjusted++`.
  - `TelemetryWriter.enqueue(deviceId, rows)`; flushes at 1,000 rows or 250 ms via multi-row `INSERT … ON CONFLICT DO NOTHING` and upserts `telemetry_latest` (only when newer `ts`); on DB error, pushes batch to Redis stream `ingest:buffer` (MAXLEN 1,000,000) and retries with backoff 1 s → 30 s; replays the buffer when healthy.
  - `LatestCache.update(deviceId, rows)` → Redis hash `latest:{deviceId}` field `key` = JSON `{ts,v}` only if newer; `LatestCache.get(deviceId): Promise<Record<string,{ts:number;v:unknown}>>`.
  - `MessageRouter.handle(topic, payload)`: telemetry → normalize → writer + latest + presence touch + `EventBus.publish({type:'telemetry', deviceId, customerId, keys, ts})` + Redis `PUBLISH ws:telemetry:{deviceId}` with the latest values; attributes → merge into `device.attributes.client` (+ `firmware_version` if key `fw`); `cmd/ack` → injected `AckHandler { handleAck(deviceId, ack: CommandAck): Promise<void> }` (no-op until Task 15 binds `CommandsService`); `$SYS …/connected|disconnected` → `PresenceService.onConnected/onDisconnected` (Task 13 interface `SessionEvents`).
  - Device→customer lookup cached in Redis `devmeta:{id}` → `{customerId, profileId}` 60 s, invalidated on device update.
  - `MqttIngestClient` (role `ingest`/`all`): clean session false, clientId `perspice-ingest-{hostname}-{pid}`, subscribes QoS 1 to `$share/ingest/perspice/v1/+/+`, `$share/ingest/perspice/v1/+/+/+`, and the two `$SYS` client event topics.
  - Metrics counters: `ingest_messages_total{result}`, `ingest_rows_total`, `ingest_buffer_length`.

- [ ] **Step 1:** Write unit tests for `normalizeTelemetry` (**Review Focus 1 & 3**): seconds timestamp converted; ts 0 → now and `adjusted=1`; ts now+2 h → now; batch array preserves per-entry ts; 70 KB payload rejected with reason `payload_too_large`; 201 keys rejected; key `a/b` rejected; boolean/string/object values mapped to correct columns. Writer unit test with fake DB: 1,000 rows triggers immediate flush; 10 rows flush after 250 ms (fake timers); DB throwing → rows land in buffer stub.
- [ ] **Step 2:** Write integration test `ingest.test.ts`: device publishes 3 messages → rows in `telemetry`, `telemetry_latest` and Redis `latest:` updated within 2 s; duplicate publish of same `ts` → no extra rows; invalid payload → debug log has `rejected` entry and a following valid message is still stored.
- [ ] **Step 3:** Run — FAIL. **Step 4:** Implement. **Step 5:** Run — PASS.
- [ ] **Step 6:** Commit `feat(ingest): MQTT ingest, normalisation, batched telemetry writes, latest cache`.

---

### Task 13: Presence and offline/dead detection, scheduler leader lock

**Files:**
- Create: `src/presence/{presence.module.ts,presence.service.ts,offline-sweep.job.ts}`, `src/scheduler/{scheduler.module.ts,leader-lock.ts,job-registry.ts}`
- Test: `test/unit/presence-transitions.test.ts`, `test/integration/presence.test.ts`

**Interfaces:**
- Consumes: `DevicesService.effectiveTimeouts`, `EventBus.publish`, `DebugLogService.push`.
- Produces:
  - `PresenceService` implements `PresenceTouch` and `SessionEvents`:
    - `touch(deviceId, ts)` — `ZADD presence:last_seen ts deviceId` (only if greater, `GT`), and if current status ≠ `online` → transition to `online`.
    - `onConnected(deviceId, connectedAt: number)` — stores `session:{id}` = connectedAt, updates `device.mqttSessionConnectedAt`, transition to `online`.
    - `onDisconnected(deviceId, connectedAt: number, reason)` — **ignored if `connectedAt < stored session connectedAt`** (Review Focus 2); if profile `sleepy` → no status change; otherwise transition to `offline`.
    - `transition(deviceId, to: DeviceStatus, reason: string)` — compare-and-set via Lua on Redis hash `status:{id}`; on change: update `device.status`, publish `{type:'device.status_changed', deviceId, customerId, from, to, reason, ts}` and `PUBLISH ws:status:{customerId|'platform'}`.
    - `flushLastSeen()` — every 10 s writes `last_seen` to Postgres in one `UPDATE … FROM (VALUES …)`.
  - `nextStatus(current: DeviceStatus, lastSeen: number|null, now: number, t: {offlineS, deadS}): DeviceStatus` (pure): `null → 'never'`; `now-lastSeen ≥ deadS → 'dead'`; `≥ offlineS → 'offline'`; else unchanged (only `touch` brings a device online).
  - `OfflineSweepJob` every 30 s (scheduler role): candidates = `ZRANGEBYSCORE presence:last_seen -inf (now - minOfflineTimeout*1000)` in pages of 1,000; applies `nextStatus` with each device's effective timeouts (cached).
  - `LeaderLock.run(name, ttlMs, fn)` — Redis `SET lock:{name} {instanceId} NX PX ttl` with renewal; `JobRegistry.every(name, intervalMs, fn)` runs only on leader.

- [ ] **Step 1:** Unit tests for `nextStatus` (boundaries exactly at `offlineS` and `deadS`; `never` stays `never`).
- [ ] **Step 2:** Integration tests: device publishes once, profile offline timeout 10 s → status `offline` within 10–40 s (fake clock: call sweep directly with `now+11s`) and `device.status_changed` event emitted; sleepy profile + MQTT disconnect → stays `online` until timeout; **Review Focus 2:** connect(t=2) then late disconnect(connectedAt=t=1) → stays online; two scheduler instances → sweep runs once per interval.
- [ ] **Step 3:** Run — FAIL. **Step 4:** Implement and bind `PresenceService` into Task 12's injection tokens. **Step 5:** Run — PASS.
- [ ] **Step 6:** Commit `feat(presence): online/offline/dead detection with leader-elected sweep`.

---

### Task 14: HTTP device transport and rate limiting

**Files:**
- Create: `src/ingest/http-device.controller.ts`, `src/common/rate-limit.ts`
- Test: `test/integration/http-device.test.ts`

**Interfaces:**
- Consumes: `CredentialsService.verifyToken`, `MessageRouter.handle`. (Command poll/ack endpoints are added to this controller in Task 15.)
- Produces:
  - Device auth header `X-Device-Token`; device id derived from token lookup (`devtokidx:{sha}` → id, plus DB fallback on `credentials_hash` unique index).
  - `POST /api/v1/device/telemetry` (body = `TelemetryPayload`) → 202; `POST /api/v1/device/attributes` → 202; `GET /api/v1/device/config` → shared attributes.
  - `rateLimit(key: string, limit: number, windowS: number): Promise<{allowed: boolean; retryAfterS: number}>` (Redis fixed window). Device HTTP limit 60 req/min per device → 429 with `Retry-After`.
  - Body size limit 64 KB → 413.

- [ ] **Step 1:** Tests: valid token → 202 and data stored; bad token → 401; 61st request in a minute → 429; 70 KB body → 413; HTTP telemetry also marks the device online.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(ingest): HTTP device transport with rate limiting`.

---

### Task 15: Commands (RPC) over MQTT and HTTP

**Files:**
- Create: `src/commands/{commands.module.ts,commands.controller.ts,commands.service.ts,commands.publisher.ts,command-timeout.job.ts}`
- Modify: `src/ingest/http-device.controller.ts` (add command poll/ack endpoints)
- Test: `test/integration/commands.test.ts`

**Interfaces:**
- Consumes: profile `commands: CommandDef[]`, `ScopedRepo`, `@Require('device.command')`, `@Audited('device.command','device')`, ingest MQTT client for publishing (role `api` uses its own lightweight publisher connection with the ingest credentials).
- Produces:
  - `POST /api/devices/:id/commands {name, params?, persistUntilOnline?: boolean, ttlS?: number (default 30, max 86400)}` → `201 CommandDto {id, name, params, status, createdAt, completedAt, result}`. 400 when `name` not declared on profile or params fail `paramsSchema` (validated with Ajv).
  - `GET /api/devices/:id/commands?limit` history; `GET /api/commands/:id`.
  - `CommandsService.handleAck(deviceId, ack: CommandAck)` — only the target device's ack updates the row (`cid` + `device_id` match); late ack after timeout → ignored, logged to debug.
  - Status flow `queued → sent → success|failed|timeout`; MQTT transport publishes `{cid,name,params}` QoS 1 to `deviceTopic(id,'cmd')` immediately when device online or `persistUntilOnline=false`; queued commands are sent on `device.status_changed → online`.
  - `CommandsPublisher.publishConfig(deviceId, shared)` → retained publish to `config` topic.
  - HTTP transport: `GET /api/v1/device/commands?wait=0..30` (long-poll on Redis `BLPOP cmdq:{id}`), marks `sent`; `POST /api/v1/device/commands/:cid/ack`.
  - `CommandTimeoutJob` every 5 s: `sent` older than `ttlS` → `timeout`; `queued` past `expiresAt` → `timeout`.
  - Every status change `PUBLISH ws:command:{deviceId}`.

- [ ] **Step 1:** Tests: MQTT device subscribed to `cmd` receives message and acks → status `success` with result; undeclared command → 400; viewer → 403; no ack → `timeout` after ttl (call job with advanced clock); offline device with `persistUntilOnline` gets the command after it reconnects; ack from another device with same `cid` ignored; HTTP long-poll returns queued command and ack works; audit row recorded with params.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(commands): device commands over MQTT and HTTP with ack and timeout`.

---

### Task 16: Telemetry query API

**Files:**
- Create: `src/telemetry/{telemetry.controller.ts,telemetry.service.ts,source-select.ts}`
- Test: `test/unit/source-select.test.ts`, `test/integration/telemetry-query.test.ts`

**Interfaces:**
- Produces:
  - `selectSource(fromMs, toMs, maxPoints = 2000): 'raw'|'1m'|'1h'|'1d'` — picks the finest source where `(to-from)/bucket ≤ maxPoints` (raw assumed when range ≤ 6 h).
  - `GET /api/devices/:id/telemetry/latest` → `Record<key,{ts,v}>` (Redis, DB fallback).
  - `GET /api/devices/:id/telemetry?keys=a,b&from&to&agg=auto|raw|avg|min|max&limit` → `{ source, series: Record<key, Array<[ts, value]>> }`; for raw non-numeric values returned as stored.
  - `GET /api/devices/:id/telemetry/keys` → keys seen for device (from `telemetry_latest`).
  - Perm `telemetry.read`; tenant entries appended to isolation suite.

- [ ] **Step 1:** Tests: `selectSource` for 1 h → `raw`, 24 h → `1m` (1,440 points), 7 d → `1h` (10,080 one-minute buckets exceed 2,000), 2 y → `1d`; integration: 100 rows inserted, query returns them in ascending ts; cross-tenant → 404.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement (call `refresh_continuous_aggregate` in tests before asserting aggregate sources). **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(telemetry): latest and history query API with automatic aggregation`.

---

### Task 17: Realtime gateway, in-app notifications, device status notifier (rules role)

**Files:**
- Create: `src/realtime/{realtime.gateway.ts,realtime.module.ts}`, `src/notifications/{notifications.controller.ts,notifications.service.ts,status-notifier.consumer.ts}`
- Test: `test/integration/realtime.test.ts`, `test/integration/status-notifier.test.ts`

**Interfaces:**
- Consumes: Redis pub/sub channels `ws:telemetry:{deviceId}`, `ws:status:{customerId|'platform'}`, `ws:command:{deviceId}`, `ws:notify:{userId}`; Redis stream `events:device`; `EmailService.send`; profile `statusNotify`.
- Produces:
  - Socket.io namespace `/rt`, path `/api/socket.io`, auth via `auth.token` (access JWT), `@socket.io/redis-adapter`. Client events: `subscribe:device {deviceId}` (scope-checked; ack `{ok:false,code:'NOT_FOUND'}` otherwise), `unsubscribe:device`, `subscribe:status` (joins own customer's or platform room). Server events: `telemetry {deviceId, values}`, `status {deviceId, from, to, ts}`, `command {deviceId, command}`, `notification NotificationDto`.
  - Platform-scope sockets join room `status:platform`, which receives every customer's status events (status publisher publishes to both `ws:status:{customerId}` and `ws:status:platform`).
  - `NotificationsService.create(userId, n: {type; severity: 'info'|'warning'|'critical'; title; body; link?}): Promise<NotificationDto>` (inserts + `PUBLISH ws:notify:{userId}`); `GET /api/notifications?unread&cursor`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`, `GET /api/notifications/unread-count`.
  - `StatusNotifierConsumer` (role `rules`/`all`, consumer group `rules`): on `device.status_changed` where profile `statusNotify.enabled` and transition ∈ {online→offline, offline→dead, offline|dead→online}: recipients = active users of the device's customer whose role key ∈ `statusNotify.roleKeys`, plus platform users with role `platform_admin` or `super_admin` when `roleKeys` includes `platform_admin`; for each channel send in-app notification and/or `device_offline` / `device_dead` / `device_online` email (vars: deviceName, profileName, lastSeen, link `${PUBLIC_URL}/devices/{id}` using the customer subdomain when the user is a customer user). Per-device cooldown 5 min for repeated offline notifications (Redis key `notify:cool:{deviceId}:{to}`).

- [ ] **Step 1:** Tests: socket of customer A subscribing to customer B device → `NOT_FOUND`; subscribed socket receives `telemetry` within 2 s of an MQTT publish; status change → socket in `status` room receives event; status notifier: offline transition creates in-app notification for customer admin and email in Mailpit with device name; flapping twice within 5 min → one email.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(realtime): websocket gateway, in-app notifications, device status notifications`.

---

### Task 18: Seed, bootstrap CLI and OpenAPI docs

**Files:**
- Create: `src/cli.ts` (commands: `migrate`, `seed`, `create-admin --email --name`, `health`), `src/db/seed.ts`, `src/openapi.ts`
- Test: `test/integration/cli.test.ts`

**Interfaces:**
- Produces:
  - `node dist/cli.js migrate` — runs migrations (idempotent).
  - `seed` — built-in roles; default profiles `Generic Sensor` (keys temperature/humidity, offline 300 s) and `Telecom RMS` (keys `mains_v`, `gen_running`, `fuel_level`, `batt_v`, `door_open`; commands `gen_start`, `gen_stop` with `confirm:true`; `statusNotify` enabled for `customer_admin`, `platform_admin`, channels email+inapp); default email templates loaded from files.
  - `create-admin` — creates `super_admin`, issues invite token, prints `${PUBLIC_URL}/activate?token=…` and also emails it if SMTP configured. Exits 1 if a super admin already exists unless `--force`.
  - Swagger UI at `/api/docs` (disabled when `NODE_ENV=production` and setting `api.docsPublic` false; then requires login).

- [ ] **Step 1:** Tests: `seed` twice → no duplicates; `create-admin` prints activation URL and second run exits 1.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(server): CLI for migrate/seed/create-admin and OpenAPI docs`.

---

### Task 19: Web app foundation — theming, auth flows, app shell

**Files:**
- Create: `apps/web/{package.json,vite.config.ts,tailwind.config.ts,index.html}`, `src/{main.tsx,router.tsx}`, `src/api/{client.ts,query.ts}`, `src/auth/{AuthProvider.tsx,LoginPage.tsx,TotpStep.tsx,ForgotPage.tsx,ResetPage.tsx,ActivatePage.tsx,RequirePermission.tsx}`, `src/branding/{BrandingProvider.tsx,applyTheme.ts}`, `src/layout/{AppShell.tsx,Sidebar.tsx,Topbar.tsx,ThemeToggle.tsx}`, `src/components/ui/*` (shadcn: button, input, label, card, dialog, dropdown-menu, table, badge, toast, form, select, tabs, tooltip, skeleton)
- Test: `apps/web/src/**/*.test.tsx`

**Interfaces:**
- Consumes: `/api/public/branding`, `/api/auth/*`, `MeResponse`, `ErrorCode`.
- Produces:
  - `apiClient` (`fetch` wrapper): attaches in-memory access token, on 401 calls `/api/auth/refresh` once (single in-flight promise) and retries; throws `ApiError {code, message, details, status}`.
  - `useAuth(): { user: MeResponse|null; login(email, password, totp?); logout(); hasPerm(p: Permission): boolean }`.
  - `applyTheme(b: BrandingDto)` sets CSS variables `--color-primary-{50..950}`, `--color-accent`, document title, favicon; Tailwind colors reference the variables. Light/dark via `class="dark"` with a toggle stored in `localStorage` (`perspice.theme`).
  - Routes: `/login`, `/forgot`, `/reset?token`, `/activate?token`, and authenticated shell `/` (overview placeholder), `/devices`, `/devices/:id`, `/profiles`, `/customers`, `/users`, `/settings/*`, `/audit`. Sidebar items are hidden without their permission.
  - Login page shows `ACCOUNT_LOCKED` retry time and switches to `TotpStep` on `TOTP_REQUIRED`.

- [ ] **Step 1:** Tests (Vitest + Testing Library + msw): login success navigates to `/`; `TOTP_REQUIRED` shows code input; locked account shows "Try again in 15 minutes"; `applyTheme({primaryColor:'#0F766E',…})` sets `--color-primary-500`; viewer does not see "Users" in sidebar; apiClient retries once after refresh.
- [ ] **Step 2:** Run `pnpm --filter @perspice/web test` — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(web): branded theming, auth flows and app shell`.

---

### Task 20: Web — administration pages (customers, users, roles, branding, settings, audit)

**Files:**
- Create: `apps/web/src/pages/customers/{CustomersPage.tsx,CustomerDetailPage.tsx,CustomerBrandingForm.tsx}`, `pages/users/{UsersPage.tsx,InviteUserDialog.tsx}`, `pages/roles/RolesPage.tsx`, `pages/settings/{BrandingSettings.tsx,EmailSettings.tsx,SecuritySettings.tsx,ProfileSettings.tsx}` (own profile: name, password, TOTP enrol with QR via `qrcode`), `pages/audit/AuditPage.tsx`, `components/BrandingEditor.tsx` (colour pickers with live contrast badge, logo upload, preview)
- Test: co-located `*.test.tsx`

**Interfaces:**
- Consumes: Task 8, 9, 5, 7 endpoints.
- Produces: pages registered in `router.tsx`; `BrandingEditor` reused for platform and customer branding.

- [ ] **Step 1:** Tests: invite dialog only lists roles the current user can grant (uses `canGrant`); slug field validates `^[a-z0-9-]{3,40}$`; contrast badge shows "Fails" for `#FFFF00`; email settings "Send test" shows success toast on 200 and error message on failure; TOTP enrol flow shows QR then confirms code.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(web): administration pages`.

---

### Task 21: Web — device profiles, devices list/detail, live data, commands, notifications bell

**Files:**
- Create: `apps/web/src/realtime/socket.ts`, `pages/profiles/{ProfilesPage.tsx,ProfileEditor.tsx,TelemetryKeysEditor.tsx,CommandsEditor.tsx}`, `pages/devices/{DevicesPage.tsx,DeviceDetailPage.tsx,CreateDeviceDialog.tsx,CredentialsPanel.tsx,LatestValuesPanel.tsx,HistoryChart.tsx,CommandsPanel.tsx,AttributesPanel.tsx,DebugPanel.tsx,StatusBadge.tsx}`, `pages/overview/OverviewPage.tsx` (KPI tiles total/online/offline/dead/never + device table — the full overview dashboard arrives in sub-project 2), `layout/NotificationsBell.tsx`
- Test: co-located `*.test.tsx`

**Interfaces:**
- Consumes: Tasks 10, 15, 16, 17 endpoints and socket events.
- Produces:
  - `useDeviceLive(deviceId)` → `{ latest, status }` merging REST snapshot with `telemetry`/`status` socket events; `useStatusFeed()` for list pages.
  - Device detail tabs: Overview (latest values with profile labels/units/decimals, status, last seen), History (ECharts line chart, key multi-select, ranges 1 h/24 h/7 d/30 d/custom, shows `source`), Commands (declared commands, params form from JSON schema, confirm dialog when `confirm`, live status), Attributes, Credentials (connection snippet for Arduino with MQTT host, port, device id; token shown once after create/regenerate with copy button), Debug (live-refreshing raw log).
  - `StatusBadge` colours: online green, offline amber, dead red, never grey — with text label (not colour only).
  - Bell: unread count, dropdown list, mark read, toast on `notification` event.

- [ ] **Step 1:** Tests: `StatusBadge` renders text for each status; latest-value panel formats `fuel_level` 64.567 with decimals 1 → `64.6 %`; command with `confirm:true` opens dialog before POST; status socket event updates row badge without refetch; token panel hides token after dialog close; bell increments on `notification` event.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(web): profiles, devices, live data, commands, notifications`.

---

### Task 22: Docker images and Compose stack

**Files:**
- Create: `deploy/Dockerfile.server` (multi-stage, `node:24-bookworm-slim`, non-root user, `tini`, `HEALTHCHECK` on `/health`), `deploy/Dockerfile.web` (build → `caddy:2.8` image containing `/srv/web`), `deploy/docker-compose.yml`, `deploy/caddy/Caddyfile`, `deploy/env.example`, `.dockerignore`
- Test: `deploy/test/compose-smoke.sh` (used by CI and `test.sh --live`)

**Interfaces:**
- Produces:
  - Compose services: `caddy` (ports 80, 443; volumes `caddy_data`, `caddy_config`; serves `/srv/web`, proxies `/api/*`, `/health` to `api:3000`), `api` (`PERSPICE_ROLE=api`), `ingest`, `rules`, `scheduler`, `postgres` (volume `pg_data`, `shm_size: 1g`), `redis` (`appendonly yes`, volume `redis_data`), `emqx` (ports 1883, 8883; volumes `emqx_data`, `./emqx/emqx.conf`, `./certs`), profile `mail-test` with `mailpit`. All services `restart: unless-stopped`, healthchecks, `depends_on: condition: service_healthy`. Image names `ghcr.io/${PERSPICE_IMAGE_OWNER}/perspice-server:${PERSPICE_VERSION}` and `perspice-web:${PERSPICE_VERSION}`.
  - A one-off `migrate` service (`command: ["node","dist/cli.js","migrate"]`, `restart: "no"`) that `api` depends on with `service_completed_successfully`.
  - Caddyfile: site `{$BASE_DOMAIN}, *.{$BASE_DOMAIN}`; `tls { on_demand }` with global `on_demand_tls { ask http://api:3000/internal/caddy/ask }` unless `CADDY_DNS_PROVIDER` set (then DNS-01 wildcard — documented, plugin build `caddy-dns/cloudflare` and `route53` via a `Dockerfile.caddy` with xcaddy); security headers (HSTS, `X-Content-Type-Options`, `Referrer-Policy`, CSP allowing self + OSM tiles); `/internal/*` returns 404 from outside.
  - EMQX TLS: Caddy obtains a cert for `mqtt.{BASE_DOMAIN}` and a small `cert-sync` sidecar (alpine + inotify) copies it into `./certs` and calls `emqx ctl` reload. Plain 1883 enabled by default (`MQTT_PLAIN_ENABLED=true`), shown as a warning on the System page later.

- [ ] **Step 1:** Write `compose-smoke.sh`: brings stack up with `deploy/env.example` values (`BASE_DOMAIN=localhost`), waits ≤ 180 s for `curl -fsS http://localhost/health`, creates admin via `docker compose exec api node dist/cli.js create-admin`, publishes one MQTT message with `mosquitto_pub` (from `eclipse-mosquitto` container) using a device created through the API, asserts `/api/devices/:id/telemetry/latest` returns it, tears down.
- [ ] **Step 2:** Run `bash deploy/test/compose-smoke.sh` — Expected: FAIL (no images).
- [ ] **Step 3:** Implement Dockerfiles, compose, Caddyfile.
- [ ] **Step 4:** Run smoke — Expected: PASS ("SMOKE OK").
- [ ] **Step 5:** Commit `feat(deploy): docker images and compose stack`.

---

### Task 23: install.sh, update.sh, test.sh, perspice CLI wrapper

**Files:**
- Create: `scripts/lib/common.sh` (logging, `require_root`, `detect_os`, `version_gt`, `wait_healthy`), `scripts/install.sh`, `scripts/update.sh`, `scripts/test.sh`, `scripts/perspice` (wraps `docker compose -f /opt/perspice/docker-compose.yml`: `status`, `logs [svc]`, `restart [svc]`, `cli <args>` → api `dist/cli.js`, `version`, `db-snapshot`, `db-restore <file>`), `scripts/test/{common.bats,install.bats,update.bats}`
- Test: bats tests + `shellcheck scripts/**/*.sh scripts/perspice` in CI

**Interfaces:**
- Produces:
  - Install dir `/opt/perspice` (compose file, `.env` mode 600, `emqx/`, `caddy/`, `certs/`, `backups/`); env var `PERSPICE_HOME` overrides for tests.
  - `install.sh` flags: `--domain`, `--admin-email`, `--admin-name`, `--version` (default: latest GitHub release tag, read from `https://api.github.com/repos/<owner>/perspice-iot/releases/latest`; `--version` required when offline), `--smtp-host/--smtp-port/--smtp-user/--smtp-pass/--smtp-from`, `--mqtt-plain=true|false`, `--build` (build images from local checkout), `--non-interactive`, `--reinstall`, `--dry-run` (prints actions; used by bats). Steps exactly as spec §10.4 install 1–8. Minimums: 2 vCPU, 4 GB RAM, 20 GB free disk (warn, not fail, below; fail below 2 GB RAM).
  - Secrets generated with `openssl rand`: `POSTGRES_PASSWORD`, `JWT_SECRET` (48 bytes b64), `MASTER_KEY` (32 bytes b64), `INTERNAL_SECRET`, `MQTT_INGEST_PASSWORD`, `EMQX_API_KEY/SECRET`, `EMQX_DASHBOARD_PASSWORD`, VAPID keys (generated by `cli.js vapid-keys` after pull).
  - `update.sh [--version vX.Y.Z] [--yes]`: reads current `PERSPICE_VERSION` from `.env`; refuses downgrade without `--allow-downgrade`; **pre-update DB snapshot** `perspice db-snapshot` → `backups/pre-update-<from>-<ts>.dump` (sub-project 4 replaces this with the full backup system; keep only the newest pre-update snapshot); pulls images; runs `migrate`; restarts `ingest`, `rules`, `scheduler`, `api` in order with `wait_healthy` each (120 s); synthetic check (`cli.js health --mqtt-roundtrip`); on failure: set previous version, `docker compose up -d`, and if migrations ran, `db-restore` the snapshot; exit non-zero with a clear message. Writes `/opt/perspice/update.log`.
  - `test.sh [--unit|--integration|--e2e|--load|--live <url>|--all]` default `--unit --integration --e2e`; exits non-zero on first failing suite; prints a summary table. `--live` runs `e2e/live.spec.ts` against the URL with `PERSPICE_LIVE_ADMIN_TOKEN` (an API key the operator creates).
  - `cli.js health --mqtt-roundtrip` (add to Task 18's CLI here): creates a temporary device, publishes via MQTT, verifies latest value, deletes device; exit 0/1.

- [ ] **Step 1:** Write bats tests: `detect_os` accepts Ubuntu 22.04/24.04 and Debian 12 fixture `os-release` files, rejects CentOS; `version_gt 0.2.0 0.1.9` true; `install.sh --dry-run --non-interactive --domain example.com --admin-email a@b.c` prints steps including "Install Docker" when `docker` is absent (PATH stubbed) and writes `.env` with mode 600 and all secret keys non-empty into a temp `PERSPICE_HOME`; re-run without `--reinstall` exits 2 "existing installation"; `update.sh --dry-run --version 0.0.1` refuses downgrade; update rollback path invoked when stubbed health check fails (stubbed `docker` records calls; assert `db-restore` called).
- [ ] **Step 2:** Run `bats scripts/test` — FAIL. **Step 3:** Implement scripts; `shellcheck` clean. **Step 4:** Run bats + shellcheck — PASS.
- [ ] **Step 5:** Commit `feat(scripts): install, update (with rollback), test and perspice CLI`.

---

### Task 24: Device simulator CLI

**Files:**
- Create: `apps/simulator/{package.json,src/index.ts,src/device.ts,src/profiles.ts}`
- Test: `apps/simulator/test/simulator.test.ts`

**Interfaces:**
- Produces: `perspice-sim --url <api> --api-key <pk_…> --mqtt <mqtt://host:1883> --profile <name|id> --count 100 --interval 10 --duration 600 [--create] [--sleepy] [--http] [--report json]`. `--create` provisions devices via API (`sim-{n}`) and stores tokens in `./.sim-devices.json`; values generated per profile key with random walk; devices ack commands (`success` with `{"echo":params}`); prints msg/s and, with `--measure-latency`, end-to-end latency via a socket.io subscription to 1% of devices (p50/p95). Exit code 1 if p95 > `--max-p95-ms` (default 2000).

- [ ] **Step 1:** Test: random-walk generator stays within key bounds; against test stack (reuse server harness via `PERSPICE_TEST_API_URL`), `--count 5 --duration 5 --create` stores rows for 5 devices.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(simulator): device simulator and latency measurement`.

---

### Task 25: Arduino/ESP32 PerspiceClient library

**Files:**
- Create: `firmware/PerspiceClient/{library.properties,README.md,src/PerspiceClient.h,src/PerspiceClient.cpp,src/PerspiceBuffer.h,src/PerspiceBuffer.cpp,src/PerspiceConfig.h}`, `examples/{BasicSensor,GeneratorController,DeepSleepSensor}/…ino`, `firmware/test/buffer_test.cpp` (host-compiled with g++ for the ring buffer), `.github/workflows/firmware.yml`

**Interfaces:**
- Produces:
  - `struct PerspiceConfig { const char* host; uint16_t port = 1883; const char* deviceId; const char* token; bool useTls = false; uint16_t keepAliveS = 30; uint16_t bufferCapacity = 64; }`.
  - `class PerspiceClient { PerspiceClient(Client& net); bool begin(const PerspiceConfig&); void loop(); bool sendTelemetry(JsonDocument& values, uint64_t tsMs = 0); bool setAttribute(const char* key, JsonVariantConst v); void onCommand(const char* name, CommandHandler h); void onConfig(ConfigHandler h); bool isConnected(); uint64_t nowMs(); }` where `using CommandHandler = bool(*)(JsonVariantConst params, JsonDocument& result);`.
  - Behaviour: MQTT clientId/username = deviceId, password = token; LWT on `status` payload `offline` retained; on connect publishes `online` retained, subscribes `cmd` and `config`; reconnect back-off 1 s doubling to 60 s; NTP via `configTime` on ESP32, and on AVR an SNTP-less mode where `ts` is omitted (server stamps); telemetry while disconnected goes to `PerspiceBuffer` (ring buffer, drops oldest when full, RAM; ESP32 optionally LittleFS when `PERSPICE_BUFFER_FLASH` defined) and is flushed oldest-first as batched array (≤ 10 per message) on reconnect; command handler result published to `cmd/ack` with `cid`; unknown command → ack `failed` `{"error":"unknown_command"}`. MQTT buffer size set to 1024 bytes.
  - Examples: `BasicSensor` (W5500 Ethernet on ESP32, temperature every 10 s), `GeneratorController` (relay pin, `gen_start`/`gen_stop` commands, `gen_running` telemetry), `DeepSleepSensor` (Wi-Fi, connect → send → wait ack of publish → deep sleep 300 s).
  - CI: `arduino-cli compile` for `esp32:esp32:esp32` (all examples) and `arduino:avr:mega` (BasicSensor with `Ethernet.h` W5100/W5500 variant).

- [ ] **Step 1:** Write `buffer_test.cpp`: push 70 items into capacity 64 → size 64, oldest dropped, pop order FIFO.
- [ ] **Step 2:** Run `g++ -std=c++17 -I firmware/PerspiceClient/src firmware/test/buffer_test.cpp firmware/PerspiceClient/src/PerspiceBuffer.cpp -o /tmp/bt && /tmp/bt` — FAIL.
- [ ] **Step 3:** Implement library and examples.
- [ ] **Step 4:** Run buffer test — PASS; run `arduino-cli compile` for each target — all compile.
- [ ] **Step 5:** Commit `feat(firmware): PerspiceClient Arduino/ESP32 library with examples`.

---

### Task 26: End-to-end tests, live test, release v0.1.0

**Files:**
- Create: `e2e/{playwright.config.ts,fixtures.ts,core-flow.spec.ts,live.spec.ts}`, `docs/{install.md,device-protocol.md,firmware.md,operations.md}`
- Modify: `VERSION` → `0.1.0`, `CHANGELOG.md`, `.github/workflows/ci.yml` (add `e2e` and `release` on tag `v*`: build + push images to GHCR, create GitHub release)

**Interfaces:**
- Consumes: compose stack (Task 22) with `mail-test` profile, simulator, Mailpit API.

- [ ] **Step 1:** Write `core-flow.spec.ts` (one test per success criterion that the UI covers):
  - super admin activates via emailed link, enrols TOTP, logs in
  - creates customer `acme`, sets customer branding (primary `#1D4ED8`), invites customer admin; customer admin activates on `acme.localhost` and sees blue theme
  - platform admin creates `Telecom RMS` device for `acme`; simulator device publishes; device detail shows live `fuel_level` within 2 s (criterion 2)
  - simulator stops; after the profile's 10 s offline timeout + sweep, badge shows Offline and Mailpit has `device_offline` email to customer admin and bell shows notification (criterion 3)
  - customer admin sends `gen_start` (confirm dialog) and sees `success` (simulator acks)
  - customer admin cannot open a device of customer `beta` by URL (404 page) (criterion 5)
- [ ] **Step 2:** Run `scripts/test.sh --e2e` — iterate until PASS.
- [ ] **Step 3:** Write `live.spec.ts` (health, create temp device, MQTT round trip, delete) and run `scripts/test.sh --live http://localhost` against the compose stack — PASS.
- [ ] **Step 4:** Write docs: install guide (DNS records: `A @`, `A *`, `A mqtt`; ports 80/443/8883/1883), device protocol (§5.1–5.4 with examples), firmware guide, operations (update, logs, snapshot).
- [ ] **Step 5:** Run full `scripts/test.sh --all` (unit, integration, e2e, load with `--count 1000 --interval 10 --duration 120` as the reduced CI load gate) — PASS.
- [ ] **Step 6:** Bump `VERSION` to `0.1.0`, finalise `CHANGELOG.md`, commit `chore(release): v0.1.0`, tag `v0.1.0`.

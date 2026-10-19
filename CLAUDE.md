# Perspice IoT

A self-hosted, white-label IoT platform (see README.md): NestJS server, React web app, an
Arduino/ESP32 device library, deployed as a Docker Compose stack. Written and maintained with
Claude Code. This file is the map; each area has its own guide.

| Area | Where | Guide |
|---|---|---|
| Web app (UI, design system, phone layouts, demo mode) | `apps/web` | `apps/web/CLAUDE.md` |
| Widgets for dashboards | `packages/widgets` | `docs/widgets.md` |
| Server (REST, MQTT ingest, rules, scheduler, PDF renderer) | `apps/server` | below |
| Types and schemas shared by server and web | `packages/shared` | below |
| Device library (ESP32, ESP32-S3, Mega) | `firmware` | `firmware/CLAUDE.md` |
| Device simulator / load generator | `apps/simulator` | `docs/load-test.md` |
| End-to-end tests, UI screenshots | `e2e` | below |
| Deployment (Compose, Caddy, EMQX, monitoring) | `deploy`, `scripts` | `docs/install.md`, `docs/operations.md` |
| Original design and build plans | `docs/superpowers` | read for the "why" of a feature |

## Toolchain

Node 24 and pnpm 9.15.9 (`corepack pnpm`). A monorepo (`pnpm-workspace.yaml`); the web app and
widgets consume `@perspice/shared` and `@perspice/widgets` as TypeScript source through path
aliases, so there is nothing to build between packages.

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test:unit     # what CI runs first (.github/workflows/ci.yml)
pnpm test:integration                              # server against real Postgres/Timescale, Redis, Mailpit (testcontainers: needs Docker)
e2e/run.sh core                                    # Playwright against a fresh stack (Docker); projects in e2e/playwright.config.ts
pnpm --filter @perspice/web dev:demo               # the web app on mock data, no server or Docker
node e2e/screenshots.mjs http://localhost:5173 /tmp/shots   # phone + desktop screenshots of it
```

Without Docker you can still typecheck, lint, run unit tests, run the web app in demo mode and
take screenshots. Integration and e2e then run in CI only; say so when handing work over.

## Server in brief

- One image, several roles (`PERSPICE_ROLE`): `api`, `ingest`, `rules`, `scheduler`, `renderer`
  (`apps/server/src/main.ts`, `system/system.service.ts`). One NestJS module per domain under
  `apps/server/src/` (devices, telemetry, dashboards, alarms, assets, energy, location, firmware…).
- Postgres with TimescaleDB through Drizzle: schema in `src/db/schema`, SQL migrations in
  `src/db/migrations` (`pnpm --filter @perspice/server db:generate`), seed (roles, default profiles
  and dashboards) in `src/db/seed.ts`.
- Multi-tenant: everything is scoped to the viewer's customer. Use the scoped helpers
  (`src/db/scoped-repo.ts`) and permission guards (`src/rbac`) like the neighbouring code does.
- Devices speak MQTT through EMQX (or HTTP, or AWS IoT Core); the protocol is
  `docs/device-protocol.md` and `packages/shared/src/protocol.ts`. A protocol change touches the
  server, shared, the firmware library and the docs together.
- Default dashboards are generated from a profile (`src/dashboards/defaults.ts`); widgets only
  exist on the client, the server stores their type and settings.

## Conventions

- Match the surrounding code: comments say why in full sentences, names are plain words, types come
  from `packages/shared`. The repo isn't Prettier-clean, so don't reformat files wholesale.
- UI work follows `apps/web/CLAUDE.md` (design tokens, phone rules), and every change gets looked
  at in demo mode at phone and desktop width.
- Tests sit next to the code (`*.test.ts(x)`) in web; in `test/unit` and `test/integration` in the
  server; `packages/widgets/test`.
- User-facing changes go in `CHANGELOG.md` under `[Unreleased]`; user docs live in `docs/` and the
  in-app help (`apps/web/src/help/content`).

## Git and releases

- `master` is the main branch; work goes through PRs. CI runs on PRs and pushes to `master`.
- Platform releases are `vX.Y.Z` tags (they start `release.yml`, which builds the images); `VERSION`
  holds the current one. Firmware library releases are `firmware-vX.Y.Z`, marked not latest
  (`firmware/CLAUDE.md` › Releasing).
- Integration tests used to flake on timing (#9–#11 fixed the known causes). A red run on
  `master` that passed on its PR is worth one look at the log before re-running.

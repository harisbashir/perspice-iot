# Phase 6b: Large, resumable downloads (platform)

**Goal:** firmware files up to 64 MB (Nextion `.tft` files are often 5–30 MB) upload without
buffering in memory, and devices can resume an interrupted download where it stopped, which matters on
weak links.

**Ships as:** platform minor (can be combined with 6a's release if both are ready). **Size:** S.

## Findings to start from

- Signed file links are served by `apps/server/src/storage/files.controller.ts`, which sends the whole
  object with `content-length` and **no `Range` support**. S3 presigned links (direct downloads)
  already support ranges.
- The firmware upload takes the image as a raw request body (`firmware.controller.ts`); check whether
  the body is buffered (it likely is) and what limits Caddy and Nest apply (16 MB today,
  `FIRMWARE_MAX_BYTES` in `packages/shared/src/fleet.ts`).

## Scope decisions

| Item | Decision |
|---|---|
| Range | `GET` on signed links honours a single `Range: bytes=N-` or `bytes=N-M` (206 with `content-range`; 416 when out of range), for the local driver. Multiple ranges aren't needed. |
| Upload | Stream the request body to storage while hashing (SHA-256), enforcing the per-kind limit as bytes arrive; no full buffering. Caddy request body limit raised for `/api/firmware` only. |
| Link lifetime | OTA links stay valid long enough for slow links: 24 h as today; a resumed download asks for the OTA message again (`GET /api/v1/device/ota`) if its link expired. |
| Limits | Raise `nextion-tft` and `custom` to 64 MB once this ships (6a keeps 16 MB until then). |

## Compatibility

Pure platform change. Clients that don't send `Range` get the whole file as before.

## Tasks

- [ ] 1. Range support in the files controller (local driver: `createReadStream({ start, end })`).
      Unit/integration tests: full, open-ended, bounded, invalid ranges, `If-Range` not needed.
- [ ] 2. Streaming firmware upload with hashing and limits; memory stays flat for a 60 MB upload
      (integration test asserting the object size and hash; measure RSS in the PR).
- [ ] 3. Caddy route limit for uploads (`deploy/caddy`), smoke test in CI (`compose-smoke.sh` uploads a
      20 MB dummy image).
- [ ] 4. Raise the per-kind limits; docs (`docs/fleet.md` sizes, resume), CHANGELOG.

## Done when

A 30 MB `.tft` uploads through the web app, and `curl -r 1000000- <link>` returns the rest of the file
with status 206.

The **System** page and the system settings are for super admins (`system.settings`). They cover the server itself: health, backups, email, security and maps. Updating the server is done from its command line.

## Health

**System** shows, refreshing on its own:

- **Instance**: the version running, and figures such as **Devices online**, **Messages / min** and **Browser sessions**;
- **Processes**: each service (`api`, `ingest`, `rules`, `scheduler`, `renderer`) with its **role** and **status**. A process that stops reporting shows here first;
- **Queues**: background work **waiting**, **active** and **failed** (emails, notifications, webhooks, exports, reports, backups);
- **Database** and **Storage** usage.

**Run check** (under *Checks and setup*) connects a temporary device to the broker, sends a value and waits for it to be stored: if it works, devices can connect and their data arrives. It is the same check as `perspice cli health --mqtt-roundtrip`.

On the server, `perspice status` lists the containers and their health, and `perspice logs <service>` follows one service's log.

## Push notifications

If the server configuration has no push (VAPID) keys, **Set up push notifications** creates them and stores them encrypted. People can then turn on push under **Settings → Notifications**. It can only be done once: new keys would cut off every browser already subscribed.

## Backups

A backup holds the whole database and stored files (logos, images, firmware), encrypted with the **backup passphrase** from `/opt/perspice/.env`. **Without the passphrase no backup can be restored: keep a copy of it away from the server.**

- **Back up now**, or set a daily schedule (**At** a time in a **Timezone**, then **Save schedule**).
- **Download latest** to keep copies elsewhere. Only the newest backup is kept on the server, so download or copy backups for history. From the server: `sudo perspice backup /path/file.pbk`.
- A failed backup leaves the previous one in place and notifies platform admins.

**Restore** replaces **all** data and files with the backup's. Choose the `.pbk` file and confirm; the platform shows a maintenance banner and is unavailable while it runs. Restores go into a fresh database that replaces the live one only once it succeeded, so a failed restore leaves your data as it was. A backup can also be restored on the server with `sudo perspice restore <file>`. The server's `MASTER_KEY` must be the same as when the backup was made (it encrypts stored secrets), unless the backup includes it.

## Email

**Settings → Email**: the **driver** (SMTP, or Amazon SES with an access key and region), the server details and the **From address**, e.g. `Acme IoT <no-reply@example.com>`. **Send a test email** to check. Without email, invites (copy the link from **Users** instead), password resets, alarm emails and scheduled reports can't be delivered.

## Security

**Settings → Security**:

- **Require two-factor authentication for super admins** (recommended).
- **Public API documentation**: serve the interactive API docs (Swagger) at `/api/docs` to anyone, without signing in (after a restart). Signed-in users can always download the spec from `/api/docs/openapi.json`.

Sign-in is rate-limited and accounts lock after 5 wrong passwords. Web pages are served over HTTPS with strict security headers; device tokens, API keys and passwords are stored only as hashes, and stored secrets (SMTP password, webhook secrets, two-factor secrets) are encrypted with `MASTER_KEY`.

## Maps

**Settings → Maps** sets the map tile server: the **Tile URL** with `{z}`, `{x}`, `{y}` (and `{s}` for subdomains), the **attribution** shown on maps, and the **maximum zoom**. Browsers only load tiles from hosts listed in `MAP_TILE_HOSTS` in `/opt/perspice/.env`; add the host there and run `perspice restart caddy` first. OpenStreetMap's public tiles are the default; for heavy use, run or rent a tile server.

## Updating the server

When a newer release is published, the System page says so, with a link to what's new and the command to copy. (It asks GitHub every few hours; offline servers show nothing.) On the server:

```bash
sudo perspice update                    # the latest release
sudo perspice update --version 1.0.2    # a given release
```

The update takes a backup and a database snapshot, pulls the new images, migrates the database, restarts the services in order and checks that devices can still send data. If anything fails, it rolls back to the previous version and data automatically. Details go to `/opt/perspice/update.log`. Installs built from source update with `--source <dir or tarball>`.

## Useful commands

| Command | Does |
|---|---|
| `perspice status` | services and health |
| `perspice logs [service]` | follow logs |
| `perspice restart [service]` | restart all or one service |
| `perspice version` | the installed version |
| `perspice backup [file]`, `perspice restore <file>` | full backups |
| `perspice cli health --mqtt-roundtrip` | end-to-end check: publish → ingest → stored |
| `perspice cli create-admin` | create another super admin |

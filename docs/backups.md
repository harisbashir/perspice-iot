# Backups

A backup holds everything needed to rebuild an installation's data:

- the database (devices, telemetry, dashboards, users, settings, alarms…), as a `pg_dump`;
- stored files: uploaded images, logos, firmware (not exports, which are temporary);
- a manifest with checksums, the version and the newest migration;
- optionally the `MASTER_KEY` (see below).

It is one `.pbk` file, compressed (zstd) and encrypted with AES-256-GCM under a key derived from `BACKUP_PASSPHRASE` (scrypt). Without the passphrase it can't be read; a changed or truncated file is refused.

## Setting up

Backups need `BACKUP_PASSPHRASE` (16 characters or more) in `/opt/perspice/.env`. The installer and `perspice update` generate one. **Keep a copy of it somewhere other than the server**: a backup is useless without it.

The server's `MASTER_KEY` encrypts stored secrets (SMTP password, webhook secrets, two-factor secrets). A restore needs the same `MASTER_KEY`. Either keep it with the passphrase (recommended), or set `BACKUP_INCLUDE_MASTER_KEY=true` to put it inside every backup — only if wherever backups are kept is as trusted as the server itself.

## Making backups

**System → Backups** (super admins and platform admins) shows the latest backup and lets you:

- **Back up now**;
- **schedule** a daily backup at a set time and time zone;
- **download** the latest backup.

Exactly one backup is kept, in storage under `backups/` (on the server's disk, or in the S3 bucket with `--storage=s3`). A new backup is written under a temporary name, read back and checked against its checksums, and only then replaces the previous one. A failed backup leaves the previous one in place, and platform admins get a notification and an email.

Because only one is kept on the server, copy backups elsewhere for history: download them, or from the command line:

```bash
sudo perspice backup                       # → /opt/perspice/backups/perspice-backup-<time>.pbk
sudo perspice backup /mnt/offsite/today.pbk
```

Backups run in the `scheduler` service; it must be running.

## Restoring

**System → Restore** takes a `.pbk` file; or:

```bash
sudo perspice restore /mnt/offsite/today.pbk
```

The restore:

1. decrypts the file and checks every checksum, the version and the `MASTER_KEY` — if anything is wrong, it stops here and nothing has changed;
2. puts the platform in **maintenance mode**: users see a banner and the API answers 503 until it ends;
3. restores the database into a side database, which replaces the live one only once `pg_restore` has succeeded;
4. replaces the stored files with the backup's;
5. runs migrations forward, if the backup is from an older version;
6. ends maintenance mode (also when the restore failed).

The data is the backup's afterwards: anything recorded since the backup was made, including device messages that arrive during the restore, is not kept. Users sign in with the accounts and passwords in the backup.

Which backups can be restored: any from v0.1.0 on that is **not newer** than the server. Older ones are migrated forward, across 0.x → 1.x too (a v0.8.0 backup restores on v1.0.0); a backup from a newer version needs the server updated first.

### On a new server

1. Install the same (or a newer) version with `install.sh`.
2. Put the original `MASTER_KEY` and `BACKUP_PASSPHRASE` in `/opt/perspice/.env` (the `MASTER_KEY` from `config.env` inside the backup if you included it — the restore page tells you if it doesn't match), then `sudo perspice restart`.
3. `sudo perspice restore <file>`.

## Database snapshots

`perspice db-snapshot` and `db-restore` remain for quick database-only copies (the updater uses a full backup since v0.4.0). They don't include files and aren't encrypted.

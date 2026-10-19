import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import type { Config } from '../config/config';

/** Runs a client tool, piping `stdin`/`stdout` files; rejects with its stderr on failure. */
function run(cmd: string, args: string[], io: { stdin?: string; stdout?: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: [io.stdin ? 'pipe' : 'ignore', io.stdout ? 'pipe' : 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr!.on('data', (c: Buffer) => (stderr = (stderr + c.toString()).slice(-4000)));
    if (io.stdout) child.stdout!.pipe(createWriteStream(io.stdout, { mode: 0o600 }));
    if (io.stdin) {
      // A tool that stops early (pg_restore --exit-on-error on a bad dump) closes its input, so
      // the next write fails with EPIPE; its exit code already reports the failure.
      child.stdin!.on('error', () => undefined);
      createReadStream(io.stdin).pipe(child.stdin!);
    }
    child.on('error', (err) => reject(new Error(`${cmd} could not start: ${err.message}`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} failed (exit ${code}): ${stderr.trim().split('\n').slice(-3).join(' ')}`))));
  });
}

/** `pg_dump -Fc` of the database into `file`. */
export function dumpDatabase(config: Config, file: string): Promise<void> {
  return run(config.PG_DUMP_PATH, ['--format=custom', '--no-owner', '--no-privileges', `--dbname=${config.DATABASE_URL}`], { stdout: file });
}

/** `pg_restore` of `file` into the database at `url` (must exist and be empty). */
export function restoreDatabase(config: Config, url: string, file: string): Promise<void> {
  return run(config.PG_RESTORE_PATH, ['--no-owner', '--no-privileges', '--exit-on-error', `--dbname=${url}`], { stdin: file });
}

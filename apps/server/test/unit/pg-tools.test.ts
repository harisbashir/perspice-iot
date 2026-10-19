import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { restoreDatabase } from '../../src/backups/pg-tools';
import type { Config } from '../../src/config/config';

describe('pg tools', () => {
  it('rejects when the tool exits before reading its input, without an unhandled EPIPE', async () => {
    // Writing into a tool that already exited fails with EPIPE about one time in six, so repeat.
    const file = join(mkdtempSync(join(tmpdir(), 'pg-tools-')), 'dump');
    writeFileSync(file, Buffer.alloc(100_000));
    const config = { PG_RESTORE_PATH: '/bin/false' } as Config;
    for (let i = 0; i < 30; i++) {
      await expect(restoreDatabase(config, 'postgres://unused', file)).rejects.toThrow(/exit 1/);
    }
    // Give a pending write the chance to fail after the last rejection.
    await new Promise((r) => setTimeout(r, 100));
  });
});

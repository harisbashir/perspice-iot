import { createWriteStream, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import tar from 'tar-stream';
import { describe, expect, it } from 'vitest';
import { ArchiveError, createEncryptStream, readBackupArchive, writeBackupArchive } from '../../src/backups/archive';

const PASS = 'correct horse battery staple';
const tmp = () => mkdtempSync(join(tmpdir(), 'perspice-archive-'));

async function make(dir: string, files: Record<string, string>, passphrase = PASS): Promise<string> {
  const file = join(dir, 'backup.pbk');
  await writeBackupArchive(createWriteStream(file), passphrase, async (add) => {
    for (const [name, content] of Object.entries(files)) await add(name, Readable.from([Buffer.from(content)]), Buffer.byteLength(content));
  });
  return file;
}

describe('backup archive (Review Focus 1, 3)', () => {
  it('round-trips files, encrypted at rest', async () => {
    const dir = tmp();
    const file = await make(dir, { 'database.dump': 'PGDMP...', 'storage/assets/logo.svg': '<svg/>' });
    expect(readFileSync(file).subarray(0, 6).toString()).toBe('PSPBK1');
    expect(readFileSync(file).includes(Buffer.from('PGDMP'))).toBe(false);
    const out = tmp();
    const { files } = await readBackupArchive(file, PASS, out);
    expect(files.sort()).toEqual(['database.dump', 'storage/assets/logo.svg']);
    expect(readFileSync(join(out, 'storage/assets/logo.svg'), 'utf8')).toBe('<svg/>');
  });

  it('rejects a wrong passphrase, a flipped byte and a truncated file before extracting anything', async () => {
    const dir = tmp();
    const file = await make(dir, { 'database.dump': randomBytes(5000).toString('hex') }); // incompressible
    await expect(readBackupArchive(file, 'wrong passphrase!!', tmp())).rejects.toThrow(ArchiveError);

    const bytes = readFileSync(file);
    const flipped = Buffer.from(bytes);
    flipped[200] = flipped[200]! ^ 0x01;
    writeFileSync(join(dir, 'flipped.pbk'), flipped);
    const out = tmp();
    await expect(readBackupArchive(join(dir, 'flipped.pbk'), PASS, out)).rejects.toThrow(/damaged|passphrase/);
    expect(readdirSync(out)).toEqual([]);

    writeFileSync(join(dir, 'short.pbk'), bytes.subarray(0, bytes.length - 40));
    await expect(readBackupArchive(join(dir, 'short.pbk'), PASS, tmp())).rejects.toThrow(ArchiveError);
    writeFileSync(join(dir, 'junk.pbk'), Buffer.from('not a backup at all'));
    await expect(readBackupArchive(join(dir, 'junk.pbk'), PASS, tmp())).rejects.toThrow(/not a Perspice backup/);
  });

  it('refuses unsafe paths and links even inside a correctly encrypted archive', async () => {
    for (const entry of [{ name: '../escape.txt' }, { name: '/etc/passwd' }, { name: 'storage/../../x' }, { name: 'link', type: 'symlink' as const, linkname: '/etc' }]) {
      const dir = tmp();
      const file = join(dir, 'evil.pbk');
      const pack = tar.pack();
      if (entry.type) pack.entry(entry);
      else pack.entry({ ...entry, size: 1 }, 'x');
      pack.finalize();
      const zlib = await import('node:zlib');
      await pipeline(pack, zlib.createZstdCompress(), createEncryptStream(PASS), createWriteStream(file));
      await expect(readBackupArchive(file, PASS, tmp())).rejects.toThrow(/Unsafe entry/);
    }
  });
});

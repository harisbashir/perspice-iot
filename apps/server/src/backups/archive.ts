import { type CipherGCM, createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { PassThrough, type Readable, Transform, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createZstdCompress, createZstdDecompress } from 'node:zlib';
import tar from 'tar-stream';

/**
 * Backup files: `PSPBK1 | salt(16) | iv(12) | AES-256-GCM(zstd(tar)) | tag(16)`, with the key
 * derived from the operator's passphrase by scrypt. Readers decrypt the whole file to a temporary
 * file and check the GCM tag before anything in it is parsed (Review Focus 1, 3).
 */
const MAGIC = Buffer.from('PSPBK1');
const SALT = 16;
const IV = 12;
const TAG = 16;
const HEADER = MAGIC.length + SALT + IV;

export class ArchiveError extends Error {
  override name = 'ArchiveError';
}

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Encrypts a stream: writes the header first and the GCM tag last. */
export function createEncryptStream(passphrase: string): Transform {
  const salt = randomBytes(SALT);
  const iv = randomBytes(IV);
  const keyPromise = deriveKey(passphrase, salt);
  let cipher: CipherGCM | undefined;
  const ready = async (push: (b: Buffer) => void) => {
    if (cipher) return cipher;
    cipher = createCipheriv('aes-256-gcm', await keyPromise, iv);
    push(Buffer.concat([MAGIC, salt, iv]));
    return cipher;
  };
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      ready((b) => this.push(b)).then((c) => cb(null, c.update(chunk)), cb);
    },
    flush(cb) {
      ready((b) => this.push(b)).then((c) => {
        this.push(c.final());
        cb(null, c.getAuthTag());
      }, cb);
    },
  });
}

export type AddEntry = (name: string, body: Readable, size: number) => Promise<void>;

/** Writes an encrypted archive to `out`; `fill` adds the entries. */
export async function writeBackupArchive(out: Writable, passphrase: string, fill: (add: AddEntry) => Promise<void>): Promise<void> {
  const pack = tar.pack();
  const done = pipeline(pack, createZstdCompress(), createEncryptStream(passphrase), out);
  try {
    await fill(async (name, body, size) => {
      const entry = pack.entry({ name, size, mode: 0o600 });
      await pipeline(body, entry);
    });
    pack.finalize();
  } catch (err) {
    pack.destroy(err as Error);
    await done.catch(() => undefined);
    throw err;
  }
  await done;
}

/** Decrypts `file` into `plainFile`; throws (and removes the output) unless the tag verifies. */
async function decryptTo(file: string, passphrase: string, plainFile: string): Promise<void> {
  const { size } = await stat(file);
  const fh = await open(file, 'r');
  const head = Buffer.alloc(HEADER);
  const tag = Buffer.alloc(TAG);
  try {
    if (size < HEADER + TAG) throw new ArchiveError('This file is not a Perspice backup');
    await fh.read(head, 0, HEADER, 0);
    if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new ArchiveError('This file is not a Perspice backup');
    await fh.read(tag, 0, TAG, size - TAG);
  } finally {
    await fh.close();
  }
  const key = await deriveKey(passphrase, head.subarray(MAGIC.length, MAGIC.length + SALT));
  const decipher = createDecipheriv('aes-256-gcm', key, head.subarray(MAGIC.length + SALT, HEADER));
  decipher.setAuthTag(tag);
  try {
    // Ciphertext → plaintext (still compressed). Nothing is decompressed or parsed until the tag checks out.
    await pipeline(createReadStream(file, { start: HEADER, end: size - TAG - 1 }), decipher, createWriteStream(plainFile));
  } catch {
    await rm(plainFile, { force: true });
    throw new ArchiveError('Wrong passphrase, or the backup file is damaged');
  }
}

const safeName = (name: string): boolean => {
  if (!name || isAbsolute(name) || name.includes('\0')) return false;
  const n = normalize(name);
  return !n.split(sep).includes('..') && !n.startsWith(`..${sep}`);
};

/**
 * Verifies and unpacks a backup into `dir` (regular files only; any absolute or `..` path, link
 * or device entry rejects the whole archive). Returns the file names.
 */
export async function readBackupArchive(file: string, passphrase: string, dir: string): Promise<{ files: string[] }> {
  await mkdir(dir, { recursive: true });
  const compressed = join(dir, '.archive.tar.zst');
  await decryptTo(file, passphrase, compressed);
  const files: string[] = [];
  const extract = tar.extract();
  const work = new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      if (header.type === 'directory') {
        stream.resume();
        return next();
      }
      if (header.type !== 'file' || !safeName(header.name)) {
        stream.resume();
        return reject(new ArchiveError(`Unsafe entry in backup: ${header.name}`));
      }
      const target = join(dir, normalize(header.name));
      mkdir(dirname(target), { recursive: true })
        .then(() => pipeline(stream, createWriteStream(target, { mode: 0o600 })))
        .then(() => {
          files.push(header.name);
          next();
        }, reject);
    });
    extract.on('finish', resolve);
    extract.on('error', reject);
  });
  try {
    const feed = pipeline(createReadStream(compressed), createZstdDecompress(), new PassThrough(), extract);
    await Promise.all([feed, work]);
  } catch (err) {
    throw err instanceof ArchiveError ? err : new ArchiveError(`The backup could not be unpacked: ${(err as Error).message}`);
  } finally {
    await rm(compressed, { force: true });
  }
  return { files };
}

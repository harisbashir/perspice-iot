import { createHmac } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { safeEqual } from '../common/internal-secret.guard';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { StorageDriver } from './storage.driver';

const KEY_PATTERN = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

export function assertValidKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.split('/').some((seg) => seg === '.' || seg === '..')) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}

function sign(secret: string, key: string, exp: string): string {
  return createHmac('sha256', secret).update(`${key}\n${exp}`).digest('base64url');
}

export function verifySignedUrl(secret: string, key: string, exp: string, sig: string, now = Date.now()): boolean {
  const expS = Number(exp);
  if (!Number.isInteger(expS) || expS * 1000 < now) return false;
  return safeEqual(sign(secret, key, exp), sig);
}

/** Stores objects on the local filesystem; content type is kept in a `.meta` sidecar file. */
export class LocalStorageDriver implements StorageDriver {
  private readonly root: string;

  constructor(
    root: string,
    private readonly signingSecret: string,
  ) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    assertValidKey(key);
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error(`Invalid storage key: ${key}`);
    return full;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
    await writeFile(`${file}.meta`, JSON.stringify({ contentType }));
  }

  async putStream(key: string, body: Readable, contentType: string): Promise<void> {
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true });
    try {
      await pipeline(body, createWriteStream(file));
    } catch (err) {
      await rm(file, { force: true });
      throw err;
    }
    await writeFile(`${file}.meta`, JSON.stringify({ contentType }));
  }

  async getStream(key: string): Promise<{ body: Readable; contentType: string; size: number }> {
    const file = this.path(key);
    const [info, meta] = await Promise.all([stat(file), readFile(`${file}.meta`, 'utf8').catch(() => '{}')]);
    const { contentType } = JSON.parse(meta) as { contentType?: string };
    return { body: createReadStream(file), contentType: contentType ?? 'application/octet-stream', size: info.size };
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string }> {
    const file = this.path(key);
    const [body, meta] = await Promise.all([
      readFile(file),
      readFile(`${file}.meta`, 'utf8').catch(() => '{}'),
    ]);
    const { contentType } = JSON.parse(meta) as { contentType?: string };
    return { body, contentType: contentType ?? 'application/octet-stream' };
  }

  async delete(key: string): Promise<void> {
    const file = this.path(key);
    await rm(file, { force: true });
    await rm(`${file}.meta`, { force: true });
  }

  async getSignedUrl(key: string, ttlSeconds: number): Promise<string> {
    assertValidKey(key);
    const exp = String(Math.floor(Date.now() / 1000) + ttlSeconds);
    return `/api/files/${key}?exp=${exp}&sig=${sign(this.signingSecret, key, exp)}`;
  }

  async list(prefix: string): Promise<string[]> {
    const files: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (!e.name.endsWith('.meta')) files.push(relative(this.root, full).split(sep).join('/'));
      }
    };
    await walk(this.root);
    return files.filter((f) => f.startsWith(prefix)).sort();
  }
}

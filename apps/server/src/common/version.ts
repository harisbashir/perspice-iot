import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

let cached: string | undefined;

/** Reads the repo-root VERSION file (or PERSPICE_VERSION in images without it). */
export function appVersion(): string {
  if (cached) return cached;
  if (process.env.PERSPICE_VERSION) return (cached = process.env.PERSPICE_VERSION.replace(/^v/, ''));
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const file = join(dir, 'VERSION');
    if (existsSync(file)) return (cached = readFileSync(file, 'utf8').trim());
    dir = dirname(dir);
  }
  return (cached = '0.0.0');
}

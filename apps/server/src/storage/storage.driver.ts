import type { Readable } from 'node:stream';

export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Stores a stream without buffering it (large exports). */
  putStream(key: string, body: Readable, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Buffer; contentType: string }>;
  getStream(key: string): Promise<{ body: Readable; contentType: string; size: number }>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, ttlSeconds: number): Promise<string>;
  list(prefix: string): Promise<string[]>;
}

export const STORAGE = Symbol('STORAGE');

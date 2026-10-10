import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { assertValidKey, signedFileUrl } from './local.driver';
import type { StorageDriver } from './storage.driver';

export interface S3Options {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  /** Key prefix inside the bucket (e.g. to share a bucket). */
  prefix?: string;
  /** Hand out presigned bucket URLs instead of API-proxied links (the bucket must be reachable by browsers). */
  directDownloads?: boolean;
}

/**
 * Storage on S3 or an S3-compatible service (MinIO, Wasabi, Spaces, B2). By default downloads go
 * through the API's signed `/api/files` links, so the bucket can stay private and internal.
 */
export class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client;
  private readonly prefix: string;

  constructor(
    private readonly o: S3Options,
    private readonly signingSecret: string,
  ) {
    this.client = new S3Client({
      region: o.region,
      endpoint: o.endpoint,
      forcePathStyle: o.forcePathStyle,
      credentials: o.accessKeyId && o.secretAccessKey ? { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey } : undefined,
    });
    this.prefix = o.prefix ?? '';
  }

  private key(key: string): string {
    assertValidKey(key);
    return this.prefix + key;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.o.bucket, Key: this.key(key), Body: body, ContentType: contentType }));
  }

  async putStream(key: string, body: Readable, contentType: string): Promise<void> {
    await new Upload({ client: this.client, params: { Bucket: this.o.bucket, Key: this.key(key), Body: body, ContentType: contentType } }).done();
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string }> {
    const { body, contentType } = await this.getStream(key);
    const chunks: Buffer[] = [];
    for await (const c of body) chunks.push(c as Buffer);
    return { body: Buffer.concat(chunks), contentType };
  }

  async getStream(key: string): Promise<{ body: Readable; contentType: string; size: number }> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.o.bucket, Key: this.key(key) }));
    return { body: res.Body as Readable, contentType: res.ContentType ?? 'application/octet-stream', size: res.ContentLength ?? 0 };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.o.bucket, Key: this.key(key) }));
  }

  async move(from: string, to: string): Promise<void> {
    const source = this.key(from);
    await this.client.send(new HeadObjectCommand({ Bucket: this.o.bucket, Key: source }));
    await this.client.send(new CopyObjectCommand({ Bucket: this.o.bucket, Key: this.key(to), CopySource: `${this.o.bucket}/${source.split('/').map(encodeURIComponent).join('/')}` }));
    await this.client.send(new DeleteObjectCommand({ Bucket: this.o.bucket, Key: source }));
  }

  async getSignedUrl(key: string, ttlSeconds: number): Promise<string> {
    if (!this.o.directDownloads) return signedFileUrl(this.signingSecret, key, ttlSeconds);
    const filename = key.split('/').pop()!;
    return presign(
      this.client,
      new GetObjectCommand({
        Bucket: this.o.bucket,
        Key: this.key(key),
        ...(key.startsWith('exports/') ? { ResponseContentDisposition: `attachment; filename="${filename}"` } : {}),
      }),
      { expiresIn: ttlSeconds },
    );
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(new ListObjectsV2Command({ Bucket: this.o.bucket, Prefix: this.prefix + prefix, ContinuationToken: token }));
      for (const o of res.Contents ?? []) if (o.Key) out.push(o.Key.slice(this.prefix.length));
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out.sort();
  }
}

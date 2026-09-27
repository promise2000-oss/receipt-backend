import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env";
import type { Storage, StoredObject } from "./types";

const CONTENT_TYPES = new Map<string, string>([
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".svg", "image/svg+xml"],
]);

function contentTypeFor(key: string): string {
  return CONTENT_TYPES.get(path.extname(key).toLowerCase()) ?? "application/octet-stream";
}

/** S3-compatible storage (AWS S3, MinIO, R2, DigitalOcean Spaces, …). */
export class S3Storage implements Storage {
  readonly driver = "s3" as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    if (!env.s3.bucket) {
      throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET to be set.");
    }
    this.bucket = env.s3.bucket;
    this.client = new S3Client({
      region: env.s3.region,
      ...(env.s3.endpoint ? { endpoint: env.s3.endpoint } : {}),
      forcePathStyle: env.s3.forcePathStyle,
      credentials: {
        accessKeyId: env.s3.accessKeyId,
        secretAccessKey: env.s3.secretAccessKey,
      },
    });
  }

  async put(key: string, data: Buffer | Readable, contentType: string): Promise<StoredObject> {
    const body = Buffer.isBuffer(data) ? data : await streamToBuffer(data);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType || contentTypeFor(key),
        // Private by default: the object is never publicly readable.
        ACL: undefined,
      }),
    );
    return { key, contentType: contentType || contentTypeFor(key), size: body.length };
  }

  async get(key: string) {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body) return null;
      return {
        stream: result.Body as Readable,
        contentType: result.ContentType ?? contentTypeFor(key),
      };
    } catch {
      return null;
    }
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    const object = await this.get(key);
    if (!object) return null;
    return streamToBuffer(object.stream);
  }

  async url(key: string, ttlSeconds = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { env } from "../env";
import { signFileToken } from "../tokens";
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

/**
 * Files live under `apps/api/.storage` and are only reachable through
 * `GET /api/files/<signed token>`, which verifies an HMAC and an expiry
 * before streaming a single byte.
 */
export class LocalDiskStorage implements Storage {
  readonly driver = "local" as const;
  private readonly root: string;

  constructor(root?: string) {
    this.root =
      root && root.trim().length > 0
        ? path.resolve(root)
        : path.resolve(__dirname, "../../.storage");
  }

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    // Defence in depth against `../` escaping the storage root.
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error("Invalid storage key");
    }
    return full;
  }

  async put(key: string, data: Buffer | Readable, _contentType: string): Promise<StoredObject> {
    const target = this.resolve(key);
    await fsp.mkdir(path.dirname(target), { recursive: true });

    if (Buffer.isBuffer(data)) {
      await fsp.writeFile(target, data);
      return { key, contentType: contentTypeFor(key), size: data.length };
    }

    const written = await new Promise<number>((resolve, reject) => {
      const out = fs.createWriteStream(target);
      let size = 0;
      data.on("data", (chunk: Buffer | string) => {
        size += Buffer.byteLength(chunk);
      });
      data.pipe(out);
      out.on("finish", () => resolve(size));
      out.on("error", reject);
      data.on("error", reject);
    });

    return { key, contentType: contentTypeFor(key), size: written };
  }

  async get(key: string) {
    const target = this.resolve(key);
    try {
      await fsp.access(target, fs.constants.R_OK);
    } catch {
      return null;
    }
    return { stream: fs.createReadStream(target), contentType: contentTypeFor(key) };
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    const target = this.resolve(key);
    try {
      return await fsp.readFile(target);
    } catch {
      return null;
    }
  }

  async url(key: string, ttlSeconds = 3600): Promise<string> {
    return `/api/files/${signFileToken(key, ttlSeconds)}`;
  }

  async remove(key: string): Promise<void> {
    try {
      await fsp.unlink(this.resolve(key));
    } catch {
      /* already gone */
    }
  }
}

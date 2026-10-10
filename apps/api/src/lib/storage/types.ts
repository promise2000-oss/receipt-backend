import type { Readable } from "node:stream";

export interface StoredObject {
  key: string;
  contentType: string;
  size: number;
}

/**
 * Object storage abstraction.
 *
 * Two implementations ship with the app:
 *  - `local`  → files live on disk behind a signed, expiring URL (dev default)
 *  - `s3`     → files live in any S3-compatible bucket behind a presigned URL
 *
 * Both are private: nothing is readable without a signature, which is what the
 * "private file storage with signed URLs" requirement asks for.
 */
export interface Storage {
  readonly driver: "local" | "s3";
  put(key: string, data: Buffer | Readable, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<{ stream: Readable; contentType: string } | null>;
  getBuffer(key: string): Promise<Buffer | null>;
  /** A URL that grants read access for `ttlSeconds`. */
  url(key: string, ttlSeconds?: number): Promise<string>;
  remove(key: string): Promise<void>;
}

/** `receipts/<businessId>/<receiptId>.pdf` */
export function pdfKey(businessId: string, receiptId: string): string {
  return `receipts/${businessId}/${receiptId}.pdf`;
}

/** `invoices/<businessId>/<invoiceId>.pdf` */
export function invoicePdfKey(businessId: string, invoiceId: string): string {
  return `invoices/${businessId}/${invoiceId}.pdf`;
}

/** `logos/<businessId>/<timestamp>-<name>` */
export function logoKey(businessId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
  return `logos/${businessId}/${Date.now()}-${safe}`;
}

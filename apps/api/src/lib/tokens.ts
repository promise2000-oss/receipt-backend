import crypto from "node:crypto";
import { env } from "./env";

/**
 * Public receipt links.
 *
 * The token is `base64url(receiptId.expiresAt)` + HMAC-SHA256 signature.
 * It carries no sequential id in the clear, cannot be forged without the
 * server secret, and stops working the moment it expires.
 */

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function hmac(payload: string): string {
  return crypto.createHmac("sha256", env.jwtSecret).update(payload).digest("base64url");
}

export function signShareToken(receiptId: string, ttlSeconds = env.shareTtlSeconds): {
  token: string;
  expiresAt: Date;
} {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const payload = `${receiptId}.${expiresAt.getTime()}`;
  return {
    token: `${b64url(payload)}.${hmac(payload)}`,
    expiresAt,
  };
}

export type ShareVerification =
  | { ok: true; receiptId: string; expiresAt: Date }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyShareToken(token: string): ShareVerification {
  if (!token || typeof token !== "string") return { ok: false, reason: "malformed" };

  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };

  const [encodedPayload, signature] = parts;
  let payload: string;
  try {
    payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const expected = hmac(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  const [receiptId, expiryRaw] = payload.split(".");
  const expiresAtMs = Number.parseInt(expiryRaw ?? "", 10);
  if (!receiptId || !Number.isFinite(expiresAtMs)) {
    return { ok: false, reason: "malformed" };
  }

  const expiresAt = new Date(expiresAtMs);
  if (expiresAtMs <= Date.now()) return { ok: false, reason: "expired" };

  return { ok: true, receiptId, expiresAt };
}

/**
 * Verification capability — the thing printed as a QR code.
 *
 * Deliberately different from the share link above:
 *
 *  - **No expiry.** A share link is a message you send; a QR is ink on paper
 *    that has to keep resolving years later. An expiring token would leave
 *    every printed receipt with a dead QR code after `SHARE_TTL_SECONDS`.
 *  - **Minimal disclosure.** It only unlocks the verification view —
 *    organization, receipt number, amount, date, status. It never exposes the
 *    itemised receipt, the customer's contact details, or tenancy ids.
 *
 * It is still a pure HMAC capability: the receipt id on its own grants
 * nothing, the signature cannot be forged without the server secret, and the
 * comparison is timing-safe.
 */
export function signVerifyToken(receiptId: string): string {
  const payload = `verify.${receiptId}`;
  return `${b64url(payload)}.${hmac(payload)}`;
}

export type VerifyTokenResult =
  | { ok: true; receiptId: string }
  | { ok: false; reason: "malformed" | "bad_signature" };

export function verifyVerifyToken(token: string): VerifyTokenResult {
  if (!token || typeof token !== "string") return { ok: false, reason: "malformed" };

  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };

  let payload: string;
  try {
    payload = Buffer.from(parts[0], "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const expected = hmac(payload);
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  if (!payload.startsWith("verify.")) return { ok: false, reason: "malformed" };
  const receiptId = payload.slice("verify.".length);
  if (!receiptId) return { ok: false, reason: "malformed" };

  return { ok: true, receiptId };
}

/**
 * Generic signed token used to hand private storage keys to the browser.
 * Same construction, different purpose.
 */
export function signFileToken(key: string, ttlSeconds = 3600): string {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const payload = `file.${key}.${expiresAt}`;
  return `${b64url(payload)}.${hmac(payload)}`;
}

export function verifyFileToken(token: string): string | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const payload = Buffer.from(parts[0], "base64url").toString("utf8");
  const expected = hmac(payload);
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  if (!payload.startsWith("file.")) return null;
  const withoutPrefix = payload.slice("file.".length);
  const lastDot = withoutPrefix.lastIndexOf(".");
  if (lastDot <= 0) return null;

  const key = withoutPrefix.slice(0, lastDot);
  const expiry = Number.parseInt(withoutPrefix.slice(lastDot + 1), 10);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return null;
  return key;
}

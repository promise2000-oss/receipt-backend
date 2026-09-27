import type { Request } from "express";
import { env } from "./env";

/**
 * Build an absolute URL from a path, honouring a reverse proxy.
 *
 * Used for share links, which must be reachable from outside — so when the
 * deployment knows its own public origin (`PUBLIC_API_BASE_URL`, e.g. behind a
 * proxy that rewrites Host), that wins over whatever the request claims.
 */
export function absoluteUrl(req: Request, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;

  const origin = env.publicBaseUrl.replace(/\/+$/, "");
  if (origin) return `${origin}${path.startsWith("/") ? path : `/${path}`}`;

  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost";
  const proto = req.get("x-forwarded-proto") ?? (req.secure ? "https" : "http");
  return `${proto}://${host}${path.startsWith("/") ? path : `/${path}`}`;
}

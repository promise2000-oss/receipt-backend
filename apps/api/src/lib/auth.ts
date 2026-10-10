import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Response } from "express";
import type { Role } from "@eleos/shared";
import { env } from "./env";
import type { AuthContext } from "../middleware/requireAuth";

export const SESSION_COOKIE = "el_session";

const BCRYPT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export function signSession(ctx: AuthContext): string {
  return jwt.sign(ctx, env.jwtSecret, {
    expiresIn: env.jwtTtlSeconds,
    issuer: "eleosstyles",
  });
}

/** Returns null for expired, tampered or malformed tokens — never throws. */
export function verifySession(token: string): AuthContext | null {
  try {
    const payload = jwt.verify(token, env.jwtSecret, {
      issuer: "eleosstyles",
    }) as jwt.JwtPayload;

    if (
      !payload ||
      typeof payload.userId !== "string" ||
      typeof payload.businessId !== "string"
    ) {
      return null;
    }

    return {
      userId: payload.userId,
      businessId: payload.businessId,
      // Recognise only the four known roles. A token minted by an older build
      // carries `owner`/`staff` and keeps working; anything unrecognised
      // resolves to `viewer`, the most restrictive role, rather than to
      // `owner` — an unknown value must never widen access.
      role: normaliseRole(payload.role),
      email: typeof payload.email === "string" ? payload.email : "",
    };
  } catch {
    return null;
  }
}

const KNOWN_ROLES = new Set<Role>(["owner", "admin", "staff", "viewer"]);

function normaliseRole(value: unknown): Role {
  return typeof value === "string" && KNOWN_ROLES.has(value as Role)
    ? (value as Role)
    : "viewer";
}

/**
 * Session travels as an httpOnly cookie so client-side script can never read
 * it, and `sameSite=lax` keeps it out of cross-site POSTs.
 */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    path: "/",
    maxAge: env.jwtTtlSeconds * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    path: "/",
  });
}

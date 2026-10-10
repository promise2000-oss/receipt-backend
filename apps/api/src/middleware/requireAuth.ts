import type { Request, RequestHandler, Response, NextFunction } from "express";
import { can, type Permission, type Role } from "@eleos/shared";
import { AppError } from "../lib/errors";
import { env } from "../lib/env";

/**
 * Route authorization.
 *
 * Two independent checks, deliberately separated:
 *
 *  - `requireAuth` — *who* is calling. Reads the httpOnly session cookie and
 *    verifies its signature. Nothing else.
 *  - `requirePermission` — *what* they may do. Decided entirely by the role
 *    inside the verified token.
 *
 * The split matters because the role is the only input to an authorization
 * decision, and it must never come from anywhere the client controls. A
 * `staff` member posting `role: "owner"` changes nothing here: the guard reads
 * `req.auth.role`, which was signed at login.
 *
 * `requireOwner` remains as a named alias for the one permission that is
 * genuinely owner-only, so existing call sites keep working.
 */

export interface AuthContext {
  userId: string;
  businessId: string;
  role: Role;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Route guard. It is deliberately applied per-route rather than globally so
 * the public receipt endpoints stay reachable without a session.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) {
    return next(
      new AppError("Your session has expired. Please sign in again.", 401, "UNAUTHORIZED"),
    );
  }
  if (env.isProd && !req.secure) {
    return next(
      new AppError("HTTPS is required.", 400, "HTTPS_REQUIRED"),
    );
  }
  next();
}

/**
 * Authorization guard — the single place a role becomes a decision.
 *
 * Order is fixed: authentication first, so an anonymous caller can never be
 * told "your role is insufficient" (which would confirm the endpoint exists
 * and map the role model to an attacker), then the permission check.
 */
export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) {
      return next(
        new AppError("Your session has expired. Please sign in again.", 401, "UNAUTHORIZED"),
      );
    }

    if (!can(auth.role, permission)) {
      return next(
        new AppError(
          "You don't have permission to do that. Ask an administrator if you need access.",
          403,
          "FORBIDDEN",
        ),
      );
    }
    next();
  };
}

/**
 * Organization-administrator guard.
 *
 * Now a thin wrapper over `requirePermission("org.update")`, which `admin`
 * also holds — because the product spec defines admin as able to change
 * organization settings, and only `owner` retains the owner-exclusive actions
 * (delete, transfer ownership). Keeping this name means every existing
 * `requireOwner` call site keeps its meaning without silently becoming
 * owner-only-only.
 */
export const requireOwner: RequestHandler = requirePermission("org.update");

/**
 * Owner-only, for the actions no other role may perform.
 *
 * Separated from `requirePermission("org.update")` on purpose: an `admin`
 * may edit the organization's name, but may not delete it or hand over
 * ownership, so those checks cannot be expressed as "another permission"
 * without adding a permission that no non-owner would hold.
 */
export const requireOwnerOnly: RequestHandler = (req, _res, next) => {
  const auth = req.auth;
  if (!auth) {
    return next(
      new AppError("Your session has expired. Please sign in again.", 401, "UNAUTHORIZED"),
    );
  }
  if (auth.role !== "owner") {
    return next(
      new AppError(
        "Only the organization owner can do that.",
        403,
        "FORBIDDEN",
      ),
    );
  }
  next();
};
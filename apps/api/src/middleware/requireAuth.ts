import type { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors";
import { env } from "../lib/env";

export interface AuthContext {
  userId: string;
  businessId: string;
  role: "owner" | "staff";
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
 * Organization-administrator guard.
 *
 * The role is minted into the session at signup and read back from the JWT —
 * it is never taken from the request body — so a staff member cannot promote
 * themselves by posting `role: "owner"`.
 *
 * Applied only to organization-level mutations (name, logo, branding, other
 * settings). Day-to-day work — issuing receipts, managing customers, reading
 * the dashboard — stays open to every member of the organization, so adding
 * this guard cannot break existing flows.
 */
export function requireOwner(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) {
    return next(
      new AppError("Your session has expired. Please sign in again.", 401, "UNAUTHORIZED"),
    );
  }
  if (req.auth.role !== "owner") {
    return next(
      new AppError(
        "Only an organization administrator can change these settings.",
        403,
        "FORBIDDEN",
      ),
    );
  }
  next();
}

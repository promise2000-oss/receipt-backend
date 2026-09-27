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

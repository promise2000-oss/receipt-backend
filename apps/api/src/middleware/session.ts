import type { NextFunction, Request, Response } from "express";
import { SESSION_COOKIE, verifySession } from "../lib/auth";

/**
 * Resolves the session cookie once, up front. `requireAuth` then simply
 * checks that `req.auth` exists, so no route ever touches the cookie directly.
 */
export function sessionParser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token && typeof token === "string") {
    const session = verifySession(token);
    if (session) req.auth = session;
  }
  next();
}

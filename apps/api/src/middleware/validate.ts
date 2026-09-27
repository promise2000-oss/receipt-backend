import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodError, type ZodType } from "zod";
import { AppError, notFound } from "../lib/errors";

/**
 * Express 5 forwards rejected promises to the error handler automatically, but
 * this wrapper keeps intent explicit and works regardless of version.
 */
export const asyncH =
  <T extends Request = Request>(
    handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
  ): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(handler(req as unknown as T, res, next)).catch(next);
  };

/** Parse `req.body` (or another bag) with a zod schema or throw a 422. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(
      "Please correct the highlighted fields.",
      422,
      "VALIDATION_ERROR",
      flattenZodError(result.error),
    );
  }
  return result.data;
}

export function flattenZodError(error: ZodError): Record<string, string> {
  const issues: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.map(String).join(".") || "_";
    if (!issues[path]) issues[path] = issue.message;
  }
  return issues;
}

/**
 * Read a route parameter as a plain string.
 *
 * Express types route params as `string | string[]` (a repeated or wildcard
 * segment yields an array), so every handler funnels through here instead of
 * trusting `req.params.x` to be a string.
 */
export function pathParam(req: Request, name: string): string {
  const value = (req.params as Record<string, unknown>)[name];

  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].length > 0) {
    return value[0];
  }

  throw notFound("Resource");
}

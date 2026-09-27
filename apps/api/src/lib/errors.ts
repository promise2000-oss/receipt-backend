/** Small, uniform error type so every failure has an HTTP status + machine code. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status = 400, code = "BAD_REQUEST", details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what = "Resource") =>
  new AppError(`${what} not found`, 404, "NOT_FOUND");

export const unauthorized = (message = "Authentication required") =>
  new AppError(message, 401, "UNAUTHORIZED");

export const forbidden = (message = "You do not have access to this") =>
  new AppError(message, 403, "FORBIDDEN");

export const conflict = (message: string, code = "CONFLICT") =>
  new AppError(message, 409, code);

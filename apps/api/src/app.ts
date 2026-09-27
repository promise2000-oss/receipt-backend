import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { ZodError } from "zod";
import { env } from "./lib/env";
import { AppError } from "./lib/errors";
import { sessionParser } from "./middleware/session";
import { flattenZodError } from "./middleware/validate";
import { authRouter } from "./routes/auth.routes";
import { businessRouter } from "./routes/business.routes";
import { customerRouter } from "./routes/customer.routes";
import { receiptRouter } from "./routes/receipt.routes";
import { dashboardRouter } from "./routes/dashboard.routes";
import { publicRouter } from "./routes/public.routes";
import { filesRouter } from "./routes/files.routes";
import { createDocsRouter, DOCS_PATH } from "./openapi";

export function createApp(): Express {
  const app = express();

  // Behind the Next.js proxy in production; also correct for local dev.
  app.set("trust proxy", 1);
  if (!env.isProd) app.set("json spaces", 2);

  app.use(
    helmet({
      // The receipt document ships an inline <style> block by design — it has
      // to render standalone inside Puppeteer with no external stylesheet.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin (Next proxy) requests carry no Origin header.
        if (!origin) return callback(null, true);
        callback(null, env.origins.includes(origin));
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    }),
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(cookieParser());
  app.use(sessionParser);

  // Brute-force protection on the credential endpoints.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 50,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      message: "Too many attempts. Please wait a few minutes and try again.",
      code: "RATE_LIMITED",
    },
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "eleosstyles-api", uptime: process.uptime() });
  });

  app.use("/api/auth", authLimiter, authRouter);
  app.use("/api/business", businessRouter);
  app.use("/api/customers", customerRouter);
  app.use("/api/receipts", receiptRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/files", filesRouter);
  // Public share links last: they are capability URLs, not sessions.
  app.use("/api/public", publicRouter);

  // Interactive API documentation. Mounted after the feature routers and
  // before the /api catch-all; DOCS_ENABLED=false takes it down.
  if (env.docsEnabled) {
    app.use(DOCS_PATH, createDocsRouter());
  }

  app.use("/api", (_req, res) => {
    res.status(404).json({ message: "Endpoint not found.", code: "NOT_FOUND" });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.status).json({
        message: error.message,
        code: error.code,
        details: error.details,
      });
      return;
    }

    if (error instanceof ZodError) {
      res.status(422).json({
        message: "Please correct the highlighted fields.",
        code: "VALIDATION_ERROR",
        details: flattenZodError(error),
      });
      return;
    }

    const anyError = error as { name?: string; code?: string; message?: string };

    if (anyError?.name === "MulterError") {
      res.status(422).json({
        message:
          anyError.code === "LIMIT_FILE_SIZE"
            ? "That file is too large (max 3 MB)."
            : "File upload failed.",
        code: "UPLOAD_ERROR",
      });
      return;
    }

    // Prisma unique-constraint violation, surfaced uniformly.
    if (anyError?.code === "P2002") {
      res.status(409).json({
        message: "That value is already taken.",
        code: "UNIQUE_VIOLATION",
      });
      return;
    }

    // eslint-disable-next-line no-console
    console.error("[api] unhandled error:", error);

    res.status(500).json({
      message: "Something went wrong on our side. Please try again.",
      code: "INTERNAL_ERROR",
    });
  });

  return app;
}

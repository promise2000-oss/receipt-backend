import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

/**
 * Locate the monorepo `.env` by walking up from the current working directory,
 * so the file is found whether we are run from the repo root, from apps/api,
 * or from a compiled dist/ folder.
 */
function loadEnvFile(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate, override: false });
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dotenv.config({ override: false });
  return null;
}

loadEnvFile();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * The public origin the hosting platform thinks we live on, if it tells us.
 *
 * Render sets `RENDER_EXTERNAL_URL` (e.g. `https://myapp.onrender.com`) at both
 * build and run time. Reading it here means share links and CORS are correct
 * the moment the service is deployed, with nothing to hard-code when the URL
 * changes — `PUBLIC_API_BASE_URL` / `API_ORIGIN` still win when set explicitly.
 */
const platformUrl = optional("RENDER_EXTERNAL_URL", "");

const NODE_ENV = optional("NODE_ENV", "development");
const JWT_SECRET = required(
  "JWT_SECRET",
  NODE_ENV === "test" ? "test-secret-should-not-be-used-in-production" : undefined,
);

if (JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters long.");
}

export const env = {
  nodeEnv: NODE_ENV,
  isProd: NODE_ENV === "production",
  isTest: NODE_ENV === "test",

  port: int("API_PORT", 4000),
  origins: optional("API_ORIGIN", platformUrl || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  jwtSecret: JWT_SECRET,
  jwtTtlSeconds: int("JWT_TTL_SECONDS", 60 * 60 * 24 * 7),
  shareTtlSeconds: int("SHARE_TTL_SECONDS", 60 * 60 * 24 * 7),

  databaseUrl: required("DATABASE_URL"),

  storageDriver: optional("STORAGE_DRIVER", "local") as "local" | "s3",
  storageDir: optional("STORAGE_DIR", ""),

  s3: {
    endpoint: optional("S3_ENDPOINT", ""),
    region: optional("S3_REGION", "us-east-1"),
    bucket: optional("S3_BUCKET", ""),
    accessKeyId: optional("S3_ACCESS_KEY_ID", ""),
    secretAccessKey: optional("S3_SECRET_ACCESS_KEY", ""),
    forcePathStyle: optional("S3_FORCE_PATH_STYLE", "true") === "true",
  },

  mailDriver: optional("MAIL_DRIVER", "console") as "console" | "smtp",
  mailFrom: optional("MAIL_FROM", "Eleosstyles Receipts <receipts@example.com>"),
  smtp: {
    host: optional("SMTP_HOST", ""),
    port: int("SMTP_PORT", 587),
    secure: optional("SMTP_SECURE", "false") === "true",
    user: optional("SMTP_USER", ""),
    pass: optional("SMTP_PASS", ""),
  },

  puppeteerExecutablePath: optional("PUPPETEER_EXECUTABLE_PATH", ""),

  /** Base URL the browser uses to reach this API (for share links). */
  publicBaseUrl: optional("PUBLIC_API_BASE_URL", platformUrl),

  /** Swagger UI at `/api/docs`. Set DOCS_ENABLED=false to take it down. */
  docsEnabled: optional("DOCS_ENABLED", "true") !== "false",
} as const;

export type Env = typeof env;

/**
 * Test bootstrap.
 *
 * Runs before any application module is imported, so it can point the suite at
 * the dedicated `eleosstyles_test` database and make sure its schema exists.
 * The development database is never touched by tests.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";

// Locate the monorepo .env (tests run with cwd = apps/api or the repo root).
for (let dir = process.cwd(), i = 0; i < 8; i += 1) {
  const candidate = path.join(dir, ".env");
  if (fs.existsSync(candidate)) {
    config({ path: candidate, override: false });
    break;
  }
  const parent = path.dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

process.env.NODE_ENV = "test";

const sourceUrl =
  process.env.DATABASE_URL ??
  "postgresql://eleos:eleos@127.0.0.1:5433/eleosstyles";

const testUrl = new URL(sourceUrl);
testUrl.pathname = "/eleosstyles_test";
process.env.DATABASE_URL = testUrl.toString();

// Never let a test accidentally send real mail.
process.env.MAIL_DRIVER = "console";

const schemaPath = path.join("prisma", "schema.prisma");
if (!fs.existsSync(schemaPath)) {
  throw new Error(`Could not find ${schemaPath} — run tests from the API workspace.`);
}

execSync(`npx prisma migrate deploy --schema ${schemaPath}`, {
  stdio: "pipe",
  env: process.env,
});

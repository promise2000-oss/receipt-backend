/**
 * One-shot database setup for environments where PostgreSQL is not the
 * project-local embedded instance (a managed server, Docker, CI…):
 *
 *   1. creates the application and test databases if they do not exist
 *   2. applies every Prisma migration  (`prisma migrate deploy`)
 *   3. seeds the demo tenant           (`prisma db seed`)
 *
 *   npm run db:setup
 *
 * Local development does not need this — `npm run db:start` already creates
 * the databases — but running it is harmless and idempotent.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

// Locate the monorepo .env (run from apps/api or the repo root).
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

const sourceUrl =
  process.env.DATABASE_URL ??
  "postgresql://eleos:eleos@127.0.0.1:5433/eleosstyles";

const base = new URL(sourceUrl);
const user = decodeURIComponent(base.username);
const dbName = decodeURIComponent(base.pathname.replace(/^\//, "")) || "eleosstyles";

// CREATE DATABASE cannot be parameterised, so only accept a boring name.
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
if (!IDENT.test(dbName)) {
  throw new Error(`Refusing to use "${dbName}" as a database name.`);
}

const targets = [dbName, `${dbName}_test`];

async function ensureDatabases(): Promise<void> {
  const maintenance = new URL(sourceUrl);
  maintenance.pathname = "/postgres";

  const client = new PrismaClient({ datasourceUrl: maintenance.toString() });
  try {
    for (const name of targets) {
      if (!IDENT.test(name)) continue;
      const rows: Array<{ exists: boolean }> = await client.$queryRawUnsafe(
        `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${name}') AS exists`,
      );
      if (rows[0]?.exists) {
        console.log(`[setup] database "${name}" already exists`);
        continue;
      }
      await client.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      console.log(`[setup] created database "${name}"`);
    }
  } finally {
    await client.$disconnect();
  }
}

async function main(): Promise<void> {
  await ensureDatabases();

  console.log("[setup] applying migrations…");
  execSync("npx prisma migrate deploy --schema prisma/schema.prisma", {
    stdio: "inherit",
    env: process.env,
  });

  console.log("[setup] seeding demo data…");
  execSync("npx prisma db seed", { stdio: "inherit", env: process.env });

  console.log("[setup] ready.");
}

main().catch((error) => {
  console.error("[setup] failed:", error);
  process.exit(1);
});

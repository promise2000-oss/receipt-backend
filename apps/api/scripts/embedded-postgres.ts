/**
 * Starts the local PostgreSQL instance used during development.
 *
 * `winget` is unusable in some sandboxes, so instead of installing Postgres
 * system-wide we run the real PostgreSQL server from a project-local data
 * directory — no admin rights, nothing outside the repo.
 *
 *   npm run db:start      # creates the database, then stays in the foreground
 *
 * Run it in its own terminal (or the background) and leave it running while
 * you work. Ctrl-C stops the server cleanly.
 */
import path from "node:path";
import fs from "node:fs";
import { config } from "dotenv";

// Reuse the monorepo .env so the port/user match DATABASE_URL.
for (const candidate of [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env"),
]) {
  if (fs.existsSync(candidate)) {
    config({ path: candidate, override: false });
    break;
  }
}

const USER = process.env.DATABASE_USER ?? "eleos";
const PASSWORD = process.env.DATABASE_PASSWORD ?? "eleos";
const PORT = Number(process.env.DATABASE_PORT ?? 5433);
const DATABASES = [
  process.env.DATABASE_NAME ?? "eleosstyles",
  `${process.env.DATABASE_NAME ?? "eleosstyles"}_test`,
];
const DATA_DIR = path.resolve(__dirname, "../.pgdata");

async function main(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const imported = require("embedded-postgres");
  const EmbeddedPostgres = imported.default ?? imported;

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    // Windows defaults initdb to the ANSI codepage (WIN1252), which silently
    // mangles — and then rejects — anything outside it. A receipt system has
    // to store customer names in any script, so force a UTF-8 cluster.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });

  const alreadyInitialised = fs.existsSync(path.join(DATA_DIR, "PG_VERSION"));

  if (!alreadyInitialised) {
    // eslint-disable-next-line no-console
    console.log("[db] initialising cluster (first run takes ~10s)…");
    await pg.initialise();
  }

  await pg.start();

  for (const name of DATABASES) {
    try {
      await pg.createDatabase(name);
      // eslint-disable-next-line no-console
      console.log(`[db] created database "${name}"`);
    } catch {
      // Already exists — this script is meant to be re-runnable.
      // eslint-disable-next-line no-console
      console.log(`[db] database "${name}" already exists`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    [
      "",
      `[db] PostgreSQL 17 ready on 127.0.0.1:${PORT}`,
      `[db] data directory: ${DATA_DIR}`,
      `[db] databases: ${DATABASES.join(", ")}`,
      "[db] leave this running; press Ctrl-C to stop.",
      "",
    ].join("\n"),
  );

  const stop = async () => {
    try {
      await pg.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("[db] failed to start:", error);
  process.exit(1);
});

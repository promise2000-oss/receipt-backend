import { createApp } from "./app";
import { env } from "./lib/env";
import { prisma, disconnectPrisma } from "./lib/prisma";
import { closeBrowser } from "./lib/pdf";

async function main(): Promise<void> {
  // Fail fast if the database is unreachable — a silent 500 loop is worse.
  await prisma.$queryRaw`SELECT 1`;

  const app = createApp();
  const server = app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `\n  Eleosstyles Receipt API\n  ▸ http://localhost:${env.port}/api/health\n  ▸ storage: ${env.storageDriver}  mail: ${env.mailDriver}\n`,
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`\n[api] ${signal} received, shutting down…`);

    server.close();
    await closeBrowser().catch(() => undefined);
    await disconnectPrisma().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    // eslint-disable-next-line no-console
    console.error("[api] unhandled rejection:", reason);
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("[api] failed to start:", error);
  process.exit(1);
});

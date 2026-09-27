import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    environment: "node",
    // PDF rendering and concurrent inserts are slower than the default 5s.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // One worker keeps Prisma connections predictable on Windows.
    fileParallelism: false,
    pool: "forks",
  },
});

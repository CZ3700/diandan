import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(
        new URL("./auth-review-server-only-stub.mjs", import.meta.url),
      ),
    },
  },
  test: {
    include: ["output/checks/p6-04-security/auth-review-rate-repro.test.ts"],
    maxWorkers: 1,
    fileParallelism: false,
  },
});

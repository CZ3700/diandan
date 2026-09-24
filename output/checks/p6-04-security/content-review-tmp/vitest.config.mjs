import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { 'server-only': fileURLToPath(new URL('./empty-server-only.mjs', import.meta.url)) } },
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['output/checks/p6-04-security/content-review-tmp/*.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.{test,spec}.{ts,tsx}", "src/test-support/**"],
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 90,
      },
    },
  },
});

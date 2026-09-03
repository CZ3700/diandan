import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

const publicImplementationFiles = [
  new URL("./migrations/runner.ts", import.meta.url),
  new URL("./testing/ephemeral-postgres.ts", import.meta.url),
] as const;

describe("persistence-postgres public type boundary", () => {
  test("does not use node-postgres ClientConfig in exported APIs", async () => {
    const sources = await Promise.all(
      publicImplementationFiles.map((file) => readFile(file, "utf8")),
    );

    expect(sources.join("\n")).not.toMatch(/\bClientConfig\b/u);
  });
});

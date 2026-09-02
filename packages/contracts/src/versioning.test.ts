import { expect, test } from "vitest";

test("owns one fail-closed wire schema version", async () => {
  const versioning = await import("./versioning.js").catch(() => undefined);

  expect(versioning, "versioning module must exist").toBeDefined();
  expect(versioning?.CONTRACT_SCHEMA_VERSION).toBe(1);
  expect(versioning?.schemaVersionSchema.parse(1)).toBe(1);

  for (const invalidVersion of [undefined, null, "1", 0, 1.1, 2]) {
    expect(
      versioning?.schemaVersionSchema.safeParse(invalidVersion).success,
    ).toBe(false);
  }
});

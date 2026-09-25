import { expect, test } from "vitest";
import { adminExceptionsRunResultSchema } from "./admin-exceptions-persistence.js";
test("worker recovery totals are bounded and account for every claimed operation", () => {
  const schema = adminExceptionsRunResultSchema;
  expect(
    schema.safeParse({ schemaVersion: 1, scanned: 3, succeeded: 2, failed: 1 })
      .success,
  ).toBe(true);
  for (const value of [
    { schemaVersion: 1, scanned: 3, succeeded: 3, failed: 1 },
    { schemaVersion: 1, scanned: 101, succeeded: 101, failed: 0 },
    { schemaVersion: 1, scanned: -1, succeeded: 0, failed: -1 },
    {
      schemaVersion: 1,
      scanned: 0,
      succeeded: 0,
      failed: 0,
      error: "private details",
    },
  ])
    expect(schema.safeParse(value).success).toBe(false);
});

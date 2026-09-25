import { expect, test } from "vitest";

import {
  createSafeRuntimeError,
  safeRuntimeErrorSchema,
} from "./safe-error.js";
import { isCanonicalRequestId } from "./request-id.js";

test("keeps the public error envelope strict and canonical", () => {
  const body = createSafeRuntimeError(
    404,
    "018F47A4-7B7C-4F27-8B35-25C984619A11",
  );

  expect(body.schemaVersion).toBe(1);
  expect(body.code).toBe("NOT_FOUND");
  expect(isCanonicalRequestId(body.requestId)).toBe(true);
  expect(Object.isFrozen(body)).toBe(true);
  expect(
    safeRuntimeErrorSchema.safeParse({
      schemaVersion: 1,
      code: "NOT_FOUND",
      requestId: "018F47A4-7B7C-4F27-8B35-25C984619A11",
    }).success,
  ).toBe(false);
});

test("uses contracts as the only owner of the public error envelope", async () => {
  const contracts = await import("@fan-support/contracts").catch(
    () => undefined,
  );

  expect(contracts, "contracts package must be available").toBeDefined();
  expect(safeRuntimeErrorSchema).toBe(contracts?.publicErrorEnvelopeSchema);
});

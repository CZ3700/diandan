import { expect, test } from "vitest";
import { getAdminOperation } from "./admin-operations";
const id = "10000000-0000-4000-8000-000000000001";
test("configuration publication uses a fixed route and requires head, validation, confirmation and a header key", () => {
  const op = getAdminOperation("payment-config-publish");
  expect(op).toBeDefined();
  const body = {
    schemaVersion: 1,
    revisionId: id,
    expectedPublicationId: null,
    validationHash: "a".repeat(64),
    reasonCode: "OPERATIONS_UPDATE",
    confirmed: true,
  };
  expect(op!.path).toBe("/api/v1/admin/payment-configuration/publish");
  expect(op!.parseCommand(body, id)).toEqual({
    ...body,
    action: "PUBLISH",
    idempotencyKey: id,
  });
  for (const extra of [
    { confirmed: false },
    { validationHash: "" },
    { actorId: id },
    { action: "ROLLBACK" },
  ])
    expect(() => op!.parseCommand({ ...body, ...extra }, id)).toThrow();
  expect(() => op!.parseCommand(body)).toThrow();
  expect(getAdminOperation("payment-config-read")!.readOnly).toBe(true);
});

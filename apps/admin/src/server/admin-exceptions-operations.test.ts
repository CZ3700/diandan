import { expect, test } from "vitest";
import { getAdminOperation } from "./admin-operations";
const id = "10000000-0000-4000-8000-000000000001";
test("exception mutations use fixed routes and require version, reason, confirmation and idempotency", () => {
  const operation = getAdminOperation("exceptions-replay-webhook");
  expect(operation).toBeDefined();
  const body = {
    schemaVersion: 1,
    target: { kind: "WEBHOOK", id, consumerKey: null },
    expectedVersion: "a".repeat(64),
    reasonCode: "OPERATOR_REVIEW",
    confirmed: true,
  };
  expect(operation!.path).toBe("/api/v1/admin/exceptions/replay-webhook");
  expect(operation!.parseCommand(body, id)).toMatchObject({
    action: "REPLAY_WEBHOOK",
    idempotencyKey: id,
  });
  for (const extra of [
    { actorId: id },
    { action: "RETRY_NOTIFICATION" },
    { confirmed: false },
    { reasonCode: "" },
    { expectedVersion: 1 },
  ])
    expect(() => operation!.parseCommand({ ...body, ...extra }, id)).toThrow();
  expect(() => operation!.parseCommand(body)).toThrow();
  expect(getAdminOperation("exceptions-list")!.readOnly).toBe(true);
});

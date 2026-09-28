import { expect, test, vi } from "vitest";
import { notificationSubmissionClaimCommandSchema } from "@fan-support/contracts";
import type { TransactionScopeControl } from "./transaction-runner.js";

const implementation =
  await import("./notification-submission-repository.js").catch(
    () => undefined,
  );
const command = notificationSubmissionClaimCommandSchema.parse({
  schemaVersion: 1,
  transportKey: "a".repeat(64),
  idempotencyKey: "notification:00000000-0000-4000-8000-000000000001",
  notificationId: "00000000-0000-4000-8000-000000000001",
  requestHash: "b".repeat(64),
  dispatchNotAfter: "2026-09-29T01:00:00Z",
  claimToken: "00000000-0000-4000-8000-000000000002",
});
const scope: TransactionScopeControl = {
  markRollbackOnly: vi.fn(),
  trackOperation: (work) => work(),
};
function setup() {
  expect(
    implementation,
    "durable native submission repository must exist",
  ).toBeDefined();
  const query = vi.fn(async () => ({ rows: [] }));
  return {
    query,
    repository: implementation!.createNotificationSubmissionRepository(
      { query, release: vi.fn() },
      scope,
    ),
  };
}
test("unknown notification cannot obtain sending authority", async () => {
  const { repository } = setup();
  expect(await repository.claim(command)).toEqual({
    schemaVersion: 1,
    decision: "CONFLICT",
  });
});
test("invalid or secret-bearing commands fail before SQL", async () => {
  const { repository, query } = setup();
  await expect(
    repository.claim({
      ...command,
      recipient: "private@example.test",
    } as never),
  ).rejects.toMatchObject({ code: "INVALID_COMMAND" });
  expect(query).not.toHaveBeenCalled();
});
test("uncertain result cannot finalize the permanent admission", async () => {
  const { repository, query } = setup();
  await expect(
    repository.finish({
      ...command,
      result: {
        schemaVersion: 1,
        operation: "SEND_NOTIFICATION",
        outcome: "FAILURE",
        error: {
          schemaVersion: 1,
          code: "TIMEOUT_OUTCOME_UNKNOWN",
          recovery: "NONE",
        },
      },
    }),
  ).rejects.toMatchObject({ code: "INVALID_COMMAND" });
  expect(query).not.toHaveBeenCalled();
});

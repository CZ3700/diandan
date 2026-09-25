import { expect, test } from "vitest";
import type { NotificationPortResponse } from "@fan-support/contracts";
const module = await import("./notification-lifecycle.js").catch(
  () => undefined,
);
const result = (code: string) =>
  ({
    schemaVersion: 1,
    operation: "SEND_NOTIFICATION",
    outcome: "FAILURE",
    error: {
      schemaVersion: 1,
      code,
      recovery: "RETRY_SAME_COMMAND",
      retryAfterMs: 1000,
    },
  }) as NotificationPortResponse;
test("an ambiguous result retains UNKNOWN while retrying the same durable identity", () => {
  expect(module).toBeDefined();
  expect(
    module!.notificationCompletion(
      result("TIMEOUT_OUTCOME_UNKNOWN"),
      1,
      6,
      true,
    ),
  ).toEqual({
    status: "RETRY_SCHEDULED",
    outcome: "UNKNOWN",
    errorCode: "TIMEOUT_OUTCOME_UNKNOWN",
    providerReference: null,
  });
});
test("the hard provider deduplication deadline ends automatic unknown retries", () => {
  expect(module).toBeDefined();
  expect(
    module!.notificationCompletion(
      result("TIMEOUT_OUTCOME_UNKNOWN"),
      1,
      6,
      false,
    ),
  ).toMatchObject({
    status: "FAILED",
    outcome: "UNKNOWN",
    errorCode: "IDEMPOTENCY_WINDOW_EXPIRED",
  });
});
test("the attempt budget terminates rather than rotating the provider key", () => {
  expect(module).toBeDefined();
  expect(
    module!.notificationCompletion(
      result("TIMEOUT_OUTCOME_UNKNOWN"),
      6,
      6,
      true,
    ),
  ).toMatchObject({ status: "FAILED", outcome: "UNKNOWN" });
});

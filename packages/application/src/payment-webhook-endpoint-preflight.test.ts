import { expect, test, vi } from "vitest";
import type { ReliableEventTransactionManager } from "@fan-support/persistence-port";

import { createPaymentWebhookEndpointPreflight } from "./payment-webhook-endpoint-preflight.js";

const endpointId = "60000000-0000-4000-8000-000000000001";
const receivedAt = "2026-09-04T00:00:00.000Z";

function createHarness(decision: "ELIGIBLE" | "UNAVAILABLE") {
  const load = vi.fn(async () => ({
    schemaVersion: 1,
    operation: "LOAD_PAYMENT_WEBHOOK_ENDPOINT",
    outcome: "SUCCESS",
    value:
      decision === "UNAVAILABLE"
        ? { decision }
        : {
            decision,
            endpoint: {
              schemaVersion: 1,
              endpointId,
              providerAccountId: "60000000-0000-4000-8000-000000000002",
              environment: "TEST",
              adapterKey: "fake_psp",
              verificationKeyReferenceHash: "a".repeat(64),
              lifecycle: {
                status: "ACTIVE",
                activeFrom: "2026-09-03T00:00:00.000Z",
              },
            },
          },
  }));
  const runInReliableEventTransaction = vi.fn(
    async (_options: unknown, work: (repositories: unknown) => unknown) =>
      work({ paymentWebhookEndpoints: { load } }),
  );
  const check = createPaymentWebhookEndpointPreflight({
    transactionManager: {
      runInReliableEventTransaction,
    } as unknown as ReliableEventTransactionManager,
  });
  return { check, load, runInReliableEventTransaction };
}

test("maps an endpoint before the transport reads its webhook payload", async () => {
  const harness = createHarness("ELIGIBLE");

  await expect(
    harness.check({ schemaVersion: 1, endpointId, receivedAt }),
  ).resolves.toEqual({ schemaVersion: 1, outcome: "ELIGIBLE" });
  expect(harness.load).toHaveBeenCalledWith({
    schemaVersion: 1,
    operation: "LOAD_PAYMENT_WEBHOOK_ENDPOINT",
    endpointId,
    receivedAt,
  });
});

test("returns only a secret-free availability decision", async () => {
  const harness = createHarness("UNAVAILABLE");

  await expect(
    harness.check({ schemaVersion: 1, endpointId, receivedAt }),
  ).resolves.toEqual({ schemaVersion: 1, outcome: "UNAVAILABLE" });
});

test("fails malformed preflight input before opening a transaction", async () => {
  const harness = createHarness("ELIGIBLE");

  await expect(
    harness.check({
      schemaVersion: 1,
      endpointId: "not-an-endpoint",
      receivedAt,
    }),
  ).resolves.toEqual({ schemaVersion: 1, outcome: "INVALID_REQUEST" });
  expect(harness.runInReliableEventTransaction).not.toHaveBeenCalled();
});

test("normalizes database failure without reflecting the provider error", async () => {
  const canary = "PRIVATE_DATABASE_FAILURE_97135";
  const check = createPaymentWebhookEndpointPreflight({
    transactionManager: {
      runInReliableEventTransaction: async () => {
        throw new Error(canary);
      },
    } as ReliableEventTransactionManager,
  });

  const result = await check({ schemaVersion: 1, endpointId, receivedAt });
  expect(result).toEqual({
    schemaVersion: 1,
    outcome: "TEMPORARY_UNAVAILABLE",
  });
  expect(JSON.stringify(result)).not.toContain(canary);
});

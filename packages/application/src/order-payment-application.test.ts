import { describe, expect, it } from "vitest";
import * as application from "./index.js";
import { createOrderPaymentApplication } from "./order-payment-application.js";
import type {
  OrderPaymentApplicationRepository,
  OrderPaymentApplicationTransactionManager,
} from "@fan-support/persistence-port";
import type {
  OrderPaymentApplyCommand,
  OrderPaymentApplyResult,
} from "@fan-support/contracts";
const id = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const command = {
  schemaVersion: 1 as const,
  providerEventId: id,
  requestId: id,
  correlationId: id,
  taskName: "order-payment-application",
};
function create(repository: OrderPaymentApplicationRepository) {
  const factory = (
    application as unknown as {
      createOrderPaymentApplication?: (deps: {
        transactions: OrderPaymentApplicationTransactionManager;
        createId: () => string;
      }) => {
        apply: (command: unknown) => Promise<OrderPaymentApplyResult>;
        runPending: (limit: number) => Promise<unknown>;
      };
    }
  ).createOrderPaymentApplication;
  expect(factory).toBeTypeOf("function");
  return factory!({
    transactions: {
      runInOrderPaymentApplicationTransaction: async (work) => work(repository),
    },
    createId: () => id,
  });
}
const paid = (providerEventId: string) => ({
  schemaVersion: 1 as const,
  decision: "APPLIED" as const,
  receiptId: id,
  providerEventId,
  attemptId: id,
  orderId: id,
  outcome: "PAID" as const,
});
describe("durable order payment application", () => {
  it("rejects a malformed scan before committing its scheduling changes", async () => {
    let commits = 0;
    const app = createOrderPaymentApplication({
      transactions: {
        runInOrderPaymentApplicationTransaction: async (work) => {
          const result = await work({
            listPending: async () =>
              ({ schemaVersion: 1, providerEventIds: [id, id] }) as never,
            apply: async () => {
              throw new Error("must not apply");
            },
          });
          commits++;
          return result;
        },
      },
    });
    await expect(app.runPending(2)).rejects.toMatchObject({
      code: "PERSISTENCE_FAILURE",
    });
    expect(commits).toBe(0);
  });
  it("rejects injected financial facts before repository access", async () => {
    let calls = 0;
    const useCases = create({
      apply: async () => {
        calls++;
        return paid(id) as OrderPaymentApplyResult;
      },
      listPending: async () => ({ schemaVersion: 1, providerEventIds: [] }),
    });
    await expect(
      useCases.apply({ ...command, status: "SUCCEEDED" }),
    ).rejects.toMatchObject({ code: "INVALID_COMMAND" });
    expect(calls).toBe(0);
  });
  it("checks result correlation instead of accepting another order receipt", async () => {
    const useCases = create({
      apply: async () => paid(second) as OrderPaymentApplyResult,
      listPending: async () => ({ schemaVersion: 1, providerEventIds: [] }),
    });
    await expect(useCases.apply(command)).rejects.toMatchObject({
      code: "INVALID_RESULT",
    });
  });
  it("isolates a failed event and preserves unmatched recovery in a bounded batch", async () => {
    const calls: string[] = [];
    const useCases = create({
      apply: async (input: OrderPaymentApplyCommand) => {
        calls.push(input.providerEventId);
        if (input.providerEventId === id)
          throw new Error("private vendor body");
        return {
          schemaVersion: 1,
          decision: "UNMATCHED",
          providerEventId: input.providerEventId,
          reason: "EXTERNAL_REFERENCE_NOT_BOUND",
        };
      },
      listPending: async () =>
        ({ schemaVersion: 1, providerEventIds: [id, second] }) as never,
    });
    expect(await useCases.runPending(2)).toEqual({
      schemaVersion: 1,
      scanned: 2,
      applied: 0,
      replayed: 0,
      unmatched: 1,
      review: 0,
      ignored: 0,
      failed: 1,
    });
    expect(calls).toEqual([id, second]);
  });
});

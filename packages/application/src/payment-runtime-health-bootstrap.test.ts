import { expect, it, vi } from "vitest";
import {
  paymentHealthPolicySchema,
  paymentHealthSnapshotSchema,
} from "@fan-support/contracts";
import type {
  PaymentHealthRepository,
  PaymentHealthTransactionManager,
} from "@fan-support/persistence-port";
import { paymentHarness } from "./payment-runtime.harness.js";
import { createPaymentRuntimeHealth } from "./payment-runtime-health.js";

async function fixture(fail = false) {
  const h = await paymentHarness();
  const policies = [1, 2, 3].map((index) =>
    paymentHealthPolicySchema.parse({
      schemaVersion: 1,
      providerAccountId: `a1000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      environment: "TEST",
      version: 1,
      failureThreshold: 3,
      failureWindowMs: 60000,
      openDurationMs: 1000,
      probeLeaseMs: 1000,
      probeRetryMs: 1000,
    }),
  );
  const initialize = vi.fn(async (policy: (typeof policies)[number]) => {
    if (fail) throw new Error("bounded repository unavailable");
    return paymentHealthSnapshotSchema.parse({
      schemaVersion: 1,
      providerAccountId: policy.providerAccountId,
      environment: policy.environment,
      policyVersion: policy.version,
      healthStatus: "HEALTHY",
      failureCount: 0,
      generation: 0,
      probeDueAt: null,
    });
  });
  const claimProbe = vi.fn<PaymentHealthRepository["claimProbe"]>(
    async () => null,
  );
  const repository: PaymentHealthRepository = {
    initialize,
    claimProbe,
    record: async () => {
      throw new Error("unused");
    },
    completeProbe: async () => {
      throw new Error("unused");
    },
  };
  const transactions: PaymentHealthTransactionManager = {
    runInPaymentHealthTransaction: async (work) => work(repository),
  };
  const providers = policies.map((policy) => ({
    ...h.dependencies.providers[0]!,
    configuration: {
      ...h.dependencies.providers[0]!.configuration,
      providerAccountId: policy.providerAccountId,
    },
  }));
  return {
    initialize,
    claimProbe,
    policies,
    health: createPaymentRuntimeHealth(
      { transactions, policies },
      () => providers,
    ),
  };
}
it("one failed bootstrap per sweep cannot multiply a bounded DB outage by the account count", async () => {
  const h = await fixture(true);
  for (let index = 0; index < 3; index++) {
    expect(await h.health.probeNext()).toMatchObject({ processed: false });
    expect(h.initialize).toHaveBeenCalledTimes(index + 1);
    expect(h.initialize.mock.calls[index]?.[0].providerAccountId).toBe(
      h.policies[index]!.providerAccountId,
    );
  }
  expect(h.claimProbe).not.toHaveBeenCalled();
});
it("incremental bootstrap keeps all ready accounts available to the PG due queue", async () => {
  const h = await fixture();
  for (let index = 0; index < 3; index++) {
    await h.health.probeNext();
    expect(h.initialize).toHaveBeenCalledTimes(index + 1);
    expect(h.claimProbe.mock.calls[index]?.[0].accounts).toHaveLength(
      index + 1,
    );
  }
  await h.health.probeNext();
  expect(h.initialize).toHaveBeenCalledTimes(3);
  expect(h.claimProbe.mock.calls[3]?.[0].accounts).toHaveLength(3);
});

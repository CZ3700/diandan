import { expect, test, vi } from "vitest";
import {
  paymentHealthPolicySchema,
  type PaymentHealthPolicy,
} from "@fan-support/contracts";
import type { PaymentHealthRepository } from "@fan-support/persistence-port";
import { createPaymentRuntimeHealth } from "./payment-runtime-health.js";
const policy = paymentHealthPolicySchema.parse({
  schemaVersion: 1,
  providerAccountId: "10000000-0000-4000-8000-000000000001",
  environment: "TEST",
  version: 1,
  failureThreshold: 3,
  failureWindowMs: 60000,
  openDurationMs: 30000,
  probeLeaseMs: 30000,
  probeRetryMs: 10000,
});
function setup(initial = [policy]) {
  let policies = initial;
  const initialize = vi.fn<PaymentHealthRepository["initialize"]>(
    async (value) => ({
      schemaVersion: 1,
      providerAccountId: value.providerAccountId,
      environment: value.environment,
      policyVersion: value.version,
      healthStatus: "UNAVAILABLE",
      failureCount: 3,
      generation: 2,
      probeDueAt: null,
    }),
  );
  const repository = {
    initialize,
    record: vi.fn(),
    claimProbe: vi.fn(async () => null),
    completeProbe: vi.fn(),
  } as PaymentHealthRepository;
  const health = createPaymentRuntimeHealth(
    {
      policies,
      readPolicies: () => policies,
      transactions: {
        runInPaymentHealthTransaction: async (work) => work(repository),
      },
    },
    () => [],
  );
  return {
    health,
    initialize,
    update: (value: PaymentHealthPolicy[]) => {
      policies = value;
    },
  };
}
test("a newly published health policy invalidates successful initialization without resetting circuit state", async () => {
  const h = setup();
  expect(await h.health.initialize(policy)).toBe(true);
  h.update([{ ...policy, version: 2, failureThreshold: 5 }]);
  expect(await h.health.initialize(policy)).toBe(true);
  expect(h.initialize).toHaveBeenCalledTimes(2);
  expect(h.initialize.mock.calls[1]![0]).toMatchObject({
    version: 2,
    failureThreshold: 5,
  });
  await h.health.initialize(policy);
  expect(h.initialize).toHaveBeenCalledTimes(2);
});
test("a late initialization of an older policy cannot admit requests under a new publication", async () => {
  const h = setup();
  let finish!: (
    value: Awaited<ReturnType<PaymentHealthRepository["initialize"]>>,
  ) => void;
  h.initialize.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const older = h.health.initialize(policy);
  h.update([{ ...policy, version: 2 }]);
  expect(await h.health.initialize(policy)).toBe(true);
  finish({
    schemaVersion: 1,
    providerAccountId: policy.providerAccountId,
    environment: "TEST",
    policyVersion: 1,
    healthStatus: "HEALTHY",
    failureCount: 0,
    generation: 0,
    probeDueAt: null,
  });
  expect(await older).toBe(false);
});
test("same-version changes, older versions and removed historical policies fail closed", async () => {
  const h = setup();
  expect(await h.health.initialize(policy)).toBe(true);
  h.update([{ ...policy, failureThreshold: 5 }]);
  expect(await h.health.initialize(policy)).toBe(false);
  h.update([{ ...policy, version: 2 }]);
  expect(await h.health.initialize(policy)).toBe(true);
  h.update([policy]);
  expect(await h.health.initialize(policy)).toBe(false);
  h.update([]);
  expect(await h.health.initialize(policy)).toBe(false);
  expect(h.initialize).toHaveBeenCalledTimes(2);
});
test("an explicitly dynamic empty deployment remains closed until its first published health policy", async () => {
  const h = setup([]);
  expect(await h.health.initialize(policy)).toBe(false);
  expect(h.initialize).not.toHaveBeenCalled();
  h.update([policy]);
  expect(await h.health.initialize(policy)).toBe(true);
  expect(h.initialize).toHaveBeenCalledOnce();
});

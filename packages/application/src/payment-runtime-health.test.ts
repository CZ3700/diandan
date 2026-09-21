import { expect, test, vi } from "vitest";
import {
  paymentPortCommandSchema,
  paymentPortResponseSchema,
} from "@fan-support/contracts";
import { classifyPaymentHealthResponse } from "./payment-runtime-health-classification.js";
import { createPaymentRuntimeUseCases } from "./payment-runtime.js";
import { paymentHarness } from "./payment-runtime.harness.js";
import type {
  PaymentHealthRepository,
  PaymentHealthTransactionManager,
} from "@fan-support/persistence-port";

const setup = async () => {
  const h = await paymentHarness();
  const account = h.dependencies.providers[0]!.configuration;
  const policy = {
    schemaVersion: 1 as const,
    providerAccountId: account.providerAccountId,
    environment: account.environment,
    version: 1,
    failureThreshold: 3,
    failureWindowMs: 60000,
    openDurationMs: 30000,
    probeLeaseMs: 30000,
    probeRetryMs: 10000,
  };
  const repository = {
    initialize: vi.fn<PaymentHealthRepository["initialize"]>(async () => ({
      schemaVersion: 1,
      providerAccountId: policy.providerAccountId,
      environment: policy.environment,
      policyVersion: policy.version,
      healthStatus: "HEALTHY",
      failureCount: 0,
      generation: 0,
      probeDueAt: null,
    })),
    record: vi.fn<PaymentHealthRepository["record"]>(async () => ({
      schemaVersion: 1,
      recorded: true,
      healthStatus: "HEALTHY",
    })),
    claimProbe: vi.fn<PaymentHealthRepository["claimProbe"]>(async () => null),
    completeProbe: vi.fn<PaymentHealthRepository["completeProbe"]>(
      async () => ({
        schemaVersion: 1,
        applied: true,
        healthStatus: "HEALTHY",
      }),
    ),
  };
  const transactions: PaymentHealthTransactionManager = {
    runInPaymentHealthTransaction: async (work) => work(repository),
  };
  const health = {
    policies: [policy],
    transactions,
  };
  const app = createPaymentRuntimeUseCases({ ...h.dependencies, health });
  const capabilities = {
    ...h.create,
    operation: "READ_PAYMENT_CAPABILITIES",
    presentationLocale: "en",
  };
  delete (capabilities as Partial<typeof h.create>).capabilityId;
  delete (capabilities as Partial<typeof h.create>).configVersion;
  delete (capabilities as Partial<typeof h.create>).ruleVersion;
  return { h, repository, health, app, capabilities, policy };
};

test("a confirmed customer cancellation is a business outcome rather than a health recovery", () => {
  const identity = {
    providerAccountId: "71000000-0000-4000-8000-000000000001",
    environment: "TEST",
    attemptId: "71000000-0000-4000-8000-000000000002",
    externalReference: "fake/payment/canceled",
  };
  const command = paymentPortCommandSchema.parse({
    schemaVersion: 1,
    operation: "GET_PAYMENT",
    ...identity,
  });
  expect(
    classifyPaymentHealthResponse(command, {
      schemaVersion: 1,
      operation: "GET_PAYMENT",
      outcome: "SUCCESS",
      value: {
        ...identity,
        status: "CANCELED",
        providerLocale: "en",
        fallbackUsed: false,
        observedAt: "2026-09-22T00:00:00.000Z",
      },
    }),
  ).toEqual({ classification: "BUSINESS_OUTCOME", code: null });
});

test("capability observations use the exact configured checkout probe context and bootstrap once", async () => {
  const { app, h, repository, capabilities, policy } = await setup();
  await app.capabilities(capabilities, h.context);
  await app.capabilities(capabilities, h.context);
  expect(repository.initialize).toHaveBeenCalledTimes(1);
  expect(repository.initialize).toHaveBeenCalledWith(policy);
  expect(repository.record).toHaveBeenCalledTimes(2);
  expect(repository.record.mock.calls[0]![0]).toMatchObject({
    providerAccountId: policy.providerAccountId,
    environment: "TEST",
    operation: "GET_CAPABILITIES",
    classification: "SUCCESS",
    code: null,
    probeContext: {
      routeId: h.create.capabilityId,
      configVersion: 1,
      ruleVersion: 1,
      command: h.provider.getCapabilities.mock.calls[0]![0],
    },
  });
  expect(repository.record.mock.calls[0]![0]).not.toEqual(
    repository.record.mock.calls[1]![0],
  );
});

test("bootstrap failure closes new capabilities before any provider call", async () => {
  const { app, h, repository, capabilities } = await setup();
  repository.initialize.mockRejectedValue(
    new Error("private-database-details"),
  );
  expect(await app.capabilities(capabilities, h.context)).toMatchObject({
    outcome: "SUCCESS",
    capabilities: { capabilities: [] },
  });
  expect(h.provider.getCapabilities).not.toHaveBeenCalled();
});

test("concurrent capability requests share one bootstrap without sharing observation identifiers", async () => {
  const { app, h, repository, capabilities } = await setup();
  await Promise.all([
    app.capabilities(capabilities, h.context),
    app.capabilities(capabilities, h.context),
  ]);
  expect(repository.initialize).toHaveBeenCalledTimes(1);
  expect(repository.record).toHaveBeenCalledTimes(2);
  expect(repository.record.mock.calls[0]![0].observationId).not.toBe(
    repository.record.mock.calls[1]![0].observationId,
  );
});

test("failed observation persistence closes capability admission without creating a payment", async () => {
  const { app, h, repository } = await setup();
  repository.record.mockRejectedValue(new Error("private-health-details"));
  expect(await app.create(h.create, h.context)).toMatchObject({
    outcome: "FAILURE",
    code: "CAPABILITY_UNAVAILABLE",
  });
  expect(h.provider.createPayment).not.toHaveBeenCalled();
});

test("health persistence failure after an accepted create never replaces the original payment result", async () => {
  const { app, h, repository } = await setup();
  repository.record.mockImplementation(async (input) => {
    if ((input as { operation: string }).operation === "CREATE_PAYMENT")
      throw new Error("private-health-details");
    return { schemaVersion: 1, recorded: true, healthStatus: "HEALTHY" };
  });
  expect(await app.create(h.create, h.context)).toMatchObject({
    outcome: "SUCCESS",
    attempt: { status: "REQUIRES_ACTION" },
  });
  expect(h.provider.createPayment).toHaveBeenCalledTimes(1);
  expect(repository.record).toHaveBeenCalledTimes(2);
  await app.create(h.create, h.context);
  expect(h.provider.createPayment).toHaveBeenCalledTimes(1);
});

test("health persistence failure cannot discard trusted reconcile or resend an uncertain create", async () => {
  const { app, h, repository } = await setup();
  h.setOutcome("UNKNOWN");
  const created = await app.create(h.create, h.context);
  expect(created).toMatchObject({
    outcome: "SUCCESS",
    attempt: { status: "UNKNOWN" },
  });
  if (
    created.outcome !== "SUCCESS" ||
    !("attempt" in created) ||
    created.attempt === null
  )
    throw new Error("Expected attempt");
  repository.record.mockRejectedValue(new Error("private-health-details"));
  expect(
    await app.recover(h.recover(created.attempt.id), h.freshContext()),
  ).toMatchObject({
    outcome: "SUCCESS",
    attempt: { status: "PROCESSING" },
  });
  expect(h.provider.createPayment).toHaveBeenCalledTimes(1);
  expect(h.provider.reconcilePayment).toHaveBeenCalledTimes(1);
  expect(repository.record).toHaveBeenCalledTimes(3);
});

test.each([
  ["RATE_LIMITED", "TECHNICAL_FAILURE"],
  ["TEMPORARY_UNAVAILABLE", "TECHNICAL_FAILURE"],
  ["UNEXPECTED_ADAPTER_FAILURE", "TECHNICAL_FAILURE"],
  ["MALFORMED_PROVIDER_RESPONSE", "TECHNICAL_FAILURE"],
  ["PROVIDER_DECLINED", "BUSINESS_OUTCOME"],
  ["CAPABILITY_UNAVAILABLE", "BUSINESS_OUTCOME"],
  ["PAYMENT_NOT_FOUND", "BUSINESS_OUTCOME"],
  ["REFUND_NOT_FOUND", "BUSINESS_OUTCOME"],
  ["CONFIGURATION_ERROR", "CONFIGURATION_ERROR"],
  ["INVALID_COMMAND", "CONFIGURATION_ERROR"],
  ["AUTHENTICATION_FAILED", "CONFIGURATION_ERROR"],
])(
  "observes %s as %s without storing provider payloads",
  async (code, classification) => {
    const { app, h, repository, capabilities } = await setup();
    const retry = [
      "RATE_LIMITED",
      "TEMPORARY_UNAVAILABLE",
      "UNEXPECTED_ADAPTER_FAILURE",
    ].includes(code);
    h.provider.getCapabilities.mockResolvedValue({
      schemaVersion: 1,
      operation: "GET_CAPABILITIES",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code,
        recovery: retry ? "RETRY_SAME_COMMAND" : "NONE",
        ...(retry ? { retryAfterMs: 1000 } : {}),
      },
    } as never);
    await app.capabilities(capabilities, h.context);
    expect(repository.record).toHaveBeenCalledWith(
      expect.objectContaining({ classification, code }),
    );
    expect(
      Object.keys(repository.record.mock.calls[0]![0] as object).sort(),
    ).toEqual([
      "classification",
      "code",
      "environment",
      "observationId",
      "operation",
      "probeContext",
      "providerAccountId",
      "schemaVersion",
    ]);
  },
);

test("provider exceptions and malformed associations have fixed technical classifications", async () => {
  const { app, h, repository, capabilities } = await setup();
  h.provider.getCapabilities.mockRejectedValueOnce(
    new Error("private-provider-payload"),
  );
  await app.capabilities(capabilities, h.context);
  expect(repository.record).toHaveBeenLastCalledWith(
    expect.objectContaining({
      classification: "TECHNICAL_FAILURE",
      code: "UNEXPECTED_ADAPTER_FAILURE",
    }),
  );
  h.provider.getCapabilities.mockResolvedValueOnce({
    schemaVersion: 9,
  } as never);
  await app.capabilities(capabilities, h.context);
  expect(repository.record).toHaveBeenLastCalledWith(
    expect.objectContaining({
      classification: "TECHNICAL_FAILURE",
      code: "MALFORMED_PROVIDER_RESPONSE",
    }),
  );
  expect(JSON.stringify(repository.record.mock.calls)).not.toContain(
    "private-provider-payload",
  );
});

test("a legitimate empty capability list is successful communication with no purchase option", async () => {
  const { app, h, repository, capabilities } = await setup();
  h.provider.getCapabilities.mockResolvedValueOnce({
    schemaVersion: 1,
    operation: "GET_CAPABILITIES",
    outcome: "SUCCESS",
    value: { capabilities: [] },
  });
  expect(await app.capabilities(capabilities, h.context)).toMatchObject({
    outcome: "SUCCESS",
    capabilities: { capabilities: [] },
  });
  expect(repository.record).toHaveBeenLastCalledWith(
    expect.objectContaining({ classification: "SUCCESS", code: null }),
  );
});
test("a correlated but unavailable capability is a business outcome", async () => {
  const { app, h, repository, capabilities } = await setup();
  const invoke = h.provider.getCapabilities.getMockImplementation()!;
  h.provider.getCapabilities.mockImplementation(async (command) => {
    const response = paymentPortResponseSchema.parse(await invoke(command));
    if (
      response.operation !== "GET_CAPABILITIES" ||
      response.outcome !== "SUCCESS"
    )
      throw new Error("Expected fixture capability response");
    response.value.capabilities[0]!.available = false;
    return response;
  });
  expect(await app.capabilities(capabilities, h.context)).toMatchObject({
    outcome: "SUCCESS",
    capabilities: { capabilities: [] },
  });
  expect(repository.record).toHaveBeenLastCalledWith(
    expect.objectContaining({ classification: "BUSINESS_OUTCOME", code: null }),
  );
});

test("a claimed health recovery uses only the stored safe query and completes its exact fence", async () => {
  const { app, h, repository, capabilities, policy } = await setup();
  await app.capabilities(capabilities, h.context);
  const context = (
    repository.record.mock.calls[0]![0] as { probeContext: unknown }
  ).probeContext;
  const lease = {
    schemaVersion: 1,
    probeId: "71000000-0000-4000-8000-000000000088",
    providerAccountId: policy.providerAccountId,
    environment: "TEST",
    generation: 2,
    expiresAt: "2026-09-22T22:00:00.000Z",
    context,
  };
  repository.claimProbe.mockResolvedValueOnce(lease as never);
  h.provider.getCapabilities.mockResolvedValueOnce({
    schemaVersion: 1,
    operation: "GET_CAPABILITIES",
    outcome: "SUCCESS",
    value: { capabilities: [] },
  });
  const healthApp = app as typeof app & { probeNext(): Promise<unknown> };
  expect(typeof healthApp.probeNext).toBe("function");
  expect(await healthApp.probeNext()).toEqual({
    schemaVersion: 1,
    outcome: "SUCCESS",
    processed: true,
  });
  expect(repository.claimProbe).toHaveBeenCalledWith({
    schemaVersion: 1,
    accounts: [
      { providerAccountId: policy.providerAccountId, environment: "TEST" },
    ],
  });
  expect(repository.completeProbe).toHaveBeenCalledWith({
    schemaVersion: 1,
    lease,
    classification: "SUCCESS",
    code: null,
  });
  expect(h.provider.getCapabilities).toHaveBeenLastCalledWith(
    (context as { command: unknown }).command,
  );
  expect(h.provider.createPayment).not.toHaveBeenCalled();
  expect(h.provider.getPayment).not.toHaveBeenCalled();
  expect(h.provider.refundPayment).not.toHaveBeenCalled();
  expect(repository.record).toHaveBeenCalledTimes(1);
});

test("health bootstrap outage cannot disable recovery of an existing uncertain attempt", async () => {
  const { app, h, repository } = await setup();
  const original = createPaymentRuntimeUseCases(h.dependencies);
  h.setOutcome("UNKNOWN");
  const created = await original.create(h.create, h.context);
  if (
    created.outcome !== "SUCCESS" ||
    !("attempt" in created) ||
    created.attempt === null
  )
    throw new Error("Expected attempt");
  repository.initialize.mockRejectedValue(
    new Error("private-bootstrap-details"),
  );
  expect(
    await app.recover(h.recover(created.attempt.id), h.freshContext()),
  ).toMatchObject({ outcome: "SUCCESS", attempt: { status: "PROCESSING" } });
  expect(h.provider.createPayment).toHaveBeenCalledTimes(1);
  expect(h.provider.reconcilePayment).toHaveBeenCalledTimes(1);
  expect(repository.initialize).toHaveBeenCalledTimes(1);
});

test("an account missing from the configured health policy cannot admit a new payment but retains old recovery", async () => {
  const { h, health, capabilities } = await setup();
  const unconfigured = createPaymentRuntimeUseCases({
    ...h.dependencies,
    health: {
      ...health,
      policies: [
        {
          ...health.policies[0]!,
          providerAccountId:
            "71000000-0000-4000-8000-000000000077" as (typeof health.policies)[0]["providerAccountId"],
        },
      ],
    },
  });
  expect(
    await unconfigured.capabilities(capabilities, h.context),
  ).toMatchObject({ outcome: "SUCCESS", capabilities: { capabilities: [] } });
  expect(h.provider.getCapabilities).not.toHaveBeenCalled();
  const original = createPaymentRuntimeUseCases(h.dependencies);
  h.setOutcome("UNKNOWN");
  const created = await original.create(h.create, h.context);
  if (
    created.outcome !== "SUCCESS" ||
    !("attempt" in created) ||
    created.attempt === null
  )
    throw new Error("Expected attempt");
  expect(
    await unconfigured.recover(h.recover(created.attempt.id), h.freshContext()),
  ).toMatchObject({ outcome: "SUCCESS", attempt: { status: "PROCESSING" } });
  expect(h.provider.createPayment).toHaveBeenCalledTimes(1);
});

test("an unresolved health query expires locally and a late success never completes the lease twice", async () => {
  const { app, h, repository, capabilities, policy } = await setup();
  await app.capabilities(capabilities, h.context);
  const context = (
    repository.record.mock.calls[0]![0] as { probeContext: unknown }
  ).probeContext;
  repository.claimProbe.mockResolvedValueOnce({
    schemaVersion: 1,
    probeId: "71000000-0000-4000-8000-000000000088",
    providerAccountId: policy.providerAccountId,
    environment: "TEST",
    generation: 2,
    expiresAt: "2026-09-22T22:00:00.000Z",
    context,
  } as never);
  let resolve: ((response: unknown) => void) | undefined;
  h.provider.getCapabilities.mockImplementationOnce(
    () =>
      new Promise((release) => {
        resolve = release as typeof resolve;
      }),
  );
  vi.useFakeTimers();
  try {
    let completed = false;
    const pending = app.probeNext().then((result) => {
      completed = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(policy.probeLeaseMs - 1);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(completed).toBe(true);
    expect(await pending).toMatchObject({
      outcome: "SUCCESS",
      processed: true,
    });
    expect(repository.completeProbe).toHaveBeenCalledTimes(1);
    expect(repository.completeProbe).toHaveBeenLastCalledWith(
      expect.objectContaining({
        classification: "TECHNICAL_FAILURE",
        code: "TEMPORARY_UNAVAILABLE",
      }),
    );
    resolve!({
      schemaVersion: 1,
      operation: "GET_CAPABILITIES",
      outcome: "SUCCESS",
      value: { capabilities: [] },
    });
    await vi.advanceTimersByTimeAsync(policy.probeLeaseMs);
    expect(repository.completeProbe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

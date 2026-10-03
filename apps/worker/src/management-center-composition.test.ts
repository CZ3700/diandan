import { expect, test, vi } from "vitest";

import { createWorkerManagementCenterComposition } from "./management-center-composition.js";

const environment = {
  FAN_SUPPORT_DATABASE_URL: "postgresql://database.example.invalid/fan_support",
  FAN_SUPPORT_DEPLOYMENT_ENV: "staging",
  FAN_SUPPORT_OBJECT_STORAGE_AUTH_MODE: "ambient",
  FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET: "fixture-source",
  FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET: "fixture-derivative",
  FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN:
    "https://media.example.invalid",
  FAN_SUPPORT_OBJECT_STORAGE_REGION: "us-east-1",
};

function harness() {
  const operations = { claim: vi.fn(async () => null) };
  const persistence = {
    managementCenterTransactionManager: {
      runInManagementCenterTransaction: vi.fn(
        async (work: (repositories: unknown) => Promise<unknown>) =>
          work({ operations }),
      ),
    },
    managementMediaTransactionManager: {
      runInManagementMediaTransaction: vi.fn(),
    },
    close: vi.fn(async () => undefined),
  };
  const storage = { marker: "storage" };
  const inspector = { inspect: vi.fn() };
  const runtime = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    runOnce: vi.fn(),
  };
  let processNext: (() => Promise<unknown>) | undefined;
  const factories = {
    createPersistence: vi.fn(() => persistence),
    createStorage: vi.fn(() => storage),
    createInspector: vi.fn(() => inspector),
    createRuntime: vi.fn(
      (options: {
        processNext(): Promise<unknown>;
        pollIntervalMs: number;
      }) => {
        processNext = options.processNext;
        return runtime;
      },
    ),
    createLeaseToken: () => "a".repeat(64),
    now: () => new Date("2026-09-26T00:00:00.000Z"),
  };
  return {
    operations,
    persistence,
    storage,
    runtime,
    factories,
    processNext: () => processNext?.(),
  };
}

test("claims management operations through its own pool and the deployment's object storage", async () => {
  const h = harness();
  const composition = await createWorkerManagementCenterComposition(
    environment,
    { factories: h.factories as never },
  );
  expect(h.factories.createPersistence).toHaveBeenCalledWith(
    {
      connectionString: environment.FAN_SUPPORT_DATABASE_URL,
      application_name: "fan-support-management-worker",
    },
    undefined,
  );
  expect(h.factories.createInspector).toHaveBeenCalledWith({
    storage: h.storage,
    now: h.factories.now,
  });
  expect(h.factories.createRuntime).toHaveBeenCalledWith(
    expect.objectContaining({ pollIntervalMs: 1000, fallback: "UNAVAILABLE" }),
  );
  await expect(h.processNext()).resolves.toBe("EMPTY");
  expect(h.operations.claim).toHaveBeenCalledWith(
    expect.objectContaining({ leaseSeconds: 300 }),
  );
  await composition.start();
  expect(h.runtime.start).toHaveBeenCalledTimes(1);
  await Promise.all([composition.stop(), composition.stop()]);
  expect(h.runtime.stop).toHaveBeenCalledTimes(1);
  expect(h.persistence.close).toHaveBeenCalledTimes(1);
});

test("pool failures use the allowlisted structured event", async () => {
  const h = harness();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  await createWorkerManagementCenterComposition(environment, {
    logger,
    factories: h.factories as never,
  });
  const persistenceOptions = (
    h.factories.createPersistence.mock.calls[0] as unknown as [
      unknown,
      { onInfrastructureFailure(notice: { code: string }): void },
    ]
  )[1];
  persistenceOptions.onInfrastructureFailure({ code: "TEMPORARY_UNAVAILABLE" });
  expect(logger.error).toHaveBeenCalledWith("persistence.pool_failure", {
    errorCode: "TEMPORARY_UNAVAILABLE",
    outcome: "failure",
  });
});

test("a construction failure closes the pool it opened and reveals no cause", async () => {
  const h = harness();
  h.factories.createRuntime.mockImplementationOnce(() => {
    throw new Error("PRIVATE_RUNTIME_FAILURE");
  });
  await expect(
    createWorkerManagementCenterComposition(environment, {
      factories: h.factories as never,
    }),
  ).rejects.toMatchObject({ code: "CONSTRUCTION_FAILED" });
  expect(h.persistence.close).toHaveBeenCalledTimes(1);
});

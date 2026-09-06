import { expect, test, vi } from "vitest";

const environment = {
  FAN_SUPPORT_DATABASE_URL: "postgresql://database.example.invalid/fan_support",
  FAN_SUPPORT_DEPLOYMENT_ENV: "development",
  FAN_SUPPORT_OBJECT_STORAGE_AUTH_MODE: "static",
  FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT: "https://objects.example.invalid",
  FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT:
    "https://objects.example.invalid",
  FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET: "fixture-source",
  FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET: "fixture-derivative",
  FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN:
    "https://media.example.invalid",
  FAN_SUPPORT_OBJECT_STORAGE_MAX_UPLOAD_BYTES: "33554432",
  FAN_SUPPORT_OBJECT_STORAGE_REGION: "us-east-1",
  FAN_SUPPORT_OBJECT_STORAGE_ACCESS_KEY_ID: "LOCAL_TEST_ACCESS",
  FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY: "LOCAL_TEST_SECRET",
  FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
};

async function loadFactory() {
  const module = await import("./media-processing-composition.js").catch(
    () => undefined,
  );
  expect(
    module?.createWorkerMediaProcessingComposition,
    "media composition must exist",
  ).toBeTypeOf("function");
  return module?.createWorkerMediaProcessingComposition as
    | undefined
    | ((
        environment: Readonly<Record<string, string | undefined>>,
        options: unknown,
      ) => Promise<{ start(): Promise<void>; stop(): Promise<void> }>);
}

function harness() {
  const claim = vi.fn(async () => ({ schemaVersion: 1, outcome: "EMPTY" }));
  const transactions = {
    runInMediaProcessingTransaction: vi.fn(
      async (work: (repositories: unknown) => Promise<unknown>) =>
        work({ mediaProcessing: { claim } }),
    ),
  };
  const persistence = {
    mediaProcessingTransactionManager: transactions,
    close: vi.fn(async () => undefined),
  };
  const storage = {};
  const processor = { process: vi.fn() };
  const runtime = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    runOnce: vi.fn(),
  };
  const factories = {
    createPersistence: vi.fn(() => persistence),
    createStorage: vi.fn(() => storage),
    createProcessor: vi.fn(() => processor),
    createRuntime: vi.fn((options: unknown) => {
      expect(options).toBeDefined();
      return runtime;
    }),
    createLeaseToken: () => "f0000000-0000-4000-8000-000000000001",
    now: () => new Date("2026-09-05T00:00:00.000Z"),
  };
  return {
    claim,
    transactions,
    persistence,
    storage,
    processor,
    runtime,
    factories,
  };
}

test("wires configured storage, image processing and the actual media transaction manager", async () => {
  const factory = await loadFactory();
  if (!factory) return;
  const h = harness();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const composition = await factory(environment, {
    factories: h.factories,
    logger,
  });
  expect(h.factories.createStorage).toHaveBeenCalledWith(
    expect.objectContaining({
      sourceBucket: "fixture-source",
      derivativeBucket: "fixture-derivative",
      maxUploadBytes: 33554432,
    }),
  );
  expect(h.factories.createProcessor).toHaveBeenCalledWith({
    storage: h.storage,
    now: h.factories.now,
  });
  expect(h.factories.createPersistence).toHaveBeenCalledWith(
    {
      connectionString: environment.FAN_SUPPORT_DATABASE_URL,
      application_name: "fan-support-media-worker",
    },
    expect.objectContaining({ onInfrastructureFailure: expect.any(Function) }),
  );
  const options = h.factories.createRuntime.mock.calls[0]?.[0] as unknown as {
    useCases: { processNext(): Promise<unknown> };
    onResult: (value: unknown) => void;
  };
  expect(await options.useCases.processNext()).toEqual({
    schemaVersion: 1,
    outcome: "EMPTY",
  });
  expect(h.claim).toHaveBeenCalledWith({
    schemaVersion: 1,
    leaseToken: h.factories.createLeaseToken(),
    leaseSeconds: 300,
  });
  options.onResult({ schemaVersion: 1, outcome: "UNAVAILABLE" });
  expect(logger.warn).toHaveBeenCalledWith("media_processing.run", {
    outcome: "UNAVAILABLE",
  });
  await composition.start();
  await composition.stop();
  await composition.stop();
  expect(h.runtime.start).toHaveBeenCalledOnce();
  expect(h.runtime.stop).toHaveBeenCalledOnce();
  expect(h.persistence.close).toHaveBeenCalledOnce();
  expect(h.runtime.stop.mock.invocationCallOrder[0]).toBeLessThan(
    h.persistence.close.mock.invocationCallOrder[0] ?? Infinity,
  );
});

test("closes allocated persistence if runtime construction fails", async () => {
  const factory = await loadFactory();
  if (!factory) return;
  const h = harness();
  h.factories.createRuntime.mockImplementationOnce(() => {
    throw new Error("PRIVATE_CONSTRUCTOR_FAILURE");
  });
  const error = await factory(environment, { factories: h.factories }).catch(
    (failure) => failure,
  );
  expect(error).toMatchObject({ code: "CONSTRUCTION_FAILED" });
  expect(String(error)).not.toContain("PRIVATE_");
  expect(h.persistence.close).toHaveBeenCalledOnce();
});

test("shutdown is safe before start and closes persistence even if runtime stop fails", async () => {
  const factory = await loadFactory();
  if (!factory) return;
  const h = harness();
  h.runtime.stop.mockRejectedValueOnce(new Error("PRIVATE_STOP_FAILURE"));
  const composition = await factory(environment, { factories: h.factories });
  const error = await composition.stop().catch((failure) => failure);
  expect(error).toMatchObject({ code: "STOP_FAILED" });
  expect(String(error)).not.toContain("PRIVATE_");
  expect(h.persistence.close).toHaveBeenCalledOnce();
  expect(h.runtime.start).not.toHaveBeenCalled();
});

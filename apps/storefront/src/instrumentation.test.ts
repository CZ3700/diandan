import { afterEach, expect, test, vi } from "vitest";

type InstrumentationModule = Readonly<{
  onRequestError: (
    error: unknown,
    request: unknown,
    context: unknown,
  ) => void | Promise<void>;
  register: () => void | Promise<void>;
}>;

async function loadInstrumentationModule(): Promise<InstrumentationModule> {
  let loaded: unknown;
  try {
    loaded = await import("./instrumentation.js");
  } catch {
    loaded = undefined;
  }

  expect(loaded, "storefront instrumentation module must exist").toBeDefined();
  return loaded as InstrumentationModule;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock("@fan-support/observability");
  vi.doUnmock("@fan-support/observability/node");
});

test("starts Node telemetry only in the Node.js runtime", async () => {
  const telemetry = { shutdown: vi.fn() };
  const startNodeTelemetry = vi.fn(() => telemetry);
  const createStructuredLogger = vi.fn(() => ({ error: vi.fn() }));
  const installSafeConsoleErrorBoundary = vi.fn();
  const installTelemetrySignalExitBoundary = vi.fn();
  vi.doMock("@fan-support/observability/node", () => ({
    installTelemetrySignalExitBoundary,
    startNodeTelemetry,
  }));
  vi.doMock("@fan-support/observability", () => ({
    createStructuredLogger,
    installSafeConsoleErrorBoundary,
  }));
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  const { register } = await loadInstrumentationModule();

  await register();

  expect(startNodeTelemetry).toHaveBeenCalledOnce();
  expect(startNodeTelemetry).toHaveBeenCalledWith({ service: "storefront" });
  expect(createStructuredLogger).toHaveBeenCalledOnce();
  expect(createStructuredLogger).toHaveBeenCalledWith({
    service: "storefront",
  });
  expect(installSafeConsoleErrorBoundary).toHaveBeenCalledOnce();
  expect(installSafeConsoleErrorBoundary).toHaveBeenCalledWith(
    createStructuredLogger.mock.results[0]?.value,
  );
  expect(installTelemetrySignalExitBoundary).toHaveBeenCalledOnce();
  expect(installTelemetrySignalExitBoundary).toHaveBeenCalledWith({
    logger: createStructuredLogger.mock.results[0]?.value,
    telemetry,
  });
});

test("does not load Node observability outside the Node.js runtime", async () => {
  const startNodeTelemetry = vi.fn();
  const createStructuredLogger = vi.fn(() => ({ error: vi.fn() }));
  const installSafeConsoleErrorBoundary = vi.fn();
  const installTelemetrySignalExitBoundary = vi.fn();
  vi.doMock("@fan-support/observability/node", () => ({
    installTelemetrySignalExitBoundary,
    startNodeTelemetry,
  }));
  vi.doMock("@fan-support/observability", () => ({
    createStructuredLogger,
    installSafeConsoleErrorBoundary,
  }));
  vi.stubEnv("NEXT_RUNTIME", "edge");
  const { onRequestError, register } = await loadInstrumentationModule();

  await register();
  await onRequestError(undefined, undefined, undefined);

  expect(startNodeTelemetry).not.toHaveBeenCalled();
  expect(createStructuredLogger).not.toHaveBeenCalled();
  expect(installSafeConsoleErrorBoundary).not.toHaveBeenCalled();
  expect(installTelemetrySignalExitBoundary).not.toHaveBeenCalled();
});

test("logs a fixed safe event without reading the original request error", async () => {
  const error = vi.fn();
  const startNodeTelemetry = vi.fn();
  const createStructuredLogger = vi.fn(() => ({ error }));
  const installSafeConsoleErrorBoundary = vi.fn();
  const installTelemetrySignalExitBoundary = vi.fn();
  vi.doMock("@fan-support/observability/node", () => ({
    installTelemetrySignalExitBoundary,
    startNodeTelemetry,
  }));
  vi.doMock("@fan-support/observability", () => ({
    createStructuredLogger,
    installSafeConsoleErrorBoundary,
  }));
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  const { onRequestError, register } = await loadInstrumentationModule();
  await register();

  const canary = "PRIVATE_STOREFRONT_ERROR_64319";
  let trapCalls = 0;
  const hostile = new Proxy(
    {},
    {
      get() {
        trapCalls += 1;
        throw new Error(canary);
      },
      getOwnPropertyDescriptor() {
        trapCalls += 1;
        throw new Error(canary);
      },
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error(canary);
      },
      ownKeys() {
        trapCalls += 1;
        throw new Error(canary);
      },
    },
  );

  await onRequestError(hostile, hostile, hostile);

  expect(trapCalls).toBe(0);
  expect(error).toHaveBeenCalledOnce();
  expect(error).toHaveBeenCalledWith("next.request.failed", {
    errorCode: "INTERNAL_ERROR",
    outcome: "failure",
  });
  expect(JSON.stringify(error.mock.calls)).not.toContain(canary);
});

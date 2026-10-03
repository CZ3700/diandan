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

  expect(loaded, "admin instrumentation module must exist").toBeDefined();
  return loaded as InstrumentationModule;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock("@fan-support/observability");
  vi.doUnmock("@fan-support/observability/node");
});

test("starts Node telemetry only in the Node.js runtime", async () => {
  vi.stubEnv("FAN_SUPPORT_ADMIN_MODE", undefined);
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
  expect(startNodeTelemetry).toHaveBeenCalledWith({ service: "admin" });
  expect(createStructuredLogger).toHaveBeenCalledOnce();
  expect(createStructuredLogger).toHaveBeenCalledWith({ service: "admin" });
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
  vi.stubEnv("FAN_SUPPORT_ADMIN_MODE", "invalid-mode");
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

  const canary = "PRIVATE_ADMIN_ERROR_64319";
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

test.each(["staging", "production"])(
  "invalid %s OIDC configuration fails before the server starts telemetry or handles requests",
  async (tier) => {
    const startNodeTelemetry = vi.fn();
    vi.doMock("@fan-support/observability/node", () => ({
      startNodeTelemetry,
      installTelemetrySignalExitBoundary: vi.fn(),
    }));
    vi.doMock("@fan-support/observability", () => ({
      createStructuredLogger: vi.fn(() => ({ error: vi.fn() })),
      installSafeConsoleErrorBoundary: vi.fn(),
    }));
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FAN_SUPPORT_DEPLOYMENT_ENV", tier);
    vi.stubEnv("FAN_SUPPORT_ADMIN_MODE", "OIDC");
    vi.stubEnv("FAN_SUPPORT_SITE_ORIGIN", "https://admin.example.invalid");
    vi.stubEnv(
      "FAN_SUPPORT_INTERNAL_API_ORIGIN",
      "https://api.example.invalid",
    );
    vi.stubEnv("FAN_SUPPORT_ADMIN_ACCESS_KEY", "PRIVATE_CONFIG_CANARY");
    vi.stubEnv("FAN_SUPPORT_ADMIN_OIDC_ISSUER", undefined);
    const { register } = await loadInstrumentationModule();
    await expect(register()).rejects.toMatchObject({
      code: "CONFIG_INVALID",
      message: expect.not.stringContaining("PRIVATE_CONFIG_CANARY"),
    });
    expect(startNodeTelemetry).not.toHaveBeenCalled();
  },
);

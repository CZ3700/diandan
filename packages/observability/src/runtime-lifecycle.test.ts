import { expect, test, vi } from "vitest";

import { createStructuredLogger } from "./logging.js";

type RuntimeLifecycleModule = Readonly<{
  createRuntimeFatalHandler: (
    options: Readonly<{
      logger: ReturnType<typeof createStructuredLogger>;
      markProcessFailed: () => void;
      requestShutdown: () => Promise<void>;
      scheduleForcedExit: () => void;
    }>,
  ) => (...ignored: readonly unknown[]) => void;
  createRuntimeShutdownCoordinator: (onFailure: () => void) => Readonly<{
    attachRuntime: (
      runtime: Readonly<{ shutdown: () => Promise<void> }>,
    ) => Promise<void>;
    requestShutdown: () => Promise<void>;
  }>;
  createRuntimeShutdownHandler: (
    options: Readonly<{
      requestShutdown: () => Promise<void>;
      scheduleForcedExit: () => void;
    }>,
  ) => () => void;
  launchObservedRuntime: (
    options: Readonly<{
      createApplication: () => Promise<
        Readonly<{
          close: () => Promise<unknown>;
          listen: (port: number, host: string) => Promise<unknown>;
        }>
      >;
      host: string;
      logger: ReturnType<typeof createStructuredLogger>;
      port: number | (() => number);
      startTelemetry: () => Readonly<{
        shutdown: () => Promise<void>;
      }>;
    }>,
  ) => Promise<Readonly<{ shutdown: () => Promise<void> }>>;
}>;

async function loadRuntimeLifecycleModule(): Promise<RuntimeLifecycleModule> {
  let loaded: unknown;
  try {
    loaded = await import("./runtime-lifecycle.js");
  } catch {
    loaded = undefined;
  }

  expect(loaded, "runtime lifecycle module must exist").toBeDefined();
  return loaded as RuntimeLifecycleModule;
}

test("starts telemetry before the application and shuts down in reverse order once", async () => {
  const { launchObservedRuntime } = await loadRuntimeLifecycleModule();
  const events: string[] = [];
  const lines: string[] = [];
  const logger = createStructuredLogger({
    service: "api",
    write: (line) => lines.push(line),
  });
  const application = {
    marker: "application",
    async listen(port: number, host: string) {
      expect(this).toBe(application);
      events.push(`application.listen:${host}:${port}`);
    },
    async close() {
      expect(this).toBe(application);
      events.push("application.close");
    },
  };
  const runtime = await launchObservedRuntime({
    host: "0.0.0.0",
    port: 3002,
    logger,
    startTelemetry: () => {
      events.push("telemetry.start");
      return {
        shutdown: async () => {
          events.push("telemetry.shutdown");
        },
      };
    },
    createApplication: async () => {
      events.push("application.create");
      return application;
    },
  });

  expect(events).toEqual([
    "telemetry.start",
    "application.create",
    "application.listen:0.0.0.0:3002",
  ]);
  expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
    event: "runtime.started",
    level: "info",
  });

  await Promise.all([runtime.shutdown(), runtime.shutdown()]);

  expect(events).toEqual([
    "telemetry.start",
    "application.create",
    "application.listen:0.0.0.0:3002",
    "application.close",
    "telemetry.shutdown",
  ]);
  expect(lines.map((line) => JSON.parse(line) as { event: string })).toEqual([
    expect.objectContaining({ event: "runtime.started" }),
    expect.objectContaining({ event: "runtime.stopped" }),
  ]);
});

test("honors a shutdown signal received before runtime startup completes", async () => {
  const { createRuntimeShutdownCoordinator } =
    await loadRuntimeLifecycleModule();
  const shutdown = vi.fn(async () => {});
  const onFailure = vi.fn();
  const coordinator = createRuntimeShutdownCoordinator(onFailure);

  await coordinator.requestShutdown();
  await coordinator.attachRuntime({ shutdown });
  await coordinator.requestShutdown();

  expect(shutdown).toHaveBeenCalledOnce();
  expect(onFailure).not.toHaveBeenCalled();
});

test("starts a forced-exit deadline before requesting graceful shutdown once", async () => {
  const { createRuntimeShutdownHandler } = await loadRuntimeLifecycleModule();
  const events: string[] = [];
  const requestShutdown = vi.fn(async () => {
    events.push("shutdown.requested");
  });
  const scheduleForcedExit = vi.fn(() => {
    events.push("forced-exit.scheduled");
  });
  const handleShutdown = createRuntimeShutdownHandler({
    requestShutdown,
    scheduleForcedExit,
  });

  handleShutdown();
  handleShutdown();
  await Promise.resolve();

  expect(events).toEqual(["forced-exit.scheduled", "shutdown.requested"]);
  expect(scheduleForcedExit).toHaveBeenCalledOnce();
  expect(requestShutdown).toHaveBeenCalledOnce();
});

test("handles a fatal process error once without inspecting or reflecting it", async () => {
  const { createRuntimeFatalHandler } = await loadRuntimeLifecycleModule();
  const canary = "PRIVATE_FATAL_CANARY_68142";
  let trapCalls = 0;
  const hostileReason = new Proxy(new Error(canary), {
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
  });
  const lines: string[] = [];
  const logger = createStructuredLogger({
    service: "worker",
    write: (line) => lines.push(line),
  });
  const markProcessFailed = vi.fn();
  const requestShutdown = vi.fn(async () => {});
  const scheduleForcedExit = vi.fn();
  const handleFatalError = createRuntimeFatalHandler({
    logger,
    markProcessFailed,
    requestShutdown,
    scheduleForcedExit,
  });

  handleFatalError(hostileReason, "unhandledRejection");
  handleFatalError(new Error(canary), "uncaughtException");
  await Promise.resolve();

  expect(trapCalls).toBe(0);
  expect(markProcessFailed).toHaveBeenCalledOnce();
  expect(scheduleForcedExit).toHaveBeenCalledOnce();
  expect(requestShutdown).toHaveBeenCalledOnce();
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain(canary);
  expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
    event: "runtime.fatal_error",
    level: "error",
    errorCode: "FATAL_RUNTIME_ERROR",
    outcome: "failure",
  });
});

test("cleans up telemetry and emits only a fixed failure when startup throws", async () => {
  const { launchObservedRuntime } = await loadRuntimeLifecycleModule();
  const canary = "PRIVATE_STARTUP_FAILURE_64012";
  const events: string[] = [];
  const lines: string[] = [];
  const logger = createStructuredLogger({
    service: "worker",
    write: (line) => lines.push(line),
  });

  await expect(
    launchObservedRuntime({
      host: "0.0.0.0",
      port: 3003,
      logger,
      startTelemetry: () => {
        events.push("telemetry.start");
        return {
          shutdown: async () => {
            events.push("telemetry.shutdown");
          },
        };
      },
      createApplication: async () => {
        events.push("application.create");
        throw new Error(canary, { cause: canary });
      },
    }),
  ).rejects.toThrow("Runtime failed to start");

  expect(events).toEqual([
    "telemetry.start",
    "application.create",
    "telemetry.shutdown",
  ]);
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain(canary);
  expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
    event: "runtime.start_failed",
    level: "error",
    errorCode: "STARTUP_FAILED",
  });
});

test("starts telemetry before validating deferred runtime configuration", async () => {
  const { launchObservedRuntime } = await loadRuntimeLifecycleModule();
  const canary = "PRIVATE_PORT_FAILURE_90714";
  const events: string[] = [];
  const lines: string[] = [];
  const logger = createStructuredLogger({
    service: "api",
    write: (line) => lines.push(line),
  });

  await expect(
    launchObservedRuntime({
      host: "0.0.0.0",
      port: () => {
        events.push("port.read");
        throw new Error(canary);
      },
      logger,
      startTelemetry: () => {
        events.push("telemetry.start");
        return {
          shutdown: async () => {
            events.push("telemetry.shutdown");
          },
        };
      },
      createApplication: async () => {
        events.push("application.create");
        throw new Error("must not be reached");
      },
    }),
  ).rejects.toThrow("Runtime failed to start");

  expect(events).toEqual([
    "telemetry.start",
    "port.read",
    "telemetry.shutdown",
  ]);
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain(canary);
  expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
    event: "runtime.start_failed",
    errorCode: "STARTUP_FAILED",
  });
});

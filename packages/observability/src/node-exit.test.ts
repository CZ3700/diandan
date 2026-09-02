import { EventEmitter } from "node:events";

import { expect, test, vi } from "vitest";

import { createStructuredLogger } from "./logging.js";
import { installTelemetrySignalExitBoundary } from "./node.js";

type ExitCode = number | string | null | undefined;

function createProcessTarget() {
  const emitter = new EventEmitter();
  const exitCalls: ExitCode[] = [];
  const target = Object.assign(emitter, {
    exitCode: undefined as ExitCode,
    exit: ((code?: ExitCode) => {
      exitCalls.push(code);
      return undefined as never;
    }) as NodeJS.Process["exit"],
  });

  return { exitCalls, target };
}

test.each([
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const)(
  "lets Next clean up before telemetry and preserves the %s exit code",
  async (signal, expectedCode) => {
    const events: string[] = [];
    const lines: string[] = [];
    const { exitCalls, target } = createProcessTarget();
    const logger = createStructuredLogger({
      service: "storefront",
      write: (line) => lines.push(line),
    });
    let releaseShutdown: (() => void) | undefined;
    const shutdown = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseShutdown = () => {
            events.push("telemetry.shutdown");
            resolve();
          };
        }),
    );
    target.once(signal, () => {
      events.push("next.cleanup");
      target.exit(expectedCode);
    });

    installTelemetrySignalExitBoundary({
      logger,
      processTarget: target,
      telemetry: { shutdown },
      timeoutMs: 1_000,
    });

    target.emit(signal);
    await Promise.resolve();

    expect(shutdown).toHaveBeenCalledOnce();
    expect(target.exitCode).toBe(expectedCode);
    expect(exitCalls).toEqual([]);
    expect(events).toEqual(["next.cleanup"]);

    releaseShutdown?.();
    await vi.waitFor(() => expect(exitCalls).toEqual([expectedCode]));

    expect(events).toEqual(["next.cleanup", "telemetry.shutdown"]);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        event: "runtime.stopped",
        level: "info",
        outcome: "success",
      }),
    ]);
  },
);

test("fails closed without reflecting a telemetry shutdown rejection", async () => {
  const canary = "PRIVATE_TELEMETRY_SHUTDOWN_84721";
  const lines: string[] = [];
  const { exitCalls, target } = createProcessTarget();
  const logger = createStructuredLogger({
    service: "admin",
    write: (line) => lines.push(line),
  });
  target.once("SIGTERM", () => target.exit(143));

  installTelemetrySignalExitBoundary({
    logger,
    processTarget: target,
    telemetry: {
      shutdown: async () => {
        throw new Error(canary);
      },
    },
    timeoutMs: 1_000,
  });

  target.emit("SIGTERM");
  await vi.waitFor(() => expect(exitCalls).toEqual([143]));

  expect(JSON.stringify(lines)).not.toContain(canary);
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining({
      event: "runtime.stop_failed",
      level: "error",
      errorCode: "SHUTDOWN_FAILED",
      outcome: "failure",
    }),
  ]);
});

test("forces the signal exit when Next cleanup exceeds its deadline", async () => {
  vi.useFakeTimers();
  try {
    const lines: string[] = [];
    const { exitCalls, target } = createProcessTarget();
    const logger = createStructuredLogger({
      service: "storefront",
      write: (line) => lines.push(line),
    });
    const shutdown = vi.fn(async () => {});
    target.once("SIGTERM", () => {
      // Simulate framework cleanup that never reaches process.exit().
    });

    installTelemetrySignalExitBoundary({
      logger,
      processTarget: target,
      telemetry: { shutdown },
      timeoutMs: 25,
    });

    target.emit("SIGTERM");
    await vi.advanceTimersByTimeAsync(25);

    expect(shutdown).not.toHaveBeenCalled();
    expect(exitCalls).toEqual([143]);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        event: "runtime.stop_failed",
        level: "error",
        errorCode: "SHUTDOWN_FAILED",
        outcome: "failure",
      }),
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test("handles repeated signals and process exits only once", async () => {
  const { exitCalls, target } = createProcessTarget();
  const shutdown = vi.fn(async () => {});
  target.on("SIGTERM", () => {
    target.exit(143);
    target.exit(143);
  });

  installTelemetrySignalExitBoundary({
    logger: createStructuredLogger({ service: "admin", write: () => {} }),
    processTarget: target,
    telemetry: { shutdown },
  });

  target.emit("SIGTERM");
  target.emit("SIGTERM");
  await vi.waitFor(() => expect(exitCalls).toEqual([143]));

  expect(shutdown).toHaveBeenCalledOnce();
});

test("restores the original signal listeners and process exit", () => {
  const { exitCalls, target } = createProcessTarget();
  const originalExit = target.exit;
  const boundary = installTelemetrySignalExitBoundary({
    logger: createStructuredLogger({ service: "admin", write: () => {} }),
    processTarget: target,
    telemetry: { shutdown: async () => {} },
  });

  boundary.restore();
  expect(target.exit).toBe(originalExit);
  expect(target.listenerCount("SIGINT")).toBe(0);
  expect(target.listenerCount("SIGTERM")).toBe(0);

  target.exit(0);
  expect(exitCalls).toEqual([0]);
});

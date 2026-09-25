import type { MediaProcessingUseCases } from "@fan-support/application";
import {
  mediaProcessingRunResultSchema,
  type MediaProcessingRunResult,
} from "@fan-support/contracts";

export type MediaProcessingWorkerRuntime = Readonly<{
  start(): Promise<void>;
  stop(): Promise<void>;
  runOnce(): Promise<void>;
}>;

export type MediaProcessingWorkerRuntimeOptions = Readonly<{
  schemaVersion: 1;
  useCases: MediaProcessingUseCases;
  pollIntervalMs: number;
  schedule?: (
    tick: () => void,
    delayMs: number,
  ) => Readonly<{ cancel(): void }>;
  onResult?: (result: MediaProcessingRunResult) => void;
}>;

function scheduleOnce(tick: () => void, delayMs: number) {
  const timer = setTimeout(tick, delayMs);
  timer.unref();
  return { cancel: () => clearTimeout(timer) };
}

/** One local claim at a time; PostgreSQL coordinates parallel processes. */
export function createMediaProcessingWorkerRuntime(
  options: MediaProcessingWorkerRuntimeOptions,
): MediaProcessingWorkerRuntime {
  if (
    options.schemaVersion !== 1 ||
    !Number.isInteger(options.pollIntervalMs) ||
    options.pollIntervalMs < 10 ||
    options.pollIntervalMs > 60_000
  ) {
    throw new Error("Invalid media worker configuration");
  }
  const schedule = options.schedule ?? scheduleOnce;
  let running = false;
  let startPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  let inFlight: Promise<void> | undefined;
  let scheduled: Readonly<{ cancel(): void }> | undefined;

  async function processOne(): Promise<void> {
    let outcome: MediaProcessingRunResult;
    try {
      outcome = mediaProcessingRunResultSchema.parse(
        await options.useCases.processNext(),
      );
    } catch {
      outcome = { schemaVersion: 1, outcome: "UNAVAILABLE" };
    }
    try {
      options.onResult?.(outcome);
    } catch {
      /* An observer must not interrupt durable processing. */
    }
  }

  function runOnce(): Promise<void> {
    if (inFlight !== undefined) return inFlight;
    if (!running) return Promise.resolve();
    scheduled?.cancel();
    scheduled = undefined;
    inFlight = processOne().finally(() => {
      inFlight = undefined;
      if (running)
        scheduled = schedule(() => {
          void runOnce();
        }, options.pollIntervalMs);
    });
    return inFlight;
  }

  return Object.freeze({
    start() {
      if (startPromise !== undefined) return startPromise;
      if (stopPromise !== undefined) return Promise.resolve();
      running = true;
      startPromise = Promise.resolve();
      void runOnce();
      return startPromise;
    },
    runOnce,
    stop() {
      stopPromise ??= (async () => {
        running = false;
        scheduled?.cancel();
        scheduled = undefined;
        // Drain the claimed work before composition closes its database pool.
        await inFlight;
      })();
      return stopPromise;
    },
  });
}

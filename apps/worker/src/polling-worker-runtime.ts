export type PollingWorkerRuntime = Readonly<{
  start(): Promise<void>;
  stop(): Promise<void>;
  runOnce(): Promise<void>;
}>;

export type PollingWorkerRuntimeOptions<Result> = Readonly<{
  pollIntervalMs: number;
  /** Claims at most one unit of durable work; a rejection is reported as the fallback result. */
  processNext(): Promise<Result>;
  fallback: Result;
  schedule?: (
    tick: () => void,
    delayMs: number,
  ) => Readonly<{ cancel(): void }>;
  onResult?: (result: Result) => void;
}>;

function scheduleOnce(tick: () => void, delayMs: number) {
  const timer = setTimeout(tick, delayMs);
  timer.unref();
  return { cancel: () => clearTimeout(timer) };
}

/** One local claim at a time; PostgreSQL leases coordinate parallel processes. */
export function createPollingWorkerRuntime<Result>(
  options: PollingWorkerRuntimeOptions<Result>,
): PollingWorkerRuntime {
  if (
    !Number.isInteger(options.pollIntervalMs) ||
    options.pollIntervalMs < 10 ||
    options.pollIntervalMs > 60_000
  )
    throw new Error("Invalid polling worker interval");
  const schedule = options.schedule ?? scheduleOnce;
  let running = false;
  let startPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  let inFlight: Promise<void> | undefined;
  let scheduled: Readonly<{ cancel(): void }> | undefined;

  async function processOne(): Promise<void> {
    let outcome: Result;
    try {
      outcome = await options.processNext();
    } catch {
      outcome = options.fallback;
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
        // Drain the claimed work before the composition closes its database pool.
        await inFlight;
      })();
      return stopPromise;
    },
  });
}

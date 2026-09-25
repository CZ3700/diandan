import type { ApiLifecycleResource } from "./bootstrap.js";

type Scheduled = Readonly<{ cancel(): void }>;
function scheduleOnce(tick: () => void, delayMs: number): Scheduled {
  const timer = setTimeout(tick, delayMs);
  timer.unref();
  return { cancel: () => clearTimeout(timer) };
}
/** TEST composition owns one local poller; PostgreSQL leases coordinate multiple processes. */
export function createManagementCenterRuntime(
  options: Readonly<{
    processNext(): Promise<unknown>;
    close(): Promise<void>;
    pollIntervalMs: number;
    schedule?: (tick: () => void, delayMs: number) => Scheduled;
  }>,
): ApiLifecycleResource {
  if (
    !Number.isInteger(options.pollIntervalMs) ||
    options.pollIntervalMs < 10 ||
    options.pollIntervalMs > 60_000
  )
    throw new TypeError("Invalid management worker poll interval");
  const schedule = options.schedule ?? scheduleOnce;
  let running = false,
    stopped = false;
  let inFlight: Promise<void> | undefined,
    stopping: Promise<void> | undefined,
    scheduled: Scheduled | undefined;
  function tick(): void {
    if (!running || inFlight) return;
    scheduled = undefined;
    inFlight = Promise.resolve()
      .then(() => options.processNext())
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        inFlight = undefined;
        if (running) scheduled = schedule(tick, options.pollIntervalMs);
      });
  }
  return Object.freeze({
    async start() {
      if (running || stopped) return;
      running = true;
      tick();
    },
    stop() {
      stopping ??= (async () => {
        stopped = true;
        running = false;
        scheduled?.cancel();
        scheduled = undefined;
        await inFlight;
        await options.close();
      })();
      return stopping;
    },
  });
}

import type { ApiLifecycleResource } from "./bootstrap.js";
/** Each process polls independently; queue delivery is not a broadcast or the source of truth. */
export function createPaymentConfigurationLifecycle(
  options: Readonly<{
    refresh(): Promise<void>;
    close(): Promise<void>;
    delayMs?: number;
  }>,
): ApiLifecycleResource {
  const delayMs = options.delayMs ?? 10000;
  if (!Number.isInteger(delayMs) || delayMs < 1000 || delayMs > 30000)
    throw new TypeError("Invalid payment configuration refresh schedule");
  let started = false,
    stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined,
    inflight: Promise<void> | undefined,
    stopped: Promise<void> | undefined;
  async function sweep() {
    try {
      await options.refresh();
    } catch {
      /* Retain the last complete directory; PostgreSQL still authorizes new routes. */
    } finally {
      if (!stopping) {
        timer = setTimeout(() => {
          timer = undefined;
          inflight = sweep();
        }, delayMs);
        timer.unref();
      }
    }
  }
  return Object.freeze({
    async start() {
      if (!started && !stopping) {
        started = true;
        inflight = sweep();
        await inflight;
      }
    },
    stop() {
      stopped ??= (async () => {
        stopping = true;
        if (timer) clearTimeout(timer);
        timer = undefined;
        await inflight;
        await options.close();
      })();
      return stopped;
    },
  });
}

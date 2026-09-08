import type { ApiLifecycleResource } from "./bootstrap.js";
import { paymentRuntimeRecoveryRunResponseSchema } from "@fan-support/contracts";
export type PaymentRecoveryLifecycleOptions = {
  recoverNext(): Promise<unknown>;
  close(): Promise<void>;
  delayMs: number;
  batchSize: number;
};
/** One bounded sweep at a time. Database claims remain authority across processes; timers only drive liveness. */
export function createPaymentRecoveryLifecycle(
  options: PaymentRecoveryLifecycleOptions,
): ApiLifecycleResource {
  if (
    !Number.isInteger(options.delayMs) ||
    options.delayMs < 1000 ||
    !Number.isInteger(options.batchSize) ||
    options.batchSize < 1 ||
    options.batchSize > 100
  )
    throw new TypeError("Invalid payment recovery schedule");
  let started = false,
    stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined,
    inflight: Promise<void> | undefined,
    stopped: Promise<void> | undefined;
  function schedule(delay: number) {
    timer = setTimeout(() => {
      timer = undefined;
      inflight = sweep();
    }, delay);
    timer.unref();
  }
  async function sweep() {
    try {
      for (let count = 0; count < options.batchSize && !stopping; count++) {
        const parsed = paymentRuntimeRecoveryRunResponseSchema.safeParse(
          await options.recoverNext(),
        );
        if (
          !parsed.success ||
          parsed.data.outcome !== "SUCCESS" ||
          !parsed.data.processed
        )
          break;
      }
    } catch {
      /* The durable due record remains pending. Never log raw provider exceptions or fabricate success. */
    } finally {
      if (!stopping) schedule(options.delayMs);
    }
  }
  return Object.freeze({
    start: async () => {
      if (!started && !stopping) {
        started = true;
        schedule(0);
      }
    },
    stop: () => {
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

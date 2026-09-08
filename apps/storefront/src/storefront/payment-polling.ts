/** Read-only, non-overlapping polling. Leaving or hiding the page never starts a payment command. */
export function startPaymentPolling(
  read: () => Promise<unknown>,
  delay = 5_000,
) {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let remaining = 12;
  const schedule = () => {
    if (
      stopped ||
      running ||
      remaining === 0 ||
      document.visibilityState !== "visible"
    )
      return;
    clearTimeout(timer);
    timer = setTimeout(
      () => {
        void tick();
      },
      Math.min(60_000, Math.max(500, delay)),
    );
  };
  async function tick() {
    if (stopped || document.visibilityState !== "visible") return;
    running = true;
    remaining--;
    try {
      await read();
    } catch {
      /* The caller owns safe visible failure feedback. */
    } finally {
      running = false;
      schedule();
    }
  }
  const visibility = () => {
    clearTimeout(timer);
    schedule();
  };
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", visibility);
    if (typeof window !== "undefined")
      window.removeEventListener("pagehide", stop);
  };
  document.addEventListener("visibilitychange", visibility);
  if (typeof window !== "undefined") window.addEventListener("pagehide", stop);
  schedule();
  return stop;
}

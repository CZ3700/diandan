import { afterEach, expect, it, vi } from "vitest";
import { shouldPollPayment } from "./payment-polling";

it("keeps querying a returned hosted payment while signed evidence is delayed", () => {
  const attempt = { status: "REQUIRES_ACTION", recovery: "NONE" } as const;
  expect(shouldPollPayment(attempt, false, true)).toBe(true);
  expect(shouldPollPayment(attempt, false, false)).toBe(false);
  expect(shouldPollPayment(attempt, true, true)).toBe(false);
  expect(shouldPollPayment(null, false, true)).toBe(false);
});
it("stops return-page reads after authoritative completion and retains evidence-pending recovery", () => {
  for (const status of ["SUCCEEDED", "FAILED", "CANCELED", "EXPIRED"] as const)
    expect(shouldPollPayment({ status, recovery: "NONE" }, false, true)).toBe(
      false,
    );
  expect(
    shouldPollPayment(
      { status: "SUCCEEDED", recovery: "EVIDENCE_PENDING" },
      false,
      true,
    ),
  ).toBe(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("waits for each read, pauses while hidden and cancels permanently on cleanup", async () => {
  vi.useFakeTimers();
  const events = new EventTarget();
  const doc = Object.assign(events, { visibilityState: "visible" });
  vi.stubGlobal("document", doc);
  let resolve!: () => void;
  const read = vi.fn(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  const loaded = await import("./payment-polling").catch(() => null);
  expect(loaded?.startPaymentPolling).toBeTypeOf("function");
  if (!loaded) return;
  const stop = loaded.startPaymentPolling(read, 500);
  await vi.advanceTimersByTimeAsync(500);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(read).toHaveBeenCalledTimes(1);
  doc.visibilityState = "hidden";
  doc.dispatchEvent(new Event("visibilitychange"));
  resolve();
  await vi.advanceTimersByTimeAsync(5000);
  expect(read).toHaveBeenCalledTimes(1);
  doc.visibilityState = "visible";
  doc.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(500);
  expect(read).toHaveBeenCalledTimes(2);
  stop();
  resolve();
  await vi.advanceTimersByTimeAsync(10000);
  expect(read).toHaveBeenCalledTimes(2);
});
it("removes its timer immediately on pagehide without waiting for a React commit", async () => {
  vi.useFakeTimers();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const browser = new EventTarget();
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", browser);
  const read = vi.fn().mockResolvedValue(undefined);
  const loaded = await import("./payment-polling");
  const stop = loaded.startPaymentPolling(read, 500);
  browser.dispatchEvent(new Event("pagehide"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(read).not.toHaveBeenCalled();
  stop();
});

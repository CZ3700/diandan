import { afterEach, expect, test, vi } from "vitest";
import { createPaymentRecoveryLifecycle } from "./payment-runtime-lifecycle.js";
afterEach(() => vi.useRealTimers());
test("recovery is serial and bounded per tick, then schedules another durable sweep", async () => {
  vi.useFakeTimers();
  const recoverNext = vi.fn(async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    processed: true,
  }));
  const close = vi.fn(async () => {});
  const runtime = createPaymentRecoveryLifecycle({
    recoverNext,
    close,
    delayMs: 1000,
    batchSize: 3,
  });
  await runtime.start();
  await runtime.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(recoverNext).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(999);
  expect(recoverNext).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1);
  expect(recoverNext).toHaveBeenCalledTimes(6);
  await runtime.stop();
  await runtime.stop();
  expect(close).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(recoverNext).toHaveBeenCalledTimes(6);
});
test("stop waits for the single active external call before closing persistence and never starts a second claim", async () => {
  vi.useFakeTimers();
  let release: ((value: unknown) => void) | undefined;
  const recoverNext = vi.fn(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const close = vi.fn(async () => {});
  const runtime = createPaymentRecoveryLifecycle({
    recoverNext,
    close,
    delayMs: 1000,
    batchSize: 3,
  });
  await runtime.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(recoverNext).toHaveBeenCalledTimes(1);
  const stopped = runtime.stop();
  await Promise.resolve();
  expect(close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(3000);
  expect(recoverNext).toHaveBeenCalledTimes(1);
  release!({ schemaVersion: 1, outcome: "SUCCESS", processed: true });
  await stopped;
  expect(close).toHaveBeenCalledTimes(1);
  expect(recoverNext).toHaveBeenCalledTimes(1);
});
test("empty or failed sweeps end their batch but do not discard future scheduled recovery", async () => {
  vi.useFakeTimers();
  const recoverNext = vi
    .fn<() => Promise<unknown>>()
    .mockRejectedValueOnce(new Error("private-provider-details"))
    .mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      processed: false,
    });
  const runtime = createPaymentRecoveryLifecycle({
    recoverNext,
    close: async () => {},
    delayMs: 1000,
    batchSize: 5,
  });
  await runtime.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(recoverNext).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(recoverNext).toHaveBeenCalledTimes(2);
  await runtime.stop();
});

test("health probes have an independent bounded slot when payment recovery is empty or fails", async () => {
  vi.useFakeTimers();
  const recoverNext = vi
    .fn()
    .mockRejectedValueOnce(new Error("private-provider-details"))
    .mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      processed: false,
    });
  const probeNext = vi.fn(async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    processed: true,
  }));
  const runtime = createPaymentRecoveryLifecycle({
    recoverNext,
    probeNext,
    close: async () => {},
    delayMs: 1000,
    batchSize: 3,
  });
  await runtime.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(probeNext).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(probeNext).toHaveBeenCalledTimes(2);
  expect(recoverNext).toHaveBeenCalledTimes(2);
  await runtime.stop();
});

test("stop waits for the current health probe and prevents another sweep", async () => {
  vi.useFakeTimers();
  let release: ((value: unknown) => void) | undefined;
  const probeNext = vi.fn(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const close = vi.fn(async () => {});
  const runtime = createPaymentRecoveryLifecycle({
    recoverNext: async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      processed: false,
    }),
    probeNext,
    close,
    delayMs: 1000,
    batchSize: 3,
  });
  await runtime.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(probeNext).toHaveBeenCalledTimes(1);
  const stopped = runtime.stop();
  await vi.advanceTimersByTimeAsync(3000);
  expect(close).not.toHaveBeenCalled();
  release!({ schemaVersion: 1, outcome: "SUCCESS", processed: true });
  await stopped;
  expect(close).toHaveBeenCalledTimes(1);
  expect(probeNext).toHaveBeenCalledTimes(1);
});

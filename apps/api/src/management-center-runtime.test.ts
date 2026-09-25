import { expect, test, vi } from "vitest";
import { createManagementCenterRuntime } from "./management-center-runtime.js";
test("shutdown drains a claimed operation before closing persistence exactly once", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const work = vi.fn(async () => pending),
    close = vi.fn(async () => undefined),
    cancel = vi.fn();
  const runtime = createManagementCenterRuntime({
    processNext: work,
    close,
    pollIntervalMs: 100,
    schedule: () => ({ cancel }),
  });
  await runtime.start();
  const stop = runtime.stop();
  expect(close).not.toHaveBeenCalled();
  release();
  await stop;
  await runtime.stop();
  expect(close).toHaveBeenCalledTimes(1);
  expect(work).toHaveBeenCalledTimes(1);
});
test("one tick never overlaps another and shutdown cancels the next scheduled tick", async () => {
  let scheduled!: () => void;
  const scheduledPromise = new Promise<void>((resolve) => {
    scheduled = resolve;
  });
  const callbacks: (() => void)[] = [],
    cancel = vi.fn(),
    work = vi.fn(async () => undefined);
  const runtime = createManagementCenterRuntime({
    processNext: work,
    close: async () => undefined,
    pollIntervalMs: 100,
    schedule: (tick) => {
      callbacks.push(tick);
      scheduled();
      return { cancel };
    },
  });
  await runtime.start();
  await scheduledPromise;
  expect(callbacks).toHaveLength(1);
  await runtime.stop();
  callbacks[0]?.();
  await Promise.resolve();
  expect(work).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledTimes(1);
});
test("invalid schedule configuration does not acquire resources", () => {
  expect(() =>
    createManagementCenterRuntime({
      processNext: async () => undefined,
      close: async () => undefined,
      pollIntervalMs: 0,
    }),
  ).toThrow();
});

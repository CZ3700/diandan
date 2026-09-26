import { expect, test, vi } from "vitest";

import { createPollingWorkerRuntime } from "./polling-worker-runtime.js";

test("a rejected claim reports the fallback, keeps polling and never overlaps work", async () => {
  let tick: (() => void) | undefined;
  const processNext = vi
    .fn<() => Promise<string>>()
    .mockRejectedValueOnce(new Error("PRIVATE_FAILURE"))
    .mockResolvedValue("EMPTY");
  const onResult = vi.fn();
  const runtime = createPollingWorkerRuntime({
    pollIntervalMs: 500,
    processNext,
    fallback: "UNAVAILABLE",
    schedule: (callback, delay) => {
      expect(delay).toBe(500);
      tick = callback;
      return { cancel: vi.fn() };
    },
    onResult,
  });
  await runtime.start();
  await vi.waitFor(() => expect(tick).toBeTypeOf("function"));
  expect(onResult).toHaveBeenLastCalledWith("UNAVAILABLE");
  tick?.();
  await runtime.runOnce();
  expect(onResult).toHaveBeenLastCalledWith("EMPTY");
  await runtime.stop();
  await runtime.runOnce();
  expect(processNext).toHaveBeenCalledTimes(2);
});

test("an interval outside the supported cadence is rejected", () => {
  for (const pollIntervalMs of [0, 9, 60_001, 1.5])
    expect(() =>
      createPollingWorkerRuntime({
        pollIntervalMs,
        processNext: async () => "EMPTY",
        fallback: "UNAVAILABLE",
      }),
    ).toThrow("Invalid polling worker interval");
});

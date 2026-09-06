import { expect, test, vi } from "vitest";
import type { MediaProcessingRunResult } from "@fan-support/contracts";

async function loadFactory() {
  const module = await import("./media-processing-runtime.js").catch(
    () => undefined,
  );
  expect(
    module?.createMediaProcessingWorkerRuntime,
    "media worker runtime must exist",
  ).toBeTypeOf("function");
  return module?.createMediaProcessingWorkerRuntime;
}

function harness() {
  let tick: (() => void) | undefined;
  const cancel = vi.fn();
  const processNext = vi.fn(async (): Promise<MediaProcessingRunResult> => ({
    schemaVersion: 1,
    outcome: "EMPTY",
  }));
  const onResult = vi.fn();
  return {
    processNext,
    onResult,
    cancel,
    tick: () => tick,
    options: {
      schemaVersion: 1 as const,
      useCases: { processNext },
      pollIntervalMs: 1000,
      schedule: (callback: () => void, delay: number) => {
        expect(delay).toBe(1000);
        tick = callback;
        return { cancel };
      },
      onResult,
    },
  };
}

test("starts immediately, polls without overlapping work and cancels future ticks on shutdown", async () => {
  const factory = await loadFactory();
  if (!factory) return;
  const h = harness();
  const runtime = factory(h.options);
  await runtime.start();
  await vi.waitFor(() => expect(h.tick()).toBeTypeOf("function"));
  expect(h.processNext).toHaveBeenCalledTimes(1);
  expect(h.tick()).toBeTypeOf("function");
  h.tick()?.();
  await runtime.runOnce();
  expect(h.processNext).toHaveBeenCalledTimes(2);
  await runtime.stop();
  h.tick()?.();
  await runtime.runOnce();
  expect(h.processNext).toHaveBeenCalledTimes(2);
  expect(h.cancel).toHaveBeenCalled();
});

test("shutdown drains an active claim and repeated start/stop calls remain idempotent", async () => {
  const factory = await loadFactory();
  if (!factory) return;
  const h = harness();
  let finish: ((value: MediaProcessingRunResult) => void) | undefined;
  h.processNext.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const runtime = factory(h.options);
  const start = runtime.start();
  expect(runtime.start()).toBe(start);
  await start;
  const active = runtime.runOnce();
  expect(runtime.runOnce()).toBe(active);
  let stopped = false;
  const stop = runtime.stop();
  expect(runtime.stop()).toBe(stop);
  void stop.then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  finish?.({ schemaVersion: 1, outcome: "SUCCEEDED" });
  await stop;
  expect(stopped).toBe(true);
  expect(h.processNext).toHaveBeenCalledTimes(1);
  expect(h.onResult).toHaveBeenCalledWith({
    schemaVersion: 1,
    outcome: "SUCCEEDED",
  });
  expect(h.tick()).toBeUndefined();
});

test("contains processing and observer exceptions, then continues polling", async () => {
  const factory = await loadFactory();
  if (!factory) return;
  const h = harness();
  h.processNext.mockRejectedValueOnce(new Error("PRIVATE_WORKER_FAILURE"));
  h.onResult.mockImplementation(() => {
    throw new Error("PRIVATE_OBSERVER_FAILURE");
  });
  const runtime = factory(h.options);
  await runtime.start();
  await vi.waitFor(() => expect(h.tick()).toBeTypeOf("function"));
  expect(h.onResult).toHaveBeenCalledWith({
    schemaVersion: 1,
    outcome: "UNAVAILABLE",
  });
  h.tick()?.();
  await runtime.runOnce();
  expect(h.processNext).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(h.onResult.mock.calls)).not.toContain("PRIVATE_");
  await runtime.stop();
});

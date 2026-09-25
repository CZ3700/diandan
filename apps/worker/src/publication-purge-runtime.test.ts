import { expect, test, vi } from "vitest";
import { createPublicationPurgeWorkerRuntime } from "./publication-purge-runtime.js";
test("due work drains promptly while an idle queue uses the configured polling interval", async () => {
  const processNext = vi
    .fn()
    .mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "RECORDED",
      jobId: "11111111-1111-4111-8111-111111111111",
      status: "SUBMITTED",
    })
    .mockResolvedValue({ schemaVersion: 1, outcome: "IDLE" });
  const schedule = vi.fn(() => ({ cancel: vi.fn() }));
  const runtime = createPublicationPurgeWorkerRuntime({
    schemaVersion: 1,
    useCases: { processNext },
    pollIntervalMs: 1000,
    schedule,
  });
  await runtime.start();
  await runtime.runOnce();
  expect(schedule).toHaveBeenLastCalledWith(expect.any(Function), 10);
  await runtime.runOnce();
  expect(schedule).toHaveBeenLastCalledWith(expect.any(Function), 1000);
  await runtime.stop();
});
test("single-flight ticks drain before stopping and never restart after stop", async () => {
  let finish: () => void = () => undefined;
  const processNext = vi.fn(
    () =>
      new Promise<{ schemaVersion: 1; outcome: "IDLE" }>((resolve) => {
        finish = () => resolve({ schemaVersion: 1, outcome: "IDLE" });
      }),
  );
  const cancel = vi.fn(),
    schedule = vi.fn(() => ({ cancel }));
  const runtime = createPublicationPurgeWorkerRuntime({
    schemaVersion: 1,
    useCases: { processNext },
    pollIntervalMs: 1000,
    schedule,
  });
  await runtime.start();
  expect(processNext).toHaveBeenCalledOnce();
  const first = runtime.runOnce();
  expect(runtime.runOnce()).toBe(first);
  const stopped = runtime.stop();
  expect(schedule).not.toHaveBeenCalled();
  finish();
  await stopped;
  await first;
  await runtime.start();
  await runtime.runOnce();
  expect(processNext).toHaveBeenCalledOnce();
});
test("provider failures and observer exceptions still schedule another durable claim", async () => {
  const processNext = vi.fn(async () => {
      throw new Error("controlled failure");
    }),
    schedule = vi.fn(() => ({ cancel: vi.fn() }));
  const runtime = createPublicationPurgeWorkerRuntime({
    schemaVersion: 1,
    useCases: { processNext },
    pollIntervalMs: 1000,
    schedule,
    onResult: () => {
      throw new Error("observer");
    },
  });
  await runtime.start();
  await runtime.runOnce();
  expect(schedule).toHaveBeenCalledOnce();
  await runtime.stop();
});

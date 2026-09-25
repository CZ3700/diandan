import { afterEach, expect, it, vi } from "vitest";
import {
  slugSchema,
  type ManagementCenterOperation,
} from "@fan-support/contracts";
import { watchManagementOperation } from "./watch-operation";
const id = "10000000-0000-4000-8000-000000000001";
const initial: ManagementCenterOperation = {
  operationId: id,
  version: 1,
  kind: "SAVE_ARTIST",
  sourceLocale: "en",
  status: "PROCESSING",
  targetId: null,
  updatedAt: "2026-09-08T00:00:00Z",
  result: null,
  failure: null,
};
const published: ManagementCenterOperation = {
  ...initial,
  status: "PUBLISHED",
  version: 2,
  targetId: id,
  result: {
    targetId: id,
    handle: slugSchema.parse("artist"),
    revisionId: id,
    publicationId: id,
    version: 1,
  },
};
afterEach(() => vi.useRealTimers());
it("waits for a committed result and stops polling after publication", async () => {
  vi.useFakeTimers();
  const read = vi.fn(async () => published),
    change = vi.fn(),
    error = vi.fn();
  const stop = watchManagementOperation({ read }, initial, change, error);
  expect(change).toHaveBeenCalledWith(initial);
  await vi.advanceTimersByTimeAsync(2000);
  expect(change).toHaveBeenLastCalledWith(published);
  await vi.advanceTimersByTimeAsync(20000);
  expect(read).toHaveBeenCalledTimes(1);
  expect(error).not.toHaveBeenCalled();
  stop();
});
it("ignores responses after the view is closed", async () => {
  vi.useFakeTimers();
  let finish!: (value: ManagementCenterOperation) => void;
  const read = vi.fn(
      () =>
        new Promise<ManagementCenterOperation>((resolve) => {
          finish = resolve;
        }),
    ),
    change = vi.fn();
  const stop = watchManagementOperation({ read }, initial, change, vi.fn());
  await vi.advanceTimersByTimeAsync(2000);
  expect(read).toHaveBeenCalledTimes(1);
  stop();
  finish(published);
  await Promise.resolve();
  expect(change).toHaveBeenCalledTimes(1);
});
it("reports a network failure once without inventing a failed publication", async () => {
  vi.useFakeTimers();
  const read = vi.fn(async () => {
      throw new Error("NETWORK_ERROR");
    }),
    change = vi.fn(),
    error = vi.fn();
  watchManagementOperation({ read }, initial, change, error);
  await vi.advanceTimersByTimeAsync(20000);
  expect(error).toHaveBeenCalledOnce();
  expect(change).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(1);
});

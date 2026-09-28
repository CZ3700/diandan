import { expect, it } from "vitest";
import {
  canStartManagementWrite,
  isDismissibleOperation,
  readDismissedOperations,
  rememberDismissedOperation,
  visibleManagementOperations,
} from "./workspace-state";

it("keeps history restore disabled after HTTP acknowledgement until publication finishes", () => {
  expect(canStartManagementWrite(false, [{ status: "PROCESSING" }])).toBe(
    false,
  );
  expect(canStartManagementWrite(false, [{ status: "PUBLISHED" }])).toBe(true);
});
it("permits a new action after a terminal failure without bypassing an active sibling", () => {
  expect(canStartManagementWrite(false, [{ status: "FAILED" }])).toBe(true);
  expect(
    canStartManagementWrite(false, [
      { status: "FAILED" },
      { status: "PROCESSING" },
    ]),
  ).toBe(false);
  expect(canStartManagementWrite(true, [])).toBe(false);
});

const operation = (
  operationId: string,
  status: "PROCESSING" | "PUBLISHED" | "FAILED",
  retryable?: boolean,
) => ({
  operationId,
  status,
  failure:
    retryable === undefined
      ? null
      : { code: "STALE_VERSION" as const, retryable },
});
it("shows active and failed operations but lets only a final failure be dismissed", () => {
  const operations = [
    operation("processing", "PROCESSING"),
    operation("published", "PUBLISHED"),
    operation("final", "FAILED", false),
    operation("retryable", "FAILED", true),
  ];
  const ids = (dismissed: string[]) =>
    visibleManagementOperations(operations, new Set(dismissed)).map(
      (item) => item.operationId,
    );
  expect(ids([])).toEqual(["processing", "final", "retryable"]);
  expect(ids(["processing", "final", "retryable"])).toEqual([
    "processing",
    "retryable",
  ]);
  expect(isDismissibleOperation(operations[2]!)).toBe(true);
  expect(isDismissibleOperation(operations[3]!)).toBe(false);
});
it("remembers dismissed failures in this browser and tolerates unusable storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  expect(readDismissedOperations(storage)).toEqual(new Set());
  rememberDismissedOperation(storage, "final");
  expect(readDismissedOperations(storage)).toEqual(new Set(["final"]));
  for (let index = 0; index < 60; index++)
    rememberDismissedOperation(storage, `operation-${index}`);
  const kept = readDismissedOperations(storage);
  expect(kept.size).toBe(50);
  expect(kept.has("operation-59")).toBe(true);
  expect(kept.has("final")).toBe(false);
  for (const [key] of values) values.set(key, "not json");
  expect(readDismissedOperations(storage)).toEqual(new Set());
  const denied = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  expect(readDismissedOperations(denied)).toEqual(new Set());
  expect(() => rememberDismissedOperation(denied, "final")).not.toThrow();
  expect(readDismissedOperations(null)).toEqual(new Set());
});

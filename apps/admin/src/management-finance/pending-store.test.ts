import { expect, test } from "vitest";
const storage = await import("./pending-store").catch(() => undefined);
const actor = "10000000-0000-4000-8000-000000000001",
  order = "10000000-0000-4000-8000-000000000002",
  key = "10000000-0000-4000-8000-000000000003";
const command = {
  action: "CANCEL" as const,
  orderId: order,
  expectedOrderVersion: 1,
  reasonCode: "CUSTOMER_REQUEST",
  confirmed: true as const,
};
function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => {
      values.set(name, value);
    },
    removeItem: (name: string) => {
      values.delete(name);
    },
  };
}
test("pending financial command survives client recreation and remains isolated to real actor and order", () => {
  expect(storage?.createFinancePendingStore).toBeTypeOf("function");
  const backend = memory();
  const original = storage!
    .createFinancePendingStore(backend, actor, order)
    .write({ key, command });
  const restored = storage!.createFinancePendingStore(backend, actor, order);
  expect(restored.read()).toEqual({ key, command });
  expect(JSON.stringify(original)).toBe(JSON.stringify(restored.read()));
  expect(
    storage!.createFinancePendingStore(backend, order, order).read(),
  ).toBeNull();
  expect(
    storage!.createFinancePendingStore(backend, actor, actor).read(),
  ).toBeNull();
  expect(() => restored.write({ key: actor, command })).toThrow();
  restored.clear(key);
  expect(restored.read()).toBeNull();
});
test("unavailable or corrupted browser storage fails closed before a new money command", () => {
  expect(storage?.createFinancePendingStore).toBeTypeOf("function");
  const unavailable = {
    getItem: () => null,
    setItem: () => {
      throw new Error("denied");
    },
    removeItem: () => {},
  };
  expect(() =>
    storage!
      .createFinancePendingStore(unavailable, actor, order)
      .write({ key, command }),
  ).toThrow();
  const corrupt = {
    ...memory(),
    getItem: () =>
      JSON.stringify({
        ...command,
        schemaVersion: 1,
        idempotencyKey: key,
        sessionToken: "private",
      }),
  };
  expect(() =>
    storage!.createFinancePendingStore(corrupt, actor, order).read(),
  ).toThrow();
});

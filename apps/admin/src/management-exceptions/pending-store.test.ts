import { expect, test } from "vitest";
const subject = await import("./pending-store").catch(() => undefined);
const id = "10000000-0000-4000-8000-000000000001";
test("uncertain exception commands survive refresh with exact body and remain actor scoped", () => {
  expect(subject?.createExceptionPendingStore).toBeTypeOf("function");
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const store = subject!.createExceptionPendingStore(storage, id);
  const request = store.write({
    key: id,
    command: {
      action: "REPLAY_WEBHOOK",
      target: { kind: "WEBHOOK", id, consumerKey: null },
      expectedVersion: "a".repeat(64) as never,
      reasonCode: "OPERATOR_REVIEW",
      confirmed: true,
    },
  });
  expect(subject!.createExceptionPendingStore(storage, id).read()).toEqual(
    request,
  );
  expect(
    subject!
      .createExceptionPendingStore(
        storage,
        "10000000-0000-4000-8000-000000000002",
      )
      .read(),
  ).toBeNull();
  expect(() => store.write(request)).toThrow();
  store.clear("different");
  expect(store.read()).toEqual(request);
  store.clear(id);
  expect(store.read()).toBeNull();
  storage.setItem(
    `fan-admin-exceptions:v1:${id}`,
    JSON.stringify({ schemaVersion: 1, action: "CONTEXT" }),
  );
  expect(() => store.read()).toThrow();
});

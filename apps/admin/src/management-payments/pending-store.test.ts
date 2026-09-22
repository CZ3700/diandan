import { expect, test } from "vitest";
const subject = await import("./pending-store").catch(() => undefined);
const id = "10000000-0000-4000-8000-000000000001";
test("configuration mutation recovery survives remount and stays isolated by authenticated actor", () => {
  expect(subject?.createPaymentPendingStore).toBeTypeOf("function");
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
  const store = subject!.createPaymentPendingStore(storage, id);
  const pending = store.write({
    key: id,
    command: {
      action: "SAVE",
      sourceRevisionId: null,
      expectedPublicationId: null,
      configuration: { schemaVersion: 1, channels: [], routes: [] },
    },
  });
  expect(subject!.createPaymentPendingStore(storage, id).read()).toEqual(
    pending,
  );
  expect(
    subject!
      .createPaymentPendingStore(
        storage,
        "10000000-0000-4000-8000-000000000002",
      )
      .read(),
  ).toBeNull();
  expect(() => store.write(pending)).toThrow();
  store.clear("different");
  expect(store.read()).toEqual(pending);
  store.clear(id);
  expect(store.read()).toBeNull();
  storage.setItem(
    `fan-admin-payment-config:v1:${id}`,
    JSON.stringify({ schemaVersion: 1, action: "READ", revisionId: null }),
  );
  expect(() => store.read()).toThrow();
});

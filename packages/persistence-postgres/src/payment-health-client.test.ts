import { afterEach, expect, test, vi } from "vitest";
import {
  createTransactionRunner,
  type TransactionClient,
} from "./transaction-runner.js";

const load = () => import("./payment-health-client.js").catch(() => null);
afterEach(() => vi.useRealTimers());
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function client(
  query: TransactionClient["query"] = async () => ({ command: "COMMIT" }),
) {
  return { query: vi.fn(query), release: vi.fn() } satisfies TransactionClient;
}
test("a timed out acquisition destroys a late client once without running SQL", async () => {
  vi.useFakeTimers();
  const module = await load();
  expect(module?.acquirePaymentHealthClient).toBeTypeOf("function");
  const pending = deferred<TransactionClient>(),
    raw = client();
  const acquiring = module!.acquirePaymentHealthClient(
    () => pending.promise,
    100,
  );
  const rejected = expect(acquiring).rejects.toMatchObject({ code: "08006" });
  await vi.advanceTimersByTimeAsync(100);
  await rejected;
  pending.resolve(raw);
  await Promise.resolve();
  await Promise.resolve();
  expect(raw.release).toHaveBeenCalledExactlyOnceWith(true);
  expect(raw.query).not.toHaveBeenCalled();
});
test("a query which never settles is terminated and a wrapper release is idempotent", async () => {
  vi.useFakeTimers();
  const module = await load();
  expect(module?.acquirePaymentHealthClient).toBeTypeOf("function");
  const raw = client(async () => new Promise<never>(() => {}));
  const bounded = await module!.acquirePaymentHealthClient(
    async () => raw,
    100,
  );
  const rejected = expect(
    bounded.query("SELECT blocked"),
  ).rejects.toMatchObject({ code: "08006" });
  await vi.advanceTimersByTimeAsync(100);
  await rejected;
  bounded.release();
  bounded.release(true);
  expect(raw.release).toHaveBeenCalledExactlyOnceWith(true);
});
test("one deadline includes acquisition time and multiple successive queries", async () => {
  vi.useFakeTimers();
  const module = await load();
  expect(module?.acquirePaymentHealthClient).toBeTypeOf("function");
  const pending = deferred<TransactionClient>(),
    raw = client();
  const acquiring = module!.acquirePaymentHealthClient(
    () => pending.promise,
    100,
  );
  await vi.advanceTimersByTimeAsync(60);
  pending.resolve(raw);
  const bounded = await acquiring;
  await bounded.query("SELECT first");
  await vi.advanceTimersByTimeAsync(40);
  await expect(bounded.query("SELECT second")).rejects.toMatchObject({
    code: "08006",
  });
  expect(raw.query).toHaveBeenCalledTimes(1);
  expect(raw.release).toHaveBeenCalledExactlyOnceWith(true);
});
test("an interrupted COMMIT retains unknown outcome and normal release cancels the deadline", async () => {
  vi.useFakeTimers();
  const module = await load();
  expect(module?.acquirePaymentHealthClient).toBeTypeOf("function");
  const entered = deferred<void>();
  const raw = client(async (sql) => {
    if (sql === "COMMIT") {
      entered.resolve();
      return new Promise<never>(() => {});
    }
    return {};
  });
  const runner = createTransactionRunner({
    acquireClient: () =>
      module!.acquirePaymentHealthClient(async () => raw, 100),
    createRepositories: () => ({}),
  });
  const transaction = runner.run(
    { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
    async () => ({ ok: true }),
  );
  const rejected = expect(transaction).rejects.toMatchObject({
    failure: {
      error: {
        code: "TRANSACTION_OUTCOME_UNKNOWN",
        recovery: "RECONCILE_REQUIRED",
      },
    },
  });
  await entered.promise;
  await vi.advanceTimersByTimeAsync(100);
  await rejected;
  expect(raw.release).toHaveBeenCalledExactlyOnceWith(true);
  const healthy = client();
  const bounded = await module!.acquirePaymentHealthClient(
    async () => healthy,
    100,
  );
  bounded.release();
  await vi.advanceTimersByTimeAsync(100);
  expect(healthy.release).toHaveBeenCalledExactlyOnceWith(undefined);
});
test("PostgreSQL transaction_timeout SQLSTATE terminates the health client", async () => {
  vi.useFakeTimers();
  const module = await load();
  expect(module?.acquirePaymentHealthClient).toBeTypeOf("function");
  const raw = client(async () => {
    throw { code: "25P04" };
  });
  const bounded = await module!.acquirePaymentHealthClient(
    async () => raw,
    100,
  );
  await expect(bounded.query("SELECT bounded")).rejects.toMatchObject({
    code: "08006",
  });
  bounded.release();
  expect(raw.release).toHaveBeenCalledExactlyOnceWith(true);
});

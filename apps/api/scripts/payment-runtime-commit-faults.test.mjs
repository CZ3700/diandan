import assert from "node:assert/strict";
import test from "node:test";

const load = () =>
  import("./payment-runtime-commit-faults.mjs").catch(() => null);
for (const method of ["beginCreate", "settleCreate"]) {
  test(`${method} fault is injected only after a successful real-manager boundary, once`, async () => {
    const module = await load();
    assert.equal(typeof module?.wrapPaymentCommitFault, "function");
    const order = [];
    const repository = {
      async beginCreate() {
        order.push("beginCreate");
        return "begin";
      },
      async settleCreate() {
        order.push("settleCreate");
        return "settle";
      },
      async readAttempt() {
        order.push("read");
        return "read";
      },
    };
    const real = {
      async runInPaymentRuntimeTransaction(work) {
        order.push("BEGIN");
        const value = await work({ paymentRuntime: repository, sentinel: 17 });
        order.push("COMMIT");
        return value;
      },
    };
    const fault = module.wrapPaymentCommitFault(real, method);
    const invoke = () =>
      fault.manager.runInPaymentRuntimeTransaction(async (repos) => {
        assert.equal(repos.sentinel, 17);
        return repos.paymentRuntime[method]();
      });
    await assert.rejects(invoke(), (error) => {
      assert.equal(order.at(-1), "COMMIT");
      return (
        error.name === "PersistenceTransactionFailureError" &&
        error.failure.error.code === "TRANSACTION_OUTCOME_UNKNOWN" &&
        error.failure.error.recovery === "RECONCILE_REQUIRED"
      );
    });
    assert.equal(fault.injections(), 1);
    assert.equal(await invoke(), method === "beginCreate" ? "begin" : "settle");
    assert.equal(fault.injections(), 1);
  });
}
test("read-only and failed transactions do not consume the fault", async () => {
  const module = await load();
  assert.equal(typeof module?.wrapPaymentCommitFault, "function");
  const failure = new Error("actual transaction rejection");
  let fail = false;
  const real = {
    async runInPaymentRuntimeTransaction(work) {
      const value = await work({
        paymentRuntime: {
          beginCreate: async () => "begin",
          readAttempt: async () => "read",
        },
      });
      if (fail) throw failure;
      return value;
    },
  };
  const fault = module.wrapPaymentCommitFault(real, "beginCreate");
  assert.equal(
    await fault.manager.runInPaymentRuntimeTransaction((repos) =>
      repos.paymentRuntime.readAttempt(),
    ),
    "read",
  );
  assert.equal(fault.injections(), 0);
  fail = true;
  await assert.rejects(
    fault.manager.runInPaymentRuntimeTransaction((repos) =>
      repos.paymentRuntime.beginCreate(),
    ),
    (error) => error === failure,
  );
  assert.equal(fault.injections(), 0);
  fail = false;
  await assert.rejects(
    fault.manager.runInPaymentRuntimeTransaction((repos) =>
      repos.paymentRuntime.beginCreate(),
    ),
    { name: "PersistenceTransactionFailureError" },
  );
  assert.equal(fault.injections(), 1);
});

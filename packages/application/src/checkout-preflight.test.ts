import { expect, test, vi } from "vitest";
import { cartRuntimeRequestContextSchema } from "@fan-support/contracts";
import { PersistenceTransactionFailureError } from "@fan-support/persistence-port";
import { fixture, id } from "./cart-runtime.test-fixtures.js";

const modulePath = "./checkout-preflight.js";
const runtime = (await import(modulePath).catch(() => ({}))) as {
  createCheckoutPreflightUseCases?: (dependencies: unknown) => {
    validate(command: unknown, context: unknown): Promise<unknown>;
    create(command: unknown, context: unknown): Promise<unknown>;
    read(command: unknown, context: unknown): Promise<unknown>;
  };
};
function harness() {
  const f = fixture();
  const context = cartRuntimeRequestContextSchema.parse({
    schemaVersion: 1,
    accesses: [
      {
        schemaVersion: 1,
        tokenDigest: "a".repeat(64),
        pepperVersion: "test-v1",
      },
    ],
    requestId: id(40),
    correlationId: id(41),
    idempotencyKey: "checkout-test-0001",
  });
  const repos = {
    cartRuntime: {
      findByCredentialForUpdate: vi.fn(async () => f.cart),
      listItems: vi.fn(async () => []),
    },
    checkoutPreflight: { loadCurrent: vi.fn() },
  };
  const run = vi.fn(async (work: (value: typeof repos) => Promise<unknown>) =>
    work(repos),
  );
  expect(runtime.createCheckoutPreflightUseCases).toBeTypeOf("function");
  const app = runtime.createCheckoutPreflightUseCases!({
    transactions: { runInCheckoutPreflightTransaction: run },
    keyManagement: {},
  });
  const validate = {
    schemaVersion: 1,
    operation: "VALIDATE_CHECKOUT",
    expectedCartVersion: f.cart.version,
    presentationLocale: "en",
  };
  const create = {
    schemaVersion: 1,
    operation: "CREATE_CHECKOUT",
    preflightId: id(90),
    expectedCartVersion: f.cart.version,
    email: "private@example.test",
    policyAcceptances: [
      {
        policyKey: "terms",
        policyRevisionId: id(91),
        policyTranslationRevisionId: id(92),
        accepted: true,
      },
    ],
  };
  return { app, f, repos, run, context, validate, create };
}
test("untrusted amounts, provider inputs and absent credentials never open a transaction", async () => {
  const h = harness();
  expect(
    await h.app.create({ ...h.create, totalAmountMinor: 1 }, h.context),
  ).toMatchObject({ code: "INVALID_COMMAND" });
  expect(
    await h.app.validate({ ...h.validate, provider: "test" }, h.context),
  ).toMatchObject({ code: "INVALID_COMMAND" });
  expect(await h.app.validate(h.validate, {})).toMatchObject({
    code: "INVALID_ACCESS",
  });
  expect(
    await h.app.create(h.create, { ...h.context, idempotencyKey: undefined }),
  ).toMatchObject({ code: "INVALID_COMMAND" });
  expect(h.run).not.toHaveBeenCalled();
});
test.each(["EXPIRED", "LOCKED", "VERSION"])(
  "%s cart cannot create a fresh preflight",
  async (state) => {
    const h = harness();
    if (state === "VERSION") h.f.cart.version++;
    else if (state === "EXPIRED") h.f.cart.expired = true;
    else h.f.cart.status = "LOCKED";
    expect(await h.app.validate(h.validate, h.context)).toMatchObject({
      code:
        state === "VERSION"
          ? "VERSION_CONFLICT"
          : state === "EXPIRED"
            ? "CART_EXPIRED"
            : "CART_LOCKED",
    });
    expect(h.repos.checkoutPreflight.loadCurrent).not.toHaveBeenCalled();
  },
);
test("an ambiguous transaction outcome is returned without automatic resubmission", async () => {
  const h = harness();
  h.run.mockRejectedValue(
    new PersistenceTransactionFailureError({
      schemaVersion: 1,
      operation: "RUN_TRANSACTION",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "TRANSACTION_OUTCOME_UNKNOWN",
        recovery: "RECONCILE_REQUIRED",
      },
    }),
  );
  expect(await h.app.validate(h.validate, h.context)).toMatchObject({
    code: "TRANSACTION_OUTCOME_UNKNOWN",
  });
  expect(h.run).toHaveBeenCalledTimes(1);
});
test("only an explicitly aborted transaction gets bounded automatic retries", async () => {
  const h = harness();
  h.run.mockRejectedValue(
    new PersistenceTransactionFailureError({
      schemaVersion: 1,
      operation: "RUN_TRANSACTION",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "TRANSACTION_ABORTED",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 100,
      },
    }),
  );
  expect(await h.app.validate(h.validate, h.context)).toMatchObject({
    code: "TEMPORARY_UNAVAILABLE",
  });
  expect(h.run).toHaveBeenCalledTimes(3);
});

import { expect, test, vi } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createAdminCatalogUseCases } from "./admin-catalog.js";
import { PersistenceTransactionFailureError } from "@fan-support/persistence-port";
const id = "e95a65da-d2d0-420c-a1ba-f6921c45c741";
const request = {
  schemaVersion: 1,
  requestId: id,
  sessionToken: "A".repeat(43),
  csrfToken: "B".repeat(42) + "A",
  command: {
    schemaVersion: 1,
    action: "CREATE_IDOL",
    handle: "sample-artist",
    expectedBaseVersion: 0,
    idempotencyKey: "create-sample-artist",
    reasonCode: "INITIAL_SETUP",
  },
};
test("authorization failure never reserves idempotency or writes identity", async () => {
  const begin = vi.fn(),
    write = vi.fn();
  const authorization = {
    authorize: vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "FORBIDDEN",
    })),
  };
  const app = createAdminCatalogUseCases({
    tokenPepper: "a".repeat(64),
    transactions: {
      runInAdminCatalogTransaction: async (
        work: (repositories: unknown) => Promise<unknown>,
      ) =>
        work({
          authorization,
          idempotency: { begin },
          adminCatalog: { write },
        }),
    } as never,
  });
  expect(await app.execute(request)).toMatchObject({
    outcome: "FAILURE",
    code: "FORBIDDEN",
  });
  expect(begin).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(authorization.authorize.mock.calls[0]).toMatchObject([
    {
      permission: "content.edit",
      locales: SUPPORTED_LOCALES,
    },
  ]);
});
test("malformed commands fail before a transaction", async () => {
  const runInAdminCatalogTransaction = vi.fn();
  const app = createAdminCatalogUseCases({
    tokenPepper: "a".repeat(64),
    transactions: { runInAdminCatalogTransaction },
  });
  expect(
    await app.execute({
      ...request,
      command: { ...request.command, expectedVersion: 0 },
    }),
  ).toMatchObject({ code: "INVALID_COMMAND" });
  expect(runInAdminCatalogTransaction).not.toHaveBeenCalled();
});
test("a concurrent database uniqueness collision is an explicit handle conflict", async () => {
  const app = createAdminCatalogUseCases({
    tokenPepper: "a".repeat(64),
    transactions: {
      runInAdminCatalogTransaction: async () => {
        throw new PersistenceTransactionFailureError({
          schemaVersion: 1,
          operation: "RUN_TRANSACTION",
          outcome: "FAILURE",
          error: { schemaVersion: 1, code: "ALREADY_EXISTS", recovery: "NONE" },
        });
      },
    },
  });
  expect(await app.execute(request)).toMatchObject({ code: "ALREADY_EXISTS" });
});

import { expect, test } from "vitest";

import * as persistencePostgres from "./index.js";

test("exposes the persistence-postgres workspace boundary", () => {
  expect(persistencePostgres.workspacePackageName).toBe(
    "@fan-support/persistence-postgres",
  );
});

test("does not expose the session-level migration helper", () => {
  expect(
    Object.hasOwn(persistencePostgres, "runMigrationCommandOnSession"),
  ).toBe(false);
});

test("exposes a managed supplier-free persistence factory", () => {
  expect(persistencePostgres.createPostgresPersistence).toBeTypeOf("function");
  expect(
    Object.hasOwn(persistencePostgres, "PersistenceTransactionError"),
  ).toBe(false);
  expect(
    Object.hasOwn(persistencePostgres, "PersistenceTransactionFailureError"),
  ).toBe(false);
  expect(Object.hasOwn(persistencePostgres, "PostgresTransactionError")).toBe(
    false,
  );
});

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
  expect(persistencePostgres.createReliableEventRepositories).toBeTypeOf(
    "function",
  );
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

test("exposes the reliable-event queue composition boundary", () => {
  expect(persistencePostgres.createPgBossReliableEventQueue).toBeTypeOf(
    "function",
  );
  expect(persistencePostgres.PgBossReliableEventQueueError).toBeTypeOf(
    "function",
  );
  expect(persistencePostgres.RELIABLE_EVENT_QUEUE_NAMES).toEqual({
    webhookInbox: "payment-webhook-inbox-v1",
    webhookDeadLetter: "payment-webhook-dead-letter-v1",
    outboxDispatch: "outbox-dispatch-v1",
    outboxDeadLetter: "outbox-dispatch-dead-letter-v1",
  });
});

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

import assert from "node:assert/strict";
import test from "node:test";
import { managementDatabaseDiagnostic } from "./management-center-diagnostics.mjs";

test("local database diagnostics never persist SQL literals or error values", () => {
  const record = managementDatabaseDiagnostic("SELECT 'private input'", {
    code: "23514",
    message: "private input rejected",
    detail: "private input",
    constraint: "private input",
    where: "SQL statement containing private input",
  });
  assert.deepEqual(record, { code: "23514", operation: "SELECT" });
  assert.deepEqual(
    managementDatabaseDiagnostic("secret command", { code: "secret value" }),
    {
      code: "UNKNOWN",
      operation: "QUERY",
    },
  );
});

test("only a PostgreSQL function identifier and source line survive a failing function trace", () => {
  assert.deepEqual(
    managementDatabaseDiagnostic("COMMIT", {
      code: "23514",
      where:
        "SQL statement private input\nPL/pgSQL function assert_example(uuid) line 12 at RAISE\nSQL statement private input",
    }),
    {
      code: "23514",
      operation: "COMMIT",
      functionName: "assert_example",
      functionLine: 12,
    },
  );
});

test("management updates expose only their fixed stage, never parameters or SQL", () => {
  const record = managementDatabaseDiagnostic(
    "UPDATE public.management_operations SET checkpoint=$2,phase=CASE WHEN $3 THEN 'PUBLISH' ELSE 'PREPARE_MEDIA' END WHERE id=$1",
    { code: "23514", message: "private input" },
  );
  assert.deepEqual(record, {
    code: "23514",
    operation: "UPDATE",
    managementStage: "CHECKPOINT",
  });
});

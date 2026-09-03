import { expect, test } from "vitest";

import * as persistencePort from "./index.js";

test("exports atomic persistence command and response schemas", () => {
  const exports = persistencePort as Record<string, unknown>;
  expect(exports["persistencePortCommandSchema"]).toBeDefined();
  expect(exports["persistencePortResponseSchema"]).toBeDefined();
  expect(exports["persistenceTransactionFailureSchema"]).toBeDefined();
  expect(exports["PersistenceTransactionFailureError"]).toBeTypeOf("function");
  expect(exports["parsePersistenceTransactionFailure"]).toBeTypeOf("function");
});

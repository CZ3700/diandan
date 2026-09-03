import { expect, test } from "vitest";

import * as testing from "./index.js";

test("exports framework-neutral adapter conformance runners", () => {
  const exports = testing as Record<string, unknown>;
  expect(exports["runPaymentProviderConformance"]).toBeTypeOf("function");
  expect(exports["runMediaStorageConformance"]).toBeTypeOf("function");
  expect(exports["runIdentityProviderConformance"]).toBeTypeOf("function");
  expect(exports["runNotificationProviderConformance"]).toBeTypeOf("function");
  expect(exports["runCachePurgeConformance"]).toBeTypeOf("function");
  expect(exports["runKeyManagementConformance"]).toBeTypeOf("function");
  expect(exports["runPersistenceConformance"]).toBeTypeOf("function");
});

import { expect, test } from "vitest";

import * as keyManagementPort from "./index.js";

test("exports envelope encryption and blind-index schemas", () => {
  const exports = keyManagementPort as Record<string, unknown>;
  expect(exports["keyManagementPortCommandSchema"]).toBeDefined();
  expect(exports["keyManagementPortResponseSchema"]).toBeDefined();
});

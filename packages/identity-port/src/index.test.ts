import { expect, test } from "vitest";

import * as identityPort from "./index.js";

test("exports provider-neutral OIDC command and response schemas", () => {
  const exports = identityPort as Record<string, unknown>;
  expect(exports["identityPortCommandSchema"]).toBeDefined();
  expect(exports["identityPortResponseSchema"]).toBeDefined();
});

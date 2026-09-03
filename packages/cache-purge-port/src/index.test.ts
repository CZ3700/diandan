import { expect, test } from "vitest";

import * as cachePurgePort from "./index.js";

test("exports canonical cache purge command and response schemas", () => {
  const exports = cachePurgePort as Record<string, unknown>;
  expect(exports["cachePurgePortCommandSchema"]).toBeDefined();
  expect(exports["cachePurgePortResponseSchema"]).toBeDefined();
});

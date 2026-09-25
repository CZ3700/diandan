import { expect, test } from "vitest";

import * as mediaPort from "./index.js";

test("exports the strict media storage command boundary", () => {
  const exports = mediaPort as Record<string, unknown>;
  expect(exports["MediaStoragePort"]).toBeUndefined();
  expect(exports["mediaPortCommandSchema"]).toBeDefined();
  expect(exports["mediaPortResponseSchema"]).toBeDefined();
});

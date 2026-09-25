import { expect, test } from "vitest";

import * as notificationPort from "./index.js";

test("exports provider-neutral notification command and response schemas", () => {
  const exports = notificationPort as Record<string, unknown>;
  expect(exports["notificationPortCommandSchema"]).toBeDefined();
  expect(exports["notificationPortResponseSchema"]).toBeDefined();
});

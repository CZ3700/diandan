import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the payment-routing workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/payment-routing");
});

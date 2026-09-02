import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the orders workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/orders");
});

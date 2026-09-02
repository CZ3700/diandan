import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the pricing workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/pricing");
});

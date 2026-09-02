import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the contracts workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/contracts");
});

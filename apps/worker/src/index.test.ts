import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the worker workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/worker");
});

import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the testing workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/testing");
});

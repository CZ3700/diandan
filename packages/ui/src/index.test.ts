import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the ui workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/ui");
});

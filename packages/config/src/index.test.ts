import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the config workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/config");
});

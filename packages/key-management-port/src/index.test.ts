import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the key-management-port workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/key-management-port");
});

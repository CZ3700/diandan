import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the identity-port workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/identity-port");
});

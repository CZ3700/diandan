import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the persistence-port workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/persistence-port");
});

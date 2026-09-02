import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the persistence-postgres workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/persistence-postgres");
});

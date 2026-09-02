import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the catalog workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/catalog");
});

import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the content workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/content");
});

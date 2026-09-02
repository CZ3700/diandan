import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the design-tokens workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/design-tokens");
});

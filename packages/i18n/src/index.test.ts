import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the i18n workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/i18n");
});

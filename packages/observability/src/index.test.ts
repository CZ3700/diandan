import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the observability workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/observability");
});

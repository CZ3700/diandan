import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the identity-oidc workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/identity-oidc");
});

import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the cart workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/cart");
});

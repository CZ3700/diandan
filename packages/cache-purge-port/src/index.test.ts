import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the cache-purge-port workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/cache-purge-port");
});

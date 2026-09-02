import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the media-port workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/media-port");
});

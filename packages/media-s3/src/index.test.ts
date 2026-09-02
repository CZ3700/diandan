import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the media-s3 workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/media-s3");
});

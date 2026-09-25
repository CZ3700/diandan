import { expect, test } from "vitest";

import * as content from "./index.js";

test("exposes the content workspace boundary", () => {
  expect(content.workspacePackageName).toBe("@fan-support/content");
  for (const validator of [
    "validateGiftPublicationCandidate",
    "validateIdolPublicationCandidate",
    "validateHomepagePublicationCandidate",
    "validatePolicyPublicationCandidate",
  ] as const) {
    expect(
      content[validator],
      `${validator} must be a package export`,
    ).toBeTypeOf("function");
  }
});

import { expect, test } from "vitest";

import { workspacePackageName } from "./index.js";

test("exposes the i18n workspace boundary", () => {
  expect(workspacePackageName).toBe("@fan-support/i18n");
});

test("consumes the canonical locale contract by reference", async () => {
  const [contracts, i18n] = await Promise.all([
    import("@fan-support/contracts").catch(() => undefined),
    import("./index.js"),
  ]);
  expect(contracts, "contracts package must be available").toBeDefined();
  expect(i18n.SUPPORTED_LOCALES).toBe(contracts?.SUPPORTED_LOCALES);
  expect(i18n.LOCALE_NATIVE_NAMES).toBe(contracts?.LOCALE_NATIVE_NAMES);
  expect(i18n.DEFAULT_LOCALE).toBe(contracts?.DEFAULT_LOCALE);
});

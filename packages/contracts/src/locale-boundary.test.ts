import { expect, test } from "vitest";
import * as legacy from "./locale.js";
import * as pureValues from "./locale-values.js";
import {
  DEFAULT_LOCALE,
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  parseSupportedLocale,
} from "./locale.js";
import {
  declarationModule,
  runtimeDependencies,
} from "../test-support/module-boundary.js";

test.each([
  "SUPPORTED_LOCALES",
  "DEFAULT_LOCALE",
  "LOCALE_NATIVE_NAMES",
  "parseSupportedLocale",
])("pure locale export %s does not initialize Zod", (name) => {
  const source = declarationModule("locale.ts", name);
  expect(runtimeDependencies(source)).not.toContain("zod");
});

test("preserves canonical locale values and strict parsing through the old entry", () => {
  expect(Object.isFrozen(SUPPORTED_LOCALES)).toBe(true);
  expect(Object.isFrozen(LOCALE_NATIVE_NAMES)).toBe(true);
  expect(DEFAULT_LOCALE).toBe("en");
  expect(Object.keys(LOCALE_NATIVE_NAMES)).toEqual([...SUPPORTED_LOCALES]);
  for (const locale of SUPPORTED_LOCALES) {
    expect(parseSupportedLocale(locale)).toBe(locale);
    expect(parseSupportedLocale(locale.toUpperCase())).toBe(locale);
  }
  for (const value of [null, undefined, [], {}, "", " en", "en-US", "en_XA"])
    expect(parseSupportedLocale(value)).toBeUndefined();
});

test("keeps the old export surface and a single binding for canonical locale values", () => {
  expect(Object.keys(legacy).sort()).toEqual(
    [
      "DEFAULT_LOCALE",
      "LOCALE_NATIVE_NAMES",
      "SUPPORTED_LOCALES",
      "localeContextSchema",
      "parseSupportedLocale",
      "supportedLocaleSchema",
    ].sort(),
  );
  for (const name of Object.keys(pureValues) as (keyof typeof pureValues)[])
    expect(legacy[name]).toBe(pureValues[name]);
});

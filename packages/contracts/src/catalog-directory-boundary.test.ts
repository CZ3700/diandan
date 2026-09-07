import { expect, test } from "vitest";
import * as legacy from "./catalog-directory.js";
import * as publicDirectory from "./catalog-directory-public.js";
import {
  declarationModule,
  runtimeDependencies,
} from "../test-support/module-boundary.js";

test.each(["idolDirectoryResponseSchema", "giftDirectoryResponseSchema"])(
  "%s does not initialize internal publication/projection proof modules",
  (name) => {
    const source = declarationModule("catalog-directory.ts", name);
    const dependencies = runtimeDependencies(source);
    expect(dependencies).not.toContain("public-projection.ts");
    expect(dependencies).not.toContain("publication.ts");
    expect(dependencies).not.toContain("content-models.ts");
  },
);

test("keeps the old export surface and re-exports the same public schema objects", () => {
  expect(Object.keys(legacy).sort()).toEqual(
    [
      "catalogVersionSchema",
      "catalogDirectoryOfferSchema",
      "catalogDirectoryFailureSchema",
      "idolDirectoryCursorSchema",
      "idolDirectoryReadCommandSchema",
      "giftDirectoryReadCommandSchema",
      "idolDirectoryRecordSchema",
      "giftDirectoryRecordSchema",
      "idolDirectorySnapshotSchema",
      "giftDirectorySnapshotSchema",
      "idolDirectoryResponseSchema",
      "giftDirectoryResponseSchema",
      "idolDirectoryCursorEncodingInputSchema",
      "idolDirectoryCursorDecodingInputSchema",
    ].sort(),
  );
  for (const name of Object.keys(
    publicDirectory,
  ) as (keyof typeof publicDirectory)[])
    expect(legacy[name]).toBe(publicDirectory[name]);
});

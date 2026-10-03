import { expect, test } from "vitest";
const subject = await import("./brand-model").catch(() => undefined);
const id = "10000000-0000-4000-8000-000000000001";
const brand = {
  schemaVersion: 1 as const,
  lightLogoAssetId: id,
  darkLogoAssetId: null,
};
test("brand defaults preserve the configured name and either logo slot can change independently", () => {
  expect(subject?.sameBrand).toBeTypeOf("function");
  const fallback = subject!.editableBrand({
    schemaVersion: 1,
    version: 0,
    draft: null,
    published: null,
  });
  expect(fallback).toEqual({
    schemaVersion: 1,
    lightLogoAssetId: null,
    darkLogoAssetId: null,
  });
  expect(subject!.sameBrand(brand, { ...brand })).toBe(true);
  expect(subject!.sameBrand(brand, { ...brand, lightLogoAssetId: null })).toBe(
    false,
  );
  expect(subject!.sameBrand(brand, { ...brand, darkLogoAssetId: id })).toBe(
    false,
  );
});
test("logo selection rejects unsupported and oversized files before upload", () => {
  expect(subject?.logoSelectionIssue).toBeTypeOf("function");
  expect(
    subject!.logoSelectionIssue({ type: "image/svg+xml", size: 100 }),
  ).toBe("imageFormat");
  expect(subject!.logoSelectionIssue({ type: "image/png", size: 0 })).toBe(
    "imageSize",
  );
  expect(
    subject!.logoSelectionIssue({
      type: "image/png",
      size: Number.MAX_SAFE_INTEGER,
    }),
  ).toBe("imageSize");
  expect(
    subject!.logoSelectionIssue({ type: "image/webp", size: 100 }),
  ).toBeNull();
});

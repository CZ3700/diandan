import { expect, test } from "vitest";

import {
  publicHttpsUrlSchema,
  publicMediaUrlSchema,
  publicMediaViewSchema,
} from "./presentation.js";

test("accepts only browser-safe HTTPS media URLs without userinfo", () => {
  expect(
    publicMediaViewSchema.safeParse({
      url: "https://media.example.invalid/gift.webp",
      alt: "Gift",
    }).success,
  ).toBe(true);
  expect(
    publicMediaViewSchema.safeParse({
      url: "https://user:password@media.example.invalid/private/object.webp",
      alt: "Gift",
    }).success,
  ).toBe(false);
  expect(
    publicMediaViewSchema.safeParse({
      url: "http://media.example.invalid/gift.webp",
      alt: "Gift",
    }).success,
  ).toBe(false);
  expect(
    publicMediaViewSchema.safeParse({
      url: "https://media.example.invalid/gift.webp?width=1200&format=webp",
      alt: "Gift",
    }).success,
  ).toBe(true);
  for (const credentialQuery of [
    "X-Amz-Credential=test",
    "X-Amz-Signature=deadbeef",
    "X-Amz-Security-Token=test",
    "X-Goog-Credential=test",
    "X-Goog-Signature=deadbeef",
    "GoogleAccessId=test&Signature=deadbeef",
    "sv=2025-01-05&sp=r&sr=b&se=2026-09-04T00%3A00%3A00Z&sig=deadbeef",
    "hdnts=exp=1788470400~acl=/*~hmac=deadbeef",
    "hdnea=exp=1788470400~acl=/*~hmac=deadbeef",
    "__token__=deadbeef",
  ]) {
    expect(
      publicMediaViewSchema.safeParse({
        url: `https://media.example.invalid/private/object.webp?${credentialQuery}`,
        alt: "Gift",
      }).success,
    ).toBe(false);
  }
});

test("rejects every public media query parameter outside the explicit allowlist", () => {
  for (const unknownQuery of [
    "cache=public",
    "token=deadbeef",
    "sig=display-variant",
    "width=1200&unexpected=value",
  ]) {
    expect(
      publicMediaUrlSchema.safeParse(
        `https://media.example.invalid/object.webp?${unknownQuery}`,
      ).success,
    ).toBe(false);
  }
});

test("rejects fragments and non-public literal media hosts", () => {
  for (const unsafeUrl of [
    "https://media.example.invalid/object.webp#access-token",
    "https://localhost/object.webp",
    "https://localhost:7445/object.webp",
    "https://localhost./object.webp",
    "https://preview.localhost/object.webp",
    "https://127.0.0.1/object.webp",
    "https://127.1/object.webp",
    "https://10.0.0.1/object.webp",
    "https://172.16.0.1/object.webp",
    "https://172.31.255.255/object.webp",
    "https://192.168.1.1/object.webp",
    "https://169.254.169.254/latest/meta-data",
    "https://100.64.0.1/object.webp",
    "https://198.18.0.1/object.webp",
    "https://224.0.0.1/object.webp",
    "https://[::1]/object.webp",
    "https://[fc00::1]/object.webp",
    "https://[fd12:3456:789a::1]/object.webp",
    "https://[fe80::1]/object.webp",
    "https://[ff02::1]/object.webp",
    "https://[2001:db8::1]/object.webp",
    "https://[::ffff:127.0.0.1]/object.webp",
    "https://[::ffff:10.0.0.1]/object.webp",
  ]) {
    expect(publicMediaUrlSchema.safeParse(unsafeUrl).success, unsafeUrl).toBe(
      false,
    );
  }
});

test("allows only the fixed local preview media origin", () => {
  expect(
    publicMediaUrlSchema.safeParse(
      "https://localhost:7444/derivatives/asset-1/hero.webp",
    ).success,
  ).toBe(true);
  for (const unsafePreviewVariant of [
    "https://localhost:7445/derivatives/asset-1/hero.webp",
    "https://127.0.0.1:7444/derivatives/asset-1/hero.webp",
    "https://10.0.0.1:7444/derivatives/asset-1/hero.webp",
  ]) {
    expect(
      publicMediaUrlSchema.safeParse(unsafePreviewVariant).success,
      unsafePreviewVariant,
    ).toBe(false);
  }
});

test("accepts only unique, bounded media transformation parameters", () => {
  for (const validQuery of [
    "",
    "?width=1",
    "?width=4096",
    "?format=avif",
    "?format=webp",
    "?format=jpeg",
    "?width=1200&format=webp",
    "?format=avif&width=640",
  ]) {
    expect(
      publicMediaUrlSchema.safeParse(
        `https://media.example.invalid/object.webp${validQuery}`,
      ).success,
      validQuery,
    ).toBe(true);
  }

  for (const invalidQuery of [
    "?width=0",
    "?width=4097",
    "?width=-1",
    "?width=1.5",
    "?width=1e3",
    "?width=01",
    "?width=",
    "?width=640&width=1200",
    "?format=png",
    "?format=WEBP",
    "?format=",
    "?format=webp&format=avif",
  ]) {
    expect(
      publicMediaUrlSchema.safeParse(
        `https://media.example.invalid/object.webp${invalidQuery}`,
      ).success,
      invalidQuery,
    ).toBe(false);
  }
});

test("rejects malformed public media URLs without throwing", () => {
  for (const malformedUrl of [
    "not a URL",
    "https://",
    "https://%",
    "https://[::1",
  ]) {
    expect(() => publicMediaUrlSchema.safeParse(malformedUrl)).not.toThrow();
    expect(publicMediaUrlSchema.safeParse(malformedUrl).success).toBe(false);
  }
});

test("keeps public HTTPS URLs separate from public media credential policy", () => {
  const paymentCallback =
    "https://payments.example.invalid/return?signature=provider-signature";
  const azureSas =
    "https://media.example.invalid/object.webp?sv=2025-01-05&sp=r&sr=b&se=2026-09-04T00%3A00%3A00Z&sig=deadbeef";

  expect(publicHttpsUrlSchema.safeParse(paymentCallback).success).toBe(true);
  expect(publicHttpsUrlSchema.safeParse(azureSas).success).toBe(true);
  expect(publicMediaUrlSchema.safeParse(paymentCallback).success).toBe(false);
  expect(publicMediaUrlSchema.safeParse(azureSas).success).toBe(false);

  expect(
    publicMediaUrlSchema.safeParse(
      "https://media.example.invalid/object.webp?sig=display-variant",
    ).success,
  ).toBe(false);
  expect(
    publicHttpsUrlSchema.safeParse(
      "https://user:password@payments.example.invalid/return",
    ).success,
  ).toBe(false);
});

test.each([
  "https://localhost/callback",
  "https://login.localhost/callback",
  "https://127.0.0.1/callback?signature=test#provider-state",
  "https://169.254.169.254/callback",
  "https://10.0.0.1/callback",
  "https://192.168.0.1/callback",
  "https://[::1]/callback",
  "https://[fe80::1]/callback",
  "https://[fc00::1]/callback",
] as const)("rejects a non-public HTTPS URL: %s", (url) => {
  expect(publicHttpsUrlSchema.safeParse(url).success).toBe(false);
});

import { createHash } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";

import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { storefrontCopyReviews } from "./review-manifest.js";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

afterEach(() => {
  vi.doUnmock("./review-manifest.js");
  vi.doUnmock("./en.js");
  vi.doUnmock("./ja.js");
  vi.resetModules();
});

test("all current draft records bind the exact shipped source and translation bytes", async () => {
  const { loadStorefrontCopy } = await import("./messages.js");
  const source = await loadStorefrontCopy("en");
  for (const locale of SUPPORTED_LOCALES) {
    const copy = await loadStorefrontCopy(locale);
    expect(storefrontCopyReviews[locale]).toMatchObject({
      schemaVersion: 1,
      namespace: "storefront",
      locale,
      status: "DRAFT",
      sourceHash: hash(source),
      translationHash: hash(copy),
      reviewer: null,
      approvedCommit: null,
    });
  }
});

test("local drafts remain readable but required approval rejects every shipped locale", async () => {
  const { loadStorefrontCopy } = await import("./messages.js");
  for (const locale of SUPPORTED_LOCALES) {
    await expect(
      loadStorefrontCopy(locale, { requireApproved: false }),
    ).resolves.toHaveProperty("navHome");
    await expect(
      loadStorefrontCopy(locale, { requireApproved: true }),
    ).rejects.toThrow("STOREFRONT_MESSAGES_UNAPPROVED");
  }
});

function approvedReviews() {
  return Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [
      locale,
      {
        ...storefrontCopyReviews[locale],
        status: "APPROVED",
        reviewer: "reviewer-fixture",
        approvedCommit: "a".repeat(40),
      },
    ]),
  );
}

async function withReviews(reviews: ReturnType<typeof approvedReviews>) {
  vi.resetModules();
  vi.doMock("./review-manifest.js", () => ({ storefrontCopyReviews: reviews }));
  return (await import("./messages.js")).loadStorefrontCopy;
}

test("matching approved source and locale records allow the unmodified requested catalog", async () => {
  const load = await withReviews(approvedReviews());
  for (const locale of SUPPORTED_LOCALES) {
    const result = await load(locale, { requireApproved: true });
    expect(hash(result)).toBe(storefrontCopyReviews[locale].translationHash);
  }
});

test.each(["en", "ja"])(
  "changed actual %s bytes invalidate unchanged approval hashes",
  async (locale) => {
    const original =
      locale === "en" ? await import("./en.js") : await import("./ja.js");
    vi.doMock(`./${locale}.js`, () => ({
      default: { ...original.default, navHome: "Changed after review" },
    }));
    const load = await withReviews(approvedReviews());
    await expect(load("ja", { requireApproved: true })).rejects.toThrow(
      "STOREFRONT_MESSAGES_UNAPPROVED",
    );
  },
);

test.each([
  ["en", "status", "DRAFT"],
  ["ja", "status", "DRAFT"],
  ["en", "reviewer", null],
  ["ja", "reviewer", "   "],
  ["en", "approvedCommit", null],
  ["ja", "approvedCommit", "a".repeat(7)],
  ["ja", "approvedCommit", "g".repeat(40)],
  ["ja", "locale", "en"],
  ["ja", "namespace", "admin"],
  ["ja", "schemaVersion", 2],
  ["en", "sourceHash", "b".repeat(64)],
  ["en", "translationHash", "b".repeat(64)],
  ["ja", "sourceHash", "b".repeat(64)],
  ["ja", "translationHash", "b".repeat(64)],
])(
  "required approval rejects stale or incomplete %s %s evidence",
  async (locale, field, value) => {
    const reviews = approvedReviews();
    reviews[String(locale)] = {
      ...reviews[String(locale)],
      [String(field)]: value,
    } as (typeof reviews)[string];
    const load = await withReviews(reviews);
    await expect(load("ja", { requireApproved: true })).rejects.toThrow(
      "STOREFRONT_MESSAGES_UNAPPROVED",
    );
  },
);

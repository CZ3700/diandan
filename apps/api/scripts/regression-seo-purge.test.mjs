import assert from "node:assert/strict";
import { test } from "node:test";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { assertRegressionPurgeRows } from "./regression-seo-purge.mjs";

const publicationId = "00000000-0000-4000-8000-000000000001";
const revisionId = "00000000-0000-4000-8000-000000000002";
function rows() {
  return SUPPORTED_LOCALES.map((locale) => ({
    locale,
    publication_id: publicationId,
    primary_subject_id: publicationId,
    secondary_subject_id: revisionId,
    event_locale: locale,
    event_type: "CONTENT_PUBLICATION_CHANGED",
    paths: [
      `/${locale}`,
      `/${locale}/idols*`,
      `/${locale}/gifts*`,
      `/${locale}/sitemap.xml`,
      `/${locale}/sitemap.xml*`,
      "/sitemap.xml*",
      "/api/v1/storefront-seo/*",
    ].sort(),
  }));
}
const check = (value, message) => assert.ok(value, message);
test("accepts all seven locale-bound invalidations for the exact publication", () => {
  assertRegressionPurgeRows(rows(), { publicationId, revisionId, check });
});
for (const [name, alter] of [
  ["missing locale", (value) => value.pop()],
  ["duplicate locale", (value) => (value[1] = value[0])],
  ["unbounded purge", (value) => value[0].paths.push("/*")],
  ["missing SEO dependency", (value) => value[0].paths.pop()],
  ["cross-locale path", (value) => (value[1].paths[0] = "/en/gifts*")],
  ["wrong outbox locale", (value) => (value[1].event_locale = "en")],
  [
    "wrong revision",
    (value) => (value[0].secondary_subject_id = publicationId),
  ],
]) {
  test(`rejects ${name} without treating partial coverage as complete`, () => {
    const value = rows();
    alter(value);
    assert.throws(() =>
      assertRegressionPurgeRows(value, { publicationId, revisionId, check }),
    );
  });
}

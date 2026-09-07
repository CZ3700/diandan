import { expect, test } from "vitest";
import {
  SUPPORTED_LOCALES,
  publicationPreflightTargetSchema,
} from "@fan-support/contracts";
import { publicationPurgePaths } from "./publication-runtime-write.js";

const id = "a0000000-0000-4000-8000-000000000001";
const targets = [
  { owner: { kind: "HOMEPAGE" }, legacy: (root: string) => [root] },
  {
    owner: { kind: "IDOL", idolId: id },
    legacy: (root: string) => [root, `${root}/idols*`, `${root}/gifts*`],
  },
  {
    owner: { kind: "GIFT", giftId: id },
    legacy: (root: string) => [root, `${root}/idols*`, `${root}/gifts*`],
  },
  {
    owner: { kind: "POLICY", policyKey: "studio-terms" },
    legacy: (root: string) => [`${root}/policies/studio-terms*`],
  },
  {
    owner: { kind: "MEDIA_METADATA", mediaAssetId: id.toUpperCase() },
    legacy: (root: string) => [
      root,
      `${root}/idols*`,
      `${root}/gifts*`,
      `${root}/media/${id}*`,
    ],
  },
];
for (const { owner, legacy } of targets) {
  test.each(SUPPORTED_LOCALES)(
    `${owner.kind} %s keeps existing paths and invalidates current sitemap/SEO variants`,
    (locale) => {
      const root = `/${locale}`;
      const target = publicationPreflightTargetSchema.parse({
        owner,
        revisionId: id,
      });
      const actual = publicationPurgePaths(target, locale);
      expect(actual).toEqual(
        [
          ...legacy(root),
          `${root}/sitemap.xml`,
          `${root}/sitemap.xml*`,
          "/sitemap.xml*",
          "/api/v1/storefront-seo/*",
        ].sort(),
      );
      expect(new Set(actual).size).toBe(actual.length);
    },
  );
}

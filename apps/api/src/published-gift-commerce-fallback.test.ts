import { expect, it } from "vitest";
import { createPublishedGiftCommerceUseCases } from "@fan-support/application";

// Use the real content producer and its established fictional publication fixture.
// This package-private built fixture is not part of the production entry point.
import { storefrontPublishedFixture } from "../../../packages/content/dist/storefront-homepage-fixtures.js";
import { computeContentAuthoringSnapshotHash } from "@fan-support/content";
import {
  sourceHashSchema,
  publishedGiftCommerceContextResponseSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
it("preserves verified incident English fallback through the gift commerce application boundary", async () => {
  for (const locale of SUPPORTED_LOCALES.filter((value) => value !== "en")) {
    const context = storefrontPublishedFixture("GIFT");
    context.locale = locale;
    const snapshot = context.canonical.snapshot;
    const audit = snapshot.translationAudits.find(
      (row) => row.locale === locale,
    )!;
    snapshot.content.translations = snapshot.content.translations.filter(
      (row) => row.locale !== locale,
    ) as typeof snapshot.content.translations;
    snapshot.translationAudits = snapshot.translationAudits.filter(
      (row) => row.locale !== locale,
    );
    snapshot.contentHash = sourceHashSchema.parse(
      computeContentAuthoringSnapshotHash(snapshot),
    );
    if (context.canonical.candidate.objectKind !== "GIFT")
      throw new Error("fixture");
    context.canonical.candidate.translations =
      context.canonical.candidate.translations.filter(
        (row) => row.id !== audit.id,
      );
    context.canonical.approvals = context.canonical.approvals.filter(
      (row) => row.translationRevisionId !== audit.id,
    );
    const loaded = publishedGiftCommerceContextResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      context,
      profileVersion: 1,
      profile: null,
    });
    const useCases = createPublishedGiftCommerceUseCases({
      transactions: {
        runInPublishedGiftCommerceTransaction: async (work) =>
          work({ publishedGiftCommerce: { load: async () => loaded } }),
      },
    });
    const query = {
      schemaVersion: 1,
      locator: {
        kind: "GIFT",
        handle: context.canonical.candidate.base.handle,
      },
      locale,
    };
    expect(await useCases.execute(query)).toMatchObject({
      outcome: "SUCCESS",
      classification: { kind: "LEGACY" },
      content: {
        view: {
          localeContext: {
            schemaVersion: 1,
            requestedLocale: locale,
            resolvedLocale: "en",
            fallbackUsed: true,
          },
        },
      },
    });
    expect(await useCases.execute({ ...query, locale: "en" })).toMatchObject({
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    });
  }
});

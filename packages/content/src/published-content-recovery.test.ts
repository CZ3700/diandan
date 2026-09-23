import { expect, test } from "vitest";
import {
  buildPublicationManifest,
  computePublicationManifestHash,
  serializePublicationManifest,
} from "./publication-manifest.js";
import {
  sourceHashSchema,
  SUPPORTED_LOCALES,
  type LegacyPublishedContentContext,
  type SupportedLocale,
} from "@fan-support/contracts";
import { storefrontPublishedFixture } from "./storefront-homepage-fixtures.js";
import { computeContentAuthoringSnapshotHash } from "./content-authoring.js";
import {
  projectPublishedContent,
  projectPublishedContentLocales,
} from "./published-content.js";
import { projectStorefrontSeoEntity } from "./storefront-seo.js";

/** Models one missing SQL translation+review row, never alters its persisted manifest. */
function missing(
  input: LegacyPublishedContentContext,
  locale: SupportedLocale,
  media = false,
) {
  const snapshot = media
    ? input.canonical.mediaSnapshots[0]!
    : input.canonical.snapshot;
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
  const candidate = input.canonical.candidate;
  if (candidate.objectKind !== "MEDIA_METADATA") {
    if (media && "mediaTranslations" in candidate)
      candidate.mediaTranslations = candidate.mediaTranslations.filter(
        (row) => row.id !== audit.id,
      );
    else if (!media)
      candidate.translations = candidate.translations.filter(
        (row) => row.id !== audit.id,
      ) as typeof candidate.translations;
  }
  input.canonical.approvals = input.canonical.approvals.filter(
    (row) => row.translationRevisionId !== audit.id,
  );
  input.canonical.copies = input.canonical.copies.filter(
    (row) => row.targetTranslationId !== audit.id,
  );
  return input;
}
for (const kind of ["IDOL", "GIFT", "HOMEPAGE", "POLICY"] as const) {
  test(`${kind} missing approved non-English projection returns the complete verified English object`, () => {
    const original = storefrontPublishedFixture(kind);
    const english = projectPublishedContent(original);
    expect(english.outcome).toBe("SUCCESS");
    for (const locale of SUPPORTED_LOCALES.filter((value) => value !== "en")) {
      const input = missing(structuredClone(original), locale);
      input.locale = locale;
      const response = projectPublishedContent(input);
      expect(response.outcome).toBe("SUCCESS");
      if (response.outcome !== "SUCCESS" || english.outcome !== "SUCCESS")
        continue;
      expect(response.publication).toEqual(english.publication);
      expect(response.content.kind).toBe(kind);
      if (
        response.content.kind === "MEDIA_METADATA" ||
        english.content.kind === "MEDIA_METADATA"
      )
        throw new Error("fixture");
      expect(response.content).toEqual({
        ...english.content,
        view: {
          ...english.content.view,
          localeContext: {
            ...english.content.view.localeContext,
            requestedLocale: locale,
            resolvedLocale: "en",
            fallbackUsed: true,
          },
        },
      });
      input.locale = "en";
      const seo = projectStorefrontSeoEntity(input);
      expect(seo.outcome).toBe("SUCCESS");
      if (seo.outcome === "SUCCESS")
        expect(seo.entity.locales.map((row) => row.locale)).toEqual(
          SUPPORTED_LOCALES.filter((value) => value !== locale),
        );
      const all = projectPublishedContentLocales(input);
      expect(all.every((value) => value.outcome === "SUCCESS")).toBe(true);
    }
  });
}
test("missing translated media text falls back the entire object rather than mixing languages", () => {
  const input = missing(storefrontPublishedFixture("IDOL"), "ja", true);
  input.locale = "ja";
  const response = projectPublishedContent(input);
  expect(response.outcome).toBe("SUCCESS");
  if (response.outcome === "SUCCESS" && response.content.kind === "IDOL")
    expect(response.content.view.localeContext).toMatchObject({
      requestedLocale: "ja",
      resolvedLocale: "en",
      fallbackUsed: true,
    });
});
for (const [name, corrupt] of [
  [
    "English unavailable",
    (input: LegacyPublishedContentContext) => missing(input, "en"),
  ],
  [
    "unpaired audit",
    (input: LegacyPublishedContentContext) =>
      input.canonical.snapshot.content.translations.pop(),
  ],
  [
    "present text tampered",
    (input: LegacyPublishedContentContext) => {
      const row = input.canonical.snapshot.content.translations[0]!;
      if ("displayName" in row.fields) row.fields.displayName = "tampered";
    },
  ],
  [
    "manifest tampered",
    (input: LegacyPublishedContentContext) => {
      input.publication.manifestHash = "0".repeat(64) as never;
    },
  ],
  [
    "present candidate translation has a forged parent",
    (input: LegacyPublishedContentContext) => {
      if (input.canonical.candidate.objectKind === "IDOL")
        input.canonical.candidate.translations[0]!.idolRevisionId =
          "aaaaaaaa-0000-4000-8000-000000000099" as never;
    },
  ],
  [
    "unknown candidate media translation",
    (input: LegacyPublishedContentContext) => {
      if (input.canonical.candidate.objectKind === "IDOL") {
        const extra = structuredClone(
          input.canonical.candidate.mediaTranslations[0]!,
        );
        extra.mediaMetadataRevisionId =
          "aaaaaaaa-0000-4000-8000-000000000099" as never;
        input.canonical.candidate.mediaTranslations.push(extra);
      }
    },
  ],
  [
    "wrong head",
    (input: LegacyPublishedContentContext) => {
      input.canonical.headVersion++;
    },
  ],
  [
    "revoked media",
    (input: LegacyPublishedContentContext) => {
      if (input.canonical.candidate.objectKind === "IDOL")
        input.canonical.candidate.mediaAssets[0]!.rightsStatus = "EXPIRED";
    },
  ],
  [
    "missing unrelated approval",
    (input: LegacyPublishedContentContext) => input.canonical.approvals.pop(),
  ],
] as const) {
  test(`recovery still rejects ${name}`, () => {
    const input = missing(storefrontPublishedFixture("IDOL"), "ja");
    input.locale = "ja";
    try {
      corrupt(input);
    } catch {
      /* Contract construction itself can reject a missing source. */
    }
    expect(projectPublishedContent(input)).toMatchObject({
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    });
    input.locale = "en";
    expect(projectStorefrontSeoEntity(input).outcome).toBe("FAILURE");
  });
}

for (const kind of [
  "IDOL",
  "GIFT",
  "HOMEPAGE",
  "POLICY",
  "MEDIA_METADATA",
] as const) {
  test(`${kind} recovers from the actual persisted canonical manifest representation`, () => {
    const input = storefrontPublishedFixture(
      kind,
      kind === "IDOL" || kind === "GIFT",
    );
    input.publication.manifest = JSON.parse(
      serializePublicationManifest(input.publication.manifest),
    ) as typeof input.publication.manifest;
    missing(input, "ja");
    input.locale = "ja";
    const result = projectPublishedContent(input);
    expect(result.outcome).toBe("SUCCESS");
    if (result.outcome === "SUCCESS")
      expect(
        result.content.kind === "MEDIA_METADATA"
          ? result.content.localeContext
          : result.content.view.localeContext,
      ).toMatchObject({
        requestedLocale: "ja",
        resolvedLocale: "en",
        fallbackUsed: true,
      });
  });
}

test("canonical recovery restores only the missing inherited approval edge and retains unrelated copy proof", () => {
  const input = storefrontPublishedFixture("POLICY");
  const context = input.canonical;
  const id = (n: number) =>
    `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
  for (const [index, locale] of (["ja", "th"] as const).entries()) {
    const audit = context.snapshot.translationAudits.find(
      (row) => row.locale === locale,
    )!;
    const source = {
      ...structuredClone(audit),
      id: id(index * 10 + 1),
      reviewId: id(index * 10 + 2),
    };
    const revisionId = id(index * 10 + 3);
    audit.inheritedFrom = {
      revisionId,
      translationId: source.id,
      reviewId: source.reviewId,
    };
    const approval = context.approvals.find(
      (row) => row.translationRevisionId === audit.id,
    )!;
    context.copies.push({
      target: { ...context.target, locale },
      targetTranslationId: audit.id,
      targetReviewId: audit.reviewId,
      authoringReceiptId: id(index * 10 + 4),
      source: {
        target: { ...context.target, revisionId, locale },
        text: {
          kind: "POLICY",
          fields: context.snapshot.content.translations.find(
            (row) => row.locale === locale,
          )!.fields,
        } as never,
        audit: source,
      },
      sourceApproval: {
        ...approval,
        approvalId: source.reviewId,
        translationRevisionId: source.id,
        policyRevisionId: revisionId,
      } as typeof approval,
    });
  }
  context.snapshot.contentHash = sourceHashSchema.parse(
    computeContentAuthoringSnapshotHash(context.snapshot),
  );
  const manifest = buildPublicationManifest(context);
  input.publication.manifest = JSON.parse(
    serializePublicationManifest(manifest),
  ) as typeof manifest;
  input.publication.manifestHash = computePublicationManifestHash(manifest);
  expect(projectPublishedContent(input).outcome).toBe("SUCCESS");
  missing(input, "ja");
  input.locale = "ja";
  expect(projectPublishedContent(input).outcome).toBe("SUCCESS");
  input.canonical.copies = [];
  expect(projectPublishedContent(input).outcome).toBe("FAILURE");
});

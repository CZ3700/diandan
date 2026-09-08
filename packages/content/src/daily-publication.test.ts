import { describe, expect, test } from "vitest";
import {
  SUPPORTED_LOCALES,
  dailyPublicationDocumentSchema,
  type DailyPublicationContext,
} from "@fan-support/contracts";
import { preflightFixtureId as id } from "./publication-preflight-fixtures.js";
import {
  computeDailyPublicationManifestHash,
  buildDailyPublicationManifest,
  computeDailySourceHash,
  projectDailyPublication,
  projectDailyPublicationLocales,
} from "./daily-publication.js";
import { createDailyPublicationFixture as fixture } from "./daily-publication-fixtures.js";

describe("daily publication current proof", () => {
  test("poster homepage preserves all slot targets and real source language with distinct role derivatives", () => {
    const context = fixture();
    const original = context.current.document;
    if (original.kind !== "IDOL") throw new Error("Idol fixture required");
    const desktop = original.media.find((row) => row.role === "HERO_DESKTOP")!;
    const mobile = original.media.find((row) => row.role === "HERO_MOBILE")!;
    const fields = {
      heroTitle: "真实首页标题",
      heroSubtitle: "原有首页简介",
      ctaLabel: "查看艺人",
      seoTitle: "首页",
      seoDescription: "原有首页内容",
      slotLabels: [
        { slotKey: "hero", label: "主视觉" },
        { slotKey: "artist", label: "推荐艺人" },
        { slotKey: "gift", label: "推荐礼物" },
        { slotKey: "terms", label: "服务条款" },
      ],
    };
    const slot = { schemaVersion: 1, homepageRevisionId: original.revisionId };
    context.current.document = dailyPublicationDocumentSchema.parse({
      schemaVersion: 3,
      kind: "HOMEPAGE",
      ownerId: original.revisionId,
      revisionId: original.revisionId,
      revisionNumber: original.revisionNumber,
      createdBy: original.createdBy,
      createdAt: original.createdAt,
      source: {
        ...original.source,
        fields,
        sourceHash: computeDailySourceHash(
          "HOMEPAGE",
          original.source.locale,
          fields,
        ),
      },
      slots: [
        {
          ...slot,
          slotKey: "hero",
          kind: "HERO_IDOL",
          idolId: original.ownerId,
          desktopMediaAssetId: desktop.mediaAssetId,
          desktopMediaMetadataRevisionId: desktop.mediaMetadataRevisionId,
          mobileMediaAssetId: mobile.mediaAssetId,
          mobileMediaMetadataRevisionId: mobile.mediaMetadataRevisionId,
          sortOrder: 0,
        },
        {
          ...slot,
          slotKey: "artist",
          kind: "FEATURED_IDOL",
          idolId: original.ownerId,
          sortOrder: 1,
        },
        {
          ...slot,
          slotKey: "gift",
          kind: "FEATURED_GIFT",
          giftId: id(9900),
          sortOrder: 2,
        },
        {
          ...slot,
          slotKey: "terms",
          kind: "POLICY_LINK",
          policyKey: "terms",
          sortOrder: 3,
        },
      ],
    });
    context.current.media = context.current.media.filter((row) =>
      [
        desktop.mediaMetadataRevisionId,
        mobile.mediaMetadataRevisionId,
      ].includes(row.metadata.revisionId),
    );
    context.current.handle = null;
    context.current.acceptingGifts = false;
    context.manifest = buildDailyPublicationManifest({
      operationId: context.manifest.operationId,
      actorId: context.manifest.actorId,
      document: context.current.document,
      media: context.current.media,
    });
    context.publication.manifestHash = computeDailyPublicationManifestHash(
      context.manifest,
    );
    for (const locale of SUPPORTED_LOCALES) {
      const response = projectDailyPublication({ ...context, locale });
      expect(response).toMatchObject({
        outcome: "SUCCESS",
        content: {
          kind: "HOMEPAGE",
          view: {
            heroTitle: fields.heroTitle,
            localeContext: {
              requestedLocale: locale,
              resolvedLocale: original.source.locale,
            },
            slots: [
              { kind: "HERO_IDOL", idolId: original.ownerId },
              { kind: "FEATURED_IDOL", idolId: original.ownerId },
              { kind: "FEATURED_GIFT", giftId: id(9900) },
              { kind: "POLICY_LINK", policyKey: "terms" },
            ],
          },
        },
      });
    }
    context.current.media[0]!.asset.rightsStatus = "REJECTED";
    expect(projectDailyPublication(context).outcome).toBe("FAILURE");
  });

  test("a later legitimate deduplicated job preserves the frozen proof and every original is still checked", () => {
    const context = fixture();
    const lineage = context.current.media[0]!.lineage;
    const additional = structuredClone(lineage.processing[0]!);
    additional.jobId = id(9970);
    lineage.processing.push(additional);
    expect(projectDailyPublication(context).outcome).toBe("SUCCESS");
    additional.sourceAsset.rightsStatus = "REJECTED";
    expect(projectDailyPublication(context)).toMatchObject({
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    });
    additional.sourceAsset.rightsStatus = "APPROVED";
    lineage.processing.shift();
    expect(projectDailyPublication(context)).toMatchObject({
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    });
  });

  test("one actual original supports role derivatives; seven routes retain real source and media language", () => {
    const context = fixture();
    for (const locale of SUPPORTED_LOCALES) {
      const value = projectDailyPublication({ ...context, locale });
      expect(value).toMatchObject({
        outcome: "SUCCESS",
        content: {
          kind: "IDOL",
          view: {
            localeContext: {
              schemaVersion: 2,
              sourceLocale: "zh-CN",
              requestedLocale: locale,
              resolvedLocale: "zh-CN",
              fallbackUsed: locale !== "zh-CN",
            },
            portrait: {
              schemaVersion: 2,
              localeContext: { resolvedLocale: "zh-CN" },
              alt: "真实图像说明",
            },
          },
        },
      });
      expect(JSON.stringify(value)).not.toMatch(
        /objectKey|editorId|actorId|APPROVED|operationId/u,
      );
    }
    expect(projectDailyPublicationLocales(context)).toHaveLength(
      SUPPORTED_LOCALES.length,
    );
  });
  test.each([
    [
      "head",
      (value: DailyPublicationContext) => {
        value.current.headVersion++;
      },
    ],
    [
      "publication",
      (value: DailyPublicationContext) => {
        value.current.publicationId = id(9990);
      },
    ],
    [
      "archive",
      (value: DailyPublicationContext) => {
        value.current.status = "archived";
      },
    ],
    [
      "revision",
      (value: DailyPublicationContext) => {
        value.current.revisionId = id(9991);
      },
    ],
    [
      "source",
      (value: DailyPublicationContext) => {
        value.current.document.source.sourceHash = "a".repeat(
          64,
        ) as typeof value.current.document.source.sourceHash;
      },
    ],
    [
      "master rights",
      (value: DailyPublicationContext) => {
        value.current.media[0]!.asset.rightsStatus = "REJECTED";
      },
    ],
    [
      "original rights",
      (value: DailyPublicationContext) => {
        value.current.media[0]!.lineage.processing[0]!.sourceAsset.rightsStatus =
          "EXPIRED";
      },
    ],
    [
      "job",
      (value: DailyPublicationContext) => {
        value.current.media[0]!.lineage.processing[0]!.status = "FAILED";
      },
    ],
    [
      "variant",
      (value: DailyPublicationContext) => {
        value.current.media[0]!.variants[0]!.status = "ARCHIVED";
      },
    ],
    [
      "extra metadata",
      (value: DailyPublicationContext) => {
        value.current.media.push(structuredClone(value.current.media[0]!));
      },
    ],
    [
      "url",
      (value: DailyPublicationContext) => {
        value.current.media[0]!.url =
          "https://media.example.test/unbound.webp" as (typeof value.current.media)[0]["url"];
      },
    ],
  ])("rejects changed %s", (_, mutate) => {
    const context = fixture();
    mutate(context);
    expect(projectDailyPublication(context)).toMatchObject({
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    });
    expect(projectDailyPublicationLocales(context)).toBeUndefined();
  });
  test("rehashed tampering cannot make an incorrect source hash or inactive media valid", () => {
    const context = fixture();
    context.manifest.document.source.sourceHash = "b".repeat(
      64,
    ) as typeof context.manifest.document.source.sourceHash;
    context.current.document = structuredClone(context.manifest.document);
    context.publication.manifestHash = computeDailyPublicationManifestHash(
      context.manifest,
    );
    expect(projectDailyPublication(context)).toMatchObject({
      code: "CONTENT_UNAVAILABLE",
    });
  });
});

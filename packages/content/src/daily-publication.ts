import {
  SUPPORTED_LOCALES,
  dailyPublicationContextSchema,
  dailyPublicationCurrentMediaSchema,
  dailyPublicationManifestSchema,
  publicationManifestAssetSchema,
  publicationManifestMediaLineageSchema,
  publicationManifestVariantSchema,
  publishedContentResponseSchema,
  publishedMediaViewSchema,
  type DailyPublicationContext,
  type DailyPublicationDocument,
  type DailyPublicationManifest,
  type DailyPublicationCurrentMedia,
  type PublishedContentResponse,
} from "@fan-support/contracts";
import {
  canonicalPublicationValue,
  hashPublicationValue,
} from "./publication-manifest-canonical.js";
import { validatePreflightMediaLineage } from "./publication-preflight-media.js";
import {
  meetsMediaRoleDerivativeMinimum,
  meetsMediaRoleSourceMinimum,
} from "./media-qualification.js";
import {
  comparePreflightTime,
  sameId,
  withoutFields,
} from "./publication-preflight-shared.js";

const domain = "fan-support.daily-publication.v1";
const equal = (left: unknown, right: unknown) =>
  canonicalPublicationValue(left) === canonicalPublicationValue(right);
export function computeDailySourceHash(
  kind: string,
  locale: string,
  fields: unknown,
) {
  return hashPublicationValue(`${domain}/source`, { kind, locale, fields });
}
export function serializeDailyDocument(
  document: DailyPublicationDocument,
): string {
  return canonicalPublicationValue(document);
}
export function computeDailyDocumentHash(document: DailyPublicationDocument) {
  return hashPublicationValue(`${domain}/document`, document);
}
function frozenMedia(input: DailyPublicationCurrentMedia) {
  return {
    metadata: input.metadata,
    asset: publicationManifestAssetSchema.parse(
      withoutFields(input.asset, [
        "processingStatus",
        "processingErrorCode",
        "rightsStatus",
        "rightsReference",
      ]),
    ),
    variants: input.variants.map((row) =>
      publicationManifestVariantSchema.parse(withoutFields(row, ["status"])),
    ),
    lineage: publicationManifestMediaLineageSchema.parse({
      ...input.lineage,
      processing: input.lineage.processing.map((row) => ({
        ...withoutFields(row, ["status", "sourceAsset"]),
        sourceAsset: publicationManifestAssetSchema.parse(
          withoutFields(row.sourceAsset, [
            "processingStatus",
            "processingErrorCode",
            "rightsStatus",
            "rightsReference",
          ]),
        ),
      })),
    }),
  };
}
/** The transaction supplies canonical rows; the public reader independently verifies them on every request. */
export function buildDailyPublicationManifest(
  input: Readonly<{
    operationId: string;
    actorId: string;
    document: unknown;
    media: readonly unknown[];
  }>,
): DailyPublicationManifest {
  return dailyPublicationManifestSchema.parse({
    schemaVersion: 3,
    publicationMode: "DIRECT_OPERATOR_V1",
    operationId: input.operationId,
    actorId: input.actorId,
    document: input.document,
    media: input.media.map((row) =>
      frozenMedia(dailyPublicationCurrentMediaSchema.parse(row)),
    ),
  });
}
export function serializeDailyPublicationManifest(
  input: DailyPublicationManifest,
): string {
  return canonicalPublicationValue(dailyPublicationManifestSchema.parse(input));
}
export function computeDailyPublicationManifestHash(
  input: DailyPublicationManifest,
) {
  return hashPublicationValue(
    domain,
    dailyPublicationManifestSchema.parse(input),
  );
}
function originalValid(document: DailyPublicationDocument): boolean {
  return (
    document.source.sourceHash ===
      computeDailySourceHash(
        document.kind,
        document.source.locale,
        document.source.fields,
      ) &&
    sameId(document.createdBy, document.source.editorId) &&
    comparePreflightTime(document.source.editedAt, document.createdAt) >= 0
  );
}
function verified(input: unknown): DailyPublicationContext | undefined {
  const parsed = dailyPublicationContextSchema.safeParse(input);
  if (!parsed.success) return undefined;
  const context = parsed.data;
  const { publication, current, manifest } = context;
  if (
    !sameId(publication.publicationId, current.publicationId) ||
    !sameId(publication.revisionId, current.revisionId) ||
    !sameId(publication.revisionId, manifest.document.revisionId) ||
    publication.headVersion !== current.headVersion ||
    !["PUBLISHED", "SUPERSEDED"].includes(current.lifecycle) ||
    !["active", "paused"].includes(current.status) ||
    (current.acceptingGifts && current.status !== "active") ||
    comparePreflightTime(publication.publishedAt, current.evaluatedAt) > 0 ||
    comparePreflightTime(
      publication.publishedAt,
      manifest.document.source.editedAt,
    ) < 0 ||
    !equal(manifest.document, current.document) ||
    !originalValid(current.document) ||
    publication.manifestHash !==
      computeDailyPublicationManifestHash(manifest) ||
    manifest.media.length !== current.media.length
  )
    return undefined;
  const seen = new Set<string>();
  for (const media of current.media) {
    const key = media.metadata.revisionId.toLowerCase();
    if (seen.has(key)) return undefined;
    seen.add(key);
    const frozen = manifest.media.filter((row) =>
      sameId(row.metadata.revisionId, media.metadata.revisionId),
    );
    if (
      frozen.length !== 1 ||
      !originalValid(media.metadata) ||
      !sameId(media.metadata.ownerId, media.asset.id) ||
      !sameId(media.lineage.assetId, media.asset.id) ||
      !["PUBLISHED", "SUPERSEDED"].includes(media.lifecycle) ||
      media.asset.processingStatus !== "READY" ||
      media.asset.rightsStatus !== "APPROVED" ||
      media.lineage.identityKind !== "PROCESSED_MASTER"
    )
      return undefined;
    const currentFrozen = frozenMedia(media);
    const proof = frozen[0]!;
    if (
      !equal(proof.metadata, currentFrozen.metadata) ||
      !equal(proof.asset, currentFrozen.asset) ||
      !sameId(proof.lineage.assetId, currentFrozen.lineage.assetId) ||
      proof.lineage.identityKind !== currentFrozen.lineage.identityKind ||
      proof.lineage.processing.some((frozenJob) => {
        const matching = currentFrozen.lineage.processing.filter((currentJob) =>
          sameId(frozenJob.jobId, currentJob.jobId),
        );
        return matching.length !== 1 || !equal(frozenJob, matching[0]);
      }) ||
      proof.variants.some((row) => {
        const matches = media.variants.filter((entry) =>
          sameId(entry.id, row.id),
        );
        return (
          matches.length !== 1 ||
          matches[0]!.status !== "READY" ||
          !equal(row, withoutFields(matches[0]!, ["status"]))
        );
      })
    )
      return undefined;
    // The existing verifier checks every recorded original, command hash and actual master.
    // The direct profile intentionally permits different role recipes from one real original.
    if (
      validatePreflightMediaLineage({
        candidate: {
          objectKind: "MEDIA_METADATA",
          currentPublication: null,
          currentPublishedRevisionId: null,
          asset: media.asset,
          variants: media.variants,
        },
        mediaLineage: [media.lineage],
      }).length !== 0
    )
      return undefined;
  }
  return context;
}
function localeContext(
  document: DailyPublicationDocument,
  context: DailyPublicationContext,
) {
  return {
    schemaVersion: 2 as const,
    publicationMode: "DIRECT_OPERATOR_V1" as const,
    sourceLocale: document.source.locale,
    requestedLocale: context.locale,
    resolvedLocale: document.source.locale,
    fallbackUsed: context.locale !== document.source.locale,
    translationRevision: document.source.id,
  };
}
function render(context: DailyPublicationContext): PublishedContentResponse {
  const document = context.current.document;
  const used = new Set<string>();
  function resolve(assetId: string, metadataId: string, role: string) {
    const rows = context.current.media.filter(
      (row) =>
        sameId(row.asset.id, assetId) &&
        sameId(row.metadata.revisionId, metadataId),
    );
    if (rows.length !== 1) throw new Error("Daily media binding unavailable");
    const media = rows[0]!;
    const selected = media.variants.filter((row) =>
      sameId(row.id, media.selectedVariantId),
    );
    if (selected.length !== 1) throw new Error("Daily variant unavailable");
    const variant = selected[0]!;
    const frozen = context.manifest.media.find((row) =>
      sameId(row.metadata.revisionId, metadataId),
    )!;
    const processingRole = role === "PRIMARY" ? "GIFT_PRIMARY" : role;
    const ratio =
      role === "PRIMARY"
        ? [1, 1]
        : ["PORTRAIT", "HERO_MOBILE"].includes(role)
          ? [4, 5]
          : role === "HERO_DESKTOP"
            ? [16, 9]
            : null;
    if (
      !frozen.variants.some((row) => sameId(row.id, variant.id)) ||
      !sameId(variant.mediaAssetId, assetId) ||
      !new URL(media.url).pathname.endsWith(`/${variant.objectKey}`) ||
      !meetsMediaRoleSourceMinimum(
        role,
        media.asset.width,
        media.asset.height,
      ) ||
      !meetsMediaRoleDerivativeMinimum(role, variant.width, variant.height) ||
      variant.width > media.asset.width ||
      variant.height > media.asset.height ||
      (ratio &&
        [media.asset, variant].some(
          (row) =>
            BigInt(row.width) * BigInt(ratio[1]!) !==
            BigInt(row.height) * BigInt(ratio[0]!),
        )) ||
      (ratio &&
        !media.lineage.processing.some(
          (row) => row.command.role === processingRole,
        ))
    )
      throw new Error("Daily media role unavailable");
    used.add(metadataId.toLowerCase());
    return publishedMediaViewSchema.parse({
      schemaVersion: 2,
      kind: "INFORMATIVE",
      localeContext: localeContext(media.metadata, context),
      url: media.url,
      alt: media.metadata.source.fields.alt,
      width: variant.width,
      height: variant.height,
      focalPoint: media.metadata.structure.focalPoint,
    });
  }
  const common = {
    schemaVersion: 1,
    localeContext: localeContext(document, context),
  };
  let content: unknown;
  if (document.kind === "IDOL" || document.kind === "GIFT") {
    const role = (name: string) => {
      const refs = document.media.filter((row) => row.role === name);
      if (refs.length !== 1)
        throw new Error("Daily required media unavailable");
      const ref = refs[0]!;
      return resolve(ref.mediaAssetId, ref.mediaMetadataRevisionId, name);
    };
    const gallery = document.media
      .filter((row) => row.role === "GALLERY")
      .toSorted((a, b) => a.sortOrder - b.sortOrder)
      .map((ref) =>
        resolve(ref.mediaAssetId, ref.mediaMetadataRevisionId, "GALLERY"),
      );
    const base = {
      ...common,
      id: document.ownerId,
      handle: context.current.handle,
      status: context.current.status,
      ...document.source.fields,
    };
    if (document.kind === "IDOL")
      content = {
        kind: "IDOL",
        aliases: [],
        view: {
          ...base,
          themeAccent: document.structure.themeAccent,
          heroTextTone: document.structure.heroTextTone,
          acceptingGifts: context.current.acceptingGifts,
          portrait: role("PORTRAIT"),
          heroDesktop: role("HERO_DESKTOP"),
          heroMobile: role("HERO_MOBILE"),
          gallery,
        },
      };
    else {
      const { variantLabels, ...fields } = document.source.fields;
      const { requiresSafetyNotice, ...structure } = document.structure;
      if (requiresSafetyNotice && !fields.safetyNotice)
        throw new Error("Daily safety notice unavailable");
      content = {
        kind: "GIFT",
        view: {
          ...common,
          id: document.ownerId,
          handle: context.current.handle,
          status: context.current.status,
          ...fields,
          ...structure,
          ...(context.wish ? { wish: context.wish } : {}),
          primaryMedia: role("PRIMARY"),
          gallery,
          variants: document.variants.map((frozenVariant) => {
            const matches = context.current.variants.filter((row) =>
              sameId(row.id, frozenVariant.id),
            );
            if (
              matches.length !== 1 ||
              !equal(
                withoutFields(matches[0]!, ["status"]),
                withoutFields(frozenVariant, ["status"]),
              )
            )
              throw new Error("Daily current variant unavailable");
            const variant = matches[0]!;
            const labels = variantLabels.filter((row) =>
              sameId(row.giftVariantId, variant.id),
            );
            if (
              labels.length !== 1 ||
              !sameId(variant.giftId, document.ownerId)
            )
              throw new Error("Daily variant label unavailable");
            return {
              schemaVersion: 1,
              id: variant.id,
              label: labels[0]!.label,
              status: variant.status,
              inventoryPolicy: variant.inventoryPolicy,
            };
          }),
        },
        details: { format: "LEGACY_TEXT", text: fields.description },
      };
    }
  } else if (document.kind === "HOMEPAGE") {
    const heroes = document.slots.filter((row) => row.kind === "HERO_IDOL");
    if (heroes.length !== 1) throw new Error("Daily homepage hero unavailable");
    const hero = heroes[0]!;
    const { slotLabels, ...fields } = document.source.fields;
    const slots = document.slots
      .toSorted((a, b) => a.sortOrder - b.sortOrder)
      .map((slot) => {
        const labels = slotLabels.filter((row) => row.slotKey === slot.slotKey);
        if (
          labels.length !== 1 ||
          !sameId(slot.homepageRevisionId, document.revisionId)
        )
          throw new Error("Daily homepage slot unavailable");
        return {
          schemaVersion: 1,
          kind: slot.kind,
          slotKey: slot.slotKey,
          sortOrder: slot.sortOrder,
          label: labels[0]!.label,
          ...(slot.kind === "HERO_IDOL" || slot.kind === "FEATURED_IDOL"
            ? { idolId: slot.idolId }
            : slot.kind === "FEATURED_GIFT"
              ? { giftId: slot.giftId }
              : { policyKey: slot.policyKey }),
        };
      });
    content = {
      kind: "HOMEPAGE",
      view: {
        ...common,
        ...fields,
        heroDesktop: resolve(
          hero.desktopMediaAssetId,
          hero.desktopMediaMetadataRevisionId,
          "HERO_DESKTOP",
        ),
        heroMobile: resolve(
          hero.mobileMediaAssetId,
          hero.mobileMediaMetadataRevisionId,
          "HERO_MOBILE",
        ),
        slots,
      },
    };
  } else
    content = {
      kind: "MEDIA_METADATA",
      localeContext: common.localeContext,
      view: resolve(document.ownerId, document.revisionId, "GALLERY"),
    };
  if (used.size !== context.current.media.length)
    throw new Error("Daily unbound media");
  return publishedContentResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PUBLISHED_CONTENT",
    publication: {
      id: context.publication.publicationId,
      revisionId: context.publication.revisionId,
      manifestHash: context.publication.manifestHash,
      publishedAt: context.publication.publishedAt,
    },
    content,
  });
}
const failure = (): PublishedContentResponse => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "CONTENT_UNAVAILABLE",
});
export function projectDailyPublication(
  input: unknown,
): PublishedContentResponse {
  try {
    const context = verified(input);
    return context ? render(context) : failure();
  } catch {
    return failure();
  }
}
/** Shares immutable proof verification while each locale still receives the complete media and DTO validation. */
export function projectDailyPublicationLocales(
  input: unknown,
): readonly PublishedContentResponse[] | undefined {
  try {
    const context = verified(input);
    if (!context) return undefined;
    return SUPPORTED_LOCALES.map((locale) => render({ ...context, locale }));
  } catch {
    return undefined;
  }
}

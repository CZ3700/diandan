import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  legacyPublishedContentContextSchema,
  dailyPublicationContextSchema,
  publishedContentResponseSchema,
  type LegacyPublishedContentContext,
  type PublishedContentResponse,
  type PublishedGiftDetails,
} from "@fan-support/contracts";
import {
  projectDailyPublication,
  projectDailyPublicationLocales,
} from "./daily-publication.js";
import { sameBaseContentTarget } from "./base-content.js";
import {
  computePublicationManifestHash,
  verifyPublicationManifest,
} from "./publication-manifest.js";
import {
  comparePreflightTime,
  sameId,
} from "./publication-preflight-shared.js";
import { publishedMediaResolver } from "./published-content-media.js";

function currentPublication(context: LegacyPublishedContentContext): boolean {
  const { publication, canonical } = context;
  const candidate = canonical.candidate;
  const current = candidate.currentPublication;
  if (
    !current ||
    !sameId(current.id, publication.publicationId) ||
    !sameId(current.targetRevisionId, publication.target.revisionId) ||
    current.action !== publication.action ||
    canonical.action !== publication.action ||
    canonical.headVersion !== publication.headVersion
  )
    return false;
  if (
    !sameBaseContentTarget(
      { ...publication.target, locale: "en" },
      { ...canonical.target, locale: "en" },
    )
  )
    return false;
  if (
    canonical.snapshot.lifecycle.status !==
    (publication.action === "PUBLISH" ? "PUBLISHED" : "SUPERSEDED")
  )
    return false;
  const lifecycle = canonical.snapshot.lifecycle;
  if (
    publication.action === "PUBLISH" &&
    (lifecycle.status !== "PUBLISHED" ||
      comparePreflightTime(publication.publishedAt, lifecycle.publishedAt) !==
        0)
  )
    return false;
  if (publication.action === "ROLLBACK") {
    const history = canonical.previousPublication;
    if (
      lifecycle.status !== "SUPERSEDED" ||
      !history ||
      sameId(history.publicationId, publication.publicationId) ||
      !sameBaseContentTarget(
        { ...history.target, locale: "en" },
        { ...publication.target, locale: "en" },
      ) ||
      comparePreflightTime(history.publishedAt, lifecycle.publishedAt) < 0 ||
      comparePreflightTime(history.publishedAt, publication.publishedAt) > 0 ||
      comparePreflightTime(publication.publishedAt, lifecycle.supersededAt) < 0
    )
      return false;
  }
  if (
    comparePreflightTime(publication.publishedAt, canonical.evaluatedAt) > 0 ||
    comparePreflightTime(
      publication.publishedAt,
      canonical.snapshot.createdAt,
    ) < 0
  )
    return false;
  const pointer =
    candidate.objectKind === "IDOL" || candidate.objectKind === "GIFT"
      ? candidate.base.publishedRevisionId
      : candidate.currentPublishedRevisionId;
  if (!pointer || !sameId(pointer, publication.target.revisionId)) return false;
  if (
    (candidate.objectKind === "IDOL" || candidate.objectKind === "GIFT") &&
    !["active", "paused"].includes(candidate.base.status)
  )
    return false;
  if (
    candidate.objectKind === "IDOL" &&
    (!("objectKind" in current) ||
      current.objectKind !== "IDOL" ||
      !sameId(current.idolId, candidate.base.id))
  )
    return false;
  if (
    candidate.objectKind === "GIFT" &&
    (!("objectKind" in current) ||
      current.objectKind !== "GIFT" ||
      !sameId(current.giftId, candidate.base.id))
  )
    return false;
  if (
    candidate.objectKind === "POLICY" &&
    (!("objectKind" in current) ||
      current.objectKind !== "POLICY" ||
      current.policyKey !== candidate.revision.policyKey ||
      comparePreflightTime(
        candidate.revision.effectiveAt,
        canonical.evaluatedAt,
      ) > 0)
  )
    return false;
  if (
    candidate.objectKind === "MEDIA_METADATA" &&
    (!("mediaAssetId" in current) ||
      !sameId(current.mediaAssetId, candidate.asset.id))
  )
    return false;
  return true;
}
function details(
  context: LegacyPublishedContentContext,
  media: ReturnType<typeof publishedMediaResolver>,
  description: string,
): PublishedGiftDetails {
  const document = context.canonical.snapshot.extensions.details;
  if (!document) return { format: "LEGACY_TEXT", text: description };
  const translation = document.translations.find(
    (row) => row.locale === context.locale,
  );
  if (!translation) throw new Error("Public detail translation unavailable");
  return {
    format: "BLOCKS",
    blocks: document.document.blocks.map((block) => {
      const field = translation.blocks.find((row) => row.blockId === block.id);
      if (!field) throw new Error("Public detail block unavailable");
      switch (block.kind) {
        case "HEADING":
          if (field.kind !== "HEADING")
            throw new Error("Public detail kind mismatch");
          return {
            id: block.id,
            kind: block.kind,
            level: block.level,
            text: field.text,
          };
        case "PARAGRAPH":
          if (field.kind !== "PARAGRAPH")
            throw new Error("Public detail kind mismatch");
          return { id: block.id, kind: block.kind, text: field.text };
        case "LIST":
          if (field.kind !== "LIST")
            throw new Error("Public detail kind mismatch");
          return {
            id: block.id,
            kind: block.kind,
            style: block.style,
            items: block.itemIds.map((id) => {
              const item = field.items.find((row) => row.itemId === id);
              if (!item) throw new Error("Public detail item unavailable");
              return { id, text: item.text };
            }),
          };
        case "SPECIFICATIONS":
          if (field.kind !== "SPECIFICATIONS")
            throw new Error("Public detail kind mismatch");
          return {
            id: block.id,
            kind: block.kind,
            items: block.itemIds.map((id) => {
              const item = field.items.find((row) => row.itemId === id);
              if (!item) throw new Error("Public detail item unavailable");
              return { id, label: item.label, value: item.value };
            }),
          };
        case "MEDIA":
          if (field.kind !== "MEDIA")
            throw new Error("Public detail kind mismatch");
          return {
            id: block.id,
            kind: block.kind,
            media: media.resolve(
              block.mediaAssetId,
              block.mediaMetadataRevisionId,
            ),
            ...(field.caption === undefined ? {} : { caption: field.caption }),
          };
      }
    }),
  };
}
function project(
  context: LegacyPublishedContentContext,
  media: ReturnType<typeof publishedMediaResolver>,
): unknown {
  const { canonical, locale } = context;
  const snapshot = canonical.snapshot,
    content = snapshot.content,
    candidate = canonical.candidate;
  const audit = snapshot.translationAudits.find(
    (row) => row.locale === locale,
  )!;
  const localeContext = {
    schemaVersion: 1,
    requestedLocale: locale,
    resolvedLocale: locale,
    fallbackUsed: false,
    translationRevision: audit.id,
  };
  const common = { schemaVersion: 1, localeContext };
  if (content.kind === "IDOL" && candidate.objectKind === "IDOL") {
    const fields = content.translations.find(
      (row) => row.locale === locale,
    )!.fields;
    const role = (name: string) => {
      const refs = content.media.filter((row) => row.role === name);
      if (refs.length !== 1) throw new Error("Public media role missing");
      const ref = refs[0]!;
      return media.resolve(
        ref.mediaAssetId,
        ref.mediaMetadataRevisionId,
        ref.role,
      );
    };
    return {
      kind: "IDOL",
      view: {
        ...common,
        id: candidate.base.id,
        handle: candidate.base.handle,
        status: candidate.base.status,
        acceptingGifts: candidate.base.acceptingGifts,
        ...fields,
        themeAccent: content.structure.themeAccent,
        heroTextTone: content.structure.heroTextTone,
        portrait: role("PORTRAIT"),
        heroDesktop: role("HERO_DESKTOP"),
        heroMobile: role("HERO_MOBILE"),
        gallery: content.media
          .filter((row) => row.role === "GALLERY")
          .toSorted((a, b) => a.sortOrder - b.sortOrder)
          .map((row) =>
            media.resolve(
              row.mediaAssetId,
              row.mediaMetadataRevisionId,
              row.role,
            ),
          ),
      },
      aliases: (snapshot.extensions.aliases?.aliases ?? []).filter(
        (row) => row.locale === null || row.locale === locale,
      ),
    };
  }
  if (content.kind === "GIFT" && candidate.objectKind === "GIFT") {
    const { variantLabels, ...fields } = content.translations.find(
      (row) => row.locale === locale,
    )!.fields;
    const primary = content.media.filter((row) => row.role === "PRIMARY");
    if (primary.length !== 1) throw new Error("Public gift primary missing");
    const labels = new Map(
      variantLabels.map((row) => [row.giftVariantId.toLowerCase(), row.label]),
    );
    const variants = candidate.variants
      .filter((row) => row.status === "active" || row.status === "paused")
      .map((row) => {
        if (
          !sameId(row.giftId, candidate.base.id) ||
          !labels.has(row.id.toLowerCase())
        )
          throw new Error("Public gift variant mismatch");
        return {
          schemaVersion: 1,
          id: row.id,
          label: labels.get(row.id.toLowerCase()),
          status: row.status,
          inventoryPolicy: row.inventoryPolicy,
        };
      });
    return {
      kind: "GIFT",
      view: {
        ...common,
        id: candidate.base.id,
        handle: candidate.base.handle,
        status: candidate.base.status,
        ...fields,
        category: content.structure.category,
        contents: content.structure.contents,
        deliveryEstimate: content.structure.deliveryEstimate,
        shippingMode: content.structure.shippingMode,
        primaryMedia: media.resolve(
          primary[0]!.mediaAssetId,
          primary[0]!.mediaMetadataRevisionId,
          "PRIMARY",
        ),
        gallery: content.media
          .filter((row) => row.role === "GALLERY")
          .toSorted((a, b) => a.sortOrder - b.sortOrder)
          .map((row) =>
            media.resolve(
              row.mediaAssetId,
              row.mediaMetadataRevisionId,
              row.role,
            ),
          ),
        variants,
      },
      details: details(context, media, fields.description),
    };
  }
  if (content.kind === "HOMEPAGE" && candidate.objectKind === "HOMEPAGE") {
    const { slotLabels, ...fields } = content.translations.find(
      (row) => row.locale === locale,
    )!.fields;
    const heroes = content.structure.slots.filter(
      (row) => row.kind === "HERO_IDOL",
    );
    if (heroes.length !== 1) throw new Error("Public homepage hero missing");
    const hero = heroes[0]!,
      labels = new Map(slotLabels.map((row) => [row.slotKey, row.label]));
    if (
      labels.size !== slotLabels.length ||
      content.structure.slots.length !== labels.size
    )
      throw new Error("Public homepage labels mismatch");
    const slots = content.structure.slots
      .toSorted((a, b) => a.sortOrder - b.sortOrder)
      .map((row) => {
        const label = labels.get(row.slotKey);
        if (!label) throw new Error("Public homepage label missing");
        const base = {
          schemaVersion: 1,
          slotKey: row.slotKey,
          kind: row.kind,
          sortOrder: row.sortOrder,
          label,
        };
        return row.kind === "HERO_IDOL" || row.kind === "FEATURED_IDOL"
          ? { ...base, idolId: row.idolId }
          : row.kind === "FEATURED_GIFT"
            ? { ...base, giftId: row.giftId }
            : { ...base, policyKey: row.policyKey };
      });
    return {
      kind: "HOMEPAGE",
      view: {
        ...common,
        ...fields,
        slots,
        heroDesktop: media.resolve(
          hero.desktopMediaAssetId,
          hero.desktopMediaMetadataRevisionId,
          "HERO_DESKTOP",
        ),
        heroMobile: media.resolve(
          hero.mobileMediaAssetId,
          hero.mobileMediaMetadataRevisionId,
          "HERO_MOBILE",
        ),
      },
    };
  }
  if (content.kind === "POLICY" && candidate.objectKind === "POLICY")
    return {
      kind: "POLICY",
      view: {
        ...common,
        policyKey: candidate.revision.policyKey,
        ...content.structure,
        ...content.translations.find((row) => row.locale === locale)!.fields,
      },
    };
  if (
    content.kind === "MEDIA_METADATA" &&
    candidate.objectKind === "MEDIA_METADATA"
  )
    return {
      kind: "MEDIA_METADATA",
      localeContext,
      view: media.resolve(candidate.asset.id, snapshot.revisionId),
    };
  throw new Error("Public content kind mismatch");
}
function verifiedContext(input: unknown): LegacyPublishedContentContext {
  const context = legacyPublishedContentContextSchema.parse(input);
  if (
    !currentPublication(context) ||
    computePublicationManifestHash(context.publication.manifest) !==
      context.publication.manifestHash ||
    !verifyPublicationManifest(context.publication.manifest, context.canonical)
  )
    throw new Error("Public publication proof invalid");
  return context;
}

function unavailable(): PublishedContentResponse {
  return {
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  };
}

/** Private rendering boundary; only the validating public entry points call it. */
function projectVerifiedContext(
  context: LegacyPublishedContentContext,
): PublishedContentResponse {
  try {
    const media = publishedMediaResolver(context);
    const content = project(context, media);
    if (!media.complete()) throw new Error("Public media projection mismatch");
    return publishedContentResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "PUBLISHED_CONTENT",
      publication: {
        id: context.publication.publicationId,
        revisionId: context.publication.target.revisionId,
        manifestHash: context.publication.manifestHash,
        publishedAt: context.publication.publishedAt,
      },
      content,
    });
  } catch {
    return unavailable();
  }
}

export function projectPublishedContent(
  input: unknown,
): PublishedContentResponse {
  try {
    if (dailyPublicationContextSchema.safeParse(input).success)
      return projectDailyPublication(input);
    return projectVerifiedContext(verifiedContext(input));
  } catch {
    return unavailable();
  }
}

/** Proves one source-language context, then retains every locale's full projection gate. */
export function projectPublishedContentLocales(
  input: unknown,
): readonly PublishedContentResponse[] {
  try {
    if (dailyPublicationContextSchema.safeParse(input).success)
      return (
        projectDailyPublicationLocales(input) ??
        SUPPORTED_LOCALES.map(() => unavailable())
      );
    const context = verifiedContext(input);
    if (context.locale !== DEFAULT_LOCALE)
      throw new Error("Publication source locale mismatch");
    return SUPPORTED_LOCALES.map((locale) =>
      projectVerifiedContext({ ...context, locale }),
    );
  } catch {
    return SUPPORTED_LOCALES.map(() => unavailable());
  }
}

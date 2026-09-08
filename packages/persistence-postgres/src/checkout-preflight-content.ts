import {
  checkoutMediaSnapshotSchema,
  checkoutTranslationSnapshotSchema,
  type PublishedContentContext,
  type CheckoutMediaSnapshot,
  type CheckoutTranslationSnapshot,
  type SupportedLocale,
} from "@fan-support/contracts";
import { projectPublishedContent } from "@fan-support/content";
import { CheckoutPreflightRepositoryError } from "@fan-support/persistence-port";

const unavailable = (): never => {
  throw new CheckoutPreflightRepositoryError("CONTENT_UNAVAILABLE");
};

/** Only called after the complete canonical projector; metadata keeps its own language and revision. */
export function checkoutContentSnapshot(
  context: PublishedContentContext,
  role: "PORTRAIT" | "PRIMARY",
): { translation: CheckoutTranslationSnapshot; media: CheckoutMediaSnapshot } {
  const projected = projectPublishedContent(context);
  if (
    projected.outcome !== "SUCCESS" ||
    !["IDOL", "GIFT"].includes(projected.content.kind)
  )
    return unavailable();
  const witness = {
    schemaVersion: 1,
    publicationId: context.publication.publicationId,
    manifestHash: context.publication.manifestHash,
    requestedLocale: context.locale,
  };
  if (context.schemaVersion === 3) {
    const document = context.current.document;
    if (document.kind !== "IDOL" && document.kind !== "GIFT")
      return unavailable();
    const refs = document.media.filter((ref) => ref.role === role);
    if (refs.length !== 1) return unavailable();
    const ref = refs[0]!;
    const media = context.current.media.find(
      (entry) =>
        entry.asset.id === ref.mediaAssetId &&
        entry.metadata.revisionId === ref.mediaMetadataRevisionId,
    );
    if (!media) return unavailable();
    const translation = (
      source: { id: string; sourceHash: string; locale: SupportedLocale },
      revisionId: string,
    ) =>
      checkoutTranslationSnapshotSchema.parse({
        ...witness,
        mode: "DAILY",
        publicationMode: "DIRECT_OPERATOR_V1",
        revisionId,
        sourceHash: source.sourceHash,
        sourceLocale: source.locale,
        requestedLocale: context.locale,
        resolvedLocale: source.locale,
        translationRevisionId: source.id,
        fallbackUsed: source.locale !== context.locale,
      });
    return {
      translation: translation(document.source, document.revisionId),
      media: checkoutMediaSnapshotSchema.parse({
        schemaVersion: 1,
        assetId: media.asset.id,
        checksum: media.asset.checksumSha256,
        objectKey: media.asset.objectKey,
        metadataRevisionId: media.metadata.revisionId,
        alt: media.metadata.source.fields.alt,
        altTranslation: translation(
          media.metadata.source,
          media.metadata.revisionId,
        ),
      }),
    };
  }
  const snapshot = context.canonical.snapshot;
  if (snapshot.content.kind !== "IDOL" && snapshot.content.kind !== "GIFT")
    return unavailable();
  const refs = snapshot.content.media.filter((ref) => ref.role === role);
  if (refs.length !== 1) return unavailable();
  const ref = refs[0]!;
  const metadata = context.canonical.mediaSnapshots.find(
    (entry) =>
      entry.revisionId === ref.mediaMetadataRevisionId &&
      entry.target.kind === "MEDIA_METADATA" &&
      entry.target.mediaAssetId === ref.mediaAssetId,
  );
  const candidate = context.canonical.candidate;
  if (candidate.objectKind !== "IDOL" && candidate.objectKind !== "GIFT")
    return unavailable();
  const asset = candidate.mediaAssets.find(
    (entry) => entry.id === ref.mediaAssetId,
  );
  if (!metadata || metadata.content.kind !== "MEDIA_METADATA" || !asset)
    return unavailable();
  const audit = snapshot.translationAudits.find(
    (entry) => entry.locale === context.locale,
  );
  const altAudit = metadata.translationAudits.find(
    (entry) => entry.locale === context.locale,
  );
  const fields = metadata.content.translations.find(
    (entry) => entry.locale === context.locale,
  )?.fields;
  if (!audit || !altAudit || !fields) return unavailable();
  const translation = (entry: typeof audit, revisionId: string) =>
    checkoutTranslationSnapshotSchema.parse({
      ...witness,
      mode: "APPROVED",
      revisionId,
      sourceHash: entry.sourceHash,
      resolvedLocale: context.locale,
      translationRevisionId: entry.id,
      fallbackUsed: false,
    });
  return {
    translation: translation(audit, snapshot.revisionId),
    media: checkoutMediaSnapshotSchema.parse({
      schemaVersion: 1,
      assetId: asset.id,
      checksum: asset.checksumSha256,
      objectKey: asset.objectKey,
      metadataRevisionId: metadata.revisionId,
      alt: fields.alt,
      altTranslation: translation(altAudit, metadata.revisionId),
    }),
  };
}

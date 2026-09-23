import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  legacyPublishedContentContextSchema,
  sourceHashSchema,
  type ContentAuthoringSnapshot,
  type LegacyPublishedContentContext,
  type PublicationManifestRevision,
  type SupportedLocale,
} from "@fan-support/contracts";
import { canonicalPublicationValue } from "./publication-manifest-canonical.js";
import { computeContentAuthoringSnapshotHash } from "./content-authoring.js";
import { validatePreflightBindings } from "./publication-preflight-bindings.js";
import {
  equalSet,
  rawEqual,
  withoutFields,
} from "./publication-preflight-shared.js";

const parentFields = {
  IDOL: "idolRevisionId",
  GIFT: "giftRevisionId",
  HOMEPAGE: "homepageRevisionId",
  POLICY: "policyRevisionId",
  MEDIA_METADATA: "mediaMetadataRevisionId",
} as const;

function translationRows(snapshot: ContentAuthoringSnapshot) {
  return snapshot.content.translations.map((translation) => {
    const audit = snapshot.translationAudits.find(
      (row) => row.locale === translation.locale,
    )!;
    return {
      schemaVersion: 1,
      id: audit.id,
      [parentFields[snapshot.target.kind]]: snapshot.revisionId,
      locale: audit.locale,
      sourceHash: audit.sourceHash,
      translatedFromSourceHash: audit.translatedFromSourceHash,
      origin: audit.origin,
      ...(audit.importBatchId ? { importBatchId: audit.importBatchId } : {}),
      editorId: audit.editorId,
      editedAt: audit.editedAt,
      review: audit.review,
      ...translation.fields,
    };
  });
}

/** Recover only a missing SQL translation/review pair from its immutable approved publication.
 * Present data, current eligibility and publication proof must still pass the original validator. */
export function recoverPublishedTranslationProjection(
  input: LegacyPublishedContentContext,
) {
  if (validatePreflightBindings(input.canonical).length !== 0)
    throw new Error("Current publication bindings unavailable");
  const samePublicationValue = (left: unknown, right: unknown) =>
    canonicalPublicationValue(left) === canonicalPublicationValue(right);
  const unavailable = new Set<SupportedLocale>();
  const missingIds = new Set<string>();
  const manifest = input.publication.manifest;
  function recover(
    snapshot: ContentAuthoringSnapshot,
    frozen: PublicationManifestRevision,
  ) {
    const absent = SUPPORTED_LOCALES.filter(
      (locale) =>
        !snapshot.content.translations.some((row) => row.locale === locale),
    );
    if (absent.length === 0) return snapshot;
    if (
      absent.includes(DEFAULT_LOCALE) ||
      !rawEqual(
        snapshot.content.translations.map((row) => row.locale).sort(),
        snapshot.translationAudits.map((row) => row.locale).sort(),
      )
    )
      throw new Error(
        "Translation recovery requires paired non-source absence",
      );
    const expected = {
      ...frozen,
      content: {
        ...frozen.content,
        translations: frozen.content.translations.filter(
          (row) => !absent.includes(row.locale),
        ),
      },
      translationAudits: frozen.translationAudits.filter(
        (row) => !absent.includes(row.locale),
      ),
    };
    if (
      !samePublicationValue(
        withoutFields(snapshot, ["lifecycle", "headVersion", "contentHash"]),
        expected,
      )
    )
      throw new Error(
        "Present translation data differs from immutable publication",
      );
    for (const locale of absent) unavailable.add(locale);
    for (const audit of frozen.translationAudits.filter((row) =>
      absent.includes(row.locale),
    ))
      missingIds.add(audit.id);
    const restored = {
      ...snapshot,
      content: {
        ...snapshot.content,
        translations: [
          ...snapshot.content.translations,
          ...frozen.content.translations.filter((row) =>
            absent.includes(row.locale),
          ),
        ],
      },
      translationAudits: [
        ...snapshot.translationAudits,
        ...frozen.translationAudits.filter((row) =>
          absent.includes(row.locale),
        ),
      ],
    } as ContentAuthoringSnapshot;
    return {
      ...restored,
      contentHash: sourceHashSchema.parse(
        computeContentAuthoringSnapshotHash(restored),
      ),
    };
  }
  const snapshot = recover(input.canonical.snapshot, manifest.revision);
  const mediaSnapshots = input.canonical.mediaSnapshots.map((current) => {
    const frozen = manifest.mediaRevisions.find(
      (row) => row.revisionId === current.revisionId,
    );
    if (!frozen) throw new Error("Media recovery proof unavailable");
    return recover(current, frozen);
  });
  if (unavailable.size === 0) return { context: input, unavailable };
  // Only evidence belonging to the exact missing translation pair may be restored.
  if (
    !samePublicationValue(
      { approvals: input.canonical.approvals, copies: input.canonical.copies },
      {
        approvals: manifest.approvals.filter(
          (row) => !missingIds.has(row.translationRevisionId),
        ),
        copies: manifest.copies.filter(
          (row) => !missingIds.has(row.targetTranslationId),
        ),
      },
    )
  )
    throw new Error("Unrelated approval or copy evidence unavailable");
  const candidate = input.canonical.candidate;
  if (
    candidate.objectKind !== "MEDIA_METADATA" &&
    (!equalSet(
      candidate.translations,
      translationRows(input.canonical.snapshot),
    ) ||
      ("mediaTranslations" in candidate &&
        !equalSet(
          candidate.mediaTranslations,
          input.canonical.mediaSnapshots.flatMap(translationRows),
        )))
  )
    throw new Error(
      "Present candidate translations differ from canonical rows",
    );
  const restoredCandidate =
    candidate.objectKind === "MEDIA_METADATA"
      ? candidate
      : {
          ...candidate,
          translations: translationRows(snapshot),
          ...("mediaTranslations" in candidate
            ? { mediaTranslations: mediaSnapshots.flatMap(translationRows) }
            : {}),
        };
  const context = legacyPublishedContentContextSchema.parse({
    ...input,
    canonical: {
      ...input.canonical,
      snapshot,
      mediaSnapshots,
      candidate: restoredCandidate,
      approvals: [
        ...input.canonical.approvals,
        ...manifest.approvals.filter((row) =>
          missingIds.has(row.translationRevisionId),
        ),
      ],
      copies: [
        ...input.canonical.copies,
        ...manifest.copies.filter((row) =>
          missingIds.has(row.targetTranslationId),
        ),
      ],
    },
  });
  return { context, unavailable };
}

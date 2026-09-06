import type {
  ContentAuthoringSnapshot,
  PublicationPreflightContext,
  PublicationPreflightIssue,
} from "@fan-support/contracts";
import { computeContentAuthoringSnapshotHash } from "./content-authoring.js";
import { sameBaseContentTarget } from "./base-content.js";
import {
  equalSet,
  withoutFields,
  preflightIssue,
  rawEqual,
  sameId,
  comparePreflightTime,
} from "./publication-preflight-shared.js";
type RecordValue = Readonly<Record<string, unknown>>;
function pick(value: RecordValue, keys: readonly string[]): RecordValue {
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}
function sameRevision(
  snapshot: ContentAuthoringSnapshot,
  revision: RecordValue,
): boolean {
  return (
    snapshot.revisionId === revision["id"] &&
    snapshot.revisionNumber === revision["revision"] &&
    snapshot.createdBy === revision["createdBy"] &&
    typeof revision["createdAt"] === "string" &&
    comparePreflightTime(snapshot.createdAt, revision["createdAt"]) === 0 &&
    rawEqual(snapshot.lifecycle, revision["lifecycle"]) &&
    (snapshot.target.kind === "HOMEPAGE" ||
      rawEqual(
        snapshot.content.structure,
        pick(revision, Object.keys(snapshot.content.structure)),
      ))
  );
}
function sameRows(
  snapshot: ContentAuthoringSnapshot,
  rows: readonly RecordValue[],
): boolean {
  if (rows.length !== snapshot.translationAudits.length) return false;
  return snapshot.translationAudits.every((audit) => {
    const matches = rows.filter((row) => row["id"] === audit.id);
    if (matches.length !== 1) return false;
    const row = matches[0]!;
    const expectedAudit = withoutFields(audit, [
      "reviewId",
      "reviewSequence",
      "inheritedFrom",
    ]);
    const text = snapshot.content.translations.find(
      (t) => t.locale === audit.locale,
    )!;
    return (
      rawEqual(expectedAudit, pick(row, Object.keys(expectedAudit))) &&
      rawEqual(text.fields, pick(row, Object.keys(text.fields)))
    );
  });
}
export function validatePreflightBindings(
  context: PublicationPreflightContext,
): PublicationPreflightIssue[] {
  const { snapshot, candidate } = context;
  const issues: PublicationPreflightIssue[] = [];
  function mismatch(path: (string | number)[]) {
    issues.push(preflightIssue("CANONICAL_SNAPSHOT_MISMATCH", path));
  }
  if (
    !sameBaseContentTarget(
      { ...context.target, locale: "en" },
      { owner: snapshot.target, revisionId: snapshot.revisionId, locale: "en" },
    ) ||
    candidate.objectKind !== snapshot.content.kind
  )
    mismatch(["target"]);
  const snapshots = [snapshot, ...context.mediaSnapshots];
  for (const [index, item] of snapshots.entries()) {
    try {
      if (computeContentAuthoringSnapshotHash(item) !== item.contentHash)
        mismatch(["snapshots", index, "contentHash"]);
    } catch {
      mismatch(["snapshots", index]);
    }
  }
  if (
    new Set(snapshots.map((item) => item.revisionId.toLowerCase())).size !==
    snapshots.length
  )
    mismatch(["mediaSnapshots"]);
  if (candidate.objectKind === "MEDIA_METADATA") {
    if (
      snapshot.target.kind !== "MEDIA_METADATA" ||
      !sameId(candidate.asset.id, snapshot.target.mediaAssetId) ||
      context.mediaSnapshots.length !== 0
    )
      mismatch(["candidate"]);
  } else {
    if (
      candidate.action !== context.action ||
      comparePreflightTime(candidate.evaluatedAt, context.evaluatedAt) !== 0 ||
      !sameRevision(snapshot, candidate.revision) ||
      !sameRows(snapshot, candidate.translations)
    )
      mismatch(["candidate", "revision"]);
    if (
      candidate.objectKind === "IDOL" &&
      (snapshot.target.kind !== "IDOL" ||
        !sameId(candidate.base.id, snapshot.target.idolId) ||
        !sameId(candidate.revision.idolId, snapshot.target.idolId))
    )
      mismatch(["candidate", "base"]);
    if (
      candidate.objectKind === "GIFT" &&
      (snapshot.target.kind !== "GIFT" ||
        !sameId(candidate.base.id, snapshot.target.giftId) ||
        !sameId(candidate.revision.giftId, snapshot.target.giftId))
    )
      mismatch(["candidate", "base"]);
    if (
      candidate.objectKind === "POLICY" &&
      (snapshot.target.kind !== "POLICY" ||
        candidate.revision.policyKey !== snapshot.target.policyKey)
    )
      mismatch(["candidate", "revision", "policyKey"]);
    if (
      (candidate.objectKind === "IDOL" || candidate.objectKind === "GIFT") &&
      "media" in snapshot.content
    ) {
      const projected = candidate.mediaReferences.map((reference) => {
        const rest = withoutFields(reference, ["schemaVersion"]);
        return Object.fromEntries(
          Object.entries(rest).filter(
            ([key]) => key !== "idolRevisionId" && key !== "giftRevisionId",
          ),
        );
      });
      if (!equalSet(projected, snapshot.content.media))
        mismatch(["candidate", "mediaReferences"]);
    }
    if (
      candidate.objectKind === "HOMEPAGE" &&
      snapshot.content.kind === "HOMEPAGE"
    ) {
      if (
        !equalSet(
          candidate.slots.map((slot) =>
            withoutFields(slot, ["schemaVersion", "homepageRevisionId"]),
          ),
          snapshot.content.structure.slots,
        )
      )
        mismatch(["candidate", "slots"]);
    }
    const metadata =
      "mediaMetadataRevisions" in candidate
        ? candidate.mediaMetadataRevisions
        : [];
    const translations =
      "mediaTranslations" in candidate ? candidate.mediaTranslations : [];
    if (metadata.length !== context.mediaSnapshots.length)
      mismatch(["mediaSnapshots"]);
    for (const [index, item] of context.mediaSnapshots.entries()) {
      const matches = metadata.filter((row) => sameId(row.id, item.revisionId));
      if (
        item.target.kind !== "MEDIA_METADATA" ||
        matches.length !== 1 ||
        !sameId(matches[0]!.mediaAssetId, item.target.mediaAssetId) ||
        !sameRevision(item, matches[0]!) ||
        !sameRows(
          item,
          translations.filter((row) =>
            sameId(row.mediaMetadataRevisionId, item.revisionId),
          ),
        )
      )
        mismatch(["mediaSnapshots", index]);
    }
  }
  const current = candidate.currentPublication;
  if ((context.headVersion === 0) !== (current === null))
    mismatch(["headVersion"]);
  return issues;
}

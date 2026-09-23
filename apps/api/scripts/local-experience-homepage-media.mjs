import { localHomepageCopy } from "./local-experience-homepage-copy.mjs";
import assert from "node:assert/strict";
import {
  SUPPORTED_LOCALES,
  contentAuthoringContentSchema,
} from "@fan-support/contracts";
import { canonicalPublicationValue } from "@fan-support/content";
import { workspaceTranslations } from "./admin-workspace-fixtures.mjs";

function comparable(value) {
  return canonicalPublicationValue({
    ...value,
    translations: [...value.translations].sort((a, b) =>
      a.locale.localeCompare(b.locale),
    ),
  });
}
export function buildLocalHomepageMediaContent(name, index) {
  return contentAuthoringContentSchema.parse({
    kind: "MEDIA_METADATA",
    structure: {
      presentationKind: "INFORMATIVE",
      focalPoint: { x: 0.5, y: 0.5 },
    },
    translations: workspaceTranslations((locale) => ({
      alt: name + " — " + localHomepageCopy(locale).portraits[index],
    })),
  });
}
/** Complete durable HTTP authoring/review; originals are reviewed and masters also published. */
export async function ensureLocalReviewedMedia({
  client,
  content,
  item,
  mediaAssetId,
  save,
  publish = true,
}) {
  const owner = { kind: "MEDIA_METADATA", mediaAssetId };
  if (!item.revisionId) {
    const candidates = (
      await client.query(
        "SELECT r.id FROM media_metadata_revisions r JOIN content_authoring_receipts a ON a.media_metadata_revision_id=r.id WHERE r.media_asset_id=$1 AND r.revision>$2 ORDER BY r.revision",
        [mediaAssetId, item.baseRevisionNumber],
      )
    ).rows;
    for (const row of candidates) {
      const read = await content.request(
        "/api/v1/admin/content-authoring/read",
        { target: owner, revisionId: row.id },
      );
      if (comparable(read.snapshot.content) === comparable(item.content)) {
        item.revisionId = row.id;
        break;
      }
    }
    if (candidates.length && !item.revisionId)
      throw new Error(
        "New artist metadata content was preserved; bootstrap differs",
      );
    item.revisionId ??= (
      await content.write("/api/v1/admin/content-authoring/create", {
        target: owner,
        content: item.content,
        expectedVersion: item.baseRevisionNumber,
      })
    ).resultId;
    await save();
  }
  const revisionId = item.revisionId;
  const snapshot = (
    await content.request("/api/v1/admin/content-authoring/read", {
      target: owner,
      revisionId,
    })
  ).snapshot;
  if (comparable(snapshot.content) !== comparable(item.content))
    throw new Error("Bootstrap metadata changed; existing content preserved");
  if (["PUBLISHED", "SUPERSEDED"].includes(snapshot.lifecycle.status)) {
    const proof = await client.query(
      "SELECT 1 FROM content_publications WHERE media_metadata_revision_id=$1 AND proof_version=2 AND action='PUBLISH'",
      [revisionId],
    );
    assert.equal(proof.rowCount, 1);
    item.published = true;
    await save();
    return;
  }
  for (const locale of SUPPORTED_LOCALES) {
    const target = { owner, revisionId, locale };
    let read = await content.request("/api/v1/admin/content-review/read", {
      target,
    });
    const write = (action, actor) =>
      content.write(
        "/api/v1/admin/content-review/" + action,
        {
          target,
          expectedVersion: read.context.audit.reviewSequence,
          expectedContentHash: read.context.audit.sourceHash,
          expectedSourceHash: read.context.currentEnglishSourceHash,
        },
        actor,
      );
    if (read.context.audit.review.status === "DRAFT") {
      await write("submit", "manager");
      read = await content.request("/api/v1/admin/content-review/read", {
        target,
      });
    }
    if (read.context.audit.review.status === "IN_REVIEW")
      await write("approve", "reviewer");
    else if (read.context.audit.review.status !== "APPROVED")
      throw new Error("Bootstrap metadata requires explicit review");
  }
  if (!publish) return;
  const target = { owner, revisionId };
  const preflight = await content.request(
    "/api/v1/admin/content/publication/preflight",
    { target, action: "PUBLISH" },
    { actor: "manager" },
  );
  assert.ok(
    preflight.ready,
    "New metadata must satisfy the normal publication gate",
  );
  assert.equal(
    preflight.headVersion,
    item.baseHeadVersion,
    "Concurrent metadata publication is preserved",
  );
  const validated =
    snapshot.lifecycle.status === "DRAFT"
      ? await content.write(
          "/api/v1/admin/content/publication/validate",
          {
            target,
            expectedVersion: preflight.headVersion,
            expectedContentHash: preflight.contentHash,
          },
          "manager",
        )
      : preflight;
  await content.write(
    "/api/v1/admin/content/publication/publish",
    {
      target,
      expectedVersion: item.baseHeadVersion,
      expectedContentHash: validated.contentHash,
    },
    "manager",
  );
  item.published = true;
  await save();
}

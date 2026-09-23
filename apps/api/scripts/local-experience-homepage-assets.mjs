import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import {
  createLocalHomepageOriginal,
  prepareLocalHomepagePosterPlan,
} from "./local-experience-homepage-originals.mjs";
import {
  buildLocalHomepageMediaContent,
  ensureLocalReviewedMedia,
} from "./local-experience-homepage-media.mjs";

/** Independent TEST canvases from committed fixtures pass through signed uploads and the unmodified strict image pipeline. */
export async function prepareLocalHomepageAssets({
  workspaceRoot,
  client,
  content,
  plan,
  save,
}) {
  const originals = Object.fromEntries(
    await Promise.all(
      ["desktop", "mobile"].map(async (key) => [
        key,
        await createLocalHomepageOriginal({ workspaceRoot, key }),
      ]),
    ),
  );
  await prepareLocalHomepagePosterPlan(plan, originals, save);
  const rights = async (assetId) => {
    const row = (
      await client.query(
        "SELECT a.rights_status,coalesce((SELECT max(version)::int FROM media_rights_events WHERE asset_id=a.id),0) version FROM media_assets a WHERE a.id=$1",
        [assetId],
      )
    ).rows[0];
    if (row?.rights_status === "APPROVED") return;
    assert.equal(
      row?.rights_status,
      "PENDING",
      "Existing nonpending rights must be preserved",
    );
    await content.write("/api/v1/admin/resources/media/rights", {
      assetId,
      expectedVersion: row.version,
      rightsStatus: "APPROVED",
      evidenceReference: "rights:local-test-committed-fictional-poster",
    });
  };
  const metadata = async (item, key, assetId, index, publish) => {
    if (!item[key]) {
      const row = (
        await client.query(
          "SELECT coalesce(max(revision)::int,0) revision FROM media_metadata_revisions WHERE media_asset_id=$1",
          [assetId],
        )
      ).rows[0];
      item[key] = {
        baseRevisionNumber: row.revision,
        baseHeadVersion: 0,
        content: buildLocalHomepageMediaContent("Local TEST poster", index),
      };
      await save();
    }
    await ensureLocalReviewedMedia({
      client,
      content,
      item: item[key],
      mediaAssetId: assetId,
      save,
      publish,
    });
  };
  for (const [index, key] of ["desktop", "mobile"].entries()) {
    const role = key === "desktop" ? "HERO_DESKTOP" : "HERO_MOBILE";
    const { bytes, sourceChecksum } = originals[key];
    if (!plan.posterAssets[key]) {
      plan.posterAssets[key] = { sourceChecksum };
      await save();
    }
    const item = plan.posterAssets[key];
    assert.equal(
      item.sourceChecksum,
      sourceChecksum,
      "Committed TEST original changed; existing plan preserved",
    );
    if (!item.sourceAssetId) {
      const existing = (
        await client.query(
          "SELECT id FROM media_assets WHERE checksum_sha256=$1 AND identity_kind='SOURCE'",
          [sourceChecksum],
        )
      ).rows[0];
      if (existing) item.sourceAssetId = existing.id;
      else {
        const grant = await content.write(
          "/api/v1/admin/resources/uploads/begin",
          {
            checksumSha256: sourceChecksum,
            byteSize: bytes.length,
            mimeType: "image/png",
            rightsReference: "rights:local-test-committed-fictional-poster",
            expectedVersion: 0,
          },
        );
        item.uploadId = grant.uploadId;
        await save();
        const uploaded = await globalThis.fetch(grant.grant.url, {
          method: "PUT",
          headers: grant.grant.headers,
          body: bytes,
          signal: globalThis.AbortSignal.timeout(30000),
        });
        await uploaded.body?.cancel();
        assert.equal(
          uploaded.status,
          200,
          "Actual strict TLS S3 upload succeeds",
        );
        item.sourceAssetId = (
          await content.write("/api/v1/admin/resources/uploads/complete", {
            uploadId: grant.uploadId,
            expectedVersion: 1,
          })
        ).resultId;
      }
      await save();
    }
    await metadata(item, "sourceMetadata", item.sourceAssetId, index, false);
    await rights(item.sourceAssetId);
    if (!item.jobId) {
      const prior = (
        await client.query(
          "SELECT id FROM media_processing_jobs WHERE source_asset_id=$1 AND source_metadata_revision_id=$2 AND role=$3 AND fit='CONTAIN' ORDER BY created_at LIMIT 1",
          [item.sourceAssetId, item.sourceMetadata.revisionId, role],
        )
      ).rows[0];
      item.jobId =
        prior?.id ??
        (
          await content.write("/api/v1/admin/resources/processing/enqueue", {
            sourceAssetId: item.sourceAssetId,
            metadataRevisionId: item.sourceMetadata.revisionId,
            role,
            fit: "CONTAIN",
            expectedVersion: 0,
          })
        ).resultId;
      await save();
    }
    if (!item.assetId) {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        const current = await content.request(
          "/api/v1/admin/resources/processing/read",
          { jobId: item.jobId },
        );
        assert.notEqual(
          current.job.snapshot.status,
          "FAILED",
          "Strict TEST image processing failed",
        );
        if (current.job.snapshot.status === "SUCCEEDED") {
          item.assetId = current.job.snapshot.outputAssetId;
          await save();
          break;
        }
        await delay(500);
      }
      assert.ok(
        item.assetId,
        "Independent strict media Worker must process the TEST poster",
      );
    }
    await rights(item.assetId);
    await metadata(item, "metadata", item.assetId, index, true);
  }
  assert.notEqual(
    plan.posterAssets.desktop.sourceChecksum,
    plan.posterAssets.mobile.sourceChecksum,
  );
}

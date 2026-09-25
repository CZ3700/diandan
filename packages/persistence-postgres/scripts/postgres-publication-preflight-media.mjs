import { randomUUID } from "node:crypto";
import { evaluatePublicationPreflight } from "@fan-support/content";
import {
  seedMediaProcessingSource,
  createMediaProcessingDatabaseReceipt,
} from "./postgres-media-processing-fixtures.mjs";
import { approvePreflightBase } from "./postgres-publication-preflight-fixtures.mjs";

/** Synthetic image receipts cover PostgreSQL evidence; they do not claim an image/S3 decode test. */
export async function verifyPublicationPreflightMedia({
  client,
  persistence,
  fixtures,
  equal,
}) {
  function success(result, label) {
    equal(result.outcome, "SUCCESS", label);
    return result;
  }
  const media = (work) =>
    persistence.mediaProcessingTransactionManager.runInMediaProcessingTransaction(
      ({ mediaProcessing }) => work(mediaProcessing),
    );
  const resource = (work) =>
    persistence.resourceManagementTransactionManager.runInResourceManagementTransaction(
      ({ resources }) => work(resources),
    );
  const author = (work) =>
    persistence.contentAuthoringTransactionManager.runInContentAuthoringTransaction(
      work,
    );
  async function processSource() {
    const source = await seedMediaProcessingSource(client, {
      requestedBy: fixtures.editor,
      role: "GIFT_PRIMARY",
      rightsStatus: "APPROVED",
    });
    success(
      await media((repository) => repository.enqueue(source.enqueue)),
      "lineage job enqueue",
    );
    const claim = success(
      await media((repository) =>
        repository.claim({
          schemaVersion: 1,
          leaseToken: randomUUID(),
          leaseSeconds: 60,
        }),
      ),
      "lineage worker claim",
    ).value;
    const result = createMediaProcessingDatabaseReceipt(claim.command, {
      outputIdentity: "preflight-shared-master",
    });
    const completed = success(
      await media((repository) =>
        repository.complete({
          schemaVersion: 1,
          jobId: claim.jobId,
          leaseToken: claim.leaseToken,
          result,
        }),
      ),
      "complete persisted provenance",
    ).value;
    return { ...source, assetId: completed.outputAssetId };
  }
  async function rights(assetId, status) {
    return success(
      await resource((repository) =>
        repository.setRights({
          schemaVersion: 1,
          assetId,
          expectedVersion: 0,
          rightsStatus: status,
          evidenceReference: "evidence:preflight-lineage",
          eventId: randomUUID(),
          actorId: fixtures.editor,
          sessionId: fixtures.sessions.editor,
          reasonCode: "PREFLIGHT_LINEAGE",
          requestId: randomUUID(),
        }),
      ),
      "audited source/master rights",
    );
  }
  const first = await processSource();
  await rights(first.assetId, "APPROVED");
  const owner = { kind: "MEDIA_METADATA", mediaAssetId: first.assetId };
  const revisionId = success(
    await author(({ contentAuthoring }) =>
      contentAuthoring.write({
        schemaVersion: 1,
        actorId: fixtures.editor,
        requestId: randomUUID(),
        command: {
          schemaVersion: 1,
          action: "CREATE",
          target: owner,
          expectedVersion: 0,
          content: fixtures.content.media,
          reasonCode: "PREFLIGHT_LINEAGE",
          idempotencyKey: randomUUID(),
        },
      }),
    ),
    "author metadata for processed master",
  ).resultId;
  await approvePreflightBase(persistence, fixtures, owner, revisionId);
  const load = () =>
    persistence.publicationPreflightTransactionManager.runInPublicationPreflightTransaction(
      ({ publicationPreflight }) =>
        publicationPreflight.load({
          schemaVersion: 1,
          target: { owner, revisionId },
          action: "PUBLISH",
        }),
    );
  const before = success(await load(), "master with one canonical source");
  equal(
    before.context.mediaLineage[0].processing.length,
    1,
    "one source edge loaded",
  );
  equal(
    evaluatePublicationPreflight(before.context).ready,
    true,
    "approved processed master with valid source is ready",
  );
  const second = await processSource();
  equal(
    second.assetId,
    first.assetId,
    "identical processed master deduplicates while preserving original jobs",
  );
  const shared = success(await load(), "shared master provenance");
  equal(
    shared.context.mediaLineage[0].processing.length,
    2,
    "all sources of shared master are loaded",
  );
  equal(
    evaluatePublicationPreflight(shared.context).ready,
    true,
    "both approved originals qualify",
  );
  await rights(second.sourceAssetId, "REJECTED");
  const revoked = success(
    await load(),
    "revoked original remains visible in canonical proof",
  );
  equal(
    revoked.context.candidate.asset.rightsStatus,
    "APPROVED",
    "master approval itself is unchanged",
  );
  equal(
    revoked.context.mediaLineage[0].processing.length,
    2,
    "revoked source cannot disappear from provenance",
  );
  const rejected = success(
    evaluatePublicationPreflight(revoked.context),
    "revoked source diagnostic",
  );
  equal(rejected.ready, false, "one revoked original blocks a shared master");
  equal(
    rejected.issues.some(
      (issue) => issue.code === "MEDIA_ORIGINAL_RIGHTS_NOT_APPROVED",
    ),
    true,
    "current original rights failure is explicit",
  );
}

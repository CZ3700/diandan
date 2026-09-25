import { randomUUID } from "node:crypto";
import {
  seedMediaProcessingSource,
  createMediaProcessingDatabaseReceipt,
} from "./postgres-media-processing-fixtures.mjs";

/** Synthetic image receipts exercise actual SQL provenance, without claiming network/image decoding. */
export async function verifyPublicationHeroOrigins({
  client,
  persistence,
  fixtures,
  check,
}) {
  const source = await seedMediaProcessingSource(client, {
    requestedBy: fixtures.editor,
    role: "HERO_DESKTOP",
    rightsStatus: "APPROVED",
    width: 6000,
    height: 4000,
  });
  const run = (work) =>
    persistence.mediaProcessingTransactionManager.runInMediaProcessingTransaction(
      ({ mediaProcessing }) => work(mediaProcessing),
    );
  const outputs = [];
  for (const role of ["HERO_DESKTOP", "HERO_MOBILE"]) {
    const enqueued = await run((repo) =>
      repo.enqueue({ ...source.enqueue, jobId: randomUUID(), role }),
    );
    check(
      enqueued.outcome,
      "SUCCESS",
      "normal processing job accepts the requested hero role",
    );
    const claimed = await run((repo) =>
      repo.claim({
        schemaVersion: 1,
        leaseToken: randomUUID(),
        leaseSeconds: 60,
      }),
    );
    check(
      claimed.outcome,
      "SUCCESS",
      "normal processing job receives a durable claim",
    );
    const claim = claimed.value;
    const result = createMediaProcessingDatabaseReceipt(claim.command, {
      outputIdentity: `publication-hero:${role}`,
    });
    const completed = await run((repo) =>
      repo.complete({
        schemaVersion: 1,
        jobId: claim.jobId,
        leaseToken: claim.leaseToken,
        result,
      }),
    );
    check(
      completed.outcome,
      "SUCCESS",
      "normal processing receipts record actual original lineage",
    );
    outputs.push(completed.value.outputAssetId);
  }
  check(
    outputs[0] !== outputs[1],
    true,
    "different hero dimensions create distinct master identities",
  );
  let error;
  try {
    await client.query(
      "SELECT public.assert_publication_hero_originals($1::uuid,$2::uuid)",
      outputs,
    );
  } catch (failure) {
    error = failure;
  }
  check(
    error?.code,
    "23514",
    "distinct hero masters sharing the same original are rejected",
  );
  await client.query(
    "SELECT public.assert_publication_hero_originals($1::uuid,$2::uuid)",
    [fixtures.catalog.media[1].assetId, fixtures.catalog.media[2].assetId],
  );
  check(true, true, "independent original hero photographs remain eligible");
}

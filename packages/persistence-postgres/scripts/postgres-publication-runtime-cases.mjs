import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  buildPublicationManifest,
  computePublicationManifestHash,
} from "@fan-support/content";

export async function verifyPublicationRuntimeCases({
  client,
  persistence,
  fixtures,
  credentials,
  publications,
  check,
}) {
  const run = (work) =>
    persistence.publicationRuntimeTransactionManager.runInPublicationRuntimeTransaction(
      work,
    );
  const authorize = async (repo) => {
    const value = await repo.authorize({
      schemaVersion: 1,
      ...credentials,
      permission: "content.publish",
      locales: SUPPORTED_LOCALES,
    });
    check(value.outcome, "SUCCESS", "current rollback and retry authority");
    return value.principal;
  };
  for (const name of Object.keys(publications)) {
    const result = publications[name];
    const read = await run(({ publicationRuntime }) =>
      publicationRuntime.readReceipt({
        schemaVersion: 1,
        resultId: result.resultId,
        actorId: fixtures.editor,
      }),
    );
    check(
      read,
      result,
      "immutable operation receipt reads exact original result",
    );
    const wrong = await run(({ publicationRuntime }) =>
      publicationRuntime.readReceipt({
        schemaVersion: 1,
        resultId: result.resultId,
        actorId: fixtures.reviewer,
      }),
    );
    check(
      wrong.code,
      "NOT_FOUND",
      "another actor cannot replay the operation receipt",
    );
    const status = await run(({ publicationRuntime }) =>
      publicationRuntime.status({
        schemaVersion: 1,
        action: "STATUS",
        publicationId: result.publicationId,
      }),
    );
    check(status.outcome, "SUCCESS", "canonical publication status reads");
    check(status.isCurrent, true, "new publication is actual current head");
    check(status.jobs.length, 7, "status includes all seven root locale jobs");
  }
  const hashes = [];
  for (const revisionId of [
    fixtures.approvedSourceRevisionIds.idol,
    fixtures.revisions.idol,
  ]) {
    const target = { owner: fixtures.targets.idol, revisionId };
    const value = await run(async ({ authorization, publicationRuntime }) => {
      const principal = await authorize(authorization);
      const loaded = await publicationRuntime.load({
        schemaVersion: 1,
        action: "ROLLBACK",
        target,
      });
      check(
        loaded.outcome,
        "SUCCESS",
        "actual historical rollback context loads",
      );
      const context = loaded.context,
        manifest =
          context.previousManifest ??
          buildPublicationManifest(context.preflight);
      check(
        context.previousManifest !== null,
        revisionId === fixtures.revisions.idol,
        "only historical v2 rollback has persisted manifest",
      );
      return publicationRuntime.write({
        schemaVersion: 1,
        requestId: randomUUID(),
        principal,
        command: {
          schemaVersion: 1,
          action: "ROLLBACK",
          target,
          expectedVersion: context.preflight.headVersion,
          expectedContentHash: context.preflight.snapshot.contentHash,
          reasonCode: "PG_ROLLBACK",
          idempotencyKey: randomUUID(),
        },
        manifest,
        manifestHash: computePublicationManifestHash(manifest),
      });
    });
    check(
      value.outcome,
      "SUCCESS",
      "rollback writes a new immutable publication event",
    );
    hashes.push(value.manifestHash);
    const current = (
      await client.query(
        "SELECT h.version::integer AS version,r.lifecycle,p.action FROM public.idol_publication_heads h JOIN public.idol_revisions r ON r.id=h.idol_revision_id JOIN public.content_publications p ON p.id=h.publication_id WHERE h.idol_id=$1",
        [fixtures.targets.idol.idolId],
      )
    ).rows[0];
    check(
      current,
      {
        version: value.headVersion,
        lifecycle: "SUPERSEDED",
        action: "ROLLBACK",
      },
      "rollback switches head without reviving historical lifecycle",
    );
  }
  check(
    hashes[1],
    publications.idol.manifestHash,
    "v2 rollback preserves its historical canonical manifest hash",
  );
  const oldStatus = await run(({ publicationRuntime }) =>
    publicationRuntime.status({
      schemaVersion: 1,
      action: "STATUS",
      publicationId: publications.idol.publicationId,
    }),
  );
  check(
    oldStatus.isCurrent,
    false,
    "original event remains immutable after two rollbacks",
  );
  const failed = (
    await client.query(
      "SELECT id,publication_id,version,generation FROM public.content_purge_jobs WHERE status='FAILED' ORDER BY id LIMIT 1",
    )
  ).rows[0];
  assert.ok(failed, "normal provider failure exists");
  const input = {
    schemaVersion: 1,
    action: "RETRY_PURGE",
    publicationId: failed.publication_id,
    purgeJobId: failed.id,
    expectedVersion: Number(failed.version),
    reasonCode: "PG_PURGE_RETRY",
    idempotencyKey: randomUUID(),
  };
  const retry = await run(async ({ authorization, publicationRuntime }) =>
    publicationRuntime.retry({
      schemaVersion: 1,
      requestId: randomUUID(),
      principal: await authorize(authorization),
      command: input,
    }),
  );
  check(
    retry.outcome,
    "SUCCESS",
    "authorized failed job retry creates a new generation",
  );
  check(
    retry.generation,
    failed.generation + 1,
    "retry preserves predecessor lineage",
  );
  const duplicate = await run(async ({ authorization, publicationRuntime }) =>
    publicationRuntime.retry({
      schemaVersion: 1,
      requestId: randomUUID(),
      principal: await authorize(authorization),
      command: { ...input, idempotencyKey: randomUUID() },
    }),
  );
  check(
    duplicate.code,
    "CONFLICT",
    "a failed generation has at most one successor",
  );
  const status = await run(({ publicationRuntime }) =>
    publicationRuntime.status({
      schemaVersion: 1,
      action: "STATUS",
      publicationId: failed.publication_id,
    }),
  );
  check(
    status.jobs.length,
    8,
    "status retains seven roots and the retry generation",
  );
  check(
    status.jobs.find((job) => job.id === failed.id).status,
    "FAILED",
    "manual retry preserves failed history",
  );
}

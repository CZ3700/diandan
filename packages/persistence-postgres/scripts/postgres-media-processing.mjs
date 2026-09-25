#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mediaProcessingObjectKey } from "@fan-support/content";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client, Pool } from "pg";
import { createPostgresPersistenceWithPoolFactory } from "../dist/postgres-persistence.js";
import { createTransactionRunner } from "../dist/transaction-runner.js";
import { createMediaProcessingRepository } from "../dist/media-processing-repository.js";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";
import { seedCatalogDirectoryFixtures } from "./postgres-catalog-fixtures.mjs";
import {
  seedMediaProcessingSource,
  createMediaProcessingDatabaseReceipt,
} from "./postgres-media-processing-fixtures.mjs";
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let step = "migration";
let assertions = 0;
let simulateFinishClockRollback = false;
let injectedFinishClockReads = 0;
function equal(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  assertions++;
}
function ok(actual, label) {
  assert.ok(actual, label);
  assertions++;
}
function success(result, label) {
  equal(
    result.outcome,
    "SUCCESS",
    `${label}: ${result.code ?? "unexpected response"}`,
  );
  return result.value;
}
async function verify(clientConfig) {
  await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "up", targetVersion: "0011" },
  });
  const observer = new Client(clientConfig);
  await observer.connect();
  let persistence;
  try {
    step = "legacy normal-trigger published fixture";
    const legacy = await seedCatalogDirectoryFixtures(observer, 2);
    const oldIds = legacy.media.map((media) => media.assetId);
    const oldState = async () =>
      (
        await observer.query(
          `SELECT jsonb_build_object(
      'assets',(SELECT jsonb_agg(to_jsonb(asset.*) - 'identity_kind' ORDER BY id) FROM public.media_assets asset WHERE id=ANY($1::uuid[])),
      'variants',(SELECT jsonb_agg(to_jsonb(variant.*) ORDER BY id) FROM public.media_variants variant WHERE media_asset_id=ANY($1::uuid[])),
      'metadata',(SELECT jsonb_agg(to_jsonb(metadata.*) ORDER BY id) FROM public.media_metadata_revisions metadata WHERE media_asset_id=ANY($1::uuid[])),
      'publications',(SELECT jsonb_agg(to_jsonb(publication.*) ORDER BY id) FROM public.content_publications publication)) AS snapshot`,
          [oldIds],
        )
      ).rows[0].snapshot;
    const before = await oldState();
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up", targetVersion: "0012" },
    });
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "down", confirmVersion: "0012" },
    });
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up", targetVersion: "0012" },
    });
    equal(
      await oldState(),
      before,
      "legacy published evidence survives data-bearing up/down/up",
    );
    equal(
      (
        await observer.query(
          "SELECT count(*)::integer AS count FROM public.media_assets WHERE id=ANY($1::uuid[]) AND identity_kind='SOURCE'",
          [oldIds],
        )
      ).rows[0].count,
      oldIds.length,
      "all legacy identities retain SOURCE purpose",
    );
    const orphanId = randomUUID();
    await observer.query(
      `INSERT INTO public.media_assets(id,identity_kind,checksum_sha256,mime_type,width,height,byte_size,object_key,processing_status,rights_status,rights_reference)
      VALUES($1,'PROCESSED_MASTER',repeat('d',64),'image/png',1200,1200,100,'processed/v1/orphan-fixture.png','PENDING','PENDING','orphan rollback fixture')`,
      [orphanId],
    );
    let orphanRollbackRefused = false;
    try {
      await runMigrations({
        clientConfig,
        workspaceRoot,
        command: { direction: "down", confirmVersion: "0012" },
      });
    } catch {
      orphanRollbackRefused = true;
    }
    ok(
      orphanRollbackRefused,
      "processed master identities prevent rollback even without job rows",
    );
    await observer.query("DELETE FROM public.media_assets WHERE id=$1", [
      orphanId,
    ]);
    persistence = createPostgresPersistenceWithPoolFactory(
      clientConfig,
      {},
      (config) => {
        const pool = new Pool(config);
        return {
          connect: async () => {
            const client = await pool.connect();
            return {
              query: async (sql, values) => {
                try {
                  let selectedSql = sql;
                  if (
                    simulateFinishClockRollback &&
                    sql.includes("media-processing:finish-attempt")
                  ) {
                    selectedSql = sql.replace(
                      /(?:statement_timestamp|clock_timestamp)\(\)/gu,
                      "(started_at - interval '1 second')",
                    );
                    if (selectedSql !== sql) injectedFinishClockReads++;
                  }
                  return await client.query(selectedSql, values);
                } catch (error) {
                  console.error(
                    `media query diagnostic: step=${sql.match(/media-processing:[a-z-]+/)?.[0] ?? sql.slice(0, 30)}; code=${error.code}; constraint=${error.constraint ?? "none"}; column=${error.column ?? "none"}`,
                  );
                  throw error;
                }
              },
              release: (destroy) => client.release(destroy),
            };
          },
          end: () => pool.end(),
          on: (event, listener) => pool.on(event, listener),
          off: (event, listener) => pool.off(event, listener),
        };
      },
    );
    const run = (work) =>
      persistence.mediaProcessingTransactionManager.runInMediaProcessingTransaction(
        ({ mediaProcessing }) => work(mediaProcessing),
      );
    const enqueue = (command) => run((repo) => repo.enqueue(command));
    const read = (jobId) =>
      run((repo) => repo.read({ schemaVersion: 1, jobId }));
    const claim = () =>
      run((repo) =>
        repo.claim({
          schemaVersion: 1,
          leaseToken: randomUUID(),
          leaseSeconds: 60,
        }),
      );
    const complete = (claimed, result) =>
      run((repo) =>
        repo.complete({
          schemaVersion: 1,
          jobId: claimed.jobId,
          leaseToken: claimed.leaseToken,
          result,
        }),
      );
    const fail = (claimed, error) =>
      run((repo) =>
        repo.fail({
          schemaVersion: 1,
          jobId: claimed.jobId,
          leaseToken: claimed.leaseToken,
          error,
        }),
      );
    async function withFinishClockRollback(work, jobId, expectedStatus) {
      const before = injectedFinishClockReads;
      simulateFinishClockRollback = true;
      let result;
      try {
        result = await work();
      } finally {
        simulateFinishClockRollback = false;
      }
      equal(
        injectedFinishClockReads,
        before + 1,
        "clock rollback affects exactly one attempt completion statement",
      );
      const attempt = (
        await observer.query(
          "SELECT status,finished_at>=started_at AS causal,finished_at=started_at AS bounded FROM public.media_processing_attempts WHERE job_id=$1 ORDER BY attempt_number DESC LIMIT 1",
          [jobId],
        )
      ).rows[0];
      equal(
        attempt.status,
        expectedStatus,
        "attempt terminal status survives a backward clock sample",
      );
      equal(
        attempt.causal,
        true,
        "attempt finish never precedes immutable start",
      );
      equal(
        attempt.bounded,
        true,
        "database start retains its exact microsecond lower bound",
      );
      return result;
    }
    step = "canonical source and enqueue";
    const source = await seedMediaProcessingSource(observer);
    const job = success(await enqueue(source.enqueue), "enqueue source");
    equal(job.status, "PENDING", "queued job status");
    equal(job.attemptCount, 0, "enqueue has no processing attempt");
    equal(
      await enqueue(source.enqueue),
      { schemaVersion: 1, outcome: "SUCCESS", value: job },
      "same enqueue replay",
    );
    equal(
      success(
        await enqueue({ ...source.enqueue, jobId: randomUUID() }),
        "same recipe dedup",
      ).jobId,
      job.jobId,
      "recipe dedup returns canonical job",
    );
    equal(
      (await enqueue({ ...source.enqueue, fit: "CONTAIN" })).code,
      "CONFLICT",
      "same job different recipe conflict",
    );
    equal(
      (await enqueue({ ...source.enqueue, reason: "Different command reason" }))
        .code,
      "CONFLICT",
      "same job different request conflict",
    );
    const rejected = await seedMediaProcessingSource(observer, {
      rightsStatus: "REJECTED",
    });
    equal(
      (await enqueue(rejected.enqueue)).code,
      "SOURCE_NOT_ELIGIBLE",
      "rejected source rights",
    );
    equal(
      (
        await enqueue({
          ...source.enqueue,
          jobId: randomUUID(),
          metadataRevisionId: rejected.metadataRevisionId,
        })
      ).code,
      "SOURCE_NOT_ELIGIBLE",
      "cross-asset metadata rejected",
    );
    const rollbackSource = await seedMediaProcessingSource(observer);
    try {
      await run(async (repo) => {
        success(
          await repo.enqueue(rollbackSource.enqueue),
          "enqueue before rollback",
        );
        throw new Error("intentional fixture rollback");
      });
    } catch {
      /* intentional transaction rollback */
    }
    equal(
      (await read(rollbackSource.enqueue.jobId)).code,
      "NOT_FOUND",
      "transaction rollback removes queued work",
    );
    step = "caught savepoint failure cannot commit actual PostgreSQL work";
    const boundarySource = await seedMediaProcessingSource(observer);
    const boundaryRunner = createTransactionRunner({
      acquireClient: async () => ({
        release: () => undefined,
        query: async (sql, values) => {
          const result = await observer.query(sql, values);
          if (sql.startsWith("RELEASE SAVEPOINT"))
            throw new Error("intentional acknowledgement loss");
          return result;
        },
      }),
      createRepositories: (client, scope) =>
        createMediaProcessingRepository(client, scope),
    });
    let boundaryRejected = false;
    try {
      await boundaryRunner.run(
        { schemaVersion: 1, isolationLevel: "READ_COMMITTED" },
        async (repo) => {
          try {
            await repo.enqueue(boundarySource.enqueue);
          } catch {
            /* Caller cannot erase the tracked failure. */
          }
          return { schemaVersion: 1, outcome: "SUCCESS" };
        },
      );
    } catch {
      boundaryRejected = true;
    }
    ok(
      boundaryRejected,
      "actual transaction rejects a caught boundary failure",
    );
    equal(
      (await read(boundarySource.enqueue.jobId)).code,
      "NOT_FOUND",
      "actual PostgreSQL writes rolled back after caller catch",
    );
    step = "concurrent claim and full evidence";
    const second = await seedMediaProcessingSource(observer, {
      role: "GIFT_PRIMARY",
    });
    success(await enqueue(second.enqueue), "second job");
    const claims = (await Promise.all([claim(), claim()])).map(
      (result, index) => success(result, `parallel claim ${index}`),
    );
    equal(
      new Set(claims.map((value) => value.jobId)).size,
      2,
      "concurrent claims never share a job",
    );
    equal((await claim()).outcome, "EMPTY", "active leases are excluded");
    for (const claimed of claims) {
      const receipt = createMediaProcessingDatabaseReceipt(claimed.command);
      equal(
        (await complete({ ...claimed, leaseToken: randomUUID() }, receipt))
          .code,
        "STALE_CLAIM",
        "wrong fencing token",
      );
      equal(
        (
          await complete(claimed, {
            ...receipt,
            variants: receipt.variants.slice(1),
          })
        ).code,
        "INVALID_COMMAND",
        "partial receipt rejected before persistence",
      );
      equal(
        (await complete(claimed, { ...receipt, commandHash: "0".repeat(64) }))
          .code,
        "CONFLICT",
        "receipt bound to canonical source recipe",
      );
      const finished = success(
        await withFinishClockRollback(
          () => complete(claimed, receipt),
          claimed.jobId,
          "SUCCEEDED",
        ),
        "complete validated metadata receipt",
      );
      equal(finished.status, "SUCCEEDED", "completed status");
      const asset = (
        await observer.query("SELECT * FROM public.media_assets WHERE id=$1", [
          finished.outputAssetId,
        ])
      ).rows[0];
      equal(asset.rights_status, "PENDING", "processing never approves rights");
      equal(asset.mime_type, "image/png", "canonical master format");
      equal(
        asset.rights_reference,
        `derived-source:${claimed.command.source.assetId}`,
        "safe derivation lineage",
      );
      equal(
        (
          await observer.query(
            "SELECT count(*)::integer AS count FROM public.media_metadata_revisions WHERE media_asset_id=$1",
            [finished.outputAssetId],
          )
        ).rows[0].count,
        0,
        "no fabricated approved metadata",
      );
      equal(
        (
          await observer.query(
            "SELECT count(*)::integer AS count FROM public.media_processing_outputs WHERE job_id=$1",
            [claimed.jobId],
          )
        ).rows[0].count,
        13,
        "one master plus twelve variant evidence rows",
      );
      equal(
        success(
          await complete(claimed, {
            ...receipt,
            variants: [...receipt.variants].reverse(),
          }),
          "complete replay with canonical ordering",
        ),
        finished,
        "duplicate complete returns exact stored result",
      );
      equal(
        (
          await complete(claimed, {
            ...receipt,
            master: { ...receipt.master, byteSize: 999 },
          })
        ).code,
        "CONFLICT",
        "successful history cannot be replaced",
      );
    }
    step = "one source across portrait and mobile hero masters";
    const portraitClaim = claims.find(
      (value) => value.command.role === "PORTRAIT",
    );
    const portraitReceipt = createMediaProcessingDatabaseReceipt(
      portraitClaim.command,
    );
    success(
      await enqueue({
        ...source.enqueue,
        jobId: randomUUID(),
        role: "HERO_MOBILE",
      }),
      "second role for the same original",
    );
    const mobileClaim = success(await claim(), "mobile role claim");
    const mobileReceipt = createMediaProcessingDatabaseReceipt(
      mobileClaim.command,
    );
    const portraitSmall = portraitReceipt.variants.find(
      (value) => value.format === "WEBP" && value.width === 320,
    );
    const mobileSmall = mobileReceipt.variants.find(
      (value) => value.format === "WEBP" && value.width === 320,
    );
    equal(
      mobileSmall.checksumSha256,
      portraitSmall.checksumSha256,
      "identical small image bytes across role masters",
    );
    ok(
      mobileSmall.objectKey !== portraitSmall.objectKey,
      "small outputs are scoped by canonical master checksum",
    );
    success(
      await complete(mobileClaim, mobileReceipt),
      "same source supports distinct role masters without key collision",
    );
    step = "checksum dedup and atomic conflict";
    const reuseSource = await seedMediaProcessingSource(observer);
    success(await enqueue(reuseSource.enqueue), "dedup source");
    const reuseClaim = success(await claim(), "dedup claim");
    const originalClaim = claims.find(
      (value) => value.command.role === "PORTRAIT",
    );
    const sameOutput = createMediaProcessingDatabaseReceipt(
      reuseClaim.command,
      { outputIdentity: originalClaim.command.source.checksumSha256 },
    );
    const previousOutput = success(
      await read(originalClaim.jobId),
      "original output",
    ).outputAssetId;
    await observer.query(
      "UPDATE public.media_assets SET rights_status='APPROVED' WHERE id=$1",
      [previousOutput],
    );
    equal(
      success(await complete(reuseClaim, sameOutput), "checksum reuse")
        .outputAssetId,
      previousOutput,
      "identical PNG reuses canonical asset",
    );
    equal(
      (
        await observer.query(
          "SELECT rights_status FROM public.media_assets WHERE id=$1",
          [previousOutput],
        )
      ).rows[0].rights_status,
      "APPROVED",
      "reuse preserves prior approval state",
    );
    step =
      "identical original and canonical PNG bytes retain separate identities";
    const sameByteSource = await seedMediaProcessingSource(observer, {
      mimeType: "image/png",
      width: 1200,
      height: 1200,
      byteSize: 5973,
      checksumSha256:
        "646ada3b42b4731621eb2d2d7f6f996a1570b5b00355ebb01d6063795aa3e1ac",
      objectKey: "sources/identity-collision.png",
      role: "GIFT_PRIMARY",
    });
    const sourceSnapshot = async () =>
      (
        await observer.query(
          "SELECT to_jsonb(asset.*) AS value FROM public.media_assets asset WHERE id=$1",
          [sameByteSource.sourceAssetId],
        )
      ).rows[0].value;
    const sameByteBefore = await sourceSnapshot();
    success(await enqueue(sameByteSource.enqueue), "same-byte PNG queued");
    const sameByteClaim = success(await claim(), "same-byte PNG claimed");
    const sameByteReceipt = createMediaProcessingDatabaseReceipt(
      sameByteClaim.command,
    );
    sameByteReceipt.master = {
      ...sameByteReceipt.master,
      checksumSha256: sameByteClaim.command.source.checksumSha256,
      objectKey: mediaProcessingObjectKey(
        sameByteClaim.command.source.checksumSha256,
        "PNG",
      ),
      byteSize: sameByteClaim.command.source.byteSize,
    };
    sameByteReceipt.variants = sameByteReceipt.variants.map((variant) => ({
      ...variant,
      objectKey: mediaProcessingObjectKey(
        variant.checksumSha256,
        variant.format,
        sameByteReceipt.master.checksumSha256,
      ),
    }));
    const sameByteFinished = success(
      await complete(sameByteClaim, sameByteReceipt),
      "same-byte PNG produces canonical master",
    );
    ok(
      sameByteFinished.outputAssetId !== sameByteSource.sourceAssetId,
      "binary identity is separate by operational purpose",
    );
    equal(
      await sourceSnapshot(),
      sameByteBefore,
      "same-byte processing preserves every source field including PENDING and rights",
    );
    equal(
      (
        await observer.query(
          "SELECT identity_kind FROM public.media_assets WHERE checksum_sha256=$1 ORDER BY identity_kind",
          [sameByteReceipt.master.checksumSha256],
        )
      ).rows.map((row) => row.identity_kind),
      ["PROCESSED_MASTER", "SOURCE"],
      "same bytes remain deduplicated independently by purpose",
    );
    const conflictSource = await seedMediaProcessingSource(observer);
    success(await enqueue(conflictSource.enqueue), "conflict source");
    const conflictClaim = success(await claim(), "conflict claim");
    const conflictReceipt = createMediaProcessingDatabaseReceipt(
      conflictClaim.command,
    );
    const collision = conflictReceipt.variants[5];
    await observer.query(
      `INSERT INTO public.media_variants(id,media_asset_id,format,width,height,byte_size,checksum_sha256,object_key,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'READY')`,
      [
        randomUUID(),
        conflictSource.sourceAssetId,
        collision.format,
        collision.width,
        collision.height,
        collision.byteSize,
        collision.checksumSha256,
        collision.objectKey,
      ],
    );
    const assetsBefore = Number(
      (
        await observer.query(
          "SELECT count(*) AS count FROM public.media_assets",
        )
      ).rows[0].count,
    );
    equal(
      (await complete(conflictClaim, conflictReceipt)).code,
      "CONFLICT",
      "late output key collision fails entire completion",
    );
    equal(
      Number(
        (
          await observer.query(
            "SELECT count(*) AS count FROM public.media_assets",
          )
        ).rows[0].count,
      ),
      assetsBefore,
      "failed completion rolls back inserted master",
    );
    equal(
      (
        await observer.query(
          "SELECT count(*)::integer AS count FROM public.media_processing_outputs WHERE job_id=$1",
          [conflictClaim.jobId],
        )
      ).rows[0].count,
      0,
      "failed completion leaves no partial output evidence",
    );
    equal(
      success(await read(conflictClaim.jobId), "conflicting job").status,
      "PROCESSING",
      "failed transaction retains active claim",
    );
    success(
      await fail(conflictClaim, { code: "OBJECT_CONFLICT", retryable: false }),
      "permanent failure",
    );
    equal(
      success(
        await fail(conflictClaim, {
          code: "OBJECT_CONFLICT",
          retryable: false,
        }),
        "failure replay",
      ).status,
      "FAILED",
      "failure replay is idempotent",
    );
    step = "normal-trigger guard rejection";
    async function rejects(sql, values, label, expected = "23514") {
      await observer.query("BEGIN");
      let code;
      try {
        await observer.query(sql, values);
        await observer.query("SET CONSTRAINTS ALL IMMEDIATE");
      } catch (error) {
        code = error.code;
      } finally {
        await observer.query("ROLLBACK");
      }
      equal(code, expected, label);
    }
    await rejects(
      "UPDATE public.media_processing_jobs SET fit='CONTAIN' WHERE id=$1",
      [job.jobId],
      "immutable recipe",
      "55000",
    );
    await rejects(
      "DELETE FROM public.media_processing_jobs WHERE id=$1",
      [job.jobId],
      "no processing history deletion",
      "55000",
    );
    await rejects(
      "DELETE FROM public.media_processing_outputs WHERE job_id=$1",
      [job.jobId],
      "output evidence immutable",
      "55000",
    );
    await rejects(
      "UPDATE public.media_processing_attempts SET error_code='INVALID_IMAGE',error_retryable=false WHERE job_id=$1",
      [job.jobId],
      "terminal attempt immutable",
      "55000",
    );
    await rejects(
      "UPDATE public.media_assets SET identity_kind='PROCESSED_MASTER' WHERE id=$1",
      [source.sourceAssetId],
      "source purpose cannot change",
      "55000",
    );
    await rejects(
      `INSERT INTO public.media_assets(id,identity_kind,checksum_sha256,mime_type,width,height,byte_size,object_key,processing_status,rights_status,rights_reference)
      SELECT gen_random_uuid(),identity_kind,checksum_sha256,mime_type,width,height,byte_size,'sources/duplicate-kind-fixture.png',processing_status,rights_status,rights_reference
      FROM public.media_assets WHERE id=$1`,
      [sameByteSource.sourceAssetId],
      "source checksum remains unique within purpose",
      "23505",
    );
    await rejects(
      `INSERT INTO public.media_assets(id,identity_kind,checksum_sha256,mime_type,width,height,byte_size,object_key,processing_status,rights_status,rights_reference)
      SELECT gen_random_uuid(),identity_kind,checksum_sha256,mime_type,width,height,byte_size,'processed/v1/duplicate-kind-fixture.png',processing_status,rights_status,rights_reference
      FROM public.media_assets WHERE id=$1`,
      [sameByteFinished.outputAssetId],
      "master checksum remains unique within purpose",
      "23505",
    );
    const derivedMetadata = randomUUID();
    await observer.query(
      `INSERT INTO public.media_metadata_revisions(id,media_asset_id,revision,lifecycle,presentation_kind,focal_x,focal_y,created_by)
      VALUES($1,$2,1,'DRAFT','INFORMATIVE',0.5,0.5,$3)`,
      [derivedMetadata, sameByteFinished.outputAssetId, source.requestedBy],
    );
    equal(
      (
        await enqueue({
          ...source.enqueue,
          jobId: randomUUID(),
          sourceAssetId: sameByteFinished.outputAssetId,
          metadataRevisionId: derivedMetadata,
          role: "GIFT_PRIMARY",
        })
      ).code,
      "SOURCE_NOT_ELIGIBLE",
      "generated master cannot become a source processing chain",
    );
    const forgery = await seedMediaProcessingSource(observer);
    const forgeryJob = success(await enqueue(forgery.enqueue), "forgery job");
    const forgeryClaim = success(await claim(), "forgery claim");
    await rejects(
      `UPDATE public.media_processing_jobs SET status='SUCCEEDED',output_asset_id=$2,result_hash=repeat('b',64),orientation=1,completed_at=statement_timestamp() WHERE id=$1`,
      [forgeryJob.jobId, previousOutput],
      "READY status alone cannot replace complete evidence",
    );
    success(
      await withFinishClockRollback(
        () => fail(forgeryClaim, { code: "INVALID_IMAGE", retryable: false }),
        forgeryClaim.jobId,
        "FAILED",
      ),
      "finish forgery test",
    );
    step = "source authority survives queued and active jobs";
    const revoked = await seedMediaProcessingSource(observer);
    success(await enqueue(revoked.enqueue), "source eligible at enqueue");
    await observer.query(
      "UPDATE public.media_assets SET rights_status='EXPIRED' WHERE id=$1",
      [revoked.sourceAssetId],
    );
    equal((await claim()).outcome, "EMPTY", "revoked source cannot be claimed");
    equal(
      success(await read(revoked.enqueue.jobId), "revoked queued job").status,
      "FAILED",
      "revocation terminalizes queued work",
    );
    const changed = await seedMediaProcessingSource(observer);
    success(await enqueue(changed.enqueue), "mutable authority fixture");
    const changedClaim = success(
      await claim(),
      "claim before rights revocation",
    );
    await rejects(
      "UPDATE public.media_metadata_revisions SET focal_x=0.25 WHERE id=$1",
      [changed.metadataRevisionId],
      "focal revisions remain immutable",
      "55000",
    );
    await observer.query(
      "UPDATE public.media_assets SET rights_status='REJECTED' WHERE id=$1",
      [changed.sourceAssetId],
    );
    equal(
      (
        await complete(
          changedClaim,
          createMediaProcessingDatabaseReceipt(changedClaim.command),
        )
      ).code,
      "SOURCE_NOT_ELIGIBLE",
      "completion rechecks source authority",
    );
    equal(
      (
        await observer.query(
          "SELECT count(*)::integer AS count FROM public.media_processing_outputs WHERE job_id=$1",
          [changedClaim.jobId],
        )
      ).rows[0].count,
      0,
      "revoked source creates no READY evidence",
    );
    success(
      await fail(changedClaim, { code: "SOURCE_CHANGED", retryable: false }),
      "acknowledge source revocation",
    );
    const archivedMasterSource = await seedMediaProcessingSource(observer);
    success(
      await enqueue(archivedMasterSource.enqueue),
      "archived master reuse fixture",
    );
    const archivedClaim = success(await claim(), "claim archived master reuse");
    await observer.query(
      "UPDATE public.media_assets SET processing_status='ARCHIVED' WHERE id=$1",
      [previousOutput],
    );
    const archivedReceipt = createMediaProcessingDatabaseReceipt(
      archivedClaim.command,
      { outputIdentity: originalClaim.command.source.checksumSha256 },
    );
    equal(
      (await complete(archivedClaim, archivedReceipt)).code,
      "CONFLICT",
      "checksum collision cannot revive archived master",
    );
    equal(
      (
        await observer.query(
          "SELECT processing_status FROM public.media_assets WHERE id=$1",
          [previousOutput],
        )
      ).rows[0].processing_status,
      "ARCHIVED",
      "archive status remains unchanged",
    );
    success(
      await fail(archivedClaim, { code: "OBJECT_CONFLICT", retryable: false }),
      "archive conflict acknowledged",
    );
    step = "bounded retry and actual lease expiry";
    const retrySource = await seedMediaProcessingSource(observer);
    success(await enqueue(retrySource.enqueue), "retry job");
    let retryClaim;
    for (let attempt = 1; attempt <= 4; attempt++) {
      retryClaim = success(await claim(), `retry claim ${attempt}`);
      equal(retryClaim.attempt, attempt, "monotonic attempt");
      const failed = success(
        await fail(retryClaim, {
          code: "STORAGE_UNAVAILABLE",
          retryable: true,
        }),
        "transient failure",
      );
      equal(failed.status, "PENDING", "retry is durable pending work");
      equal(
        (await claim()).outcome,
        "EMPTY",
        "database backoff blocks early claim",
      );
      await delay(
        Math.max(0, Date.parse(failed.nextAttemptAt) - Date.now()) + 80,
      );
    }
    retryClaim = success(await claim(), "fifth claim");
    console.log(
      "media PG: retry backoff passed; waiting for real lease expiration",
    );
    await delay(
      Math.max(0, Date.parse(retryClaim.leaseExpiresAt) - Date.now()) + 80,
    );
    const finalClaim = success(
      await claim(),
      "expired fifth claim is reclaimed",
    );
    equal(finalClaim.attempt, 6, "expired claim advances fencing generation");
    equal(
      (
        await complete(
          retryClaim,
          createMediaProcessingDatabaseReceipt(retryClaim.command),
        )
      ).code,
      "STALE_CLAIM",
      "expired worker cannot complete after reclaim",
    );
    console.log(
      "media PG: stale fencing passed; waiting for final lease exhaustion",
    );
    await delay(
      Math.max(0, Date.parse(finalClaim.leaseExpiresAt) - Date.now()) + 80,
    );
    equal(
      (
        await withFinishClockRollback(
          () => claim(),
          finalClaim.jobId,
          "EXPIRED",
        )
      ).outcome,
      "EMPTY",
      "final expired attempt cannot be reclaimed",
    );
    const exhausted = success(await read(finalClaim.jobId), "exhausted job");
    equal(exhausted.status, "FAILED", "sixth expired attempt terminates");
    equal(exhausted.attemptCount, 6, "finite attempts enforced");
    equal(
      exhausted.error,
      { code: "PROCESSING_TIMEOUT", retryable: true },
      "stable timeout reason retained",
    );
    equal(
      (
        await observer.query(
          "SELECT count(*)::integer AS count FROM public.media_processing_attempts WHERE job_id=$1",
          [finalClaim.jobId],
        )
      ).rows[0].count,
      6,
      "complete attempt history retained",
    );
    step = "rollback history and legacy evidence";
    let refused = false;
    try {
      await runMigrations({
        clientConfig,
        workspaceRoot,
        command: { direction: "down", confirmVersion: "0012" },
      });
    } catch {
      refused = true;
    }
    ok(refused, "migration refuses to delete new business processing history");
    equal(
      (
        await observer.query(
          "SELECT max(version) AS version FROM public.schema_migrations",
        )
      ).rows[0].version,
      "0012",
      "refused rollback is atomic",
    );
    equal(
      await oldState(),
      before,
      "legacy published media rows remain exact after processing",
    );
    console.log(
      `media PostgreSQL integration passed (${assertions} assertions; actual lease expiry; normal triggers; synthetic output metadata)`,
    );
  } finally {
    await persistence?.close();
    await observer.end();
  }
}
try {
  await withEphemeralPostgres(async (config) => {
    try {
      return await verify(config);
    } catch (error) {
      console.error(
        `media PG safe diagnostic: step=${step}; code=${error.code ?? error.name}; constraint=${error.constraint ?? "none"}; column=${error.column ?? "none"}; table=${error.table ?? "none"}`,
      );
      if (error instanceof assert.AssertionError) console.error(error.message);
      throw error;
    }
  });
} catch (error) {
  console.error(
    `media PostgreSQL integration failed at ${step}: ${error.code ?? error.name ?? "unknown"}`,
  );
  if (error instanceof assert.AssertionError) console.error(error.message);
  process.exitCode = 1;
}

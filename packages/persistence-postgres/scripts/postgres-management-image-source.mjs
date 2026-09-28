#!/usr/bin/env node
// Actual migrated PostgreSQL read/reuse checks. Replica-mode synthetic history deliberately permits
// corrupt ancestry negatives; this is NOT evidence of a normally published content or object pipeline.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";
import {
  readManagementImageSource,
  resolveManagementClaimImageSource,
} from "../dist/management-image-source.js";
import { hashMediaProcessingCommand } from "@fan-support/content";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const hash = (value) => createHash("sha256").update(value).digest("hex");
let assertions = 0,
  stage = "migrate";
const equal = (actual, expected, label) => {
  stage = label;
  assert.deepEqual(actual, expected, label);
  assertions++;
};
await withEphemeralPostgres(async (configuration) => {
  await runMigrations({
    clientConfig: configuration,
    workspaceRoot,
    command: { direction: "up" },
  });
  const client = new Client(configuration);
  await client.connect();
  const actor = randomUUID(),
    master = randomUUID(),
    masterHash = hash(master),
    masterKey = `processed/v1/${masterHash}.png`;
  async function seed(work) {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL session_replication_role=replica");
      await work();
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  async function asset(id, identity, checksum, key, width, height) {
    await client.query(
      "INSERT INTO public.media_assets(id,identity_kind,checksum_sha256,mime_type,width,height,byte_size,object_key,processing_status,rights_status,rights_reference) VALUES($1,$2,$3,'image/png',$4,$5,100,$6,'READY','APPROVED','synthetic focal reader fixture')",
      [id, identity, checksum, width, height, key],
    );
  }
  async function metadata(id, assetId, revision = 1) {
    await client.query(
      "INSERT INTO public.media_metadata_revisions(id,media_asset_id,revision,lifecycle,presentation_kind,focal_x,focal_y,created_by) VALUES($1,$2,$3,'SUPERSEDED','INFORMATIVE',0.5,0.3,$4)",
      [id, assetId, revision, actor],
    );
  }
  let previousPublication = null;
  async function lineage(metadataId, jobId, copied = null) {
    await client.query(
      "INSERT INTO public.daily_publication_revisions(revision_id,object_kind,object_id,source_locale,source_translation_id,document,document_hash,operation_id,actor_id,created_at,media_metadata_revision_id,processing_job_id,copied_from_metadata_revision_id) VALUES($1,'MEDIA_METADATA',$2,'en',$3,'{}',$4,$5,$6,now(),$1,$7,$8)",
      [
        metadataId,
        master,
        randomUUID(),
        hash(metadataId),
        randomUUID(),
        actor,
        jobId,
        copied,
      ],
    );
    const publicationId = randomUUID();
    await client.query(
      "INSERT INTO public.content_publications(id,content_type,media_asset_id,media_metadata_revision_id,action,translation_manifest_hash,approval_manifest_hash,media_manifest_hash,published_by,idempotency_key,proof_version,audit_log_id,replaces_publication_id) VALUES($1::uuid,'MEDIA_METADATA',$2,$3,'PUBLISH',$4,$4,$4,$5,$1::text,3,$1::uuid,$6)",
      [
        publicationId,
        master,
        metadataId,
        hash(metadataId),
        actor,
        previousPublication,
      ],
    );
    previousPublication = publicationId;
  }
  async function original(index) {
    const sourceId = randomUUID(),
      sourceMetadata = randomUUID(),
      jobId = randomUUID(),
      metadataId = randomUUID(),
      targetId = randomUUID(),
      revision = randomUUID();
    const checksum = hash(sourceId),
      objectKey = `uploads/${checksum}.png`;
    await asset(sourceId, "SOURCE", checksum, objectKey, 2400, 1600);
    await metadata(sourceMetadata, sourceId);
    const command = {
      schemaVersion: 1,
      profileVersion: 1,
      source: {
        assetId: sourceId,
        metadataRevisionId: sourceMetadata,
        checksumSha256: checksum,
        objectKey,
        mimeType: "image/png",
        width: 2400,
        height: 1600,
        byteSize: 100,
      },
      role: "PORTRAIT",
      fit: "COVER_ALLOW_ENLARGE",
      focalPoint: { x: 0.5, y: 0.3 },
    };
    await client.query(
      "INSERT INTO public.media_processing_jobs(id,source_asset_id,source_metadata_revision_id,source_checksum_sha256,profile_version,role,fit,focal_x,focal_y,command_hash,requested_by,reason,status,attempt_count,lease_token,lease_expires_at,output_asset_id,result_hash,orientation,completed_at,generation) VALUES($1,$2,$3,$4,1,'PORTRAIT','COVER_ALLOW_ENLARGE',0.5,0.3,$5,$6,'synthetic focal reader fixture','SUCCEEDED',1,$7,now()+interval '1 hour',$8,$9,6,now(),1)",
      [
        jobId,
        sourceId,
        sourceMetadata,
        checksum,
        hashMediaProcessingCommand(command),
        actor,
        randomUUID(),
        master,
        hash(jobId),
      ],
    );
    await client.query(
      "INSERT INTO public.media_processing_outputs(job_id,kind,format,media_asset_id,width,height,byte_size,checksum_sha256,object_key) VALUES($1,'MASTER','PNG',$2,1600,2000,100,$3,$4)",
      [jobId, master, masterHash, masterKey],
    );
    await metadata(metadataId, master, index);
    await lineage(metadataId, jobId);
    await client.query(
      "INSERT INTO public.idols(id,handle,status,version,published_revision_id) VALUES($1,$2,'active',2,$3)",
      [targetId, `focal-${index}`, revision],
    );
    await client.query(
      "INSERT INTO public.idol_revision_media(idol_revision_id,role,media_asset_id,media_metadata_revision_id,sort_order) VALUES($1,'PORTRAIT',$2,$3,0)",
      [revision, master, metadataId],
    );
    return {
      sourceId,
      sourceMetadata,
      jobId,
      metadataId,
      targetId,
      revision,
      target: { kind: "ARTIST", id: targetId, expectedVersion: 2 },
    };
  }
  let first, second;
  try {
    stage = "seed explicit synthetic lineage";
    await seed(async () => {
      await asset(
        master,
        "PROCESSED_MASTER",
        masterHash,
        masterKey,
        1600,
        2000,
      );
      first = await original(1);
      second = await original(2);
    });
    const read = () => readManagementImageSource(client, first.target);
    const initial = await read();
    equal(
      initial.outcome,
      "SUCCESS",
      "exact daily processing lineage resolves",
    );
    equal(
      initial.source.assetId,
      first.sourceId,
      "specific metadata selects first original of shared master",
    );
    equal(
      (await readManagementImageSource(client, second.target)).source.assetId,
      second.sourceId,
      "second metadata selects its own original",
    );
    equal(initial.orientation, 6, "EXIF orientation is read from exact job");
    equal(
      (
        await readManagementImageSource(client, {
          ...first.target,
          expectedVersion: 1,
        })
      ).code,
      "TARGET_CONFLICT",
      "stale target rejected before source",
    );
    const claim = {
      intent: {
        kind: "SAVE_ARTIST",
        id: first.targetId,
        expectedVersion: 2,
        image: {
          currentImage: initial.currentImage,
          focalPoint: { x: 0.1, y: 0.9 },
        },
      },
      operation: { targetId: first.targetId },
      checkpoint: { sourceAssetId: null },
    };
    equal(
      (await resolveManagementClaimImageSource(client, claim)).outcome,
      "SUCCESS",
      "reuse binds exact reference",
    );
    equal(
      (
        await resolveManagementClaimImageSource(client, {
          ...claim,
          intent: {
            ...claim.intent,
            image: {
              ...claim.intent.image,
              currentImage: {
                assetId: master,
                metadataRevisionId: second.metadataId,
              },
            },
          },
        })
      ).code,
      "TARGET_CONFLICT",
      "shared master does not authorize another metadata",
    );
    equal(
      (
        await resolveManagementClaimImageSource(client, {
          ...claim,
          checkpoint: { sourceAssetId: second.sourceId },
        })
      ).code,
      "TARGET_CONFLICT",
      "checkpoint cannot switch original",
    );
    const copy = randomUUID();
    await seed(async () => {
      await metadata(copy, master, 3);
      await lineage(copy, null, first.metadataId);
      await client.query(
        "UPDATE public.idol_revision_media SET media_metadata_revision_id=$1 WHERE idol_revision_id=$2",
        [copy, first.revision],
      );
    });
    equal(
      (await read()).source.assetId,
      first.sourceId,
      "text copy follows original lineage",
    );
    equal(
      (await read()).currentImage.metadataRevisionId,
      copy,
      "CAS identity remains current copy",
    );
    const mutate = async (sql, values, restore, restoreValues, label) => {
      await seed(() => client.query(sql, values));
      equal((await read()).code, "REUPLOAD_REQUIRED", label);
      await seed(() => client.query(restore, restoreValues));
    };
    await mutate(
      "UPDATE public.media_assets SET rights_status='EXPIRED' WHERE id=$1",
      [first.sourceId],
      "UPDATE public.media_assets SET rights_status='APPROVED' WHERE id=$1",
      [first.sourceId],
      "source rights revocation refuses preview and reuse",
    );
    await mutate(
      "UPDATE public.media_assets SET processing_status='ARCHIVED' WHERE id=$1",
      [first.sourceId],
      "UPDATE public.media_assets SET processing_status='READY' WHERE id=$1",
      [first.sourceId],
      "archived original refused",
    );
    await mutate(
      "UPDATE public.media_processing_jobs SET role='HERO_DESKTOP' WHERE id=$1",
      [first.jobId],
      "UPDATE public.media_processing_jobs SET role='PORTRAIT' WHERE id=$1",
      [first.jobId],
      "mismatched processing role refused",
    );
    const originalHash = (
      await client.query(
        "SELECT command_hash FROM public.media_processing_jobs WHERE id=$1",
        [first.jobId],
      )
    ).rows[0].command_hash;
    await mutate(
      "UPDATE public.media_processing_jobs SET command_hash=$1 WHERE id=$2",
      [hash("tampered"), first.jobId],
      "UPDATE public.media_processing_jobs SET command_hash=$1 WHERE id=$2",
      [originalHash, first.jobId],
      "tampered command digest refused",
    );
    await mutate(
      "UPDATE public.daily_publication_revisions SET copied_from_metadata_revision_id=$1 WHERE revision_id=$1",
      [copy],
      "UPDATE public.daily_publication_revisions SET copied_from_metadata_revision_id=$1 WHERE revision_id=$2",
      [first.metadataId, copy],
      "copy cycle refused",
    );
    await mutate(
      "UPDATE public.media_processing_outputs SET checksum_sha256=$1 WHERE job_id=$2",
      [hash("mismatch"), first.jobId],
      "UPDATE public.media_processing_outputs SET checksum_sha256=$1 WHERE job_id=$2",
      [masterHash, first.jobId],
      "master receipt mismatch refused",
    );
    await mutate(
      "UPDATE public.media_metadata_revisions SET lifecycle='ARCHIVED' WHERE id=$1",
      [first.sourceMetadata],
      "UPDATE public.media_metadata_revisions SET lifecycle='SUPERSEDED' WHERE id=$1",
      [first.sourceMetadata],
      "archived source metadata refused",
    );
    equal(
      (await read()).source.assetId,
      first.sourceId,
      "negative probes preserve original exact lineage",
    );
    console.log(
      JSON.stringify({
        status: "PASS",
        suite: "management-image-source",
        assertions,
        evidence:
          "real migrated PostgreSQL; synthetic replica-seeded lineage negatives; not publication or object evidence",
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        status: "FAIL",
        suite: "management-image-source",
        stage,
        code: error.code ?? error.name,
        message: error.message,
      }),
    );
    throw error;
  } finally {
    await client.end();
  }
});

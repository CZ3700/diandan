import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createMediaSourceInspector } from "@fan-support/media-image";
import { createS3MediaStorageAdapter } from "@fan-support/media-s3";
import { createWorkerMediaProcessingComposition } from "../../worker/dist/media-processing-composition.js";
import { createMediaProcessingWorkerRuntime } from "../../worker/dist/media-processing-runtime.js";

export function publicationMediaEnvironment(environment, s3) {
  return {
    ...environment,
    FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT: s3.endpoint,
    FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT: s3.endpoint,
    FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET: s3.sourceBucket,
    FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET: s3.derivativeBucket,
    FAN_SUPPORT_OBJECT_STORAGE_ACCESS_KEY_ID: s3.accessKeyId,
    FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY: s3.secretAccessKey,
    FAN_SUPPORT_OBJECT_STORAGE_MAX_UPLOAD_BYTES: "33554432",
  };
}
export function createPublicationMediaFixture(s3) {
  const storage = createS3MediaStorageAdapter({
    schemaVersion: 1,
    sourceBucket: s3.sourceBucket,
    derivativeBucket: s3.derivativeBucket,
    publicMediaOrigin: "https://media.example.invalid",
    maxUploadBytes: 33554432,
    region: "us-east-1",
    authentication: {
      mode: "static",
      endpoint: s3.endpoint,
      presignEndpoint: s3.endpoint,
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
      forcePathStyle: true,
    },
  });
  return {
    storage,
    inspector: createMediaSourceInspector({ storage, now: () => new Date() }),
  };
}
export async function verifyPublicationMedia({
  request,
  publish,
  check,
  fixtures,
  observer,
  storage,
  environment,
  logger,
  secrets,
}) {
  const resources = "/api/v1/admin/resources",
    authoring = "/api/v1/admin/content-authoring",
    review = "/api/v1/admin/content-review";
  const bytes = await sharp({
    create: {
      width: 1800,
      height: 1400,
      channels: 3,
      background: { r: 46, g: 73, b: 105 },
    },
  })
    .withMetadata({ orientation: 6 })
    .jpeg({ quality: 85 })
    .toBuffer();
  const grant = await request(
    resources + "/uploads/begin",
    {
      schemaVersion: 1,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.length,
      mimeType: "image/jpeg",
      rightsReference: "rights:publication-synthetic-source",
      expectedVersion: 0,
      reasonCode: "HTTP_PUBLICATION_MEDIA",
    },
    { key: randomUUID() },
  );
  check(
    grant.kind === "UPLOAD_GRANT",
    "actual media upload has a scoped signed grant",
  );
  secrets.push(grant.grant.url);
  check(
    grant.grant.headers["x-amz-checksum-sha256"] ===
      createHash("sha256").update(bytes).digest("base64") &&
      grant.grant.headers["if-none-match"] === "*",
    "real S3 signature binds checksum and prevents overwrite",
  );
  const put = await globalThis.fetch(grant.grant.url, {
    method: "PUT",
    headers: grant.grant.headers,
    body: bytes,
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  await put.body?.cancel();
  check(
    put.status === 200,
    "strict TLS S3 receives actual uploaded source bytes",
  );
  const registered = await request(
    resources + "/uploads/complete",
    {
      schemaVersion: 1,
      uploadId: grant.uploadId,
      expectedVersion: 1,
      reasonCode: "HTTP_PUBLICATION_MEDIA",
    },
    { key: randomUUID() },
  );
  const sourceId = registered.resultId;
  async function author(assetId) {
    const owner = { kind: "MEDIA_METADATA", mediaAssetId: assetId };
    const created = await request(
      authoring + "/create",
      {
        schemaVersion: 1,
        target: owner,
        content: fixtures.content.media,
        expectedVersion: 0,
        reasonCode: "HTTP_PUBLICATION_MEDIA",
      },
      { key: randomUUID() },
    );
    for (const locale of SUPPORTED_LOCALES)
      for (const action of ["submit", "approve"]) {
        const target = { owner, revisionId: created.resultId, locale };
        const read = await request(review + "/read", {
          schemaVersion: 1,
          target,
        });
        await request(
          review + "/" + action,
          {
            schemaVersion: 1,
            target,
            expectedVersion: read.context.audit.reviewSequence,
            expectedContentHash: read.context.audit.sourceHash,
            expectedSourceHash: read.context.currentEnglishSourceHash,
            reasonCode: "HTTP_PUBLICATION_MEDIA",
          },
          {
            key: randomUUID(),
            actor: action === "approve" ? "reviewer" : "editor",
          },
        );
      }
    return { owner, revisionId: created.resultId };
  }
  const sourceMetadata = await author(sourceId);
  const approveRights = (
    assetId,
    expectedVersion = 0,
    rightsStatus = "APPROVED",
  ) =>
    request(
      resources + "/media/rights",
      {
        schemaVersion: 1,
        assetId,
        expectedVersion,
        rightsStatus,
        evidenceReference: "rights:independent-publication-evidence",
        reasonCode: "HTTP_PUBLICATION_MEDIA",
      },
      { key: randomUUID() },
    );
  await approveRights(sourceId);
  const enqueued = await request(
    resources + "/processing/enqueue",
    {
      schemaVersion: 1,
      sourceAssetId: sourceId,
      metadataRevisionId: sourceMetadata.revisionId,
      role: "GIFT_PRIMARY",
      fit: "CONTAIN",
      expectedVersion: 0,
      reasonCode: "HTTP_PUBLICATION_MEDIA",
    },
    { key: randomUUID() },
  );
  let runtime;
  const worker = await createWorkerMediaProcessingComposition(environment, {
    logger,
    factories: {
      createRuntime: (options) => {
        runtime = createMediaProcessingWorkerRuntime({
          ...options,
          schedule: () => ({ cancel() {} }),
        });
        return runtime;
      },
    },
  });
  try {
    await worker.start();
    await runtime.runOnce();
  } finally {
    await worker.stop();
  }
  const processed = await request(resources + "/processing/read", {
    schemaVersion: 1,
    jobId: enqueued.resultId,
  });
  check(
    processed.job.snapshot.status === "SUCCEEDED",
    "durable actual image worker processes the HTTP-enqueued source",
  );
  const masterId = processed.job.snapshot.outputAssetId;
  await approveRights(masterId);
  const masterTarget = await author(masterId);
  const readiness = await request(
    "/api/v1/admin/content/publication/preflight",
    { schemaVersion: 1, target: masterTarget, action: "PUBLISH" },
  );
  check(
    readiness.ready,
    "actual master is publishable before source rights revocation",
  );
  await approveRights(sourceId, 1, "REJECTED");
  const rejected = await request(
    "/api/v1/admin/content/publication/validate",
    {
      schemaVersion: 1,
      target: masterTarget,
      expectedVersion: readiness.headVersion,
      expectedContentHash: readiness.contentHash,
      reasonCode: "HTTP_PUBLICATION_RECHECK",
    },
    { key: randomUUID(), status: 409 },
  );
  check(
    rejected.code === "PUBLICATION_BLOCKED",
    "publish mutation repeats current source rights gate after prior readiness",
  );
  await approveRights(sourceId, 2);
  const publication = await publish(masterTarget);
  const outputs = (
    await observer.query(
      "SELECT object_key,checksum_sha256,byte_size,width,height FROM public.media_variants WHERE media_asset_id=$1 AND status='READY'",
      [masterId],
    )
  ).rows;
  check(
    outputs.length === 12,
    "actual processor stores twelve ready responsive variants",
  );
  for (const locale of SUPPORTED_LOCALES) {
    const published = await request(
      `/api/v1/media/${masterId}?locale=${locale}`,
      undefined,
      { method: "GET" },
    );
    check(
      published.publication.id === publication.publicationId &&
        published.content.kind === "MEDIA_METADATA",
      "actual processed metadata is publicly selected from its v2 manifest",
    );
    const view = published.content.view;
    const selected = outputs.find(
      (entry) =>
        new globalThis.URL(view.url).pathname === "/" + entry.object_key,
    );
    check(
      Boolean(selected),
      "public globalThis.URL resolves an actual approved derivative recorded by the image worker",
    );
    const download = await storage.createDownloadGrant({
      schemaVersion: 1,
      operation: "CREATE_DOWNLOAD_GRANT",
      storageClass: "DERIVATIVE",
      objectKey: selected.object_key,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    });
    check(
      download.outcome === "SUCCESS",
      "actual derivative receives a private read grant",
    );
    secrets.push(download.value.url);
    const response = await globalThis.fetch(download.value.url, {
      signal: globalThis.AbortSignal.timeout(15_000),
    });
    check(
      response.status === 200,
      "strict TLS GET retrieves published derivative bytes",
    );
    const decodedBytes = Buffer.from(await response.arrayBuffer());
    check(
      createHash("sha256").update(decodedBytes).digest("hex") ===
        selected.checksum_sha256 &&
        decodedBytes.length === Number(selected.byte_size),
      "actual derivative bytes match immutable PostgreSQL checksum and size",
    );
    const decoded = await sharp(decodedBytes).metadata();
    check(
      decoded.width === view.width &&
        decoded.height === view.height &&
        !decoded.exif &&
        !decoded.icc &&
        !decoded.xmp &&
        !decoded.orientation,
      "public geometry matches sanitized derivative without source metadata",
    );
  }
  await approveRights(sourceId, 3, "REJECTED");
  await request(`/api/v1/media/${masterId}?locale=en`, undefined, {
    method: "GET",
    status: 503,
  });
  await approveRights(sourceId, 4);
  await request(`/api/v1/media/${masterId}?locale=en`, undefined, {
    method: "GET",
  });
  return publication.publicationId;
}

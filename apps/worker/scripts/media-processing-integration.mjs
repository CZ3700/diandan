#!/usr/bin/env node
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import sharp from "sharp";
import { createMediaImageProcessor } from "@fan-support/media-image";
import { createS3MediaStorageAdapter } from "@fan-support/media-s3";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "@fan-support/persistence-postgres";
import { createWorkerMediaProcessingComposition } from "../dist/media-processing-composition.js";
import { createMediaProcessingWorkerRuntime } from "../dist/media-processing-runtime.js";
import { seedMediaProcessingSource } from "../../../packages/persistence-postgres/scripts/postgres-media-processing-fixtures.mjs";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const runnerArgument = "--run-media-worker";
let stage = "setup";
let assertions = 0;
function check(condition, message) {
  assertions += 1;
  assert.ok(condition, message);
}
function successful(response, label) {
  check(response.outcome === "SUCCESS", label);
  return response.value;
}

function runtimeEnvironment(database, s3) {
  const url = new URL("postgresql://localhost");
  url.hostname = database.host;
  url.port = String(database.port);
  url.pathname = `/${database.database}`;
  url.username = database.user;
  url.password = database.password;
  return {
    FAN_SUPPORT_DATABASE_URL: url.href,
    FAN_SUPPORT_DEPLOYMENT_ENV: "development",
    FAN_SUPPORT_OBJECT_STORAGE_AUTH_MODE: "static",
    FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT: s3.endpoint,
    FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT: s3.endpoint,
    FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET: s3.sourceBucket,
    FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET: s3.derivativeBucket,
    FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN:
      "https://media.example.invalid",
    FAN_SUPPORT_OBJECT_STORAGE_MAX_UPLOAD_BYTES: "33554432",
    FAN_SUPPORT_OBJECT_STORAGE_REGION: "us-east-1",
    FAN_SUPPORT_OBJECT_STORAGE_ACCESS_KEY_ID: s3.accessKeyId,
    FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY: s3.secretAccessKey,
    FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
  };
}

function testStorage(config) {
  return createS3MediaStorageAdapter({
    schemaVersion: 1,
    sourceBucket: config.sourceBucket,
    derivativeBucket: config.derivativeBucket,
    publicMediaOrigin: "https://media.example.invalid",
    maxUploadBytes: 33554432,
    region: "us-east-1",
    authentication: {
      mode: "static",
      endpoint: config.endpoint,
      presignEndpoint: config.endpoint,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      forcePathStyle: true,
    },
  });
}

async function imageBytes(variation) {
  const width = 1800;
  const height = 1400;
  const data = Buffer.alloc(width * height * 3);
  const colors = [
    [220 - variation, 30, 40],
    [20, 200 - variation, 30],
    [20, 40, 220 - variation],
  ];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const color = colors[Math.floor(x / 600)];
      const offset = (y * width + x) * 3;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
    }
  return sharp(data, { raw: { width, height, channels: 3 } })
    .withMetadata({ orientation: 6 })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function registerSource(observer, storage, variation) {
  const square = variation === "UNCHANGED_SQUARE";
  const bytes = square
    ? await sharp({
        create: {
          width: 1200,
          height: 1200,
          channels: 3,
          background: "#203050",
        },
      })
        .png({ compressionLevel: 9 })
        .toBuffer()
    : await imageBytes(variation);
  const mimeType = square ? "image/png" : "image/jpeg";
  const metadata = await sharp(bytes).metadata();
  check(
    square
      ? metadata.orientation === undefined &&
          metadata.width === 1200 &&
          metadata.height === 1200
      : metadata.orientation === 6 &&
          metadata.width === 1800 &&
          metadata.height === 1400,
    "fixture contains its intended encoded dimensions and orientation",
  );
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  const objectKey = `source/media-worker/${randomUUID()}.${square ? "png" : "jpg"}`;
  const upload = successful(
    await storage.createUploadGrant({
      schemaVersion: 1,
      operation: "CREATE_UPLOAD_GRANT",
      storageClass: "SOURCE",
      objectKey,
      checksumSha256,
      byteSize: bytes.byteLength,
      mimeType,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }),
    "real source upload grant",
  );
  const response = await globalThis.fetch(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body: bytes,
  });
  await response.body?.cancel();
  check(response.ok, "real source uploaded through TLS S3");
  return seedMediaProcessingSource(observer, {
    checksumSha256,
    objectKey,
    byteSize: bytes.byteLength,
    mimeType,
    width: metadata.width,
    height: metadata.height,
    role: "GIFT_PRIMARY",
    fit: square ? "COVER" : "CONTAIN",
  });
}

async function waitUntil(predicate, description, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(description);
}

async function verifyOutputs(observer, storage, snapshot, square = false) {
  const rows = (
    await observer.query(
      "SELECT * FROM public.media_processing_outputs WHERE job_id=$1 ORDER BY kind,format,width",
      [snapshot.jobId],
    )
  ).rows;
  check(
    rows.length === 13,
    "one master plus twelve responsive outputs persisted",
  );
  for (const row of rows) {
    const download = successful(
      await storage.createDownloadGrant({
        schemaVersion: 1,
        operation: "CREATE_DOWNLOAD_GRANT",
        storageClass: row.kind === "MASTER" ? "SOURCE" : "DERIVATIVE",
        objectKey: row.object_key,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
      "stored output download grant",
    );
    const response = await globalThis.fetch(download.url, {
      headers: download.headers,
    });
    check(response.ok, "stored output is available over TLS");
    const bytes = Buffer.from(await response.arrayBuffer());
    check(
      bytes.byteLength === Number(row.byte_size),
      "stored output byte count agrees with PostgreSQL",
    );
    check(
      createHash("sha256").update(bytes).digest("hex") === row.checksum_sha256,
      "stored output checksum agrees with PostgreSQL",
    );
    const metadata = await sharp(bytes).metadata();
    const decoded = await sharp(bytes)
      .raw()
      .toBuffer({ resolveWithObject: true });
    check(
      metadata.width === row.width &&
        metadata.height === row.height &&
        decoded.info.width === row.width &&
        decoded.info.height === row.height,
      "output pixels independently decode to recorded geometry",
    );
    check(
      metadata.exif === undefined &&
        metadata.icc === undefined &&
        metadata.xmp === undefined &&
        metadata.iptc === undefined &&
        metadata.orientation === undefined,
      "output strips source EXIF and metadata",
    );
    check(
      metadata.format ===
        { PNG: "png", JPEG: "jpeg", WEBP: "webp", AVIF: "heif" }[row.format],
      "output format independently verified",
    );
    if (row.kind === "MASTER") {
      const pixel = (x, y) => [
        ...decoded.data.subarray(
          (y * row.width + x) * decoded.info.channels,
          (y * row.width + x) * decoded.info.channels + 3,
        ),
      ];
      if (square) {
        check(
          JSON.stringify(pixel(0, 0)) === JSON.stringify([32, 48, 80]),
          "unchanged square retains exact source pixels",
        );
      } else {
        check(
          JSON.stringify(pixel(0, 0)) === JSON.stringify([18, 18, 22]),
          "contain uses the qualified neutral canvas",
        );
        check(
          pixel(600, 100)[0] > 190 &&
            pixel(600, 600)[1] > 170 &&
            pixel(600, 1100)[2] > 190,
          "EXIF rotation becomes real correctly oriented image pixels",
        );
      }
    }
  }
  const output = (
    await observer.query(
      "SELECT processing_status,rights_status FROM public.media_assets WHERE id=$1",
      [snapshot.outputAssetId],
    )
  ).rows[0];
  check(
    output.processing_status === "READY" && output.rights_status === "PENDING",
    "byte processing never forges editorial rights approval",
  );
  check(
    Number(
      (
        await observer.query(
          "SELECT count(*) FROM public.media_metadata_revisions WHERE media_asset_id=$1",
          [snapshot.outputAssetId],
        )
      ).rows[0].count,
    ) === 0,
    "processing cannot fabricate a reviewed publication revision",
  );
}

async function verify(database, s3) {
  stage = "migrations";
  await runMigrations({
    clientConfig: database,
    workspaceRoot,
    command: { direction: "up" },
  });
  const observer = new Client(database);
  const maintenance = new Client({ ...database, database: "postgres" });
  await observer.connect();
  await maintenance.connect();
  const persistence = createPostgresPersistence({
    ...database,
    application_name: "media-worker-harness-observer",
    connectionTimeoutMillis: 1000,
  });
  const transactions = persistence.mediaProcessingTransactionManager;
  const invoke = (method, command) =>
    transactions.runInMediaProcessingTransaction(({ mediaProcessing }) =>
      mediaProcessing[method](command),
    );
  const read = async (jobId) => {
    const response = await invoke("read", { schemaVersion: 1, jobId });
    assert.equal(response.outcome, "SUCCESS", "durable snapshot available");
    return response.value;
  };
  const storage = testStorage(s3);
  const outcomes = [];
  let failNextUpload = false;
  let injectedFailures = 0;
  let stopped = false;
  let composition;
  let databaseDisabled = false;
  let expiredSourceId;
  let heldReceipt;
  let releaseHeld;
  let cleanupStarted = false;
  let cleanupFailed;
  let recoveryJobId;
  const databaseIdentifier = `"${database.database.replaceAll('"', '""')}"`;
  try {
    stage = "source registration and durable enqueue";
    const first = await registerSource(observer, storage, 0);
    const firstJob = successful(
      await invoke("enqueue", first.enqueue),
      "first processing job enqueued",
    );
    const before = (
      await observer.query(
        "SELECT to_jsonb(a) AS asset FROM public.media_assets a WHERE id=$1",
        [first.sourceAssetId],
      )
    ).rows[0].asset;
    const duplicate = successful(
      await invoke("enqueue", { ...first.enqueue, jobId: randomUUID() }),
      "duplicate recipe deduplicated",
    );
    check(
      duplicate.jobId === firstJob.jobId,
      "duplicate submissions reuse one durable job",
    );
    const makeComposition = () =>
      createWorkerMediaProcessingComposition(runtimeEnvironment(database, s3), {
        factories: {
          createPersistence: (config, options) =>
            createPostgresPersistence(
              { ...config, connectionTimeoutMillis: 1000 },
              options,
            ),
          createProcessor: (options) => {
            const real = createMediaImageProcessor({
              ...options,
              fetch: async (url, init) => {
                if (failNextUpload && init?.method === "PUT") {
                  failNextUpload = false;
                  injectedFailures += 1;
                  return new globalThis.Response("", { status: 503 });
                }
                return globalThis.fetch(url, init);
              },
            });
            return {
              async process(command) {
                const receipt = await real.process(command);
                if (
                  !cleanupStarted &&
                  command.source.assetId === expiredSourceId &&
                  receipt.outcome === "SUCCESS"
                ) {
                  heldReceipt = receipt;
                  await new Promise((resolve) => {
                    releaseHeld = resolve;
                  });
                }
                return receipt;
              },
            };
          },
          createRuntime: (options) =>
            createMediaProcessingWorkerRuntime({
              ...options,
              onResult: (result) => {
                outcomes.push(result.outcome);
                options.onResult?.(result);
              },
            }),
        },
      });
    composition = await makeComposition();
    stage = "production composition consumes persisted job and real bytes";
    await composition.start();
    await waitUntil(
      async () => (await read(firstJob.jobId)).status === "SUCCEEDED",
      "first worker job timed out",
    );
    const firstResult = await read(firstJob.jobId);
    check(
      firstResult.attemptCount >= 1 && firstResult.attemptCount <= 6,
      "ordinary processing commits within its durable attempt limit",
    );
    stage = "first output independent byte verification";
    await verifyOutputs(observer, storage, firstResult);
    const after = (
      await observer.query(
        "SELECT to_jsonb(a) AS asset FROM public.media_assets a WHERE id=$1",
        [first.sourceAssetId],
      )
    ).rows[0].asset;
    check(
      JSON.stringify(after) === JSON.stringify(before),
      "processing preserves original source identity and review state",
    );
    check(
      (await invoke("enqueue", first.enqueue)).value.outputAssetId ===
        firstResult.outputAssetId,
      "duplicate after success returns same canonical output",
    );

    stage = "transient storage fault and durable retry";
    const retry = await registerSource(observer, storage, 2);
    const retryStart = outcomes.length;
    failNextUpload = true;
    const retryJob = successful(
      await invoke("enqueue", retry.enqueue),
      "retry job enqueued",
    );
    await waitUntil(
      () =>
        Promise.resolve(
          injectedFailures === 1 &&
            outcomes.slice(retryStart).includes("RETRY_SCHEDULED"),
        ),
      "storage retry not observed",
    );
    check(
      injectedFailures === 1,
      "one HTTP 503 injected at actual image upload boundary",
    );
    await waitUntil(
      async () => (await read(retryJob.jobId)).status === "SUCCEEDED",
      "storage retry did not recover",
    );
    const retryResult = await read(retryJob.jobId);
    check(
      retryResult.attemptCount >= 2 && retryResult.attemptCount <= 6,
      "storage failure keeps one durable retry and succeeds",
    );
    await verifyOutputs(observer, storage, retryResult);

    stage = "database outage and same worker recovery";
    const outageStart = outcomes.length;
    await maintenance.query(
      `ALTER DATABASE ${databaseIdentifier} ALLOW_CONNECTIONS false`,
    );
    databaseDisabled = true;
    stage = "database outage: terminate worker connections";
    await maintenance.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND application_name=$2",
      [database.database, "fan-support-media-worker"],
    );
    stage = "database outage: observe unavailable outcome";
    await waitUntil(
      () =>
        Promise.resolve(outcomes.slice(outageStart).includes("UNAVAILABLE")),
      "worker did not contain database outage",
      10_000,
    );
    stage = "database recovery: restore connections";
    await maintenance.query(
      `ALTER DATABASE ${databaseIdentifier} ALLOW_CONNECTIONS true`,
    );
    databaseDisabled = false;
    stage = "database recovery: register source";
    const recovered = await registerSource(observer, storage, 3);
    stage = "database recovery: enqueue source";
    const recoveredJob = successful(
      await invoke("enqueue", recovered.enqueue),
      "database recovery job enqueued",
    );
    recoveryJobId = recoveredJob.jobId;
    stage = "database recovery: same worker consumes queued job";
    await waitUntil(
      async () => (await read(recoveredJob.jobId)).status === "SUCCEEDED",
      "same worker did not recover database connection",
    );
    const recoveredResult = await read(recoveredJob.jobId);
    check(
      recoveredResult.attemptCount >= 1 && recoveredResult.attemptCount <= 6,
      "unavailable database did not lose or fabricate a claim",
    );

    stage = "identical source and master bytes preserve separate identities";
    const unchanged = await registerSource(
      observer,
      storage,
      "UNCHANGED_SQUARE",
    );
    const unchangedBefore = (
      await observer.query(
        "SELECT to_jsonb(a) AS asset FROM public.media_assets a WHERE id=$1",
        [unchanged.sourceAssetId],
      )
    ).rows[0].asset;
    const unchangedJob = successful(
      await invoke("enqueue", unchanged.enqueue),
      "unchanged PNG job enqueued",
    );
    await waitUntil(
      async () => (await read(unchangedJob.jobId)).status === "SUCCEEDED",
      "identical source/master bytes failed to complete",
    );
    const unchangedResult = await read(unchangedJob.jobId);
    const unchangedAfter = (
      await observer.query(
        "SELECT to_jsonb(a) AS asset FROM public.media_assets a WHERE id=$1",
        [unchanged.sourceAssetId],
      )
    ).rows[0].asset;
    const unchangedMaster = (
      await observer.query("SELECT * FROM public.media_assets WHERE id=$1", [
        unchangedResult.outputAssetId,
      ])
    ).rows[0];
    check(
      JSON.stringify(unchangedBefore) === JSON.stringify(unchangedAfter),
      "same-byte processing does not rewrite any source field",
    );
    check(
      unchangedBefore.checksum_sha256 === unchangedMaster.checksum_sha256,
      "actual encoder produced identical source and master bytes",
    );
    check(
      unchangedBefore.id !== unchangedMaster.id &&
        unchangedBefore.object_key !== unchangedMaster.object_key,
      "source and processed master retain distinct canonical identities and keys",
    );
    check(
      unchangedBefore.identity_kind === "SOURCE" &&
        unchangedMaster.identity_kind === "PROCESSED_MASTER",
      "database scopes checksum deduplication by source/master identity",
    );
    await verifyOutputs(observer, storage, unchangedResult, true);

    stage = "actual expired lease reclaim and fencing";
    await composition.stop();
    const expired = await registerSource(observer, storage, 1);
    expiredSourceId = expired.sourceAssetId;
    const expiredJob = successful(
      await invoke("enqueue", expired.enqueue),
      "lease recovery job enqueued",
    );
    const oldClaim = successful(
      await invoke("claim", {
        schemaVersion: 1,
        leaseToken: randomUUID(),
        leaseSeconds: 60,
      }),
      "real 60 second lease acquired",
    );
    check(
      oldClaim.jobId === expiredJob.jobId,
      "expired lease belongs to registered source",
    );
    composition = await makeComposition();
    await composition.start();
    process.stdout.write(
      "media worker: real bytes and storage/database recovery passed; awaiting actual lease expiry\n",
    );
    await waitUntil(
      () => Promise.resolve(heldReceipt !== undefined),
      "expired lease was not reclaimed",
      120_000,
    );
    const during = await read(expiredJob.jobId);
    check(
      during.status === "PROCESSING" &&
        during.attemptCount >= 2 &&
        during.attemptCount <= 6,
      "worker reclaims only after real PostgreSQL lease expiry",
    );
    check(
      (
        await observer.query(
          "SELECT status FROM public.media_processing_attempts WHERE job_id=$1 AND attempt_number=1",
          [expiredJob.jobId],
        )
      ).rows[0].status === "EXPIRED",
      "original lease was durably recorded as expired",
    );
    const stale = await invoke("complete", {
      schemaVersion: 1,
      jobId: oldClaim.jobId,
      leaseToken: oldClaim.leaseToken,
      result: heldReceipt,
    });
    check(
      stale.outcome === "FAILURE" && stale.code === "STALE_CLAIM",
      "old lease cannot finalize newer real image processing",
    );
    stage = "shutdown drains successful in-flight work";
    const stop = composition.stop().then(() => {
      stopped = true;
    });
    await delay(25);
    check(
      !stopped,
      "shutdown waits while a claimed processing receipt is in flight",
    );
    releaseHeld();
    await stop;
    const expiredResult = await read(expiredJob.jobId);
    check(
      expiredResult.status === "SUCCEEDED" &&
        expiredResult.attemptCount === during.attemptCount,
      "in-flight claim commits before shutdown closes the pool",
    );
    await verifyOutputs(observer, storage, expiredResult);
    check(
      outcomes.includes("SUCCEEDED") &&
        outcomes.includes("RETRY_SCHEDULED") &&
        outcomes.includes("UNAVAILABLE"),
      "actual runtime reports expected durable outcomes",
    );
    process.stdout.write(
      `Media worker PostgreSQL + TLS S3 integration passed (${assertions} assertions; real image bytes, 13 outputs per image, same-byte source/master isolation, durable retries, real lease fencing, database recovery and draining shutdown; attempts=${firstResult.attemptCount}/${retryResult.attemptCount}/${recoveredResult.attemptCount}/${unchangedResult.attemptCount}/${expiredResult.attemptCount}).\n`,
    );
  } catch (error) {
    if (stage.startsWith("database ")) {
      const snapshot =
        recoveryJobId === undefined
          ? undefined
          : await observer
              .query(
                `SELECT status, attempt_count, error_code,
          greatest(0, floor(extract(epoch FROM (lease_expires_at - clock_timestamp()))))::integer AS lease_remaining_seconds
          FROM public.media_processing_jobs WHERE id = $1`,
                [recoveryJobId],
              )
              .then((result) => result.rows[0])
              .catch(() => undefined);
      process.stderr.write(
        `${JSON.stringify({
          stage,
          failureKind: [
            "Error",
            "TypeError",
            "PersistenceTransactionFailureError",
          ].includes(error?.name)
            ? error.name
            : "OTHER",
          outcomes: outcomes.slice(-8),
          ...(snapshot === undefined ? {} : { snapshot }),
        })}\n`,
      );
    }
    if (error instanceof assert.AssertionError)
      process.stderr.write(`media worker assertion: ${error.message}\n`);
    throw error;
  } finally {
    cleanupStarted = true;
    releaseHeld?.();
    if (databaseDisabled)
      await maintenance
        .query(`ALTER DATABASE ${databaseIdentifier} ALLOW_CONNECTIONS true`)
        .catch(() => undefined);
    const cleanup = await Promise.allSettled([
      composition?.stop(),
      persistence.close(),
      observer.end(),
      maintenance.end(),
    ]);
    cleanupFailed = cleanup.some((entry) => entry.status === "rejected");
  }
  if (cleanupFailed) throw new Error("Media integration cleanup failed");
}

if (process.argv[2] === runnerArgument) {
  try {
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    await withEphemeralPostgres((database) => verify(database, s3));
    process.exit(0);
  } catch {
    process.stderr.write(
      `Media worker integration failed at ${stage}; provider details suppressed.\n`,
    );
    process.exit(1);
  }
} else {
  try {
    await withEphemeralS3((config) =>
      runS3IntegrationChild({
        ...config,
        scriptUrl: import.meta.url,
        argument: runnerArgument,
        timeoutMs: 300_000,
      }),
    );
  } catch {
    process.stderr.write(
      "Media worker integration or ephemeral resource cleanup failed.\n",
    );
    process.exitCode = 1;
  }
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, request as httpsRequest } from "node:https";
import path from "node:path";
import { Buffer } from "node:buffer";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { MEDIA_FRAMING_MASTER_SIZES } from "@fan-support/contracts";
import { workspaceMediaContent } from "./admin-workspace-fixtures.mjs";
import { createStorefrontTestCertificate } from "./storefront-test-network.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Explicit synthetic matte composition: never resample or relabel the source photograph. */
export async function createMatteFixture(sourcePath, role) {
  const original = await readFile(sourcePath);
  const normalized = await sharp(original)
    .rotate()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = normalized.info;
  const minimum = MEDIA_FRAMING_MASTER_SIZES[role];
  const target = {
    width: Math.max(width, minimum.width),
    height: Math.max(height, minimum.height),
  };
  const left = Math.floor((target.width - width) / 2);
  const top = Math.floor((target.height - height) / 2);
  const bytes = await sharp({
    create: { ...target, channels: 3, background: { r: 18, g: 18, b: 22 } },
  })
    .composite([
      { input: normalized.data, raw: { width, height, channels }, left, top },
    ])
    .png()
    .toBuffer();
  const extracted = await sharp(bytes)
    .extract({ left, top, width, height })
    .removeAlpha()
    .raw()
    .toBuffer();
  assert.equal(
    digest(extracted),
    digest(normalized.data),
    "matte preserves every decoded original photograph pixel without enlargement",
  );
  return {
    bytes,
    provenance: {
      schemaVersion: 1,
      kind: "SYNTHETIC_TEST_MATTE",
      role,
      sourceSha256: digest(original),
      composedSha256: digest(bytes),
      sourceSize: { width, height },
      canvasSize: target,
      placement: { left, top, width, height },
      resampled: false,
      sourcePixelSha256: digest(normalized.data),
      embeddedPixelSha256: digest(extracted),
      formalAssetApproval: false,
    },
  };
}

/** Browser media is actual S3 data, served through a tightly scoped local TLS fixture origin. */
export async function createStorefrontMediaGateway({
  s3,
  configPath,
  currentPublicClient,
}) {
  const directory = path.dirname(configPath);
  const { certificatePath, privateKeyPath } =
    await createStorefrontTestCertificate(directory);
  const storage = new S3Client({
    region: "us-east-1",
    endpoint: s3.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
    },
  });
  const allowed = new Map();
  const served = new Map();
  let failImages = false;
  let redirectTarget;
  const redirectKey = `processed/v1/${"0".repeat(64)}/${"1".repeat(64)}.webp`;
  const server = createServer(
    {
      cert: await readFile(certificatePath),
      key: await readFile(privateKeyPath),
      minVersion: "TLSv1.2",
    },
    async (request, response) => {
      const key = request.url?.slice(1);
      if (key === redirectKey && redirectTarget) {
        response
          .writeHead(302, {
            location: redirectTarget,
            "cache-control": "no-store",
          })
          .end();
        return;
      }
      let expected = allowed.get(key);
      if (
        currentPublicClient &&
        key &&
        ["GET", "HEAD"].includes(request.method)
      ) {
        // Discover newly published derivatives only; never expose source bucket keys.
        try {
          expected = (
            await currentPublicClient.query(
              `SELECT v.object_key,v.checksum_sha256,v.byte_size,v.width,v.height,CASE v.format WHEN 'AVIF' THEN 'image/avif' WHEN 'WEBP' THEN 'image/webp' WHEN 'JPEG' THEN 'image/jpeg' END AS mime_type FROM public.media_variants v JOIN public.media_assets a ON a.id=v.media_asset_id JOIN public.media_metadata_publication_heads h ON h.media_asset_id=a.id WHERE v.object_key=$1 AND v.status='READY' AND a.processing_status='READY' AND a.rights_status='APPROVED'`,
              [key],
            )
          ).rows[0];
          if (expected) allowed.set(key, expected);
          else allowed.delete(key);
        } catch {
          expected = undefined;
        }
      }
      if (!expected || !["GET", "HEAD"].includes(request.method)) {
        response.writeHead(404, { "cache-control": "no-store" }).end();
        return;
      }
      if (failImages) {
        response.writeHead(503, { "cache-control": "no-store" }).end();
        return;
      }
      try {
        const object = await storage.send(
          new GetObjectCommand({ Bucket: s3.derivativeBucket, Key: key }),
        );
        const bytes = Buffer.from(await object.Body.transformToByteArray());
        assert.equal(digest(bytes), expected.checksum_sha256);
        assert.equal(bytes.length, Number(expected.byte_size));
        served.set(key, {
          sha256: digest(bytes),
          byteSize: bytes.length,
          width: expected.width,
          height: expected.height,
        });
        response.writeHead(200, {
          "content-type": expected.mime_type,
          "content-length": bytes.length,
          "cache-control": "public, max-age=60",
          "access-control-allow-origin": "*",
          "x-content-type-options": "nosniff",
        });
        response.end(request.method === "HEAD" ? undefined : bytes);
      } catch {
        response.writeHead(503, { "cache-control": "no-store" }).end();
      }
    },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `https://media.example.invalid:${server.address().port}`;
  return {
    origin,
    certificatePath,
    publishedMetadata(value) {
      if (!value) return undefined;
      const url = new globalThis.URL(value);
      return url.origin === origin && !url.search && !url.hash
        ? allowed.get(url.pathname.slice(1))
        : undefined;
    },
    redirectProbe(value) {
      assert.ok(this.publishedMetadata(value));
      redirectTarget = value;
      return `${origin}/${redirectKey}`;
    },
    async probe(pathname) {
      const ca = await readFile(path.join(directory, "ca.crt"));
      return new Promise((resolve, reject) => {
        const request = httpsRequest(
          new globalThis.URL(pathname, origin),
          {
            ca,
            lookup: (_hostname, options, callback) =>
              options.all
                ? callback(null, [{ address: "127.0.0.1", family: 4 }])
                : callback(null, "127.0.0.1", 4),
          },
          (response) => {
            response.resume();
            response.once("end", () =>
              resolve({ status: response.statusCode }),
            );
          },
        );
        request.once("error", reject);
        request.setTimeout(30_000, () =>
          request.destroy(new Error("TEST media probe timed out")),
        );
        request.end();
      });
    },
    async allowPublishedAsset(client, assetId) {
      const records = (
        await client.query(
          "SELECT v.object_key,v.checksum_sha256,v.byte_size,v.width,v.height,CASE v.format WHEN 'AVIF' THEN 'image/avif' WHEN 'WEBP' THEN 'image/webp' WHEN 'JPEG' THEN 'image/jpeg' END AS mime_type FROM media_variants v JOIN media_metadata_publication_heads h ON h.media_asset_id=v.media_asset_id WHERE v.media_asset_id=$1 AND v.status='READY'",
          [assetId],
        )
      ).rows;
      assert.equal(records.length, 12);
      for (const row of records) allowed.set(row.object_key, row);
    },
    setFailure(value) {
      failImages = value;
    },
    evidence: () => [...served.values()],
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      storage.destroy();
    },
  };
}

export function createStorefrontMediaPublisher({
  content,
  workerRuntime,
  client,
  gateway,
  check,
  provenance,
}) {
  return async function publishMedia(sourcePath, role, label) {
    const composed = await createMatteFixture(sourcePath, role);
    provenance.push({
      sourcePath: sourcePath.split("/public/").at(-1),
      ...composed.provenance,
    });
    const { bytes } = composed;
    const grant = await content.write("/api/v1/admin/resources/uploads/begin", {
      checksumSha256: digest(bytes),
      byteSize: bytes.length,
      mimeType: "image/png",
      rightsReference: "rights:original-fictional-internal-matte-fixture",
      expectedVersion: 0,
    });
    const uploaded = await globalThis.fetch(grant.grant.url, {
      method: "PUT",
      headers: grant.grant.headers,
      body: bytes,
      signal: globalThis.AbortSignal.timeout(30_000),
    });
    await uploaded.body?.cancel();
    check(
      uploaded.status === 200,
      "real source bytes pass strict TLS signed S3 upload",
    );
    const sourceId = (
      await content.write("/api/v1/admin/resources/uploads/complete", {
        uploadId: grant.uploadId,
        expectedVersion: 1,
      })
    ).resultId;
    const sourceOwner = { kind: "MEDIA_METADATA", mediaAssetId: sourceId };
    const sourceRevision = await content.author(
      sourceOwner,
      workspaceMediaContent(`Synthetic source ${label}`),
    );
    await content.approve(sourceOwner, sourceRevision);
    async function rights(assetId) {
      await content.write("/api/v1/admin/resources/media/rights", {
        assetId,
        expectedVersion: 0,
        rightsStatus: "APPROVED",
        evidenceReference: "rights:internal-generated-art-fixture-only",
      });
    }
    await rights(sourceId);
    const job = await content.write(
      "/api/v1/admin/resources/processing/enqueue",
      {
        sourceAssetId: sourceId,
        metadataRevisionId: sourceRevision,
        role,
        fit: "CONTAIN",
        expectedVersion: 0,
      },
    );
    let output;
    const deadline = globalThis.performance.now() + 120_000;
    while (globalThis.performance.now() < deadline) {
      await workerRuntime.runOnce();
      const current = await content.request(
        "/api/v1/admin/resources/processing/read",
        { jobId: job.resultId },
      );
      if (current.job.snapshot.status === "SUCCEEDED") {
        output = current.job.snapshot.outputAssetId;
        break;
      }
      assert.notEqual(
        current.job.snapshot.status,
        "FAILED",
        "real image processing must not reach permanent failure",
      );
      await delay(250);
    }
    check(
      Boolean(output),
      "actual worker produces the role master and responsive derivatives",
    );
    await rights(output);
    const owner = { kind: "MEDIA_METADATA", mediaAssetId: output };
    const revisionId = await content.author(
      owner,
      workspaceMediaContent(label),
    );
    await content.approve(owner, revisionId);
    await content.publish(owner, revisionId);
    await gateway.allowPublishedAsset(client, output);
    return { assetId: output, revisionId };
  };
}

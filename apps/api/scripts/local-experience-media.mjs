import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:https";
import { Pool } from "pg";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

export async function startLocalMedia({ config, database, s3, own }) {
  const pool = new Pool({ ...database, max: 2 });
  own("published media database", () => pool.end());
  const storage = new S3Client({
    region: "us-east-1",
    endpoint: s3.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
    },
  });
  own("published media storage", () => storage.destroy());
  const server = createServer(
    {
      cert: await readFile(config.tls.certificatePath),
      key: await readFile(config.tls.privateKeyPath),
      minVersion: "TLSv1.2",
    },
    async (request, response) => {
      const key = request.url?.slice(1);
      if (
        request.headers.host !== new URL(config.origins.media).host ||
        !["GET", "HEAD"].includes(request.method) ||
        !/^processed\/v1\/[a-f0-9]{64}\/[a-f0-9]{64}\.(avif|webp|jpg)$/u.test(
          key ?? "",
        )
      ) {
        response.writeHead(404, { "cache-control": "no-store" }).end();
        return;
      }
      try {
        const expected = (
          await pool.query(
            "SELECT v.checksum_sha256,v.byte_size,CASE v.format WHEN 'AVIF' THEN 'image/avif' WHEN 'WEBP' THEN 'image/webp' WHEN 'JPEG' THEN 'image/jpeg' END mime_type FROM media_variants v JOIN media_assets a ON a.id=v.media_asset_id JOIN media_metadata_publication_heads h ON h.media_asset_id=a.id WHERE v.object_key=$1 AND v.status='READY' AND a.processing_status='READY' AND a.rights_status='APPROVED'",
            [key],
          )
        ).rows[0];
        if (!expected) {
          response.writeHead(404, { "cache-control": "no-store" }).end();
          return;
        }
        const value = await storage.send(
          new GetObjectCommand({ Bucket: s3.derivativeBucket, Key: key }),
        );
        const bytes = Buffer.from(await value.Body.transformToByteArray());
        if (
          bytes.length !== Number(expected.byte_size) ||
          createHash("sha256").update(bytes).digest("hex") !==
            expected.checksum_sha256
        )
          throw new Error("Derivative integrity mismatch");
        response
          .writeHead(200, {
            "content-type": expected.mime_type,
            "content-length": bytes.length,
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
            "x-content-type-options": "nosniff",
          })
          .end(request.method === "HEAD" ? undefined : bytes);
      } catch {
        response.writeHead(503, { "cache-control": "no-store" }).end();
      }
    },
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.ports.media, "127.0.0.1", resolve);
  });
  own(
    "published media HTTPS",
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
}

import {
  adminResourceResponseSchema,
  adminCatalogResponseSchema,
  type AdminResourceResponse,
} from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "./client";
type Grant = Extract<AdminResourceResponse, { kind: "UPLOAD_GRANT" }>;
type Source = Readonly<{
  checksumSha256: string;
  byteSize: number;
  mimeType: string;
  rightsReference: string;
}>;
/** In-memory checkpoints survive request failures, never a browser reload or session boundary. */
export function createMediaUploadAttempt(transport: typeof fetch = fetch) {
  let checkpoint: {
    fingerprint: string;
    grant: Grant;
    putComplete: boolean;
    registered: boolean;
    assetId: string | null;
  } | null = null;
  return {
    async upload(client: AdminClient, source: Source, bytes: ArrayBuffer) {
      const fingerprint = JSON.stringify(source);
      if (
        !checkpoint ||
        checkpoint.fingerprint !== fingerprint ||
        (!checkpoint.putComplete &&
          Date.parse(checkpoint.grant.grant.expiresAt) <= Date.now())
      ) {
        const grant = await client.call(
          "media-upload-begin",
          {
            schemaVersion: 1,
            ...source,
            expectedVersion: 0,
            reasonCode: "MEDIA_UPLOAD",
          },
          adminResourceResponseSchema,
          true,
        );
        if (grant.kind !== "UPLOAD_GRANT")
          throw new AdminClientError("INVALID_RESPONSE");
        checkpoint = {
          fingerprint,
          grant,
          putComplete: false,
          registered: false,
          assetId: null,
        };
      }
      const current = checkpoint;
      if (!current.putComplete) {
        let response: Response;
        try {
          response = await transport(current.grant.grant.url, {
            method: current.grant.grant.method,
            headers: current.grant.grant.headers,
            body: bytes,
            credentials: "omit",
            redirect: "error",
            referrerPolicy: "no-referrer",
            signal: AbortSignal.timeout(30000),
          });
        } catch {
          throw new AdminClientError("NETWORK_ERROR");
        }
        // A conditional PUT may have succeeded before its response was lost. COMPLETE must still
        // verify the canonical object's checksum, full bytes and decoder evidence in either case.
        if (!response.ok && response.status !== 412)
          throw new AdminClientError("UPLOAD_FAILED");
        current.putComplete = true;
      }
      if (!current.registered) {
        await client.call(
          "media-upload-complete",
          {
            schemaVersion: 1,
            uploadId: current.grant.uploadId,
            expectedVersion: 1,
            reasonCode: "MEDIA_UPLOAD",
          },
          adminResourceResponseSchema,
          true,
        );
        current.registered = true;
      }
      if (!current.assetId) {
        const result = await client.call(
          "media-upload-read",
          { schemaVersion: 1, uploadId: current.grant.uploadId },
          adminResourceResponseSchema,
        );
        if (result.kind !== "UPLOAD" || !result.upload.assetId)
          throw new AdminClientError("INVALID_RESPONSE");
        current.assetId = result.upload.assetId;
      }
      const result = await client.call(
        "catalog-owner",
        {
          schemaVersion: 1,
          target: { kind: "MEDIA_METADATA", mediaAssetId: current.assetId },
          locale: "en",
        },
        adminCatalogResponseSchema,
      );
      if (result.kind !== "OWNER")
        throw new AdminClientError("INVALID_RESPONSE");
      return result.owner;
    },
  };
}

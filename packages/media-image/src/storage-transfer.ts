import { createHash } from "node:crypto";
import {
  mediaPortResponseSchema,
  type MediaImageProcessingCommand,
  type MediaPortCommand,
  type MediaPortResponse,
} from "@fan-support/contracts";
import type { MediaStoragePort } from "@fan-support/media-port";
import { type ProcessingBudget, ProcessingFailure } from "./failure.js";

type Identity = Pick<
  MediaImageProcessingCommand["source"],
  "objectKey" | "checksumSha256" | "byteSize" | "mimeType"
> & { storageClass: "SOURCE" | "DERIVATIVE" };
type SourceIdentity = Pick<Identity, "storageClass" | "objectKey">;

function checkedResponse(
  input: unknown,
  operation: MediaPortCommand["operation"],
): MediaPortResponse {
  const parsed = mediaPortResponseSchema.safeParse(input);
  if (!parsed.success || parsed.data.operation !== operation)
    throw new ProcessingFailure("STORAGE_UNAVAILABLE");
  return parsed.data;
}

function sameIdentity(
  actual: SourceIdentity,
  expected: SourceIdentity,
): boolean {
  return (
    actual.storageClass === expected.storageClass &&
    actual.objectKey === expected.objectKey
  );
}

function sameObject(actual: Identity, expected: Identity): boolean {
  return (
    sameIdentity(actual, expected) &&
    actual.checksumSha256 === expected.checksumSha256 &&
    actual.byteSize === expected.byteSize &&
    actual.mimeType === expected.mimeType
  );
}

export function createStorageTransfer(
  storage: MediaStoragePort,
  fetch: typeof globalThis.fetch,
  now: () => Date,
  budget: ProcessingBudget,
) {
  const expiry = (seconds: number) =>
    new Date(now().getTime() + seconds * 1000).toISOString();
  function validExpiry(expiresAt: string): boolean {
    return new Date(expiresAt).getTime() > now().getTime();
  }

  async function inspect(
    expected: Identity,
    source: boolean,
    missingAllowed = false,
  ): Promise<boolean> {
    const response = checkedResponse(
      await budget.request(() =>
        storage.inspectObject({
          schemaVersion: 1,
          operation: "INSPECT_OBJECT",
          storageClass: expected.storageClass,
          objectKey: expected.objectKey,
        }),
      ),
      "INSPECT_OBJECT",
    );
    if (response.outcome === "FAILURE") {
      if (missingAllowed && response.error.code === "OBJECT_NOT_FOUND")
        return false;
      if (source && response.error.code === "OBJECT_NOT_FOUND")
        throw new ProcessingFailure("SOURCE_NOT_FOUND");
      throw new ProcessingFailure("STORAGE_UNAVAILABLE");
    }
    if (response.operation !== "INSPECT_OBJECT")
      throw new ProcessingFailure("STORAGE_UNAVAILABLE");
    if (!sameObject(response.value, expected))
      throw new ProcessingFailure(
        source ? "SOURCE_CHANGED" : "OBJECT_CONFLICT",
      );
    return true;
  }

  async function download(
    command: Readonly<{ source: Omit<Identity, "storageClass"> }>,
  ): Promise<Buffer> {
    const expected = { ...command.source, storageClass: "SOURCE" as const };
    await inspect(expected, true);
    const response = checkedResponse(
      await budget.request(() =>
        storage.createDownloadGrant({
          schemaVersion: 1,
          operation: "CREATE_DOWNLOAD_GRANT",
          storageClass: "SOURCE",
          objectKey: command.source.objectKey,
          // Internal GET grants must still satisfy a provider's 60-second minimum
          // after ordinary dispatch latency. Transfer and codec budgets stay unchanged.
          expiresAt: expiry(120),
        }),
      ),
      "CREATE_DOWNLOAD_GRANT",
    );
    if (response.outcome === "FAILURE")
      throw new ProcessingFailure(
        response.error.code === "OBJECT_NOT_FOUND"
          ? "SOURCE_NOT_FOUND"
          : "STORAGE_UNAVAILABLE",
      );
    if (
      response.operation !== "CREATE_DOWNLOAD_GRANT" ||
      !sameIdentity(response.value, expected) ||
      !validExpiry(response.value.expiresAt)
    )
      throw new ProcessingFailure("STORAGE_UNAVAILABLE");
    const grant = response.value;
    return budget.request(async (signal) => {
      try {
        const response = await fetch(grant.url, {
          method: "GET",
          headers: grant.headers,
          redirect: "error",
          signal,
        });
        if (response.status !== 200) {
          void response.body?.cancel().catch(() => undefined);
          throw new ProcessingFailure(
            response.status === 404
              ? "SOURCE_NOT_FOUND"
              : "STORAGE_UNAVAILABLE",
          );
        }
        const mime = response.headers
          .get("content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase();
        const length = response.headers.get("content-length");
        if (
          mime !== command.source.mimeType ||
          (length !== null &&
            (!/^\d+$/.test(length) || Number(length) !== expected.byteSize))
        ) {
          void response.body?.cancel().catch(() => undefined);
          throw new ProcessingFailure(
            mime !== command.source.mimeType
              ? "MIME_MISMATCH"
              : "SOURCE_CHANGED",
          );
        }
        if (!response.body) throw new ProcessingFailure("SOURCE_CHANGED");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        const hash = createHash("sha256");
        let received = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            received += chunk.value.byteLength;
            if (received > expected.byteSize)
              throw new ProcessingFailure("SOURCE_CHANGED");
            hash.update(chunk.value);
            chunks.push(chunk.value);
          }
        } finally {
          void reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
        if (
          received !== expected.byteSize ||
          hash.digest("hex") !== expected.checksumSha256
        )
          throw new ProcessingFailure("SOURCE_CHANGED");
        return Buffer.concat(chunks, received);
      } catch (error) {
        if (error instanceof ProcessingFailure) throw error;
        throw new ProcessingFailure(
          signal.aborted ? "PROCESSING_TIMEOUT" : "STORAGE_UNAVAILABLE",
        );
      }
    });
  }

  async function upload(bytes: Buffer, expected: Identity): Promise<void> {
    // Outputs are content-addressed, so processing the same original again yields objects that are
    // already stored. A create-only PUT of a large body onto an existing key can be cut off mid-upload
    // (a dropped connection or 5xx instead of a clean 412), so reuse the identical object instead.
    if (await inspect(expected, false, true)) return;
    const response = checkedResponse(
      await budget.request(() =>
        storage.createUploadGrant({
          schemaVersion: 1,
          operation: "CREATE_UPLOAD_GRANT",
          storageClass: expected.storageClass,
          objectKey: expected.objectKey,
          checksumSha256: expected.checksumSha256,
          byteSize: expected.byteSize,
          mimeType: expected.mimeType,
          expiresAt: expiry(60),
        }),
      ),
      "CREATE_UPLOAD_GRANT",
    );
    if (response.outcome === "FAILURE") {
      if (
        response.error.code === "OBJECT_ALREADY_EXISTS" ||
        response.error.code === "PRECONDITION_FAILED"
      ) {
        await inspect(expected, false);
        return;
      }
      throw new ProcessingFailure("STORAGE_UNAVAILABLE");
    }
    if (
      response.operation !== "CREATE_UPLOAD_GRANT" ||
      !sameObject(response.value, expected) ||
      !validExpiry(response.value.expiresAt)
    )
      throw new ProcessingFailure("OBJECT_CONFLICT");
    const grant = response.value;
    const headers = new Headers(grant.headers);
    if (
      headers.get("if-none-match") !== "*" ||
      headers.get("content-type") !== expected.mimeType ||
      (headers.has("content-length") &&
        headers.get("content-length") !== String(expected.byteSize))
    )
      throw new ProcessingFailure("OBJECT_CONFLICT");
    const checksum = headers.get("x-amz-checksum-sha256");
    if (
      checksum !== null &&
      checksum !==
        Buffer.from(expected.checksumSha256, "hex").toString("base64")
    )
      throw new ProcessingFailure("OBJECT_CONFLICT");
    headers.set("content-length", String(expected.byteSize));
    await budget.request(async (signal) => {
      try {
        const response = await fetch(grant.url, {
          method: "PUT",
          headers,
          body: new Uint8Array(bytes),
          redirect: "error",
          signal,
        });
        void response.body?.cancel().catch(() => undefined);
        if (![200, 201, 204, 412].includes(response.status))
          throw new ProcessingFailure(
            response.status >= 500 ||
              response.status === 429 ||
              response.status === 408
              ? "STORAGE_UNAVAILABLE"
              : "OBJECT_CONFLICT",
          );
      } catch (error) {
        if (error instanceof ProcessingFailure) throw error;
        throw new ProcessingFailure(
          signal.aborted ? "PROCESSING_TIMEOUT" : "STORAGE_UNAVAILABLE",
        );
      }
    });
    await inspect(expected, false);
  }

  return { download, upload };
}

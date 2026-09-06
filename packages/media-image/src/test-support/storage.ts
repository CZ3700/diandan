import { createHash } from "node:crypto";
import {
  credentiallessHttpsUrlSchema,
  mediaImageProcessingCommandSchema,
  sourceHashSchema,
  mediaPortCommandSchema,
  type MediaImageProcessingCommand,
  type MediaPortFailure,
} from "@fan-support/contracts";
import type { MediaStoragePort } from "@fan-support/media-port";

export const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export const testNow = () => new Date("2026-09-05T00:00:00.000Z");

export function commandFor(
  bytes: Buffer,
  overrides: Partial<MediaImageProcessingCommand["source"]> = {},
): MediaImageProcessingCommand {
  return mediaImageProcessingCommandSchema.parse({
    schemaVersion: 1,
    profileVersion: 1,
    source: {
      assetId:
        "d33cf54b-26b5-458b-8cd0-042063247755" as MediaImageProcessingCommand["source"]["assetId"],
      metadataRevisionId:
        "07e96b47-175b-4c69-bcab-045d65056ecb" as MediaImageProcessingCommand["source"]["metadataRevisionId"],
      objectKey: "original/fixture.png",
      checksumSha256: hash(bytes),
      byteSize: bytes.length,
      mimeType: "image/png",
      width: 1200,
      height: 1200,
      ...overrides,
    },
    role: "GIFT_PRIMARY",
    fit: "COVER",
    focalPoint: { x: 0.5, y: 0.5 },
  });
}

interface StoredObject {
  bytes: Buffer;
  mimeType: MediaImageProcessingCommand["source"]["mimeType"];
  checksumSha256: string;
}
export function memoryStorage(
  source: Buffer,
  command: Readonly<{
    source: Pick<
      MediaImageProcessingCommand["source"],
      "objectKey" | "checksumSha256" | "byteSize" | "mimeType"
    >;
  }>,
) {
  const objects = new Map<string, StoredObject>([
    [
      `SOURCE/${command.source.objectKey}`,
      {
        bytes: source,
        mimeType: command.source.mimeType,
        checksumSha256: command.source.checksumSha256,
      },
    ],
  ]);
  const uploads: string[] = [];
  const controls = {
    failPut: 0,
    conflict: false,
    corruptHead: false,
    downloadMime: command.source.mimeType as string,
    extraDownload: Buffer.alloc(0),
  };
  const missing = (
    operation: MediaPortFailure["operation"],
  ): MediaPortFailure => ({
    schemaVersion: 1,
    operation,
    outcome: "FAILURE",
    error: { schemaVersion: 1, code: "OBJECT_NOT_FOUND", recovery: "NONE" },
  });
  const storage: MediaStoragePort = {
    async inspectObject(input) {
      mediaPortCommandSchema.parse(input);
      const object = objects.get(`${input.storageClass}/${input.objectKey}`);
      if (!object)
        return { ...missing(input.operation), operation: input.operation };
      return {
        schemaVersion: 1,
        operation: input.operation,
        outcome: "SUCCESS",
        value: {
          storageClass: input.storageClass,
          objectKey: input.objectKey,
          mimeType: object.mimeType,
          checksumSha256: sourceHashSchema.parse(
            controls.corruptHead && input.objectKey.startsWith("processed/")
              ? "f".repeat(64)
              : object.checksumSha256,
          ),
          byteSize: object.bytes.length,
          revisionToken: "fixture-etag",
        },
      };
    },
    async createDownloadGrant(input) {
      mediaPortCommandSchema.parse(input);
      return {
        schemaVersion: 1,
        operation: input.operation,
        outcome: "SUCCESS",
        value: {
          storageClass: input.storageClass,
          objectKey: input.objectKey,
          method: "GET",
          headers: {},
          url: credentiallessHttpsUrlSchema.parse(
            `https://storage.example.invalid/${input.storageClass}/${input.objectKey}?signature=private-fixture`,
          ),
          expiresAt: input.expiresAt,
        },
      };
    },
    async createUploadGrant(input) {
      mediaPortCommandSchema.parse(input);
      return {
        schemaVersion: 1,
        operation: input.operation,
        outcome: "SUCCESS",
        value: {
          storageClass: input.storageClass,
          objectKey: input.objectKey,
          method: "PUT",
          checksumSha256: input.checksumSha256,
          byteSize: input.byteSize,
          mimeType: input.mimeType,
          expiresAt: input.expiresAt,
          url: credentiallessHttpsUrlSchema.parse(
            `https://storage.example.invalid/${input.storageClass}/${input.objectKey}?signature=private-fixture`,
          ),
          headers: {
            "if-none-match": "*",
            "content-type": input.mimeType,
            "x-amz-checksum-sha256": Buffer.from(
              input.checksumSha256,
              "hex",
            ).toString("base64"),
          },
        },
      };
    },
    async deleteObject(input) {
      return { ...missing(input.operation), operation: input.operation };
    },
    async resolvePublicUrl(input) {
      return { ...missing(input.operation), operation: input.operation };
    },
  };
  const fetch: typeof globalThis.fetch = async (url, init) => {
    if (init?.redirect !== "error")
      throw new Error("Redirect policy was omitted");
    const path = new URL(String(url)).pathname.slice(1);
    if (init.method === "GET") {
      const object = objects.get(path);
      if (!object) return new Response(null, { status: 404 });
      return new Response(
        new Uint8Array(Buffer.concat([object.bytes, controls.extraDownload])),
        { status: 200, headers: { "content-type": controls.downloadMime } },
      );
    }
    if (
      init.method !== "PUT" ||
      new Headers(init.headers).get("if-none-match") !== "*"
    )
      throw new Error("Immutable PUT required");
    uploads.push(path);
    if (controls.failPut > 0 && uploads.length === controls.failPut)
      return new Response(null, { status: 503 });
    if (objects.has(path)) return new Response(null, { status: 412 });
    const bytes = Buffer.from(await new Response(init.body).arrayBuffer());
    const headers = new Headers(init.headers);
    const mimeType = headers.get("content-type") as StoredObject["mimeType"];
    objects.set(path, {
      bytes,
      mimeType,
      checksumSha256: controls.conflict ? "e".repeat(64) : hash(bytes),
    });
    return new Response(null, { status: controls.conflict ? 412 : 200 });
  };
  return { storage, fetch, objects, uploads, controls };
}

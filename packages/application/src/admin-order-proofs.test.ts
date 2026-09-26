import { describe, expect, test, vi } from "vitest";
import {
  credentiallessHttpsUrlSchema,
  deliveryProofRenditionObjectKey,
  deliveryProofSourceObjectKey,
  type AdminOrdersResponse,
  type MediaPortResponse,
} from "@fan-support/contracts";
import type { AdminOrdersRepositories } from "@fan-support/persistence-port";
import type {
  DeliveryProofProcessingPort,
  MediaStoragePort,
} from "@fan-support/media-port";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import { createAdminOrdersUseCases } from "./index.js";

const orderId = "40000000-0000-4000-8000-000000000001";
const fulfillmentId = "40000000-0000-4000-8000-000000000002";
const uploadId = "40000000-0000-4000-8000-000000000003";
const proofId = "40000000-0000-4000-8000-000000000004";
const checksum = (fill: string) => fill.repeat(64);
const authorizedAt = "2026-09-27T00:00:00.000000Z";
const envelope = (command: unknown) => ({
  schemaVersion: 1,
  requestId: orderId,
  sessionToken: "a".repeat(42) + "A",
  csrfToken: "b".repeat(42) + "A",
  command,
});
const begin = {
  schemaVersion: 1,
  action: "BEGIN_PROOF_UPLOAD",
  orderId,
  expectedOrderVersion: 2,
  idempotencyKey: "proof-upload-begin-0001",
  reasonCode: "DELIVERY_PROOF_UPLOAD",
  fulfillmentId,
  expectedFulfillmentVersion: 3,
  checksumSha256: checksum("a"),
  byteSize: 4096,
  mimeType: "image/jpeg",
} as const;
const source = {
  objectKey: deliveryProofSourceObjectKey(uploadId),
  checksumSha256: checksum("a"),
  byteSize: 4096,
  mimeType: "image/jpeg",
};
const rendition = (fill: string, width: number, height: number) => ({
  objectKey: deliveryProofRenditionObjectKey(uploadId, checksum(fill)),
  checksumSha256: checksum(fill),
  byteSize: 2048,
  width,
  height,
  mimeType: "image/webp",
});
const reservation = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "PROOF_RESERVATION",
  orderId,
  fulfillmentId,
  uploadId,
  replayed: false,
  source,
  createdAt: authorizedAt,
  expiresAt: "2026-09-27T00:15:00.000000Z",
  authorizedAt,
  sessionExpiresAt: "2026-09-27T00:03:00.000000Z",
};
const uploadState = (status: "RESERVED" | "READY") => ({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "PROOF_UPLOAD_STATE",
  orderId,
  fulfillmentId,
  uploadId,
  status,
  source,
  expiresAt: "2026-09-27T00:15:00.000000Z",
  display: status === "READY" ? rendition("b", 1600, 1200) : null,
  thumbnail: status === "READY" ? rendition("c", 480, 360) : null,
});
const processed = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  profileVersion: 1,
  uploadId,
  metadataPolicy: "STRIP_ALL_SRGB",
  display: rendition("b", 1600, 1200),
  thumbnail: rendition("c", 480, 360),
} as const;
const grantUrl = credentiallessHttpsUrlSchema.parse(
  "https://storage.example.test/private?X-Amz-Signature=fixture",
);

function setup(repository: Partial<AdminOrdersRepositories["adminOrders"]>) {
  let inside = false;
  const outside = () => expect(inside).toBe(false);
  const adminOrders = {
    execute: vi.fn(),
    preparePrivate: vi.fn(),
    confirmPrivate: vi.fn(),
    reserveProofUpload: vi.fn(),
    readProofUpload: vi.fn(),
    completeProofUpload: vi.fn(),
    readProofRendition: vi.fn(),
    ...repository,
  } as AdminOrdersRepositories["adminOrders"];
  const run = vi.fn(
    async (
      work: (repositories: AdminOrdersRepositories) => Promise<unknown>,
    ) => {
      outside();
      inside = true;
      try {
        return await work({
          adminOrders,
          adminOrderResends: { request: vi.fn() },
        });
      } finally {
        inside = false;
      }
    },
  );
  const storage = {
    createUploadGrant: vi.fn(async (command): Promise<MediaPortResponse> => {
      outside();
      return {
        schemaVersion: 1,
        operation: "CREATE_UPLOAD_GRANT",
        outcome: "SUCCESS",
        value: {
          storageClass: command.storageClass,
          objectKey: command.objectKey,
          checksumSha256: command.checksumSha256,
          byteSize: command.byteSize,
          mimeType: command.mimeType,
          method: "PUT",
          url: grantUrl,
          headers: { "if-none-match": "*" },
          expiresAt: command.expiresAt,
        },
      };
    }),
    createDownloadGrant: vi.fn(async (command): Promise<MediaPortResponse> => {
      outside();
      return {
        schemaVersion: 1,
        operation: "CREATE_DOWNLOAD_GRANT",
        outcome: "SUCCESS",
        value: {
          storageClass: command.storageClass,
          objectKey: command.objectKey,
          method: "GET",
          url: grantUrl,
          headers: {},
          expiresAt: command.expiresAt,
        },
      };
    }),
    inspectObject: vi.fn(),
    deleteObject: vi.fn(),
    resolvePublicUrl: vi.fn(),
  } as unknown as MediaStoragePort & {
    createUploadGrant: ReturnType<typeof vi.fn>;
    createDownloadGrant: ReturnType<typeof vi.fn>;
  };
  const processor = {
    process: vi.fn(async (): Promise<unknown> => {
      outside();
      return processed;
    }),
  };
  const useCases = createAdminOrdersUseCases({
    transactions: { runInAdminOrdersTransaction: run as never },
    keys: {
      decryptEnvelope: vi.fn(),
      encryptEnvelope: vi.fn(),
    } as unknown as KeyManagementPort,
    tokenPepper: "a".repeat(64),
    proofs: {
      storage,
      processor: processor as unknown as DeliveryProofProcessingPort,
    },
  });
  return { useCases, adminOrders, storage, processor, run };
}
const response = async (
  useCases: ReturnType<typeof setup>["useCases"],
  command: unknown,
) => (await useCases.execute(envelope(command))) as AdminOrdersResponse;

describe("proof uploads reserve before signing", () => {
  test("signs a SOURCE-only grant after commit, bounded by the session", async () => {
    const { useCases, storage, adminOrders } = setup({
      reserveProofUpload: vi.fn(async () => reservation as never),
    });
    const result = await response(useCases, begin);
    expect(result).toMatchObject({
      outcome: "SUCCESS",
      kind: "PROOF_UPLOAD_GRANT",
      uploadId,
      replayed: false,
      grant: { method: "PUT", expiresAt: "2026-09-27T00:03:00.000000Z" },
    });
    expect(storage.createUploadGrant).toHaveBeenCalledWith(
      expect.objectContaining({ storageClass: "SOURCE", ...source }),
    );
    expect(adminOrders.execute).not.toHaveBeenCalled();
  });
  test("passes reservation refusals through and rejects mismatched reservations", async () => {
    const refused = setup({
      reserveProofUpload: vi.fn(
        async () =>
          ({
            schemaVersion: 1,
            outcome: "FAILURE",
            code: "PROOF_LIMIT_REACHED",
          }) as never,
      ),
    });
    expect(await response(refused.useCases, begin)).toMatchObject({
      code: "PROOF_LIMIT_REACHED",
    });
    expect(refused.storage.createUploadGrant).not.toHaveBeenCalled();
    const mismatched = setup({
      reserveProofUpload: vi.fn(
        async () =>
          ({
            ...reservation,
            source: { ...source, byteSize: 1 },
          }) as never,
      ),
    });
    expect(await response(mismatched.useCases, begin)).toMatchObject({
      code: "TEMPORARY_UNAVAILABLE",
    });
    expect(mismatched.storage.createUploadGrant).not.toHaveBeenCalled();
  });
});

describe("proof completion processes outside transactions", () => {
  const complete = {
    schemaVersion: 1,
    action: "COMPLETE_PROOF_UPLOAD",
    orderId,
    uploadId,
  };
  test("processes a reservation and records the verified renditions", async () => {
    const recorded = vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "PROOF_UPLOAD",
      orderId,
      uploadId,
      width: 1600,
      height: 1200,
    }));
    const { useCases, processor } = setup({
      readProofUpload: vi.fn(async () => uploadState("RESERVED") as never),
      completeProofUpload: recorded as never,
    });
    expect(await response(useCases, complete)).toMatchObject({
      kind: "PROOF_UPLOAD",
      width: 1600,
    });
    expect(processor.process).toHaveBeenCalledWith({
      schemaVersion: 1,
      profileVersion: 1,
      uploadId,
      source,
    });
    expect(recorded).toHaveBeenCalledWith(
      expect.objectContaining({ uploadId, source, result: processed }),
    );
  });
  test("a READY upload is returned without reprocessing", async () => {
    const { useCases, processor } = setup({
      readProofUpload: vi.fn(async () => uploadState("READY") as never),
    });
    expect(await response(useCases, complete)).toMatchObject({
      kind: "PROOF_UPLOAD",
      width: 1600,
      height: 1200,
    });
    expect(processor.process).not.toHaveBeenCalled();
  });
  test.each([
    ["SOURCE_NOT_FOUND", false, "NOT_FOUND"],
    ["STORAGE_UNAVAILABLE", true, "TEMPORARY_UNAVAILABLE"],
    ["INVALID_IMAGE", false, "PROOF_INVALID"],
    ["SOURCE_TOO_SMALL", false, "PROOF_INVALID"],
  ])("maps processing %s to %s", async (code, retryable, expected) => {
    const { useCases, processor, adminOrders } = setup({
      readProofUpload: vi.fn(async () => uploadState("RESERVED") as never),
    });
    processor.process.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code, retryable },
    });
    expect(await response(useCases, complete)).toMatchObject({
      code: expected,
    });
    expect(adminOrders.completeProofUpload).not.toHaveBeenCalled();
  });
});

describe("administrative proof viewing", () => {
  const view = {
    schemaVersion: 1,
    action: "VIEW_PROOF",
    orderId,
    proofId,
    rendition: "thumbnail",
  };
  const location = (sessionExpiresAt: string) => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PROOF_RENDITION",
    orderId,
    proofId,
    rendition: "thumbnail",
    identity: rendition("c", 480, 360),
    authorizedAt,
    sessionExpiresAt,
  });
  test("returns a short private GET for the exact SOURCE rendition", async () => {
    const { useCases, storage } = setup({
      readProofRendition: vi.fn(
        async () => location("2026-09-27T01:00:00.000000Z") as never,
      ),
    });
    expect(await response(useCases, view)).toMatchObject({
      kind: "PROOF_DOWNLOAD",
      proofId,
      width: 480,
      download: { method: "GET", expiresAt: "2026-09-27T00:05:00.000000Z" },
    });
    expect(storage.createDownloadGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        storageClass: "SOURCE",
        objectKey: rendition("c", 480, 360).objectKey,
      }),
    );
  });
  test("a nearly expired session cannot receive a provider grant", async () => {
    const { useCases, storage } = setup({
      readProofRendition: vi.fn(
        async () => location("2026-09-27T00:00:30.000000Z") as never,
      ),
    });
    expect(await response(useCases, view)).toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(storage.createDownloadGrant).not.toHaveBeenCalled();
  });
  test("deployments without private proof storage refuse every proof step", async () => {
    const useCases = createAdminOrdersUseCases({
      transactions: { runInAdminOrdersTransaction: vi.fn() as never },
      keys: {
        decryptEnvelope: vi.fn(),
        encryptEnvelope: vi.fn(),
      } as unknown as KeyManagementPort,
      tokenPepper: "a".repeat(64),
    });
    for (const command of [begin, view])
      expect(await useCases.execute(envelope(command))).toMatchObject({
        code: "TEMPORARY_UNAVAILABLE",
      });
  });
});

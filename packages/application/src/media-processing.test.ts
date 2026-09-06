import { expect, test, vi } from "vitest";
import {
  hashMediaProcessingCommand,
  mediaProcessingObjectKey,
  planMediaFraming,
} from "@fan-support/content";
import {
  mediaImageProcessingCommandSchema,
  mediaImageProcessingSuccessSchema,
  mediaProcessingSnapshotResponseSchema,
  sourceHashSchema,
  mediaObjectKeySchema,
  type MediaImageProcessingCommand,
  type MediaImageProcessingResult,
  type MediaImageProcessingSuccess,
  type MediaProcessingClaimResponse,
  type MediaProcessingSnapshotResponse,
} from "@fan-support/contracts";
import type {
  JsonValue,
  MediaProcessingRepositories,
} from "@fan-support/persistence-port";

const jobId = "a0000000-0000-4000-8000-000000000001";
const leaseToken = "b0000000-0000-4000-8000-000000000001";
const source: MediaImageProcessingCommand =
  mediaImageProcessingCommandSchema.parse({
    schemaVersion: 1,
    profileVersion: 1,
    source: {
      assetId: "c0000000-0000-4000-8000-000000000001",
      metadataRevisionId: "d0000000-0000-4000-8000-000000000001",
      checksumSha256: "a".repeat(64),
      objectKey: "originals/synthetic-source.png",
      mimeType: "image/png",
      byteSize: 1024,
      width: 2400,
      height: 1600,
    },
    role: "GIFT_PRIMARY",
    fit: "CONTAIN",
    focalPoint: { x: 0.5, y: 0.5 },
  });

async function loadFactory() {
  const module = await import("./media-processing.js").catch(() => undefined);
  expect(
    module?.createMediaProcessingUseCases,
    "media use cases must exist",
  ).toBeTypeOf("function");
  return module?.createMediaProcessingUseCases;
}

function harness() {
  let depth = 0;
  const claimValue: MediaProcessingClaimResponse = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    value: {
      schemaVersion: 1,
      jobId,
      leaseToken,
      attempt: 1,
      leaseExpiresAt: "2026-09-06T12:00:00.000Z",
      command: source,
    },
  };
  const failureResponse: MediaProcessingSnapshotResponse = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    value: {
      schemaVersion: 1,
      jobId,
      status: "PENDING",
      attemptCount: 1,
      outputAssetId: null,
      error: { code: "STORAGE_UNAVAILABLE", retryable: true },
      nextAttemptAt: "2026-09-06T12:00:00.000Z",
    },
  };
  const repository = {
    claim: vi.fn(async (): Promise<MediaProcessingClaimResponse> => claimValue),
    complete: vi.fn(async (): Promise<MediaProcessingSnapshotResponse> => {
      throw new Error("should not complete failure");
    }),
    fail: vi.fn(
      async (): Promise<MediaProcessingSnapshotResponse> => failureResponse,
    ),
    read: vi.fn(),
    enqueue: vi.fn(),
  };
  const transaction = vi.fn();
  const runTransaction = async <T extends JsonValue>(
    work: (repositories: MediaProcessingRepositories) => Promise<T>,
  ): Promise<T> => {
    transaction();
    depth += 1;
    try {
      return await work({ mediaProcessing: repository });
    } finally {
      depth -= 1;
    }
  };
  const processor = {
    process: vi.fn(async (): Promise<MediaImageProcessingResult> => {
      expect(depth).toBe(0);
      return {
        schemaVersion: 1 as const,
        outcome: "FAILURE" as const,
        error: { code: "STORAGE_UNAVAILABLE" as const, retryable: true },
      };
    }),
  };
  return {
    repository,
    transaction,
    processor,
    claimValue,
    failureResponse,
    dependencies: {
      transactions: { runInMediaProcessingTransaction: runTransaction },
      processor,
      createLeaseToken: () => leaseToken,
      leaseSeconds: 300,
    },
  };
}

test("claims briefly, processes outside the transaction and persists a retry", async () => {
  const factory = await loadFactory();
  if (!factory) return;
  const h = harness();
  expect(await factory(h.dependencies).processNext()).toEqual({
    schemaVersion: 1,
    outcome: "RETRY_SCHEDULED",
  });
  expect(h.repository.claim).toHaveBeenCalledWith({
    schemaVersion: 1,
    leaseToken,
    leaseSeconds: 300,
  });
  expect(h.processor.process).toHaveBeenCalledWith(source);
  expect(h.repository.fail).toHaveBeenCalledWith({
    schemaVersion: 1,
    jobId,
    leaseToken,
    error: { code: "STORAGE_UNAVAILABLE", retryable: true },
  });
  expect(h.transaction).toHaveBeenCalledTimes(2);
  expect(h.repository.complete).not.toHaveBeenCalled();
});

function successReceipt(): MediaImageProcessingSuccess {
  const planned = planMediaFraming({
    schemaVersion: 1,
    assetId: source.source.assetId,
    metadataRevisionId: source.source.metadataRevisionId,
    sourceChecksum: source.source.checksumSha256,
    sourceWidth: source.source.width,
    sourceHeight: source.source.height,
    role: source.role,
    fit: source.fit,
    focalPoint: source.focalPoint,
  });
  if (planned.outcome !== "SUCCESS") throw new Error("Fixture plan invalid");
  const checksum = "b".repeat(64);
  return mediaImageProcessingSuccessSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    commandHash: hashMediaProcessingCommand(source),
    profileVersion: 1,
    orientation: 1,
    plan: planned.plan,
    metadataPolicy: "STRIP_ALL_SRGB",
    master: {
      objectKey: mediaProcessingObjectKey(checksum, "PNG"),
      checksumSha256: checksum,
      byteSize: 1024,
      width: 1200,
      height: 1200,
      mimeType: "image/png",
    },
    variants: (["AVIF", "WEBP", "JPEG"] as const).flatMap((format) =>
      [320, 640, 960, 1200].map((width) => {
        const variantChecksum = `${{ AVIF: "a", WEBP: "b", JPEG: "c" }[format]}${width.toString(16).padStart(63, "0")}`;
        return {
          objectKey: mediaProcessingObjectKey(
            variantChecksum,
            format,
            checksum,
          ),
          checksumSha256: variantChecksum,
          byteSize: 1024,
          width,
          height: width,
          format,
        };
      }),
    ),
  });
}

test("only reports success after a bound receipt commits to the same durable job", async () => {
  const factory = await loadFactory();
  if (!factory) return;
  const h = harness();
  const receipt = successReceipt();
  h.processor.process.mockResolvedValueOnce(receipt);
  h.repository.complete.mockResolvedValueOnce(
    mediaProcessingSnapshotResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      value: {
        schemaVersion: 1,
        jobId,
        status: "SUCCEEDED",
        attemptCount: 1,
        outputAssetId: "e0000000-0000-4000-8000-000000000001",
        error: null,
        nextAttemptAt: null,
      },
    }),
  );
  expect(await factory(h.dependencies).processNext()).toEqual({
    schemaVersion: 1,
    outcome: "SUCCEEDED",
  });
  expect(h.repository.complete).toHaveBeenCalledWith({
    schemaVersion: 1,
    jobId,
    leaseToken,
    result: receipt,
  });
  expect(h.repository.fail).not.toHaveBeenCalled();
});

test("an uncertain completion commit remains leased for recovery, without a second failure write", async () => {
  const factory = await loadFactory();
  if (!factory) return;
  const h = harness();
  h.processor.process.mockResolvedValueOnce(successReceipt());
  h.repository.complete.mockRejectedValueOnce(
    new Error("PRIVATE_COMMIT_FAILURE"),
  );
  expect(await factory(h.dependencies).processNext()).toEqual({
    schemaVersion: 1,
    outcome: "UNAVAILABLE",
  });
  expect(h.repository.fail).not.toHaveBeenCalled();
});

test.each(["hash", "focalPoint", "objectKey"])(
  "rejects fabricated successful %s evidence before completion",
  async (field) => {
    const factory = await loadFactory();
    if (!factory) return;
    const h = harness();
    const receipt = successReceipt();
    if (field === "hash")
      receipt.commandHash = sourceHashSchema.parse("f".repeat(64));
    if (field === "focalPoint") receipt.plan.request.focalPoint.x = 0;
    if (field === "objectKey")
      receipt.master.objectKey =
        mediaObjectKeySchema.parse("private/source.png");
    h.processor.process.mockResolvedValueOnce(receipt);
    expect(await factory(h.dependencies).processNext()).toEqual({
      schemaVersion: 1,
      outcome: "RETRY_SCHEDULED",
    });
    expect(h.repository.complete).not.toHaveBeenCalled();
    expect(h.repository.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        error: { code: "UNEXPECTED_PROCESSING_FAILURE", retryable: true },
      }),
    );
  },
);

test("empty or unavailable claims never invoke the processor", async () => {
  const factory = await loadFactory();
  if (!factory) return;
  const h = harness();
  const app = factory(h.dependencies);
  h.repository.claim.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "EMPTY",
  });
  expect(await app.processNext()).toEqual({
    schemaVersion: 1,
    outcome: "EMPTY",
  });
  h.repository.claim.mockRejectedValueOnce(
    new Error("PRIVATE_DATABASE_FAILURE"),
  );
  expect(await app.processNext()).toEqual({
    schemaVersion: 1,
    outcome: "UNAVAILABLE",
  });
  expect(h.processor.process).not.toHaveBeenCalled();
});

test("contains unknown processor exceptions without losing the claim or logging provider data", async () => {
  const factory = await loadFactory();
  if (!factory) return;
  const h = harness();
  h.processor.process.mockRejectedValueOnce(new Error("PRIVATE_OBJECT_URL"));
  const result = await factory(h.dependencies).processNext();
  expect(result).toEqual({ schemaVersion: 1, outcome: "RETRY_SCHEDULED" });
  expect(h.repository.fail).toHaveBeenCalledWith({
    schemaVersion: 1,
    jobId,
    leaseToken,
    error: { code: "UNEXPECTED_PROCESSING_FAILURE", retryable: true },
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_OBJECT_URL");
});

test("expired claims cannot overwrite a newer worker's result", async () => {
  const factory = await loadFactory();
  if (!factory) return;
  const h = harness();
  h.repository.fail.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "STALE_CLAIM",
  });
  expect(await factory(h.dependencies).processNext()).toEqual({
    schemaVersion: 1,
    outcome: "STALE_CLAIM",
  });
  expect(h.repository.complete).not.toHaveBeenCalled();
});

test("terminal retry exhaustion is determined by the durable repository", async () => {
  const factory = await loadFactory();
  if (!factory) return;
  const h = harness();
  h.claimValue.value.attempt = 6;
  h.failureResponse.value.status = "FAILED";
  h.failureResponse.value.attemptCount = 6;
  h.failureResponse.value.nextAttemptAt = null;
  expect(await factory(h.dependencies).processNext()).toEqual({
    schemaVersion: 1,
    outcome: "FAILED",
  });
});

test("rejects a claim for a different lease before external processing", async () => {
  const factory = await loadFactory();
  if (!factory) return;
  const h = harness();
  h.claimValue.value.leaseToken = "b0000000-0000-4000-8000-000000000002";
  expect(await factory(h.dependencies).processNext()).toEqual({
    schemaVersion: 1,
    outcome: "UNAVAILABLE",
  });
  expect(h.processor.process).not.toHaveBeenCalled();
});

test("rejects a finalization response belonging to another job", async () => {
  const factory = await loadFactory();
  if (!factory) return;
  const h = harness();
  h.failureResponse.value.jobId = "a0000000-0000-4000-8000-000000000002";
  expect(await factory(h.dependencies).processNext()).toEqual({
    schemaVersion: 1,
    outcome: "UNAVAILABLE",
  });
});

import { expect, test, vi } from "vitest";
import { managementCenterClaimSchema } from "@fan-support/contracts";
import type { ManagementMediaTransactionManager } from "@fan-support/persistence-port";
import { createManagementMediaPreparation } from "./management-media.js";

const id = "a1000000-0000-4000-8000-000000000001";
const now = "2026-09-08T00:00:00Z";
const makeClaim = () =>
  managementCenterClaimSchema.parse({
    schemaVersion: 1,
    actorId: id,
    sessionId: id,
    requestId: id,
    operation: {
      operationId: id,
      version: 1,
      kind: "SAVE_ARTIST",
      sourceLocale: "zh-CN",
      status: "PROCESSING",
      targetId: id,
      updatedAt: now,
      result: null,
      failure: null,
    },
    intent: {
      kind: "SAVE_ARTIST",
      sourceLocale: "zh-CN",
      id,
      expectedVersion: 1,
      name: "艺人",
      description: "介绍",
      image: null,
    },
    intentHash: "a".repeat(64),
    authorizedUntil: "2026-09-08T01:00:00Z",
    leaseTokenDigest: "b".repeat(64),
    leaseExpiresAt: "2026-09-08T00:01:00Z",
    checkpoint: {
      sourceAssetId: null,
      jobs: [],
      preparedMedia: null,
      retryRequested: false,
    },
  });
function fixture(current: unknown) {
  const loadClaim = vi.fn(async () => current);
  const inspect = vi.fn();
  const transactions = {
    runInManagementMediaTransaction: async (
      work: (value: unknown) => Promise<unknown>,
    ) => work({ operations: { loadClaim }, resources: {}, publication: {} }),
  } as unknown as ManagementMediaTransactionManager;
  return {
    loadClaim,
    inspect,
    preparation: createManagementMediaPreparation({
      transactions,
      inspector: { inspect },
    }),
  };
}
test("edits retaining their image reauthorize the lease without uploading another image", async () => {
  const claim = makeClaim(),
    f = fixture(claim);
  expect(await f.preparation.prepare(claim)).toEqual({
    outcome: "READY",
    preparedMedia: null,
  });
  expect(f.loadClaim).toHaveBeenCalledWith({
    operationId: id,
    leaseTokenDigest: "b".repeat(64),
  });
  expect(f.inspect).not.toHaveBeenCalled();
});
test("a revoked or stale operation cannot perform storage I/O", async () => {
  const claim = makeClaim(),
    f = fixture({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "NEEDS_AUTHORIZATION",
    });
  expect(await f.preparation.prepare(claim)).toMatchObject({
    outcome: "FAILURE",
    code: "NEEDS_AUTHORIZATION",
  });
  expect(f.inspect).not.toHaveBeenCalled();
});

test("successful derivative inherits the actual upload attestation before metadata publication; revoked rights are not reset", async () => {
  for (const status of ["PENDING", "EXPIRED"] as const) {
    const claim = makeClaim();
    if (claim.intent.kind !== "SAVE_ARTIST")
      throw new Error("Expected artist fixture");
    claim.intent.image = { uploadId: id };
    claim.checkpoint.sourceAssetId = id;
    claim.checkpoint.jobs = [
      { role: "PORTRAIT", metadataRevisionId: id, jobId: id },
    ];
    const setRights = vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      resultId: id,
      replayed: false,
    }));
    const prepareMediaMetadata = vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      metadataRevisionId: id,
    }));
    const repositories = {
      operations: {
        loadClaim: async () => claim,
        checkpoint: async () => claim,
      },
      resources: {
        readMediaJob: async () => ({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "MEDIA_JOB",
          job: {
            schemaVersion: 1,
            generation: 1,
            retryOfJobId: null,
            snapshot: {
              schemaVersion: 1,
              jobId: id,
              status: "SUCCEEDED",
              attemptCount: 1,
              outputAssetId: id,
              error: null,
              nextAttemptAt: null,
            },
          },
        }),
        readMedia: async () => ({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "MEDIA",
          media: {
            schemaVersion: 1,
            assetId: id,
            identityKind: "PROCESSED_MASTER",
            mimeType: "image/png",
            width: 1600,
            height: 2000,
            byteSize: 200,
            processingStatus: "READY",
            rightsStatus: status,
            rightsVersion: 0,
          },
        }),
        setRights,
      },
      publication: { prepareMediaMetadata },
    };
    const transactions = {
      runInManagementMediaTransaction: async (
        work: (repositories: unknown) => Promise<unknown>,
      ) => work(repositories),
    } as unknown as ManagementMediaTransactionManager;
    const result = await createManagementMediaPreparation({
      transactions,
      inspector: { inspect: vi.fn() },
    }).prepare(claim);
    if (status === "PENDING") {
      expect(result.outcome).toBe("READY");
      expect(setRights).toHaveBeenCalledOnce();
      expect(setRights.mock.invocationCallOrder[0]).toBeLessThan(
        prepareMediaMetadata.mock.invocationCallOrder[0]!,
      );
    } else {
      expect(result).toMatchObject({
        outcome: "FAILURE",
        code: "MEDIA_FAILED",
      });
      expect(setRights).not.toHaveBeenCalled();
      expect(prepareMediaMetadata).not.toHaveBeenCalled();
    }
  }
});

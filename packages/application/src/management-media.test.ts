import { afterEach, describe, expect, test, vi } from "vitest";
import {
  managementCenterClaimSchema,
  mediaUploadTicketSchema,
  sourceHashSchema,
} from "@fan-support/contracts";
import type { ManagementMediaTransactionManager } from "@fan-support/persistence-port";
import { PersistenceTransactionFailureError } from "@fan-support/persistence-port";
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

describe("management media confirmed transaction aborts", () => {
  afterEach(() => vi.useRealTimers());

  const aborted = () =>
    new PersistenceTransactionFailureError({
      schemaVersion: 1,
      outcome: "FAILURE",
      operation: "RUN_TRANSACTION",
      error: {
        schemaVersion: 1,
        code: "TRANSACTION_ABORTED",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 250,
      },
    });

  function transactionFixture(
    abortPhase: number,
    abortCount = 1,
    error: unknown = aborted(),
  ) {
    const input = makeClaim();
    if (input.intent.kind !== "SAVE_ARTIST") throw new Error("Artist fixture");
    input.intent.image = { uploadId: id };
    const ticket = mediaUploadTicketSchema.parse({
      schemaVersion: 1,
      uploadId: id,
      actorId: id,
      sessionId: id,
      version: 1,
      source: {
        objectKey: "uploads/v1/fixture.png",
        checksumSha256: "a".repeat(64),
        byteSize: 200,
        mimeType: "image/png",
      },
      rightsReference: "rights:fixture",
      status: "PENDING",
      assetId: null,
      createdAt: now,
      expiresAt: input.authorizedUntil,
    });
    const state = {
      persisted: { claim: structuredClone(input), ticket },
      phase: 0,
      attempts: [0, 0, 0],
      active: false,
      changeSourceOnAbort: false,
      failedJobs: false,
      invalidReload: "",
    };
    let draft = structuredClone(state.persisted);
    let sequence = 10;
    const freshId = () =>
      `a1000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
    const mutation = (resultId: string) => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      resultId,
      replayed: false,
    });
    const checkpoints: Array<{
      phase: number;
      checkpoint: typeof input.checkpoint;
    }> = [];
    const loaded: Array<{
      phase: number;
      checkpoint: typeof input.checkpoint;
    }> = [];
    const operations = {
      loadClaim: vi.fn(async () => {
        loaded.push({
          phase: state.phase,
          checkpoint: structuredClone(draft.claim.checkpoint),
        });
        if (state.phase === abortPhase && state.attempts[state.phase]! > 1) {
          if (state.invalidReload === "authority")
            return {
              schemaVersion: 1,
              outcome: "FAILURE",
              code: "NEEDS_AUTHORIZATION",
            };
          if (state.invalidReload === "intent")
            draft.claim.intentHash = sourceHashSchema.parse("c".repeat(64));
          if (state.invalidReload === "fence")
            draft.claim.leaseTokenDigest = sourceHashSchema.parse(
              "c".repeat(64),
            );
          if (state.invalidReload === "operation")
            draft.claim.operation.operationId = freshId();
        }
        return draft.claim;
      }),
      checkpoint: vi.fn(
        async (command: { checkpoint: typeof input.checkpoint }) => {
          draft.claim.checkpoint = structuredClone(command.checkpoint);
          checkpoints.push({
            phase: state.phase,
            checkpoint: structuredClone(command.checkpoint),
          });
          return draft.claim;
        },
      ),
    };
    const resources = {
      readUpload: vi.fn(async () => ({
        schemaVersion: 1,
        outcome: "SUCCESS",
        value: draft.ticket,
      })),
      registerUpload: vi.fn(async (command: { assetId: string }) => {
        draft.ticket = {
          ...draft.ticket,
          status: "REGISTERED",
          version: 2,
          assetId: command.assetId,
        };
        return mutation(command.assetId);
      }),
      readMedia: vi.fn(async ({ assetId }: { assetId: string }) => ({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "MEDIA",
        media: {
          schemaVersion: 1,
          assetId,
          identityKind:
            assetId === draft.ticket.assetId ? "SOURCE" : "PROCESSED_MASTER",
          mimeType: "image/png",
          width: 1600,
          height: 2000,
          byteSize: 200,
          processingStatus: "READY",
          rightsStatus: "PENDING",
          rightsVersion: 0,
        },
      })),
      setRights: vi.fn(async () => mutation(freshId())),
      enqueueMedia: vi.fn(async ({ jobId }: { jobId: string }) =>
        mutation(jobId),
      ),
      retryMediaJob: vi.fn(async ({ newJobId }: { newJobId: string }) =>
        mutation(newJobId),
      ),
      readMediaJob: vi.fn(async ({ jobId }: { jobId: string }) => ({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "MEDIA_JOB",
        job: {
          schemaVersion: 1,
          generation: 1,
          retryOfJobId: null,
          snapshot: {
            schemaVersion: 1,
            jobId,
            status: state.failedJobs ? "FAILED" : "SUCCEEDED",
            attemptCount: 1,
            outputAssetId: state.failedJobs ? null : id,
            error: state.failedJobs
              ? { code: "STORAGE_UNAVAILABLE", retryable: true }
              : null,
            nextAttemptAt: null,
          },
        },
      })),
    };
    const publication = {
      prepareMediaMetadata: vi.fn(async () => ({
        schemaVersion: 1,
        outcome: "SUCCESS",
        metadataRevisionId: freshId(),
      })),
    };
    const transactions: ManagementMediaTransactionManager = {
      async runInManagementMediaTransaction(work) {
        state.attempts[state.phase]!++;
        draft = structuredClone(state.persisted);
        state.active = true;
        try {
          const result = await work({
            operations,
            resources,
            publication,
          } as never);
          if (
            state.phase === abortPhase &&
            state.attempts[state.phase]! <= abortCount
          ) {
            if (state.changeSourceOnAbort)
              state.persisted.ticket.source.checksumSha256 =
                sourceHashSchema.parse("c".repeat(64));
            throw error;
          }
          state.persisted = structuredClone(draft);
          state.phase++;
          return result;
        } finally {
          state.active = false;
        }
      },
    };
    const inspect = vi.fn(async () => {
      expect(state.active).toBe(false);
      return {
        schemaVersion: 1 as const,
        outcome: "SUCCESS" as const,
        receipt: {
          schemaVersion: 1 as const,
          profileVersion: 1 as const,
          source: structuredClone(ticket.source),
          width: 1600,
          height: 2000,
          orientation: 1,
        },
      };
    });
    const preparation = createManagementMediaPreparation({
      transactions,
      inspector: { inspect },
    });
    return {
      input,
      state,
      operations,
      resources,
      publication,
      inspect,
      preparation,
      checkpoints,
      loaded,
    };
  }

  test.each([0, 1, 2])(
    "phase %s retries two COMMIT aborts without replaying inspection or mutated checkpoint",
    async (phase) => {
      vi.useFakeTimers();
      const f = transactionFixture(phase, 2);
      const originalInput = structuredClone(f.input);
      const pending = f.preparation.prepare(f.input);
      await vi.advanceTimersByTimeAsync(249);
      expect(f.state.attempts[phase]).toBe(1);
      expect(f.state.active).toBe(false);
      await vi.runAllTimersAsync();
      expect((await pending).outcome).toBe("READY");
      expect(f.state.attempts).toEqual([
        phase === 0 ? 3 : 1,
        phase === 1 ? 3 : 1,
        phase === 2 ? 3 : 1,
      ]);
      expect(f.inspect).toHaveBeenCalledTimes(1);
      expect(f.input).toEqual(originalInput);
      const reloads = f.loaded.filter((row) => row.phase === phase);
      expect(reloads).toHaveLength(3);
      expect(reloads[1]?.checkpoint).toEqual(reloads[0]?.checkpoint);
      expect(reloads[2]?.checkpoint).toEqual(reloads[0]?.checkpoint);
      if (phase > 0) {
        const abortedCheckpoint = f.checkpoints.find(
          (row) => row.phase === phase,
        )!.checkpoint;
        const finalCheckpoint = f.state.persisted.claim.checkpoint;
        if (phase === 1) {
          expect(finalCheckpoint.sourceAssetId).not.toBe(
            abortedCheckpoint.sourceAssetId,
          );
          for (const job of abortedCheckpoint.jobs)
            expect(
              finalCheckpoint.jobs.map((value) => value.jobId),
            ).not.toContain(job.jobId);
        } else {
          for (const asset of abortedCheckpoint.preparedMedia!.assets)
            expect(
              finalCheckpoint.preparedMedia!.assets.map(
                (value) => value.metadataRevisionId,
              ),
            ).not.toContain(asset.metadataRevisionId);
        }
      }
    },
  );

  test("a derivative retry reloads old job IDs and the retry flag after rollback", async () => {
    vi.useFakeTimers();
    const f = transactionFixture(2);
    f.state.failedJobs = true;
    f.state.persisted.claim.checkpoint.retryRequested = true;
    const pending = f.preparation.prepare(f.input);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ outcome: "PENDING" });
    expect(f.state.attempts).toEqual([1, 1, 2]);
    expect(f.inspect).toHaveBeenCalledTimes(1);
    const reloads = f.loaded.filter((row) => row.phase === 2);
    expect(reloads[1]?.checkpoint).toEqual(reloads[0]?.checkpoint);
    expect(reloads[1]?.checkpoint.retryRequested).toBe(true);
    const abortedCheckpoint = f.checkpoints.find(
      (row) => row.phase === 2,
    )!.checkpoint;
    const committed = f.state.persisted.claim.checkpoint;
    expect(committed.retryRequested).toBe(false);
    expect(committed.preparedMedia).toBeNull();
    for (const job of abortedCheckpoint.jobs)
      expect(committed.jobs.map((value) => value.jobId)).not.toContain(
        job.jobId,
      );
    expect(f.resources.retryMediaJob).toHaveBeenCalledTimes(6);
  });

  test("a media metadata statement abort replays only its database phase", async () => {
    vi.useFakeTimers();
    const f = transactionFixture(-1, 0);
    f.publication.prepareMediaMetadata.mockRejectedValueOnce(aborted());
    const pending = f.preparation.prepare(f.input);
    await vi.runAllTimersAsync();
    expect((await pending).outcome).toBe("READY");
    expect(f.state.attempts).toEqual([1, 2, 1]);
    expect(f.inspect).toHaveBeenCalledTimes(1);
    expect(f.resources.registerUpload).toHaveBeenCalledTimes(2);
    expect(f.resources.enqueueMedia).toHaveBeenCalledTimes(3);
    const sourceReads = f.loaded.filter((row) => row.phase === 1);
    expect(sourceReads[1]?.checkpoint).toEqual(sourceReads[0]?.checkpoint);
  });

  test.each([0, 1, 2])(
    "phase %s stops after three aborts and preserves its prior durable checkpoint",
    async (phase) => {
      vi.useFakeTimers();
      const f = transactionFixture(phase, 3);
      const pending = f.preparation.prepare(f.input);
      await vi.runAllTimersAsync();
      expect(await pending).toMatchObject({
        outcome: "FAILURE",
        code: "MANAGEMENT_UNAVAILABLE",
      });
      expect(f.state.attempts[phase]).toBe(3);
      expect(f.state.phase).toBe(phase);
      expect(f.inspect).toHaveBeenCalledTimes(phase === 0 ? 0 : 1);
      expect(f.state.persisted.claim.checkpoint).toEqual(
        f.loaded.find((row) => row.phase === phase)!.checkpoint,
      );
    },
  );

  test.each(["authority", "intent", "fence", "operation"])(
    "source retry rejects changed %s before resource mutation",
    async (invalid) => {
      vi.useFakeTimers();
      const f = transactionFixture(1);
      f.state.invalidReload = invalid;
      const pending = f.preparation.prepare(f.input);
      await vi.runAllTimersAsync();
      expect(await pending).toMatchObject({
        outcome: "FAILURE",
        code:
          invalid === "authority" ? "NEEDS_AUTHORIZATION" : "TARGET_CONFLICT",
      });
      expect(f.state.attempts).toEqual([1, 2, 0]);
      expect(f.resources.registerUpload).toHaveBeenCalledTimes(1);
      expect(f.inspect).toHaveBeenCalledTimes(1);
      expect(f.state.persisted.claim.checkpoint.sourceAssetId).toBeNull();
    },
  );

  test("a changed source after rollback cannot reuse the earlier inspection", async () => {
    vi.useFakeTimers();
    const f = transactionFixture(1);
    f.state.changeSourceOnAbort = true;
    const pending = f.preparation.prepare(f.input);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({
      outcome: "FAILURE",
      code: "UPLOAD_NOT_READY",
    });
    expect(f.resources.registerUpload).toHaveBeenCalledTimes(1);
    expect(f.inspect).toHaveBeenCalledTimes(1);
  });

  test.each([
    "TRANSACTION_OUTCOME_UNKNOWN",
    "INTEGRITY_VIOLATION",
    "UNEXPECTED_ADAPTER_FAILURE",
    "untyped",
  ])("does not retry %s", async (code) => {
    vi.useFakeTimers();
    const error =
      code === "untyped"
        ? { code: "TRANSACTION_ABORTED", recovery: "RETRY_SAME_COMMAND" }
        : new PersistenceTransactionFailureError({
            schemaVersion: 1,
            outcome: "FAILURE",
            operation: "RUN_TRANSACTION",
            error: {
              schemaVersion: 1,
              code: code as
                | "TRANSACTION_OUTCOME_UNKNOWN"
                | "INTEGRITY_VIOLATION"
                | "UNEXPECTED_ADAPTER_FAILURE",
              recovery:
                code === "TRANSACTION_OUTCOME_UNKNOWN"
                  ? "RECONCILE_REQUIRED"
                  : code === "INTEGRITY_VIOLATION"
                    ? "NONE"
                    : "RETRY_SAME_COMMAND",
              ...(code === "UNEXPECTED_ADAPTER_FAILURE"
                ? { retryAfterMs: 250 }
                : {}),
            },
          });
    const f = transactionFixture(1, 1, error);
    expect(await f.preparation.prepare(f.input)).toMatchObject({
      outcome: "FAILURE",
      code: "MANAGEMENT_UNAVAILABLE",
    });
    expect(f.state.attempts).toEqual([1, 1, 0]);
    expect(f.inspect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("an inspector exception is never treated as a retryable database callback", async () => {
    vi.useFakeTimers();
    const f = transactionFixture(-1, 0);
    f.inspect.mockRejectedValueOnce(aborted());
    expect(await f.preparation.prepare(f.input)).toMatchObject({
      outcome: "FAILURE",
      code: "MANAGEMENT_UNAVAILABLE",
    });
    expect(f.inspect).toHaveBeenCalledTimes(1);
    expect(f.state.attempts).toEqual([1, 0, 0]);
    expect(f.resources.registerUpload).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

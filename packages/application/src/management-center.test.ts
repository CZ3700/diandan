import { afterEach, describe, expect, it, vi } from "vitest";
import {
  credentiallessHttpsUrlSchema,
  type CreateMediaDownloadGrantCommand,
  type ManagementCenterPreparedMedia,
} from "@fan-support/contracts";
import {
  createManagementCenterUseCases,
  createManagementCenterWorker,
} from "./management-center.js";
import type { ManagementCenterTransactionManager } from "@fan-support/persistence-port";
import { PersistenceTransactionFailureError } from "@fan-support/persistence-port";

const id = "00000000-0000-4000-8000-000000000001";
const principal = {
  schemaVersion: 1 as const,
  actorId: id,
  sessionId: id,
  authorizedAt: "2026-09-08T00:00:00Z",
  expiresAt: "2026-09-08T01:00:00Z",
};
const intent = {
  kind: "SAVE_ARTIST",
  sourceLocale: "th",
  id: null,
  expectedVersion: 0,
  name: "Test",
  description: "Description",
  image: { uploadId: id },
};
const operation = {
  operationId: id,
  version: 1,
  kind: "SAVE_ARTIST",
  sourceLocale: "th",
  status: "PROCESSING",
  targetId: id,
  updatedAt: principal.authorizedAt,
  result: null,
  failure: null,
};
const success = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "OPERATION",
  operation,
};
const claim = {
  schemaVersion: 1,
  operation,
  actorId: id,
  sessionId: id,
  requestId: id,
  intent,
  intentHash: "b".repeat(64),
  authorizedUntil: principal.expiresAt,
  leaseTokenDigest: "a".repeat(64),
  leaseExpiresAt: principal.expiresAt,
  checkpoint: {
    retryRequested: false,
    sourceAssetId: null,
    jobs: [],
    preparedMedia: null,
  },
};
function fixture() {
  const operations = {
    authorize: vi
      .fn()
      .mockResolvedValue({ schemaVersion: 1, outcome: "SUCCESS", principal }),
    submit: vi.fn().mockResolvedValue(success),
    read: vi.fn().mockResolvedValue(success),
    retry: vi.fn().mockResolvedValue(success),
    context: vi.fn(),
    list: vi.fn(),
    claim: vi.fn().mockResolvedValue(claim),
    loadClaim: vi.fn().mockResolvedValue(claim),
    checkpoint: vi.fn(),
    defer: vi.fn().mockResolvedValue(success),
    fail: vi.fn(),
    complete: vi.fn(),
  };
  const publication = {
    publish: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      target: { kind: "IDOL", id, handle: "test" },
      publicationId: id,
      revisionId: id,
      headVersion: 1,
      targetVersion: 2,
      publishedAt: principal.authorizedAt,
    }),
  };
  const transactions = {
    runInManagementCenterTransaction: vi.fn(
      async (work: (repos: unknown) => unknown) =>
        work({ operations, publication }),
    ),
  } as unknown as ManagementCenterTransactionManager;
  const resourceManagement = { execute: vi.fn() };
  const useCases = createManagementCenterUseCases({
    transactions,
    resourceManagement,
    tokenPepper: "c".repeat(64),
  });
  const request = {
    schemaVersion: 1,
    requestId: id,
    sessionToken: "a".repeat(42) + "A",
    csrfToken: "b".repeat(42) + "A",
    command: {
      schemaVersion: 1,
      action: "SUBMIT",
      intent,
      idempotencyKey: "management-submit-01",
    },
  };
  return {
    operations,
    publication,
    transactions,
    resourceManagement,
    useCases,
    request,
  };
}
function readyWorkerFixture() {
  const f = fixture();
  const result = {
    targetId: id,
    handle: "test",
    revisionId: id,
    publicationId: id,
    version: 2,
  };
  for (const name of ["claim", "loadClaim"] as const)
    f.operations[name].mockImplementation(
      async (input: { leaseTokenDigest: string }) => ({
        ...claim,
        leaseTokenDigest: input.leaseTokenDigest,
      }),
    );
  f.operations.complete.mockResolvedValue({
    ...success,
    operation: { ...operation, status: "PUBLISHED", result },
  });
  f.operations.fail.mockResolvedValue({
    ...success,
    operation: {
      ...operation,
      status: "FAILED",
      failure: { code: "PUBLICATION_FAILED", retryable: true },
    },
  });
  const media = {
    prepare: vi.fn(async () => ({
      outcome: "READY" as const,
      preparedMedia: null as ManagementCenterPreparedMedia | null,
    })),
  };
  const worker = createManagementCenterWorker({
    transactions: f.transactions,
    media,
    createLeaseToken: () => "a".repeat(64),
    leaseSeconds: 60,
  });
  return { ...f, media, worker };
}
function transactionFailure(
  code:
    | "INTEGRITY_VIOLATION"
    | "TRANSACTION_ABORTED"
    | "TRANSACTION_OUTCOME_UNKNOWN"
    | "UNEXPECTED_ADAPTER_FAILURE",
  retryAfterMs = 250,
) {
  const retryable =
    code === "TRANSACTION_ABORTED" || code === "UNEXPECTED_ADAPTER_FAILURE";
  const recovery = retryable ? "RETRY_SAME_COMMAND" : "NONE";
  return new PersistenceTransactionFailureError({
    schemaVersion: 1,
    operation: "RUN_TRANSACTION",
    outcome: "FAILURE",
    error: {
      schemaVersion: 1,
      code,
      recovery:
        code === "TRANSACTION_OUTCOME_UNKNOWN"
          ? "RECONCILE_REQUIRED"
          : recovery,
      ...(retryable ? { retryAfterMs } : {}),
    },
  });
}
describe("management publication transaction retries", () => {
  afterEach(() => vi.useRealTimers());

  function rollbackFixture(
    abortCount: number,
    error: unknown = transactionFailure("TRANSACTION_ABORTED"),
  ) {
    const f = readyWorkerFixture();
    const state = { publishing: 0, committed: 0, active: false };
    vi.mocked(
      f.transactions.runInManagementCenterTransaction,
    ).mockImplementation(async (work) => {
      const before = f.publication.publish.mock.calls.length;
      state.active = true;
      try {
        const result = await work({
          operations: f.operations,
          publication: f.publication,
        } as never);
        if (f.publication.publish.mock.calls.length > before) {
          state.publishing++;
          // Model COMMIT abort after the callback has also called complete.
          if (state.publishing <= abortCount) throw error;
          if (result === "PUBLISHED") state.committed++;
        }
        return result;
      } finally {
        state.active = false;
      }
    });
    return { ...f, state };
  }

  it("waits for the port delay outside the rolled-back transaction, then commits once", async () => {
    vi.useFakeTimers();
    const f = rollbackFixture(
      1,
      transactionFailure("TRANSACTION_ABORTED", 800),
    );
    const pending = f.worker.processNext();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.state).toEqual({ publishing: 1, committed: 0, active: false });
    expect(f.operations.complete).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(799);
    expect(f.publication.publish).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe("PUBLISHED");
    expect(f.state).toEqual({ publishing: 2, committed: 1, active: false });
    expect(f.operations.loadClaim).toHaveBeenCalledTimes(2);
    expect(f.operations.claim).toHaveBeenCalledTimes(1);
    expect(f.media.prepare).toHaveBeenCalledTimes(1);
    expect(f.operations.fail).not.toHaveBeenCalled();
    expect(f.publication.publish.mock.calls[1]).toEqual(
      f.publication.publish.mock.calls[0],
    );
  });

  it("allows a third total publication attempt without redoing claim or media", async () => {
    vi.useFakeTimers();
    const f = rollbackFixture(2);
    const pending = f.worker.processNext();
    await vi.runAllTimersAsync();
    expect(await pending).toBe("PUBLISHED");
    expect(f.state.committed).toBe(1);
    expect(f.publication.publish).toHaveBeenCalledTimes(3);
    expect(f.operations.loadClaim).toHaveBeenCalledTimes(3);
    expect(f.operations.complete).toHaveBeenCalledTimes(3);
    expect(f.operations.claim).toHaveBeenCalledTimes(1);
    expect(f.media.prepare).toHaveBeenCalledTimes(1);
    expect(f.operations.fail).not.toHaveBeenCalled();
  });

  it("retries a statement abort with the same prepared media before completing", async () => {
    vi.useFakeTimers();
    const f = rollbackFixture(0);
    const preparedMedia: ManagementCenterPreparedMedia = {
      sourceAssetId: id,
      assets: [
        {
          role: "PORTRAIT",
          assetId: id,
          metadataRevisionId: id,
          processingJobId: id,
        },
      ],
    };
    f.media.prepare.mockResolvedValue({ outcome: "READY", preparedMedia });
    const originalLoad = f.operations.loadClaim.getMockImplementation()!;
    f.operations.loadClaim.mockImplementation(async (fence) => ({
      ...(await originalLoad(fence)),
      checkpoint: { ...claim.checkpoint, preparedMedia },
    }));
    f.publication.publish.mockRejectedValueOnce(
      transactionFailure("TRANSACTION_ABORTED"),
    );
    const pending = f.worker.processNext();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.operations.complete).not.toHaveBeenCalled();
    expect(f.state.active).toBe(false);
    await vi.runAllTimersAsync();
    expect(await pending).toBe("PUBLISHED");
    expect(f.operations.loadClaim).toHaveBeenCalledTimes(2);
    expect(f.publication.publish).toHaveBeenCalledTimes(2);
    expect(f.operations.complete).toHaveBeenCalledTimes(1);
    expect(f.state.committed).toBe(1);
    expect(f.media.prepare).toHaveBeenCalledTimes(1);
    expect(f.publication.publish.mock.calls[1]?.[0]).toMatchObject({
      preparedMedia,
    });
    expect(f.publication.publish.mock.calls[1]).toEqual(
      f.publication.publish.mock.calls[0],
    );
  });

  it("records one fenced failure after three aborts, without a fourth publication", async () => {
    vi.useFakeTimers();
    const f = rollbackFixture(3);
    const pending = f.worker.processNext();
    await vi.runAllTimersAsync();
    expect(await pending).toBe("FAILED");
    expect(f.state.committed).toBe(0);
    expect(f.publication.publish).toHaveBeenCalledTimes(3);
    expect(f.operations.loadClaim).toHaveBeenCalledTimes(3);
    expect(f.operations.claim).toHaveBeenCalledTimes(1);
    expect(f.media.prepare).toHaveBeenCalledTimes(1);
    expect(f.operations.fail).toHaveBeenCalledExactlyOnceWith({
      operationId: id,
      leaseTokenDigest: f.operations.claim.mock.calls[0]![0].leaseTokenDigest,
      code: "PUBLICATION_FAILED",
      retryable: true,
    });
  });

  it.each(["authority-or-lease", "intent", "fence", "operation"])(
    "stops if the next transaction reload rejects %s",
    async (invalid) => {
      vi.useFakeTimers();
      const f = rollbackFixture(1);
      const originalLoad = f.operations.loadClaim.getMockImplementation()!;
      f.operations.loadClaim
        .mockImplementationOnce(originalLoad)
        .mockImplementationOnce(async (fence) => {
          const current = await originalLoad(fence);
          if (invalid === "authority-or-lease")
            return {
              schemaVersion: 1,
              outcome: "FAILURE",
              code: "NEEDS_AUTHORIZATION",
            };
          if (invalid === "intent")
            return { ...current, intentHash: "c".repeat(64) };
          if (invalid === "fence")
            return { ...current, leaseTokenDigest: "c".repeat(64) };
          return {
            ...current,
            operation: {
              ...current.operation,
              operationId: "00000000-0000-4000-8000-000000000002",
            },
          };
        });
      const pending = f.worker.processNext();
      await vi.runAllTimersAsync();
      expect(await pending).toBe("UNAVAILABLE");
      expect(f.operations.loadClaim).toHaveBeenCalledTimes(2);
      expect(f.publication.publish).toHaveBeenCalledTimes(1);
      expect(f.state.committed).toBe(0);
      expect(f.operations.fail).not.toHaveBeenCalled();
      expect(f.operations.claim).toHaveBeenCalledTimes(1);
      expect(f.media.prepare).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [
      "unknown commit",
      transactionFailure("TRANSACTION_OUTCOME_UNKNOWN"),
      "UNAVAILABLE",
    ],
    ["integrity", transactionFailure("INTEGRITY_VIOLATION"), "FAILED"],
    [
      "unexpected adapter",
      transactionFailure("UNEXPECTED_ADAPTER_FAILURE"),
      "FAILED",
    ],
    [
      "untyped abort",
      { code: "TRANSACTION_ABORTED", recovery: "RETRY_SAME_COMMAND" },
      "UNAVAILABLE",
    ],
  ])("never replays %s", async (_label, error, expected) => {
    vi.useFakeTimers();
    const f = rollbackFixture(3, error);
    expect(await f.worker.processNext()).toBe(expected);
    expect(f.publication.publish).toHaveBeenCalledTimes(1);
    expect(f.operations.loadClaim).toHaveBeenCalledTimes(1);
    expect(f.media.prepare).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["claim", "media"])(
    "does not retry an abort in %s",
    async (phase) => {
      vi.useFakeTimers();
      const f = readyWorkerFixture();
      if (phase === "claim")
        f.operations.claim.mockRejectedValueOnce(
          transactionFailure("TRANSACTION_ABORTED"),
        );
      else
        f.media.prepare.mockRejectedValueOnce(
          transactionFailure("TRANSACTION_ABORTED"),
        );
      expect(await f.worker.processNext()).toBe("UNAVAILABLE");
      expect(f.operations.claim).toHaveBeenCalledTimes(1);
      expect(f.media.prepare).toHaveBeenCalledTimes(phase === "claim" ? 0 : 1);
      expect(f.publication.publish).not.toHaveBeenCalled();
      expect(f.operations.fail).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
describe("management publication rollback outcomes", () => {
  it.each(["INTEGRITY_VIOLATION", "UNEXPECTED_ADAPTER_FAILURE"] as const)(
    "records a retryable failure in a new fenced transaction only after confirmed %s",
    async (code) => {
      const f = readyWorkerFixture();
      const events: string[] = [];
      let transaction = 0;
      vi.mocked(
        f.transactions.runInManagementCenterTransaction,
      ).mockImplementation(async (work) => {
        const ordinal = ++transaction;
        events.push(`transaction:${ordinal}`);
        const result = await work({
          operations: f.operations,
          publication: f.publication,
        } as never);
        if (ordinal === 2) {
          events.push("rollback:confirmed");
          throw transactionFailure(code);
        }
        return result;
      });
      expect(await f.worker.processNext()).toBe("FAILED");
      expect(events).toEqual([
        "transaction:1",
        "transaction:2",
        "rollback:confirmed",
        "transaction:3",
      ]);
      expect(f.operations.fail).toHaveBeenCalledExactlyOnceWith({
        operationId: id,
        leaseTokenDigest: f.operations.claim.mock.calls[0]![0].leaseTokenDigest,
        code: "PUBLICATION_FAILED",
        retryable: true,
      });
      expect(f.publication.publish).toHaveBeenCalledTimes(1);
      expect(f.operations.complete).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    transactionFailure("TRANSACTION_OUTCOME_UNKNOWN"),
    new Error("pure validation"),
    { code: "INTEGRITY_VIOLATION" },
  ])(
    "does not infer rollback from an unknown commit or untyped exception",
    async (error) => {
      const f = readyWorkerFixture();
      let transaction = 0;
      vi.mocked(
        f.transactions.runInManagementCenterTransaction,
      ).mockImplementation(async (work) => {
        const ordinal = ++transaction;
        const result = await work({
          operations: f.operations,
          publication: f.publication,
        } as never);
        if (ordinal === 2) throw error;
        return result;
      });
      expect(await f.worker.processNext()).toBe("UNAVAILABLE");
      expect(transaction).toBe(2);
      expect(f.operations.fail).not.toHaveBeenCalled();
      expect(f.operations.complete).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["revoked", "unknown-failure-commit"])(
    "does not report FAILED if fresh failure recording is %s",
    async (mode) => {
      const f = readyWorkerFixture();
      let transaction = 0;
      if (mode === "revoked")
        f.operations.fail.mockResolvedValue({
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "NEEDS_AUTHORIZATION",
        });
      vi.mocked(
        f.transactions.runInManagementCenterTransaction,
      ).mockImplementation(async (work) => {
        const ordinal = ++transaction;
        const result = await work({
          operations: f.operations,
          publication: f.publication,
        } as never);
        if (ordinal === 2) throw transactionFailure("INTEGRITY_VIOLATION");
        if (ordinal === 3 && mode === "unknown-failure-commit")
          throw transactionFailure("TRANSACTION_OUTCOME_UNKNOWN");
        return result;
      });
      expect(await f.worker.processNext()).toBe("UNAVAILABLE");
      expect(transaction).toBe(3);
      expect(f.operations.fail).toHaveBeenCalledTimes(1);
    },
  );
  it("never records a publication failure when claiming itself aborts", async () => {
    const f = readyWorkerFixture();
    vi.mocked(
      f.transactions.runInManagementCenterTransaction,
    ).mockRejectedValue(transactionFailure("TRANSACTION_ABORTED"));
    expect(await f.worker.processNext()).toBe("UNAVAILABLE");
    expect(f.operations.fail).not.toHaveBeenCalled();
    expect(f.publication.publish).not.toHaveBeenCalled();
  });
});
describe("management orchestration", () => {
  it("authorizes actual source locale and persists only credential digests and IDs", async () => {
    const f = fixture();
    expect(await f.useCases.execute(f.request)).toEqual(success);
    expect(f.operations.authorize.mock.calls[0]?.[0]).toMatchObject({
      sourceLocale: "th",
    });
    const stored = f.operations.submit.mock.calls[0]?.[0];
    expect(stored).toMatchObject({ principal, intent });
    expect(JSON.stringify(stored)).not.toContain(f.request.sessionToken);
    expect(JSON.stringify(stored)).not.toContain(f.request.csrfToken);
  });
  it("does not create anything when actual authority is revoked", async () => {
    const f = fixture();
    f.operations.authorize.mockResolvedValue({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "FORBIDDEN",
    });
    expect(await f.useCases.execute(f.request)).toMatchObject({
      outcome: "FAILURE",
      code: "FORBIDDEN",
    });
    expect(f.operations.submit).not.toHaveBeenCalled();
  });
  it("rejects raw credentials injected into command data", async () => {
    const f = fixture();
    expect(
      await f.useCases.execute({
        ...f.request,
        command: { ...f.request.command, actorId: id },
      }),
    ).toMatchObject({ code: "INVALID_COMMAND" });
    expect(f.operations.authorize).not.toHaveBeenCalled();
  });
  it("replays upload preparation with stable rights evidence across request IDs", async () => {
    const f = fixture();
    f.resourceManagement.execute.mockResolvedValue({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CONTENT_UNAVAILABLE",
    });
    const request = {
      ...f.request,
      command: {
        schemaVersion: 1,
        action: "PREPARE_UPLOAD",
        checksumSha256: "d".repeat(64),
        byteSize: 100,
        mimeType: "image/jpeg",
        rightsConfirmed: true,
        idempotencyKey: "management-upload-01",
      },
    };
    await f.useCases.execute(request);
    await f.useCases.execute({ ...request, requestId: id.replace(/1$/u, "2") });
    expect(f.resourceManagement.execute.mock.calls[0]?.[0].command).toEqual(
      f.resourceManagement.execute.mock.calls[1]?.[0].command,
    );
  });
  it("does not call publication until actual media preparation is READY", async () => {
    const f = fixture();
    const media = {
      prepare: vi.fn().mockResolvedValue({ outcome: "PENDING" }),
    };
    const worker = createManagementCenterWorker({
      transactions: f.transactions,
      media,
      createLeaseToken: () => "a".repeat(64),
      leaseSeconds: 60,
    });
    f.operations.claim.mockResolvedValue(null);
    expect(await worker.processNext()).toBe("EMPTY");
    f.operations.claim.mockImplementation(
      async (input: { leaseTokenDigest: string }) => ({
        ...claim,
        leaseTokenDigest: input.leaseTokenDigest,
      }),
    );
    expect(await worker.processNext()).toBe("PENDING");
    expect(f.publication.publish).not.toHaveBeenCalled();
    expect(f.operations.defer).toHaveBeenCalledTimes(1);
  });
  it("checks the current delegation again after slow media work", async () => {
    const f = fixture();
    f.operations.claim.mockImplementation(
      async (input: { leaseTokenDigest: string }) => ({
        ...claim,
        leaseTokenDigest: input.leaseTokenDigest,
      }),
    );
    f.operations.loadClaim.mockResolvedValue({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "NEEDS_AUTHORIZATION",
    });
    const worker = createManagementCenterWorker({
      transactions: f.transactions,
      media: {
        prepare: vi
          .fn()
          .mockResolvedValue({ outcome: "READY", preparedMedia: null }),
      },
      createLeaseToken: () => "a".repeat(64),
      leaseSeconds: 60,
    });
    expect(await worker.processNext()).toBe("UNAVAILABLE");
    expect(f.publication.publish).not.toHaveBeenCalled();
  });
  it("does not report published when the final receipt commit is uncertain", async () => {
    const f = fixture();
    f.operations.claim.mockImplementation(
      async (input: { leaseTokenDigest: string }) => ({
        ...claim,
        leaseTokenDigest: input.leaseTokenDigest,
      }),
    );
    f.operations.complete.mockRejectedValue(new Error("commit unknown"));
    f.operations.loadClaim.mockImplementation(
      async (input: { leaseTokenDigest: string }) => ({
        ...claim,
        leaseTokenDigest: input.leaseTokenDigest,
      }),
    );
    const worker = createManagementCenterWorker({
      transactions: f.transactions,
      media: {
        prepare: vi
          .fn()
          .mockResolvedValue({ outcome: "READY", preparedMedia: null }),
      },
      createLeaseToken: () => "a".repeat(64),
      leaseSeconds: 60,
    });
    expect(await worker.processNext()).toBe("UNAVAILABLE");
    expect(f.operations.complete).toHaveBeenCalledTimes(1);
    expect(f.operations.fail).not.toHaveBeenCalled();
  });
  it("rejects a loadClaim result from a different operation before publication", async () => {
    const f = fixture();
    f.operations.claim.mockImplementation(
      async (input: { leaseTokenDigest: string }) => ({
        ...claim,
        leaseTokenDigest: input.leaseTokenDigest,
      }),
    );
    f.operations.loadClaim.mockImplementation(
      async (input: { leaseTokenDigest: string }) => ({
        ...claim,
        leaseTokenDigest: input.leaseTokenDigest,
        operation: { ...operation, operationId: id.replace(/1$/u, "2") },
      }),
    );
    const worker = createManagementCenterWorker({
      transactions: f.transactions,
      media: {
        prepare: vi
          .fn()
          .mockResolvedValue({ outcome: "READY", preparedMedia: null }),
      },
      createLeaseToken: () => "a".repeat(64),
      leaseSeconds: 60,
    });
    expect(await worker.processNext()).toBe("UNAVAILABLE");
    expect(f.publication.publish).not.toHaveBeenCalled();
  });
  it("publishes only after the exact publication and operation receipt succeed in one transaction", async () => {
    const f = fixture();
    const result = {
      targetId: id,
      handle: "test",
      revisionId: id,
      publicationId: id,
      version: 2,
    };
    f.operations.claim.mockImplementation(
      async (input: { leaseTokenDigest: string }) => ({
        ...claim,
        leaseTokenDigest: input.leaseTokenDigest,
      }),
    );
    f.operations.loadClaim.mockImplementation(
      async (input: { leaseTokenDigest: string }) => ({
        ...claim,
        leaseTokenDigest: input.leaseTokenDigest,
      }),
    );
    f.operations.complete.mockResolvedValue({
      ...success,
      operation: { ...operation, status: "PUBLISHED", result },
    });
    const worker = createManagementCenterWorker({
      transactions: f.transactions,
      media: {
        prepare: vi
          .fn()
          .mockResolvedValue({ outcome: "READY", preparedMedia: null }),
      },
      createLeaseToken: () => "a".repeat(64),
      leaseSeconds: 60,
    });
    expect(await worker.processNext()).toBe("PUBLISHED");
    expect(f.operations.complete).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: id, result }),
    );
    expect(
      f.transactions.runInManagementCenterTransaction,
    ).toHaveBeenCalledTimes(2);
  });
  it("a target version conflict requires a fresh edit rather than advertising a blind retry", async () => {
    const f = fixture();
    f.operations.claim.mockImplementation(
      async (input: { leaseTokenDigest: string }) => ({
        ...claim,
        leaseTokenDigest: input.leaseTokenDigest,
      }),
    );
    f.operations.loadClaim.mockImplementation(
      async (input: { leaseTokenDigest: string }) => ({
        ...claim,
        leaseTokenDigest: input.leaseTokenDigest,
      }),
    );
    f.publication.publish.mockResolvedValue({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "TARGET_CONFLICT",
    });
    f.operations.fail.mockResolvedValue({
      ...success,
      operation: {
        ...operation,
        status: "FAILED",
        failure: { code: "TARGET_CONFLICT", retryable: false },
      },
    });
    const worker = createManagementCenterWorker({
      transactions: f.transactions,
      media: {
        prepare: vi
          .fn()
          .mockResolvedValue({ outcome: "READY", preparedMedia: null }),
      },
      createLeaseToken: () => "a".repeat(64),
      leaseSeconds: 60,
    });
    expect(await worker.processNext()).toBe("FAILED");
    expect(f.operations.fail).toHaveBeenCalledWith(
      expect.objectContaining({ code: "TARGET_CONFLICT", retryable: false }),
    );
  });
  it("an unrelated publication result cannot complete this operation", async () => {
    const f = fixture();
    f.operations.claim.mockImplementation(
      async (input: { leaseTokenDigest: string }) => ({
        ...claim,
        leaseTokenDigest: input.leaseTokenDigest,
      }),
    );
    f.operations.loadClaim.mockImplementation(
      async (input: { leaseTokenDigest: string }) => ({
        ...claim,
        leaseTokenDigest: input.leaseTokenDigest,
      }),
    );
    f.publication.publish.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      target: { kind: "GIFT", id, handle: "test" },
      publicationId: id,
      revisionId: id,
      headVersion: 1,
      targetVersion: 2,
      publishedAt: principal.authorizedAt,
    });
    const worker = createManagementCenterWorker({
      transactions: f.transactions,
      media: {
        prepare: vi
          .fn()
          .mockResolvedValue({ outcome: "READY", preparedMedia: null }),
      },
      createLeaseToken: () => "a".repeat(64),
      leaseSeconds: 60,
    });
    expect(await worker.processNext()).toBe("UNAVAILABLE");
    expect(f.operations.complete).not.toHaveBeenCalled();
  });
});

it.each([false, true])(
  "authorizes the stable original through canonical transaction snapshots (normalized UUID target: %s)",
  async (normalizeTarget) => {
    const f = fixture();
    const target = {
      kind: "ARTIST",
      id: "A1000000-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
      expectedVersion: 2,
    };
    const resolvedTarget = normalizeTarget
      ? { ...target, id: target.id.toLowerCase() }
      : target;
    const source = {
      assetId: id,
      metadataRevisionId: id,
      objectKey: "uploads/original.png",
      checksumSha256: "a".repeat(64),
      mimeType: "image/png",
      width: 1600,
      height: 2400,
      byteSize: 100,
    };
    const readImageSource = vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      target: resolvedTarget,
      currentImage: { assetId: id, metadataRevisionId: id },
      focalPoint: { x: 0.5, y: 0.3 },
      source,
      orientation: 6,
    }));
    let inTransaction = false;
    const storage = {
      createDownloadGrant: vi.fn(
        async (input: CreateMediaDownloadGrantCommand) => {
          expect(inTransaction).toBe(false);
          return {
            schemaVersion: 1 as const,
            outcome: "SUCCESS" as const,
            operation: "CREATE_DOWNLOAD_GRANT" as const,
            value: {
              storageClass: input.storageClass,
              objectKey: input.objectKey,
              expiresAt: input.expiresAt,
              method: "GET" as const,
              url: credentiallessHttpsUrlSchema.parse(
                "https://media.example.test/temporary",
              ),
              headers: {},
            },
          };
        },
      ),
    };
    const useCases = createManagementCenterUseCases({
      tokenPepper: "c".repeat(64),
      resourceManagement: { execute: vi.fn() },
      storage,
      transactions: {
        runInManagementCenterTransaction: async (work) => {
          inTransaction = true;
          try {
            const result = await work({
              operations: { ...f.operations, readImageSource },
              publication: {},
            } as never);
            // Real transaction-runner returns immutable snapshots with alphabetically ordered keys.
            return JSON.parse(
              JSON.stringify(result, (_key, value: unknown) =>
                value !== null &&
                typeof value === "object" &&
                !Array.isArray(value)
                  ? Object.fromEntries(
                      Object.entries(value).sort(([left], [right]) =>
                        left < right ? -1 : left > right ? 1 : 0,
                      ),
                    )
                  : value,
              ),
            );
          } finally {
            inTransaction = false;
          }
        },
      },
    });
    const result = await useCases.execute({
      ...f.request,
      command: { schemaVersion: 1, action: "READ_IMAGE_SOURCE", target },
    });
    expect(result).toMatchObject({
      outcome: "SUCCESS",
      kind: "ORIGINAL_IMAGE",
      sourceWidth: 2400,
      sourceHeight: 1600,
      target: resolvedTarget,
    });
    expect(JSON.stringify(result)).not.toContain("objectKey");
    expect(storage.createDownloadGrant).toHaveBeenCalledOnce();
  },
);

it.each(["session", "source", "time"])(
  "does not release a signed original when %s changes while signing",
  async (change) => {
    const f = fixture();
    const target = { kind: "ARTIST", id, expectedVersion: 2 };
    const original = {
      schemaVersion: 1,
      outcome: "SUCCESS",
      target,
      currentImage: { assetId: id, metadataRevisionId: id },
      focalPoint: { x: 0.5, y: 0.3 },
      source: {
        assetId: id,
        metadataRevisionId: id,
        objectKey: "uploads/original.png",
        checksumSha256: "a".repeat(64),
        mimeType: "image/png",
        width: 1600,
        height: 2400,
        byteSize: 100,
      },
      orientation: 6,
    };
    const readImageSource = vi.fn(async () => original);
    const storage = {
      createDownloadGrant: vi.fn(
        async (input: CreateMediaDownloadGrantCommand) => {
          if (change === "session")
            f.operations.authorize.mockResolvedValue({
              schemaVersion: 1,
              outcome: "FAILURE",
              code: "UNAUTHENTICATED",
            } as never);
          if (change === "source")
            readImageSource.mockResolvedValue({
              ...original,
              source: { ...original.source, checksumSha256: "b".repeat(64) },
            });
          if (change === "time")
            f.operations.authorize.mockResolvedValue({
              schemaVersion: 1,
              outcome: "SUCCESS",
              principal: { ...principal, authorizedAt: "2026-09-08T00:03:00Z" },
            });
          return {
            schemaVersion: 1 as const,
            outcome: "SUCCESS" as const,
            operation: "CREATE_DOWNLOAD_GRANT" as const,
            value: {
              storageClass: input.storageClass,
              objectKey: input.objectKey,
              expiresAt: input.expiresAt,
              method: "GET" as const,
              url: credentiallessHttpsUrlSchema.parse(
                "https://media.example.test/temporary",
              ),
              headers: {},
            },
          };
        },
      ),
    };
    const useCases = createManagementCenterUseCases({
      tokenPepper: "c".repeat(64),
      resourceManagement: { execute: vi.fn() },
      storage,
      transactions: {
        runInManagementCenterTransaction: (work) =>
          work({
            operations: { ...f.operations, readImageSource },
            publication: {},
          } as never),
      },
    });
    const result = await useCases.execute({
      ...f.request,
      command: { schemaVersion: 1, action: "READ_IMAGE_SOURCE", target },
    });
    expect(result.outcome).toBe("FAILURE");
    expect(JSON.stringify(result)).not.toContain("temporary");
  },
);

import { describe, expect, it, vi } from "vitest";
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
  const worker = createManagementCenterWorker({
    transactions: f.transactions,
    media: { prepare: async () => ({ outcome: "READY", preparedMedia: null }) },
    createLeaseToken: () => "a".repeat(64),
    leaseSeconds: 60,
  });
  return { ...f, worker };
}
function transactionFailure(
  code:
    | "INTEGRITY_VIOLATION"
    | "TRANSACTION_ABORTED"
    | "TRANSACTION_OUTCOME_UNKNOWN"
    | "UNEXPECTED_ADAPTER_FAILURE",
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
      ...(retryable ? { retryAfterMs: 250 } : {}),
    },
  });
}
describe("management publication rollback outcomes", () => {
  it.each([
    "INTEGRITY_VIOLATION",
    "TRANSACTION_ABORTED",
    "UNEXPECTED_ADAPTER_FAILURE",
  ] as const)(
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
        if (ordinal === 2) throw transactionFailure("TRANSACTION_ABORTED");
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

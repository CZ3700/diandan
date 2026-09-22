import { expect, test, vi } from "vitest";
import type {
  AdminExceptionsRepository,
  AdminExceptionsTransactionManager,
} from "@fan-support/persistence-port";
const application = await import("./admin-exceptions.js").catch(
  () => undefined,
);
const recovery = await import("./admin-exceptions-recovery.js").catch(
  () => undefined,
);
const id = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002";
const target = { kind: "WEBHOOK" as const, id, consumerKey: null };
const request = {
  schemaVersion: 1,
  requestId: other,
  sessionToken: "a".repeat(42) + "A",
  csrfToken: "b".repeat(42) + "A",
  command: {
    schemaVersion: 1,
    action: "REPLAY_WEBHOOK",
    target,
    expectedVersion: "c".repeat(64),
    idempotencyKey: "exceptions-key-0001",
    reasonCode: "RETRY_AFTER_REPAIR",
    confirmed: true,
  },
};
const receipt = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "MUTATION",
  action: "REPLAY_WEBHOOK",
  target,
  operationId: other,
  replayed: false,
};
function fixture() {
  const repository = {
    execute: vi.fn(async () => receipt),
    claim: vi.fn(async () => null),
    settle: vi.fn(async () => ({
      schemaVersion: 1,
      operationId: other,
      decision: "RECORDED",
    })),
  };
  const transactions: AdminExceptionsTransactionManager = {
    runInAdminExceptionsTransaction: async (work) =>
      work(repository as unknown as AdminExceptionsRepository),
  };
  return { repository, transactions };
}
test("exception commands store token digests and stable request identity without dispatching side effects", async () => {
  expect(application?.createAdminExceptionsUseCases).toBeTypeOf("function");
  const { repository, transactions } = fixture();
  const useCases = application!.createAdminExceptionsUseCases({
    transactions,
    tokenPepper: "d".repeat(64),
  });
  expect(await useCases.execute(request)).toEqual(receipt);
  expect(await useCases.execute({ ...request, requestId: id })).toEqual(
    receipt,
  );
  const saved = repository.execute.mock.calls as unknown as [
    Record<string, unknown>,
  ][];
  expect(JSON.stringify(saved)).not.toContain(request.sessionToken);
  expect(JSON.stringify(saved)).not.toContain(request.csrfToken);
  expect(saved[0]![0]["requestHash"]).toEqual(saved[1]![0]["requestHash"]);
  expect(repository.claim).not.toHaveBeenCalled();
});
test("invalid input, wrong-target receipts and repository failures fail closed", async () => {
  expect(application?.createAdminExceptionsUseCases).toBeTypeOf("function");
  const { repository, transactions } = fixture();
  const useCases = application!.createAdminExceptionsUseCases({
    transactions,
    tokenPepper: "d".repeat(64),
  });
  expect(
    await useCases.execute({
      ...request,
      command: { ...request.command, confirmed: false },
    }),
  ).toMatchObject({ outcome: "FAILURE", code: "INVALID_COMMAND" });
  expect(repository.execute).not.toHaveBeenCalled();
  repository.execute.mockResolvedValue({
    ...receipt,
    target: { ...target, id: other },
  });
  expect(await useCases.execute(request)).toMatchObject({
    code: "TEMPORARY_UNAVAILABLE",
  });
  repository.execute.mockRejectedValue(new Error("private backend details"));
  expect(await useCases.execute(request)).toMatchObject({
    code: "TEMPORARY_UNAVAILABLE",
  });
});
const job = {
  schemaVersion: 1,
  jobType: "PROCESS_WEBHOOK_INBOX",
  webhookInboxId: id,
  correlationId: other,
  propagation: {
    schemaVersion: 1,
    requestId: other,
    traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
  },
};
const claim = {
  schemaVersion: 1,
  operationId: other,
  action: "REPLAY_WEBHOOK",
  target,
  generation: 1,
  leaseTokenDigest: "e".repeat(64),
  leaseExpiresAt: "2026-09-22T00:01:00.000Z",
  job,
};
test.each([false, true])(
  "recovery preserves business identity and settles one processing budget; failure=%s",
  async (fails) => {
    expect(recovery?.createAdminExceptionsRecovery).toBeTypeOf("function");
    const { repository, transactions } = fixture();
    repository.claim.mockImplementationOnce(
      async (...args: unknown[]) =>
        ({
          ...claim,
          leaseTokenDigest: (args[0] as { leaseTokenDigest: string })
            .leaseTokenDigest,
        }) as never,
    );
    const processWebhookInbox = vi.fn(async () => {
      if (fails) throw new Error("private handler failure");
    });
    const dispatchOutboxEvent = vi.fn(async () => undefined);
    const worker = recovery!.createAdminExceptionsRecovery({
      transactions,
      processWebhookInbox,
      dispatchOutboxEvent,
    });
    expect(await worker.runPending(6)).toEqual({
      schemaVersion: 1,
      scanned: 1,
      succeeded: fails ? 0 : 1,
      failed: fails ? 1 : 0,
    });
    expect(processWebhookInbox).toHaveBeenCalledWith(job, {
      schemaVersion: 1,
      jobId: other,
      attemptNumber: 6,
      maxAttempts: 6,
    });
    expect(dispatchOutboxEvent).not.toHaveBeenCalled();
    expect(repository.settle).toHaveBeenCalledWith({
      schemaVersion: 1,
      claim: {
        ...claim,
        leaseTokenDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
      outcome: fails ? "FAILED" : "SUCCEEDED",
      reasonCode: fails ? "PROCESSING_FAILED" : "PROCESSED",
    });
  },
);
test("dead-letter recovery rejects unregistered consumers and never changes their identity", async () => {
  expect(recovery?.createAdminExceptionsRecovery).toBeTypeOf("function");
  const { repository, transactions } = fixture();
  const dead = {
    ...claim,
    action: "RETRY_DEAD_LETTER",
    target: { kind: "DEAD_LETTER", id, consumerKey: "unknown-consumer" },
    job: {
      schemaVersion: 1,
      jobType: "DISPATCH_OUTBOX_EVENT",
      outboxEventId: id,
      consumerKey: "unknown-consumer",
      correlationId: job.correlationId,
      propagation: job.propagation,
    },
  };
  repository.claim.mockImplementationOnce(
    async (...args: unknown[]) =>
      ({
        ...dead,
        leaseTokenDigest: (args[0] as { leaseTokenDigest: string })
          .leaseTokenDigest,
      }) as never,
  );
  const dispatchOutboxEvent = vi.fn(async () => undefined);
  const worker = recovery!.createAdminExceptionsRecovery({
    transactions,
    processWebhookInbox: async () => undefined,
    dispatchOutboxEvent,
  });
  expect(await worker.runPending(1)).toMatchObject({ failed: 1 });
  expect(dispatchOutboxEvent).not.toHaveBeenCalled();
});
test("mismatched lease digest never dispatches", async () => {
  const { repository, transactions } = fixture();
  repository.claim.mockResolvedValueOnce(claim as never);
  const processWebhookInbox = vi.fn(async () => undefined);
  const worker = recovery!.createAdminExceptionsRecovery({
    transactions,
    processWebhookInbox,
    dispatchOutboxEvent: async () => undefined,
  });
  await expect(worker.runPending(1)).rejects.toThrow();
  expect(processWebhookInbox).not.toHaveBeenCalled();
});
test.each([
  { operationId: other, decision: "STALE" },
  { operationId: id, decision: "RECORDED" },
])(
  "stale or unrelated settlement never counts as successful: %s",
  async (settlement) => {
    const { repository, transactions } = fixture();
    const worker = recovery!.createAdminExceptionsRecovery({
      transactions,
      processWebhookInbox: async () => undefined,
      dispatchOutboxEvent: async () => undefined,
    });
    repository.claim.mockImplementationOnce(
      async (...args: unknown[]) =>
        ({
          ...claim,
          leaseTokenDigest: (args[0] as { leaseTokenDigest: string })
            .leaseTokenDigest,
        }) as never,
    );
    repository.settle.mockResolvedValueOnce({
      schemaVersion: 1,
      ...settlement,
    });
    expect(await worker.runPending(1)).toMatchObject({
      succeeded: 0,
      failed: 1,
    });
  },
);

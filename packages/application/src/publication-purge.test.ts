import { expect, test, vi } from "vitest";
import type { CachePurgePort } from "@fan-support/cache-purge-port";
import {
  idempotencyKeySchema,
  type PublicationPurgeClaim,
} from "@fan-support/contracts";
import type {
  PublicationPurgeRepository,
  PublicationPurgeTransactionManager,
} from "@fan-support/persistence-port";
import { createPublicationPurgeUseCases } from "./publication-purge.js";

const id = (n: number) =>
  `85000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-09-06T10:00:00.000001Z";
function harness(submitted = false) {
  let inTransaction = false;
  const claim: PublicationPurgeClaim = {
    schemaVersion: 1,
    leaseToken: id(2),
    version: 2,
    purgeReference: submitted ? "purge-fixture" : null,
    paths: ["/ja/idols/fixture", "/ja/idols*"],
    idempotencyKey: idempotencyKeySchema.parse(`publication-purge:${id(1)}`),
    job: {
      schemaVersion: 1,
      id: id(1),
      publicationId: id(3),
      outboxEventId: id(4),
      locale: "ja",
      generation: 1,
      retryOf: null,
      status: submitted ? "SUBMITTED" : "PENDING",
      version: 2,
      attemptCount: 1,
      failureCount: 0,
      createdAt: at,
      updatedAt: at,
      nextAttemptAt: at,
      completedAt: null,
      errorCode: null,
    },
  };
  const take = vi.fn<PublicationPurgeRepository["claim"]>(async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    claim,
  }));
  const record = vi.fn<PublicationPurgeRepository["record"]>(
    async (command) => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      job: {
        ...claim.job,
        version: 3,
        status:
          command.result.kind === "SUBMITTED"
            ? "SUBMITTED"
            : command.result.kind === "COMPLETED"
              ? "COMPLETED"
              : claim.job.status,
        completedAt: command.result.kind === "COMPLETED" ? at : null,
        failureCount:
          claim.job.failureCount + (command.result.kind === "FAILURE" ? 1 : 0),
        errorCode:
          command.result.kind === "FAILURE" ? command.result.code : null,
      },
    }),
  );
  const transactions: PublicationPurgeTransactionManager = {
    async runInPublicationPurgeTransaction(work) {
      inTransaction = true;
      try {
        return await work({ publicationPurge: { claim: take, record } });
      } finally {
        inTransaction = false;
      }
    },
  };
  const submit = vi.fn<CachePurgePort["submitPurge"]>(async () => {
    expect(inTransaction).toBe(false);
    return {
      schemaVersion: 1,
      operation: "SUBMIT_PURGE",
      outcome: "SUCCESS",
      value: {
        purgeReference: "purge-fixture",
        status: "PENDING",
        submittedAt: at,
      },
    };
  });
  const poll = vi.fn<CachePurgePort["getPurgeStatus"]>(async () => {
    expect(inTransaction).toBe(false);
    return {
      schemaVersion: 1,
      operation: "GET_PURGE_STATUS",
      outcome: "SUCCESS",
      value: {
        purgeReference: "purge-fixture",
        status: "COMPLETED",
        completedAt: at,
      },
    };
  });
  return {
    claim,
    take,
    record,
    submit,
    poll,
    useCases: createPublicationPurgeUseCases({
      transactions,
      cachePurge: { submitPurge: submit, getPurgeStatus: poll },
    }),
  };
}
test("no due content job means no provider request", async () => {
  const h = harness();
  h.take.mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    claim: null,
  });
  expect(await h.useCases.processNext()).toEqual({
    schemaVersion: 1,
    outcome: "IDLE",
  });
  expect(h.submit).not.toHaveBeenCalled();
});
test("pending submission is recorded with its reference and never reported completed", async () => {
  const h = harness();
  expect(await h.useCases.processNext()).toMatchObject({
    outcome: "RECORDED",
    status: "SUBMITTED",
  });
  expect(h.submit).toHaveBeenCalledWith({
    schemaVersion: 1,
    operation: "SUBMIT_PURGE",
    idempotencyKey: h.claim.idempotencyKey,
    paths: h.claim.paths,
  });
  expect(h.record).toHaveBeenCalledWith({
    schemaVersion: 1,
    jobId: id(1),
    leaseToken: id(2),
    expectedVersion: 2,
    result: { kind: "SUBMITTED", purgeReference: "purge-fixture" },
  });
  expect(h.poll).not.toHaveBeenCalled();
});
test("resumed submitted job polls outside SQL and records actual completion", async () => {
  const h = harness(true);
  expect(await h.useCases.processNext()).toMatchObject({
    outcome: "RECORDED",
    status: "COMPLETED",
  });
  expect(h.submit).not.toHaveBeenCalled();
  expect(h.poll).toHaveBeenCalledWith({
    schemaVersion: 1,
    operation: "GET_PURGE_STATUS",
    purgeReference: "purge-fixture",
  });
});
test("pending poll does not become completion or failure", async () => {
  const h = harness(true);
  h.poll.mockResolvedValue({
    schemaVersion: 1,
    operation: "GET_PURGE_STATUS",
    outcome: "SUCCESS",
    value: { purgeReference: "purge-fixture", status: "PENDING" },
  });
  expect(await h.useCases.processNext()).toMatchObject({ status: "SUBMITTED" });
  expect(h.record.mock.calls[0]?.[0].result).toEqual({ kind: "PENDING" });
});
test("provider errors persist safe retry policy without leaking messages", async () => {
  const h = harness();
  h.submit.mockRejectedValue(new Error("private provider secret"));
  const result = await h.useCases.processNext();
  expect(result).toMatchObject({ outcome: "RECORDED" });
  expect(h.record.mock.calls[0]?.[0].result).toEqual({
    kind: "FAILURE",
    code: "UNEXPECTED_ADAPTER_FAILURE",
    retryable: true,
  });
  expect(JSON.stringify(result)).not.toContain("secret");
});
test("wrong poll reference cannot certify completion", async () => {
  const h = harness(true);
  h.poll.mockResolvedValue({
    schemaVersion: 1,
    operation: "GET_PURGE_STATUS",
    outcome: "SUCCESS",
    value: {
      purgeReference: "unrelated",
      status: "COMPLETED",
      completedAt: at,
    },
  });
  await h.useCases.processNext();
  expect(h.record.mock.calls[0]?.[0].result).toMatchObject({
    kind: "FAILURE",
    code: "INVALID_PROVIDER_RESPONSE",
    retryable: false,
  });
});
test("lost lease cannot report a provider result as durable completion", async () => {
  const h = harness(true);
  h.record.mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "STALE_VERSION",
  });
  expect(await h.useCases.processNext()).toEqual({
    schemaVersion: 1,
    outcome: "UNAVAILABLE",
  });
});
test("provider timeout releases the worker for durable retry and ignores late response", async () => {
  vi.useFakeTimers();
  try {
    const h = harness();
    h.submit.mockImplementation(() => new Promise(() => {}));
    const run = h.useCases.processNext();
    await vi.advanceTimersByTimeAsync(30_001);
    expect(await run).toMatchObject({ outcome: "RECORDED" });
    expect(h.record.mock.calls[0]?.[0].result).toMatchObject({
      kind: "FAILURE",
      retryable: true,
    });
  } finally {
    vi.useRealTimers();
  }
});
test("structured provider failures retain their explicit retry policy", async () => {
  const h = harness();
  h.submit.mockResolvedValue({
    schemaVersion: 1,
    operation: "SUBMIT_PURGE",
    outcome: "FAILURE",
    error: { schemaVersion: 1, code: "ACCESS_DENIED", recovery: "NONE" },
  });
  await h.useCases.processNext();
  expect(h.record.mock.calls[0]?.[0].result).toEqual({
    kind: "FAILURE",
    code: "ACCESS_DENIED",
    retryable: false,
  });
});
test("a pending provider result cannot be reported as completed by the repository", async () => {
  const h = harness();
  h.record.mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    job: { ...h.claim.job, version: 3, status: "COMPLETED", completedAt: at },
  });
  expect(await h.useCases.processNext()).toEqual({
    schemaVersion: 1,
    outcome: "UNAVAILABLE",
  });
});
for (const change of [
  { publicationId: id(99) },
  { outboxEventId: id(99) },
  { locale: "en" as const },
  { generation: 2, retryOf: id(99) },
])
  test(`record cannot change the claimed ${Object.keys(change)[0]}`, async () => {
    const h = harness();
    h.record.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      job: { ...h.claim.job, ...change, version: 3, status: "SUBMITTED" },
    });
    expect(await h.useCases.processNext()).toEqual({
      schemaVersion: 1,
      outcome: "UNAVAILABLE",
    });
  });

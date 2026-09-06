import { expect, test, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
  sourceHashSchema,
  publicationRuntimeRequestSchema,
  type PublicationRuntimeContext,
  type PublicationRuntimeResponse,
} from "@fan-support/contracts";
import { computeContentAuthoringSnapshotHash } from "@fan-support/content";
import type {
  PublicationRuntimeRepositories,
  PublicationRuntimeTransactionManager,
} from "@fan-support/persistence-port";
import { policyPreflightFixture } from "./publication-preflight-fixtures.js";
import { createPublicationRuntimeUseCases } from "./publication-runtime.js";

const id = (n: number) =>
  `86000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tokenPepper = "bd".repeat(32);
const fail = (code: "FORBIDDEN" | "NOT_FOUND" = "NOT_FOUND") => ({
  schemaVersion: 1 as const,
  outcome: "FAILURE" as const,
  code,
});
function harness(action: "VALIDATE" | "PUBLISH" = "VALIDATE") {
  const preflight = policyPreflightFixture();
  if (action === "PUBLISH") {
    preflight.snapshot.lifecycle = {
      status: "VALIDATED",
      validatedAt: "2026-09-06T08:30:00Z",
    };
    if (preflight.candidate.objectKind === "POLICY")
      preflight.candidate.revision.lifecycle = preflight.snapshot.lifecycle;
    preflight.snapshot.contentHash = sourceHashSchema.parse(
      computeContentAuthoringSnapshotHash(preflight.snapshot),
    );
  }
  const context: PublicationRuntimeContext = {
    schemaVersion: 1,
    preflight,
    previousManifest: null,
    mediaPublications: [],
  };
  const request = {
    schemaVersion: 1,
    requestId: id(1),
    sessionToken: Buffer.alloc(32, 5).toString("base64url"),
    csrfToken: Buffer.alloc(32, 6).toString("base64url"),
    command: {
      schemaVersion: 1,
      action,
      target: preflight.target,
      expectedVersion: preflight.headVersion,
      expectedContentHash: preflight.snapshot.contentHash,
      reasonCode: "CONTENT_APPROVED",
      idempotencyKey: "publication-fixture-key",
    },
  };
  publicationRuntimeRequestSchema.parse(request);
  const events: string[] = [];
  const authorize = vi.fn<
    PublicationRuntimeRepositories["authorization"]["authorize"]
  >(async () => {
    events.push("authorize");
    return {
      schemaVersion: 1,
      outcome: "SUCCESS",
      principal: {
        schemaVersion: 1,
        actorId: id(2),
        sessionId: id(3),
        authorizedAt: "2026-09-06T09:00:00Z",
        expiresAt: "2026-09-06T10:00:00Z",
      },
    };
  });
  const begin = vi.fn<PublicationRuntimeRepositories["idempotency"]["begin"]>(
    async () => {
      events.push("begin");
      return {
        schemaVersion: 1,
        operation: "BEGIN_IDEMPOTENCY",
        outcome: "SUCCESS",
        value: { decision: "STARTED" },
      };
    },
  );
  const complete = vi.fn<
    PublicationRuntimeRepositories["idempotency"]["complete"]
  >(async () => {
    events.push("complete");
    return {
      schemaVersion: 1,
      operation: "COMPLETE_IDEMPOTENCY",
      outcome: "SUCCESS",
      value: { completed: true },
    };
  });
  const load = vi.fn<
    PublicationRuntimeRepositories["publicationRuntime"]["load"]
  >(async () => {
    events.push("load");
    return { schemaVersion: 1, outcome: "SUCCESS", context };
  });
  const write = vi.fn<
    PublicationRuntimeRepositories["publicationRuntime"]["write"]
  >(async (input) => {
    events.push("write");
    return {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "PUBLICATION_MUTATION",
      resultId: id(4),
      action: input.command.action,
      target: input.command.target,
      headVersion:
        input.command.expectedVersion + (action === "VALIDATE" ? 0 : 1),
      contentHash: sourceHashSchema.parse("b".repeat(64)),
      publicationId: action === "VALIDATE" ? null : id(5),
      manifestHash: action === "VALIDATE" ? null : input.manifestHash,
      replayed: false,
    };
  });
  const readReceipt = vi.fn<
    PublicationRuntimeRepositories["publicationRuntime"]["readReceipt"]
  >(async () => fail());
  const status = vi.fn<
    PublicationRuntimeRepositories["publicationRuntime"]["status"]
  >(async () => fail());
  const retry = vi.fn<
    PublicationRuntimeRepositories["publicationRuntime"]["retry"]
  >(async () => fail());
  const transactions: PublicationRuntimeTransactionManager = {
    runInPublicationRuntimeTransaction: async (work) => {
      events.push("transaction");
      return work({
        authorization: { authorize },
        idempotency: { begin, complete },
        publicationRuntime: { load, write, readReceipt, status, retry },
      });
    },
  };
  return {
    request,
    context,
    events,
    authorize,
    begin,
    complete,
    load,
    write,
    readReceipt,
    status,
    retry,
    useCases: createPublicationRuntimeUseCases({ transactions, tokenPepper }),
  };
}
for (const action of ["VALIDATE", "PUBLISH"] as const)
  test(`${action} authorizes and verifies canonical evidence before atomic writes`, async () => {
    const h = harness(action),
      before = structuredClone(h.context);
    expect(await h.useCases.execute(h.request)).toMatchObject({
      outcome: "SUCCESS",
      kind: "PUBLICATION_MUTATION",
      action,
      replayed: false,
    });
    expect(h.events).toEqual([
      "transaction",
      "authorize",
      "begin",
      "load",
      "write",
      "complete",
    ]);
    expect(h.authorize.mock.calls[0]?.[0]).toMatchObject({
      permission: "content.publish",
      locales: SUPPORTED_LOCALES,
    });
    expect(h.write.mock.calls[0]?.[0]).toMatchObject({
      principal: { actorId: id(2) },
      manifest: { target: h.context.preflight.target },
    });
    expect(h.context).toEqual(before);
  });
test("strict invalid client authority does not start a transaction", async () => {
  const h = harness();
  expect(
    await h.useCases.execute({
      ...h.request,
      command: { ...h.request.command, ready: true },
    }),
  ).toMatchObject({ code: "INVALID_COMMAND" });
  expect(h.events).toEqual([]);
});
test("revoked authorization blocks idempotency replay and canonical reads", async () => {
  const h = harness();
  h.authorize.mockResolvedValue(fail("FORBIDDEN"));
  expect(await h.useCases.execute(h.request)).toEqual(fail("FORBIDDEN"));
  expect(h.begin).not.toHaveBeenCalled();
  expect(h.load).not.toHaveBeenCalled();
});
for (const change of [
  { expectedVersion: 99 },
  { expectedContentHash: "c".repeat(64) },
])
  test(`rejects stale request ${Object.keys(change)[0]} without writes`, async () => {
    const h = harness();
    expect(
      await h.useCases.execute({
        ...h.request,
        command: { ...h.request.command, ...change },
      }),
    ).toMatchObject({
      code: "expectedVersion" in change ? "STALE_VERSION" : "STALE_CONTENT",
    });
    expect(h.write).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
  });
test("DRAFT cannot skip validation and a validated revision cannot be validated twice", async () => {
  const h = harness();
  expect(
    await h.useCases.execute({
      ...h.request,
      command: { ...h.request.command, action: "PUBLISH" },
    }),
  ).toMatchObject({ code: "PUBLICATION_BLOCKED" });
  expect(h.write).not.toHaveBeenCalled();
  const second = harness("PUBLISH");
  expect(
    await second.useCases.execute({
      ...second.request,
      command: { ...second.request.command, action: "VALIDATE" },
    }),
  ).toMatchObject({ code: "REVISION_NOT_DRAFT" });
});
test("incomplete translations cannot reserve a successful receipt", async () => {
  const h = harness();
  h.context.preflight.snapshot.content.translations.pop();
  expect(await h.useCases.execute(h.request)).toMatchObject({
    outcome: "FAILURE",
  });
  expect(h.write).not.toHaveBeenCalled();
  expect(h.complete).not.toHaveBeenCalled();
});
test("status uses current read authorization and no mutation idempotency", async () => {
  const h = harness();
  expect(
    await h.useCases.execute({
      ...h.request,
      command: { schemaVersion: 1, action: "STATUS", publicationId: id(5) },
    }),
  ).toEqual(fail());
  expect(h.authorize.mock.calls[0]?.[0].permission).toBe("content.read");
  expect(h.begin).not.toHaveBeenCalled();
  expect(h.status).toHaveBeenCalledOnce();
});
test("replay loads the immutable typed receipt after reauthorization", async () => {
  const h = harness();
  const first = await h.useCases.execute(h.request);
  h.begin.mockResolvedValue({
    schemaVersion: 1,
    operation: "BEGIN_IDEMPOTENCY",
    outcome: "SUCCESS",
    value: {
      decision: "REPLAY",
      safeResultReference: `result-ref:v1:${id(4)}`,
    },
  });
  h.readReceipt.mockResolvedValue(first);
  h.write.mockClear();
  h.load.mockClear();
  expect(await h.useCases.execute(h.request)).toMatchObject({
    resultId: id(4),
    replayed: true,
  });
  expect(h.write).not.toHaveBeenCalled();
  expect(h.load).not.toHaveBeenCalled();
  h.readReceipt.mockResolvedValue({
    ...first,
    resultId: id(99),
  } as PublicationRuntimeResponse);
  expect(await h.useCases.execute(h.request)).toMatchObject({
    code: "CONTENT_UNAVAILABLE",
  });
});
for (const decision of ["CONFLICT", "IN_PROGRESS"] as const)
  test(`idempotency ${decision} prevents writes`, async () => {
    const h = harness();
    h.begin.mockResolvedValue({
      schemaVersion: 1,
      operation: "BEGIN_IDEMPOTENCY",
      outcome: "SUCCESS",
      value: { decision },
    });
    expect(await h.useCases.execute(h.request)).toMatchObject({
      code: decision === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "CONFLICT",
    });
    expect(h.load).not.toHaveBeenCalled();
  });
test("database failure and invalid repository receipts never complete idempotency", async () => {
  const h = harness();
  h.write.mockRejectedValue(new Error("private database detail"));
  expect(await h.useCases.execute(h.request)).toMatchObject({
    code: "CONTENT_UNAVAILABLE",
  });
  expect(h.complete).not.toHaveBeenCalled();
  const second = harness();
  second.write.mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PURGE_RETRY",
    resultId: id(4),
    publicationId: id(5),
    purgeJobId: id(6),
    generation: 2,
    version: 1,
    replayed: false,
  });
  expect(await second.useCases.execute(second.request)).toMatchObject({
    code: "CONTENT_UNAVAILABLE",
  });
  expect(second.complete).not.toHaveBeenCalled();
});
for (const operation of ["begin", "complete"] as const)
  for (const code of ["TRANSACTION_ABORTED", "VERSION_CONFLICT"] as const)
    test(`${operation} returned ${code} preserves conflict recovery`, async () => {
      const h = harness();
      const error = {
        schemaVersion: 1 as const,
        code,
        ...(code === "TRANSACTION_ABORTED"
          ? { recovery: "RETRY_SAME_COMMAND" as const, retryAfterMs: 100 }
          : { recovery: "NONE" as const }),
      };
      if (operation === "begin")
        h.begin.mockResolvedValue({
          schemaVersion: 1,
          operation: "BEGIN_IDEMPOTENCY",
          outcome: "FAILURE",
          error,
        });
      else
        h.complete.mockResolvedValue({
          schemaVersion: 1,
          operation: "COMPLETE_IDEMPOTENCY",
          outcome: "FAILURE",
          error,
        });
      expect(await h.useCases.execute(h.request)).toMatchObject({
        code: "CONFLICT",
      });
    });
test("status cannot return a different publication even when its response is valid", async () => {
  const h = harness();
  h.status.mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PUBLICATION_STATUS",
    publicationId: id(6),
    target: h.context.preflight.target,
    headVersion: 1,
    manifestHash: sourceHashSchema.parse("d".repeat(64)),
    publishedAt: "2026-09-06T09:00:00Z",
    isCurrent: true,
    jobs: SUPPORTED_LOCALES.map((locale, index) => ({
      schemaVersion: 1,
      id: id(20 + index),
      publicationId: id(6),
      outboxEventId: id(40 + index),
      locale,
      generation: 1,
      retryOf: null,
      status: "PENDING",
      version: 1,
      attemptCount: 0,
      failureCount: 0,
      createdAt: "2026-09-06T09:00:00Z",
      updatedAt: "2026-09-06T09:00:00Z",
      nextAttemptAt: "2026-09-06T09:00:00Z",
      completedAt: null,
      errorCode: null,
    })),
  });
  expect(
    await h.useCases.execute({
      ...h.request,
      command: { schemaVersion: 1, action: "STATUS", publicationId: id(5) },
    }),
  ).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
});

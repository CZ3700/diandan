/// <reference types="node" />
import { createHmac } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
  adminContentCommandSchema,
  adminPrincipalSchema,
  contentReviewContextSchema,
  createIdolAliasDraftCommandSchema,
  createGiftDetailDraftCommandSchema,
  sourceHashSchema,
  type AdminContentCommand,
  type AdminContentFailure,
  type ContentReviewContext,
} from "@fan-support/contracts";
import {
  prepareGiftDetailDraft,
  prepareIdolAliasDraft,
} from "@fan-support/content";
import type {
  AdminContentRepositories,
  AdminContentTransactionManager,
  JsonValue,
} from "@fan-support/persistence-port";
import {
  createAdminContentUseCases,
  digestAdminContentToken,
} from "./admin-content.js";

const id = (n: number) =>
  `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tokenPepper = "ab".repeat(32);
const sessionToken = Buffer.alloc(32, 1).toString("base64url");
const csrfToken = Buffer.alloc(32, 2).toString("base64url");
const now = "2026-09-05T18:00:00.000Z";
const principal = adminPrincipalSchema.parse({
  schemaVersion: 1,
  actorId: id(1),
  sessionId: id(2),
  authorizedAt: now,
  expiresAt: "2026-09-05T19:00:00.000Z",
});
const fail = (code: AdminContentFailure["code"]): AdminContentFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});
const aliasInput = createIdolAliasDraftCommandSchema.parse({
  schemaVersion: 1,
  id: id(3),
  idolRevisionId: id(4),
  aliases: [{ id: "stage-name", locale: "th", text: "ดาว" }],
  actorId: id(1),
  reasonCode: "CONTENT_EDIT",
  requestId: id(5),
});
const aliasDraft = prepareIdolAliasDraft(aliasInput, now);
if (aliasDraft.outcome !== "SUCCESS") throw new Error("invalid fixture");
const aliasSet = aliasDraft.aliasSet;
const detailInput = createGiftDetailDraftCommandSchema.parse({
  schemaVersion: 1,
  document: {
    schemaVersion: 1,
    id: id(6),
    giftRevisionId: id(7),
    blocks: [{ id: "intro", kind: "PARAGRAPH" }],
  },
  translations: [
    {
      id: id(8),
      locale: "en",
      origin: "HUMAN",
      blocks: [{ blockId: "intro", kind: "PARAGRAPH", text: "Gift contents" }],
    },
    {
      id: id(9),
      locale: "th",
      origin: "HUMAN",
      blocks: [{ blockId: "intro", kind: "PARAGRAPH", text: "รายการของขวัญ" }],
    },
  ],
  actorId: id(1),
  reasonCode: "CONTENT_EDIT",
  requestId: id(10),
});
const detailDraft = prepareGiftDetailDraft(detailInput, now);
if (detailDraft.outcome !== "SUCCESS") throw new Error("invalid fixture");
const completeDetailDraft = prepareGiftDetailDraft(
  createGiftDetailDraftCommandSchema.parse({
    ...detailInput,
    translations: SUPPORTED_LOCALES.map((locale, index) => ({
      id: id(100 + index),
      locale,
      origin: "HUMAN",
      blocks: [
        { blockId: "intro", kind: "PARAGRAPH", text: `Content for ${locale}` },
      ],
    })),
  }),
  now,
);
if (completeDetailDraft.outcome !== "SUCCESS")
  throw new Error("invalid fixture");
const completeDetail = completeDetailDraft;
const aliasContext = contentReviewContextSchema.parse({
  schemaVersion: 1,
  target: { kind: "IDOL_ALIASES", revisionId: id(4) },
  subjectId: id(3),
  sequence: 1,
  status: "DRAFT",
  editorId: id(1),
  structureEditorId: id(1),
  editedAt: now,
  contentHash: aliasDraft.aliasSet.contentHash,
  sourceHash: null,
  locales: ["th"],
});

function detailContext(locale: "en" | "th" = "en"): ContentReviewContext {
  if (detailDraft.outcome !== "SUCCESS") throw new Error("invalid fixture");
  const translation = detailDraft.translations.find(
    (row) => row.locale === locale,
  )!;
  return contentReviewContextSchema.parse({
    schemaVersion: 1,
    target: { kind: "GIFT_DETAILS", revisionId: id(7), locale },
    subjectId: translation.id,
    sequence: 2,
    status: "IN_REVIEW",
    editorId: id(11),
    structureEditorId: id(12),
    editedAt: now,
    contentHash: translation.sourceHash,
    sourceHash: translation.translatedFromSourceHash,
    locales: [locale],
  });
}

function request(command: AdminContentCommand, requestId = id(13)) {
  return { schemaVersion: 1, requestId, sessionToken, csrfToken, command };
}
function reviewCommand(
  action: "SUBMIT_REVIEW" | "APPROVE_REVIEW" = "SUBMIT_REVIEW",
  context = aliasContext,
): AdminContentCommand {
  return adminContentCommandSchema.parse({
    schemaVersion: 1,
    action,
    target: context.target,
    expectedVersion: context.sequence,
    expectedContentHash: context.contentHash,
    expectedSourceHash: context.sourceHash,
    reasonCode: "CONTENT_REVIEW",
    idempotencyKey: "admin-review-fixture-001",
  });
}
function createAliases(): AdminContentCommand {
  const { schemaVersion, id, idolRevisionId, aliases, reasonCode } = aliasInput;
  const draft = { schemaVersion, id, idolRevisionId, aliases, reasonCode };
  return adminContentCommandSchema.parse({
    schemaVersion: 1,
    action: "CREATE_IDOL_ALIASES",
    draft,
    expectedVersion: 1,
    idempotencyKey: "alias-create-fixture-001",
  });
}
function createDetails(): AdminContentCommand {
  const { schemaVersion, document, translations, reasonCode } = detailInput;
  const draft = { schemaVersion, document, translations, reasonCode };
  return adminContentCommandSchema.parse({
    schemaVersion: 1,
    action: "CREATE_GIFT_DETAILS",
    draft,
    expectedVersion: 1,
    idempotencyKey: "detail-create-fixture-001",
  });
}

function harness() {
  const events: string[] = [];
  const authorize = vi.fn<
    AdminContentRepositories["authorization"]["authorize"]
  >(async () => {
    events.push("authorize");
    return { schemaVersion: 1, outcome: "SUCCESS", principal };
  });
  const loadTarget = vi.fn<
    AdminContentRepositories["contentReviews"]["loadTarget"]
  >(async (input) => {
    events.push("load-review");
    return {
      schemaVersion: 1,
      outcome: "SUCCESS",
      context:
        input.target.kind === "GIFT_DETAILS"
          ? detailContext(input.target.locale === "th" ? "th" : "en")
          : aliasContext,
    };
  });
  const append = vi.fn<AdminContentRepositories["contentReviews"]["append"]>(
    async () => {
      events.push("append");
      return {
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "MUTATION",
        resultId: id(20),
        replayed: false,
      };
    },
  );
  const read = vi.fn<AdminContentRepositories["contentDrafts"]["read"]>(
    async (input) => {
      events.push("read");
      return input.kind === "IDOL_ALIASES" ? aliasDraft : detailDraft;
    },
  );
  const createIdolAliases = vi.fn<
    AdminContentRepositories["contentDrafts"]["createIdolAliases"]
  >(async () => {
    events.push("create");
    return aliasDraft;
  });
  const createGiftDetails = vi.fn<
    AdminContentRepositories["contentDrafts"]["createGiftDetails"]
  >(async () => {
    events.push("create");
    return detailDraft;
  });
  const begin = vi.fn<AdminContentRepositories["idempotency"]["begin"]>(
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
  const complete = vi.fn<AdminContentRepositories["idempotency"]["complete"]>(
    async () => {
      events.push("complete");
      return {
        schemaVersion: 1,
        operation: "COMPLETE_IDEMPOTENCY",
        outcome: "SUCCESS",
        value: { completed: true },
      };
    },
  );
  const issue = vi.fn<AdminContentRepositories["contentPreviews"]["issue"]>(
    async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      grantId: id(21),
      createdAt: now,
      expiresAt: "2026-09-05T18:05:00.000Z",
    }),
  );
  const readPreview = vi.fn<
    AdminContentRepositories["contentPreviews"]["read"]
  >(async (input) => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    target: input.target,
    content: { kind: "IDOL_ALIASES", aliases: aliasSet.aliases },
  }));
  const revoke = vi.fn<AdminContentRepositories["contentPreviews"]["revoke"]>(
    async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      resultId: id(21),
      replayed: false,
    }),
  );
  const repositories: AdminContentRepositories = {
    authorization: { authorize },
    contentReviews: { loadTarget, append },
    contentDrafts: { read, createIdolAliases, createGiftDetails },
    idempotency: { begin, complete },
    contentPreviews: { issue, read: readPreview, revoke },
  };
  let transactionsStarted = 0;
  let commits = 0;
  let rollbacks = 0;
  const transactions: AdminContentTransactionManager = {
    async runInAdminContentTransaction<Result extends JsonValue>(
      work: (r: AdminContentRepositories) => Promise<Result>,
    ): Promise<Result> {
      transactionsStarted++;
      try {
        const result = await work(repositories);
        commits++;
        return result;
      } catch (error) {
        rollbacks++;
        throw error;
      }
    },
  };
  return {
    ...createAdminContentUseCases({ transactions, tokenPepper }),
    repositories,
    authorize,
    loadTarget,
    append,
    read,
    createIdolAliases,
    createGiftDetails,
    begin,
    complete,
    issue,
    previewRead: readPreview,
    revoke,
    events,
    stats: () => ({ transactionsStarted, commits, rollbacks }),
  };
}

describe("admin content authorization and idempotency", () => {
  test("rejects malformed requests before acquiring a database transaction", async () => {
    const subject = harness();
    for (const input of [
      null,
      {},
      request({
        ...createAliases(),
        actorId: id(99),
      } as unknown as AdminContentCommand),
      { ...request(createAliases()), sessionToken: "invalid" },
      { ...request(createAliases()), csrfToken: csrfToken + "=" },
    ])
      expect(await subject.execute(input)).toEqual(fail("INVALID_COMMAND"));
    expect(subject.stats().transactionsStarted).toBe(0);
  });
  test("uses separate peppered purposes and transmits no bearer tokens to ports", async () => {
    const subject = harness();
    await subject.execute(request(createAliases()));
    const call = subject.authorize.mock.calls[0]![0];
    expect(call.sessionTokenDigest).toBe(
      digestAdminContentToken({
        tokenPepper,
        purpose: "admin-session",
        token: sessionToken,
      }),
    );
    expect(call.csrfTokenDigest).toBe(
      digestAdminContentToken({
        tokenPepper,
        purpose: "admin-csrf",
        token: csrfToken,
      }),
    );
    expect(
      new Set(
        ["admin-session", "admin-csrf", "content-preview"].map((purpose) =>
          digestAdminContentToken({
            tokenPepper,
            purpose: purpose as
              "admin-session" | "admin-csrf" | "content-preview",
            token: sessionToken,
          }),
        ),
      ).size,
    ).toBe(3);
    const portCalls = JSON.stringify([
      subject.authorize.mock.calls,
      subject.createIdolAliases.mock.calls,
      subject.begin.mock.calls,
      subject.complete.mock.calls,
    ]);
    for (const secret of [sessionToken, csrfToken, tokenPepper])
      expect(portCalls.includes(secret)).toBe(false);
  });
  test.each(["UNAUTHENTICATED", "FORBIDDEN", "CSRF_INVALID"] as const)(
    "authorization %s prevents data and idempotency access",
    async (code) => {
      const subject = harness();
      subject.authorize.mockResolvedValue(fail(code));
      expect(await subject.execute(request(reviewCommand()))).toEqual(
        fail(code),
      );
      expect(subject.loadTarget).not.toHaveBeenCalled();
      expect(subject.begin).not.toHaveBeenCalled();
      expect(subject.append).not.toHaveBeenCalled();
    },
  );
  test("create persists only a safe result reference and request transport changes do not change its hash", async () => {
    const subject = harness();
    expect(await subject.execute(request(createAliases()))).toEqual({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      resultId: id(3),
      replayed: false,
    });
    await subject.execute(request(createAliases(), id(98)));
    expect(subject.begin.mock.calls[0]![0].canonicalRequestHash).toBe(
      subject.begin.mock.calls[1]![0].canonicalRequestHash,
    );
    expect(subject.begin.mock.calls[0]![0].expiresAt).toBe(
      "2026-09-06T18:00:00.000Z",
    );
    expect(subject.complete.mock.calls[0]![0]).toMatchObject({
      status: "SUCCEEDED",
      safeResultReference: `result-ref:v1:${id(3)}`,
    });
    expect(subject.createIdolAliases.mock.calls[0]![0]).toMatchObject({
      actorId: principal.actorId,
      requestId: id(13),
    });
    expect(subject.authorize.mock.calls.at(-1)![0]).toMatchObject({
      permission: "content.edit",
      locales: ["th"],
    });
    expect(subject.stats().transactionsStarted).toBe(2);
  });
  test("mixed universal and empty alias sets require every supported locale", async () => {
    for (const aliases of [
      [],
      [{ id: "stage-name", locale: null, text: "Stage name" }],
    ]) {
      const subject = harness();
      const command = createAliases();
      if (command.action !== "CREATE_IDOL_ALIASES") throw new Error("fixture");
      await subject.execute(
        request({ ...command, draft: { ...command.draft, aliases } }),
      );
      expect(subject.authorize.mock.calls.at(-1)![0].locales).toEqual([
        ...SUPPORTED_LOCALES,
      ]);
    }
  });
  test("details creation authorizes every supplied locale and binds the current principal", async () => {
    const subject = harness();
    expect(await subject.execute(request(createDetails()))).toMatchObject({
      outcome: "SUCCESS",
      resultId: id(6),
    });
    expect(subject.authorize.mock.calls.at(-1)![0]).toMatchObject({
      permission: "content.edit",
      locales: ["en", "th"],
    });
    expect(subject.createGiftDetails.mock.calls[0]![0].actorId).toBe(
      principal.actorId,
    );
  });
  test("replay reloads and authorizes canonical review locales before returning the old result", async () => {
    const subject = harness();
    subject.loadTarget.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      context: { ...aliasContext, sequence: 3, status: "APPROVED" },
    });
    subject.begin.mockResolvedValue({
      schemaVersion: 1,
      operation: "BEGIN_IDEMPOTENCY",
      outcome: "SUCCESS",
      value: {
        decision: "REPLAY",
        safeResultReference: `result-ref:v1:${id(20)}`,
      },
    });
    expect(await subject.execute(request(reviewCommand()))).toEqual({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      resultId: id(20),
      replayed: true,
    });
    expect(subject.authorize.mock.invocationCallOrder[0]).toBeLessThan(
      subject.loadTarget.mock.invocationCallOrder[0]!,
    );
    expect(subject.loadTarget.mock.invocationCallOrder[0]).toBeLessThan(
      subject.authorize.mock.invocationCallOrder[1]!,
    );
    expect(subject.authorize.mock.invocationCallOrder[1]).toBeLessThan(
      subject.begin.mock.invocationCallOrder[0]!,
    );
    expect(subject.append).not.toHaveBeenCalled();
  });
  test("revoked language authorization blocks a replay", async () => {
    const subject = harness();
    subject.authorize
      .mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "SUCCESS",
        principal,
      })
      .mockResolvedValueOnce(fail("FORBIDDEN"));
    expect(await subject.execute(request(reviewCommand()))).toEqual(
      fail("FORBIDDEN"),
    );
    expect(subject.begin).not.toHaveBeenCalled();
  });
  test("accepts canonical authorization times as the database clock advances", async () => {
    const subject = harness();
    subject.authorize
      .mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "SUCCESS",
        principal,
      })
      .mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "SUCCESS",
        principal: { ...principal, authorizedAt: "2026-09-05T18:00:00.012Z" },
      });
    expect(await subject.execute(request(reviewCommand()))).toMatchObject({
      outcome: "SUCCESS",
    });
  });
  test.each([
    { actorId: id(80) },
    { sessionId: id(81) },
    { expiresAt: "2026-09-05T20:00:00.000Z" },
  ])(
    "inconsistent second canonical authorization fails closed %#",
    async (change) => {
      const subject = harness();
      subject.authorize
        .mockResolvedValueOnce({
          schemaVersion: 1,
          outcome: "SUCCESS",
          principal,
        })
        .mockResolvedValueOnce({
          schemaVersion: 1,
          outcome: "SUCCESS",
          principal: { ...principal, ...change },
        });
      expect(await subject.execute(request(reviewCommand()))).toEqual(
        fail("CONTENT_UNAVAILABLE"),
      );
      expect(subject.begin).not.toHaveBeenCalled();
    },
  );
  test.each(["READ_DRAFT", "READ_REVIEW", "APPROVE_REVIEW"] as const)(
    "%s accepts the same live principal when the canonical database wall clock moves backward",
    async (action) => {
      const subject = harness();
      subject.authorize
        .mockResolvedValueOnce({
          schemaVersion: 1,
          outcome: "SUCCESS",
          principal: { ...principal, authorizedAt: "2026-09-05T18:00:00.831Z" },
        })
        .mockResolvedValueOnce({
          schemaVersion: 1,
          outcome: "SUCCESS",
          principal: { ...principal, authorizedAt: "2026-09-05T18:00:00.656Z" },
        });
      const command: AdminContentCommand =
        action === "APPROVE_REVIEW"
          ? reviewCommand(action, detailContext())
          : action === "READ_REVIEW"
            ? { schemaVersion: 1, action, target: aliasContext.target }
            : {
                schemaVersion: 1,
                action,
                target: {
                  schemaVersion: 1,
                  kind: "IDOL_ALIASES",
                  idolRevisionId: aliasInput.idolRevisionId,
                },
              };
      expect(await subject.execute(request(command))).toMatchObject({
        outcome: "SUCCESS",
        kind:
          action === "APPROVE_REVIEW"
            ? "MUTATION"
            : action === "READ_REVIEW"
              ? "REVIEW"
              : "DRAFT",
      });
      expect(subject.authorize).toHaveBeenCalledTimes(2);
      expect(subject.stats().rollbacks).toBe(0);
    },
  );
  test.each([1, 2])(
    "authorization %i still rejects a session expired at that canonical instant",
    async (expiredCall) => {
      const subject = harness();
      if (expiredCall === 2)
        subject.authorize.mockResolvedValueOnce({
          schemaVersion: 1,
          outcome: "SUCCESS",
          principal,
        });
      subject.authorize.mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "SUCCESS",
        principal: { ...principal, authorizedAt: principal.expiresAt },
      });
      expect(await subject.execute(request(reviewCommand()))).toEqual(
        fail("UNAUTHENTICATED"),
      );
      expect(subject.begin).not.toHaveBeenCalled();
      expect(subject.append).not.toHaveBeenCalled();
    },
  );
  test.each([
    ["CONFLICT", "IDEMPOTENCY_CONFLICT"],
    ["IN_PROGRESS", "CONFLICT"],
  ] as const)(
    "idempotency %s returns %s without changing content",
    async (decision, code) => {
      const subject = harness();
      subject.begin.mockResolvedValue({
        schemaVersion: 1,
        operation: "BEGIN_IDEMPOTENCY",
        outcome: "SUCCESS",
        value: { decision },
      });
      expect(await subject.execute(request(createAliases()))).toEqual(
        fail(code),
      );
      expect(subject.createIdolAliases).not.toHaveBeenCalled();
    },
  );
  test("failed creation after begin rejects the transaction instead of leaving IN_PROGRESS", async () => {
    const subject = harness();
    subject.createIdolAliases.mockResolvedValue({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "REVISION_NOT_DRAFT",
    });
    expect(await subject.execute(request(createAliases()))).toEqual(
      fail("REVISION_NOT_DRAFT"),
    );
    expect(subject.stats()).toEqual({
      transactionsStarted: 1,
      commits: 0,
      rollbacks: 1,
    });
    expect(subject.complete).not.toHaveBeenCalled();
  });
  test("completion failure rolls back a successful mutation", async () => {
    const subject = harness();
    subject.complete.mockResolvedValue({
      schemaVersion: 1,
      operation: "COMPLETE_IDEMPOTENCY",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "TEMPORARY_UNAVAILABLE",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 100,
      },
    });
    expect(await subject.execute(request(createAliases()))).toEqual(
      fail("CONTENT_UNAVAILABLE"),
    );
    expect(subject.stats().rollbacks).toBe(1);
  });
  test("historical error references never become successful mutation replay", async () => {
    const subject = harness();
    subject.begin.mockResolvedValue({
      schemaVersion: 1,
      operation: "BEGIN_IDEMPOTENCY",
      outcome: "SUCCESS",
      value: {
        decision: "REPLAY",
        safeResultReference: "error-ref:v1:INTERNAL_ERROR",
      },
    });
    expect(await subject.execute(request(createAliases()))).toEqual(
      fail("CONTENT_UNAVAILABLE"),
    );
    expect(subject.createIdolAliases).not.toHaveBeenCalled();
  });
  test.each(["TRANSACTION_ABORTED", "VERSION_CONFLICT"] as const)(
    "normalizes %s without exposing adapter details",
    async (code) => {
      const subject = harness();
      subject.authorize.mockRejectedValue({
        schemaVersion: 1,
        operation: "RUN_TRANSACTION",
        outcome: "FAILURE",
        error: {
          schemaVersion: 1,
          code,
          recovery:
            code === "TRANSACTION_ABORTED" ? "RETRY_SAME_COMMAND" : "NONE",
          ...(code === "TRANSACTION_ABORTED" ? { retryAfterMs: 100 } : {}),
        },
      });
      expect(await subject.execute(request(createAliases()))).toEqual(
        fail("CONFLICT"),
      );
    },
  );
  test("missing review targets cannot reserve an idempotency result", async () => {
    const subject = harness();
    subject.loadTarget.mockResolvedValue(fail("NOT_FOUND"));
    expect(await subject.execute(request(reviewCommand()))).toEqual(
      fail("NOT_FOUND"),
    );
    expect(subject.begin).not.toHaveBeenCalled();
  });
});

describe("canonical content review", () => {
  test("submits only the original editor's draft and never forwards client hashes as authority", async () => {
    const subject = harness();
    expect(await subject.execute(request(reviewCommand()))).toMatchObject({
      outcome: "SUCCESS",
      resultId: id(20),
    });
    expect(subject.append.mock.calls[0]![0]).toMatchObject({
      action: "SUBMIT",
      actorId: principal.actorId,
      expectedVersion: 1,
      expectedContentHash: aliasContext.contentHash,
    });
    expect(subject.authorize.mock.calls.at(-1)![0]).toMatchObject({
      permission: "content.edit",
      locales: ["th"],
    });
  });
  test.each([
    ["STALE_VERSION", { sequence: 2 }],
    ["STALE_CONTENT", { contentHash: sourceHashSchema.parse("b".repeat(64)) }],
    ["INVALID_REVIEW_STATE", { status: "IN_REVIEW" }],
    ["FORBIDDEN", { editorId: id(50) }],
  ] as const)(
    "rejects %s before appending and rolls back idempotency",
    async (code, changes) => {
      const subject = harness();
      subject.loadTarget.mockResolvedValue({
        schemaVersion: 1,
        outcome: "SUCCESS",
        context: { ...aliasContext, ...changes },
      });
      expect(await subject.execute(request(reviewCommand()))).toEqual(
        fail(code),
      );
      expect(subject.append).not.toHaveBeenCalled();
      expect(subject.stats().rollbacks).toBe(1);
    },
  );
  test("approves a current translation using assigned locale and independent canonical editors", async () => {
    const subject = harness();
    const context = detailContext("th");
    expect(
      await subject.execute(request(reviewCommand("APPROVE_REVIEW", context))),
    ).toMatchObject({ outcome: "SUCCESS" });
    expect(subject.authorize.mock.calls.at(-1)![0]).toMatchObject({
      permission: "content.translation.review",
      locales: ["th"],
    });
    expect(subject.append.mock.calls[0]![0]).toMatchObject({
      action: "APPROVE",
      actorId: principal.actorId,
    });
  });
  test("rejects changed English source lineage without appending approval", async () => {
    const subject = harness();
    const context = detailContext();
    subject.loadTarget.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      context: {
        ...context,
        sourceHash: sourceHashSchema.parse("e".repeat(64)),
      },
    });
    expect(
      await subject.execute(request(reviewCommand("APPROVE_REVIEW", context))),
    ).toEqual(fail("STALE_CONTENT"));
    expect(subject.append).not.toHaveBeenCalled();
  });
  test.each(["editorId", "structureEditorId"] as const)(
    "rejects self approval through %s",
    async (field) => {
      const subject = harness();
      const context = detailContext();
      subject.loadTarget.mockResolvedValue({
        schemaVersion: 1,
        outcome: "SUCCESS",
        context: { ...context, [field]: principal.actorId.toUpperCase() },
      });
      expect(
        await subject.execute(
          request(reviewCommand("APPROVE_REVIEW", context)),
        ),
      ).toEqual(fail("SELF_REVIEW"));
      expect(subject.append).not.toHaveBeenCalled();
    },
  );
  test("mismatched canonical targets fail closed", async () => {
    const subject = harness();
    subject.loadTarget.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      context: {
        ...aliasContext,
        target: { kind: "IDOL_ALIASES", revisionId: id(99) },
      },
    });
    expect(await subject.execute(request(reviewCommand()))).toEqual(
      fail("CONTENT_UNAVAILABLE"),
    );
    expect(subject.begin).not.toHaveBeenCalled();
  });
  test("draft read authorizes canonical translations and includes review contexts", async () => {
    const subject = harness();
    const response = await subject.execute(
      request(
        adminContentCommandSchema.parse({
          schemaVersion: 1,
          action: "READ_DRAFT",
          target: {
            schemaVersion: 1,
            kind: "GIFT_DETAILS",
            giftRevisionId: id(7),
          },
        }),
      ),
    );
    expect(response).toMatchObject({
      outcome: "SUCCESS",
      kind: "DRAFT",
      content: detailDraft,
      reviews: [detailContext("en"), detailContext("th")],
    });
    expect(subject.authorize.mock.calls.at(-1)![0]).toMatchObject({
      permission: "content.read",
      locales: ["en", "th"],
    });
    expect(subject.begin).not.toHaveBeenCalled();
  });
  test("reads aliases using the actual whole-set language scope", async () => {
    const subject = harness();
    expect(
      await subject.execute(
        request(
          adminContentCommandSchema.parse({
            schemaVersion: 1,
            action: "READ_DRAFT",
            target: {
              schemaVersion: 1,
              kind: "IDOL_ALIASES",
              idolRevisionId: id(4),
            },
          }),
        ),
      ),
    ).toMatchObject({
      outcome: "SUCCESS",
      kind: "DRAFT",
      content: aliasDraft,
      reviews: [aliasContext],
    });
    expect(subject.authorize.mock.calls.at(-1)![0]).toMatchObject({
      permission: "content.read",
      locales: ["th"],
    });
  });
  test("a partial language assignment cannot read an entire draft's other translations", async () => {
    const subject = harness();
    subject.authorize
      .mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "SUCCESS",
        principal,
      })
      .mockResolvedValueOnce(fail("FORBIDDEN"));
    expect(
      await subject.execute(
        request(
          adminContentCommandSchema.parse({
            schemaVersion: 1,
            action: "READ_DRAFT",
            target: {
              schemaVersion: 1,
              kind: "GIFT_DETAILS",
              giftRevisionId: id(7),
            },
          }),
        ),
      ),
    ).toEqual(fail("FORBIDDEN"));
  });
  test("draft identity returned by persistence must match the requested parent", async () => {
    const subject = harness();
    subject.read.mockResolvedValue(detailDraft);
    expect(
      await subject.execute(
        request(
          adminContentCommandSchema.parse({
            schemaVersion: 1,
            action: "READ_DRAFT",
            target: {
              schemaVersion: 1,
              kind: "IDOL_ALIASES",
              idolRevisionId: id(4),
            },
          }),
        ),
      ),
    ).toEqual(fail("CONTENT_UNAVAILABLE"));
  });
});

describe("read only preview capabilities", () => {
  const target = {
    kind: "IDOL_ALIASES" as const,
    revisionId: id(4),
    locale: "th" as const,
  };
  test("issues a fresh one-time response token while the repository receives only its digest", async () => {
    const subject = harness();
    const command: AdminContentCommand = {
      schemaVersion: 1,
      action: "ISSUE_PREVIEW",
      target,
      ttlSeconds: 300,
      reasonCode: "CONTENT_PREVIEW",
    };
    const first = await subject.execute(request(command));
    const second = await subject.execute(request(command, id(22)));
    expect(first).toMatchObject({
      outcome: "SUCCESS",
      kind: "PREVIEW_GRANT",
      grantId: id(21),
    });
    if (
      first.outcome !== "SUCCESS" ||
      first.kind !== "PREVIEW_GRANT" ||
      second.outcome !== "SUCCESS" ||
      second.kind !== "PREVIEW_GRANT"
    )
      throw new Error("preview failed");
    expect(Buffer.from(first.token, "base64url").byteLength).toBe(32);
    expect(first.token).not.toBe(second.token);
    expect(subject.issue.mock.calls[0]![0]).toMatchObject({
      actorId: principal.actorId,
      sessionId: principal.sessionId,
      target,
      tokenDigest: digestAdminContentToken({
        tokenPepper,
        purpose: "content-preview",
        token: first.token,
      }),
    });
    expect(JSON.stringify(subject.issue.mock.calls).includes(first.token)).toBe(
      false,
    );
    expect(subject.begin).not.toHaveBeenCalled();
  });
  test("read preview sends its exact scope and only a digest to the same transaction", async () => {
    const subject = harness();
    const result = await subject.readPreview({
      schemaVersion: 1,
      target,
      token: sessionToken,
    });
    expect(result).toMatchObject({
      outcome: "SUCCESS",
      target,
      content: { kind: "IDOL_ALIASES" },
    });
    expect(subject.previewRead.mock.calls[0]![0]).toEqual({
      schemaVersion: 1,
      target,
      tokenDigest: digestAdminContentToken({
        tokenPepper,
        purpose: "content-preview",
        token: sessionToken,
      }),
    });
    expect(subject.authorize).not.toHaveBeenCalled();
    expect(subject.stats().transactionsStarted).toBe(1);
  });
  test("bounds TTL from actual issuance time, with expiration clamped to the session", async () => {
    const subject = harness();
    const expiresAt = "2026-09-05T18:00:03.000Z";
    subject.authorize.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      principal: { ...principal, expiresAt },
    });
    subject.issue.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      grantId: id(21),
      createdAt: "2026-09-05T18:00:00.015Z",
      expiresAt,
    });
    expect(
      await subject.execute(
        request({
          schemaVersion: 1,
          action: "ISSUE_PREVIEW",
          target,
          ttlSeconds: 300,
          reasonCode: "CONTENT_PREVIEW",
        }),
      ),
    ).toMatchObject({ outcome: "SUCCESS", kind: "PREVIEW_GRANT", expiresAt });
  });
  test("advancing issuance clock does not falsely reject a full requested TTL", async () => {
    const subject = harness();
    subject.issue.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      grantId: id(21),
      createdAt: "2026-09-05T18:00:00.015Z",
      expiresAt: "2026-09-05T18:05:00.015Z",
    });
    expect(
      await subject.execute(
        request({
          schemaVersion: 1,
          action: "ISSUE_PREVIEW",
          target,
          ttlSeconds: 300,
          reasonCode: "CONTENT_PREVIEW",
        }),
      ),
    ).toMatchObject({ outcome: "SUCCESS", kind: "PREVIEW_GRANT" });
  });
  test("preview TTL follows actual issuance after the database wall clock moves backward", async () => {
    const subject = harness();
    subject.authorize.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      principal: { ...principal, authorizedAt: "2026-09-05T18:00:00.831Z" },
    });
    subject.issue.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      grantId: id(21),
      createdAt: "2026-09-05T18:00:00.665Z",
      expiresAt: "2026-09-05T18:05:00.665Z",
    });
    const response = await subject.execute(
      request({
        schemaVersion: 1,
        action: "ISSUE_PREVIEW",
        target,
        ttlSeconds: 300,
        reasonCode: "CONTENT_PREVIEW",
      }),
    );
    expect(response).toMatchObject({
      outcome: "SUCCESS",
      kind: "PREVIEW_GRANT",
      expiresAt: "2026-09-05T18:05:00.665Z",
    });
    expect(subject.stats().rollbacks).toBe(0);
  });
  test("preview expiration cannot exceed the issuer session even within the requested TTL", async () => {
    const subject = harness();
    subject.authorize.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      principal: { ...principal, expiresAt: "2026-09-05T18:00:03.000Z" },
    });
    subject.issue.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      grantId: id(21),
      createdAt: "2026-09-05T18:00:00.015Z",
      expiresAt: "2026-09-05T18:00:03.001Z",
    });
    expect(
      await subject.execute(
        request({
          schemaVersion: 1,
          action: "ISSUE_PREVIEW",
          target,
          ttlSeconds: 300,
          reasonCode: "CONTENT_PREVIEW",
        }),
      ),
    ).toEqual(fail("CONTENT_UNAVAILABLE"));
    expect(subject.stats().rollbacks).toBe(1);
  });
  test.each([
    {
      createdAt: "2026-09-05T17:59:59.999Z",
      expiresAt: "2026-09-05T18:05:00.000Z",
    },
    { createdAt: now, expiresAt: "2026-09-05T18:05:00.001Z" },
    { createdAt: now, expiresAt: now },
  ])(
    "invalid grant chronology or excessive TTL rolls back issuance %#",
    async (times) => {
      const subject = harness();
      subject.issue.mockResolvedValue({
        schemaVersion: 1,
        outcome: "SUCCESS",
        grantId: id(21),
        ...times,
      });
      expect(
        await subject.execute(
          request({
            schemaVersion: 1,
            action: "ISSUE_PREVIEW",
            target,
            ttlSeconds: 300,
            reasonCode: "CONTENT_PREVIEW",
          }),
        ),
      ).toEqual(fail("CONTENT_UNAVAILABLE"));
      expect(subject.stats().rollbacks).toBe(1);
    },
  );
  test("revokes an owned preview using basic permission, with safe idempotent replay", async () => {
    const subject = harness();
    const command = adminContentCommandSchema.parse({
      schemaVersion: 1,
      action: "REVOKE_PREVIEW",
      grantId: id(21),
      reasonCode: "PREVIEW_REVOKE",
      idempotencyKey: "preview-revoke-fixture-001",
    });
    expect(await subject.execute(request(command))).toMatchObject({
      outcome: "SUCCESS",
      resultId: id(21),
      replayed: false,
    });
    expect(subject.authorize.mock.calls[0]![0]).toMatchObject({
      permission: "content.preview",
      locales: [],
    });
    expect(subject.revoke.mock.calls[0]![0]).toMatchObject({
      grantId: id(21),
      actorId: principal.actorId,
    });
    subject.begin.mockResolvedValue({
      schemaVersion: 1,
      operation: "BEGIN_IDEMPOTENCY",
      outcome: "SUCCESS",
      value: {
        decision: "REPLAY",
        safeResultReference: `result-ref:v1:${id(21)}`,
      },
    });
    expect(await subject.execute(request(command, id(40)))).toMatchObject({
      outcome: "SUCCESS",
      resultId: id(21),
      replayed: true,
    });
    expect(subject.revoke).toHaveBeenCalledTimes(1);
  });
  test("a different issuer cannot revoke another preview grant", async () => {
    const subject = harness();
    subject.revoke.mockResolvedValue(fail("NOT_FOUND"));
    const command = adminContentCommandSchema.parse({
      schemaVersion: 1,
      action: "REVOKE_PREVIEW",
      grantId: id(21),
      reasonCode: "PREVIEW_REVOKE",
      idempotencyKey: "preview-revoke-fixture-001",
    });
    expect(await subject.execute(request(command))).toEqual(fail("NOT_FOUND"));
    expect(subject.stats().rollbacks).toBe(1);
    expect(subject.complete).not.toHaveBeenCalled();
  });
  test("malformed preview tokens never reach persistence", async () => {
    const subject = harness();
    expect(
      await subject.readPreview({ schemaVersion: 1, target, token: "bad" }),
    ).toEqual(fail("INVALID_COMMAND"));
    expect(subject.previewRead).not.toHaveBeenCalled();
  });
  test("expired or revoked grant returns a safe failure", async () => {
    const subject = harness();
    subject.previewRead.mockResolvedValue(fail("PREVIEW_UNAVAILABLE"));
    expect(
      await subject.readPreview({
        schemaVersion: 1,
        target,
        token: sessionToken,
      }),
    ).toEqual(fail("PREVIEW_UNAVAILABLE"));
  });
  test("unexpected adapter data cannot expose author metadata or another locale", async () => {
    const subject = harness();
    subject.previewRead.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      target: { ...target, locale: "en" },
      content: { kind: "IDOL_ALIASES", aliases: [] },
    });
    expect(
      await subject.readPreview({
        schemaVersion: 1,
        target,
        token: sessionToken,
      }),
    ).toEqual(fail("PREVIEW_UNAVAILABLE"));
    subject.previewRead.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      target,
      content: { kind: "IDOL_ALIASES", aliases: [], actorId: id(1) },
    } as never);
    expect(
      await subject.readPreview({
        schemaVersion: 1,
        target,
        token: sessionToken,
      }),
    ).toEqual(fail("PREVIEW_UNAVAILABLE"));
  });
  test("adapter exceptions expose no source messages, credentials, or payloads", async () => {
    const subject = harness();
    subject.authorize.mockRejectedValue(new Error(sessionToken + tokenPepper));
    expect(await subject.execute(request(createAliases()))).toEqual(
      fail("CONTENT_UNAVAILABLE"),
    );
    subject.previewRead.mockRejectedValue(
      new Error(sessionToken + tokenPepper),
    );
    expect(
      await subject.readPreview({
        schemaVersion: 1,
        target,
        token: sessionToken,
      }),
    ).toEqual(fail("PREVIEW_UNAVAILABLE"));
  });
});

describe("assigned language review reading", () => {
  function subject() {
    const subject = harness();
    const translation = completeDetail.translations.find(
      (row) => row.locale === "ja",
    )!;
    const context = contentReviewContextSchema.parse({
      schemaVersion: 1,
      target: {
        kind: "GIFT_DETAILS",
        revisionId: detailInput.document.giftRevisionId,
        locale: "ja",
      },
      subjectId: translation.id,
      sequence: 1,
      status: "DRAFT",
      editorId: translation.editorId,
      structureEditorId: translation.editorId,
      editedAt: translation.editedAt,
      contentHash: translation.sourceHash,
      sourceHash: translation.translatedFromSourceHash,
      locales: ["ja"],
    });
    subject.read.mockResolvedValue(completeDetail);
    subject.loadTarget.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      context,
    });
    subject.authorize.mockImplementation(async (command) =>
      command.locales.some((locale) => locale !== "ja")
        ? fail("FORBIDDEN")
        : { schemaVersion: 1, outcome: "SUCCESS", principal },
    );
    const input = {
      ...request(createDetails()),
      command: {
        schemaVersion: 1,
        action: "READ_REVIEW",
        target: context.target,
      },
    };
    return { ...subject, context, input };
  }
  test("a reviewer assigned only Japanese receives that translation and actual English source", async () => {
    const review = subject();
    const response = await review.execute(review.input);
    expect(response).toEqual({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "REVIEW",
      context: review.context,
      content: {
        kind: "GIFT_DETAILS",
        document: completeDetail.document,
        translation: {
          blocks: completeDetail.translations.find(
            (row) => row.locale === "ja",
          )!.blocks,
        },
      },
      source: {
        blocks: completeDetail.translations.find((row) => row.locale === "en")!
          .blocks,
      },
    });
    expect(review.authorize.mock.calls.at(-1)![0]).toMatchObject({
      permission: "content.read",
      locales: ["ja"],
    });
    for (const locale of SUPPORTED_LOCALES.filter(
      (locale) => locale !== "en" && locale !== "ja",
    ))
      expect(JSON.stringify(response)).not.toContain(`Content for ${locale}`);
    expect(review.begin).not.toHaveBeenCalled();
  });
  test("a reviewer missing the selected language is refused before any content is returned", async () => {
    const review = subject();
    review.authorize
      .mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "SUCCESS",
        principal,
      })
      .mockResolvedValueOnce(fail("FORBIDDEN"));
    expect(await review.execute(review.input)).toEqual(fail("FORBIDDEN"));
  });
  test("selected content and English source hashes must match the canonical review context", async () => {
    const review = subject();
    review.loadTarget.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      context: {
        ...review.context,
        sourceHash: sourceHashSchema.parse("f".repeat(64)),
      },
    });
    expect(await review.execute(review.input)).toEqual(
      fail("CONTENT_UNAVAILABLE"),
    );
  });
  test("cannot present mutated source text under a formerly approved hash", async () => {
    const review = subject();
    const tampered = structuredClone(completeDetail);
    const english = tampered.translations.find((row) => row.locale === "en")!;
    english.blocks = [
      { blockId: "intro", kind: "PARAGRAPH", text: "Changed English source" },
    ];
    review.read.mockResolvedValue(tampered);
    expect(await review.execute(review.input)).toEqual(
      fail("CONTENT_UNAVAILABLE"),
    );
  });
  test("alias review reading returns the full independently approved set without a fabricated English source", async () => {
    const review = harness();
    const input = {
      ...request(createAliases()),
      command: {
        schemaVersion: 1,
        action: "READ_REVIEW",
        target: aliasContext.target,
      },
    };
    expect(await review.execute(input)).toEqual({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "REVIEW",
      context: aliasContext,
      content: { kind: "IDOL_ALIASES", aliases: aliasSet.aliases },
      source: null,
    });
    expect(review.authorize.mock.calls.at(-1)![0]).toMatchObject({
      permission: "content.read",
      locales: ["th"],
    });
  });
});

test("token digest validates canonical entropy and the injected pepper", () => {
  for (const badPepper of [
    "",
    "ab".repeat(31),
    "AB".repeat(32),
    "zz".repeat(32),
  ])
    expect(() =>
      digestAdminContentToken({
        tokenPepper: badPepper,
        purpose: "admin-session",
        token: sessionToken,
      }),
    ).toThrow("invalid admin token configuration");
  for (const token of ["", sessionToken + "=", sessionToken.slice(0, -1) + "B"])
    expect(() =>
      digestAdminContentToken({ tokenPepper, purpose: "admin-session", token }),
    ).toThrow("invalid admin token");
  const digest = digestAdminContentToken({
    tokenPepper,
    purpose: "admin-session",
    token: sessionToken,
  });
  expect(digest).not.toBe(
    createHmac("sha256", Buffer.from(tokenPepper, "hex"))
      .update(sessionToken)
      .digest("hex"),
  );
});

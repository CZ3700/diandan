/// <reference types="node" />
import { createHmac } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import {
  adminPrincipalSchema,
  baseContentTargetSchema,
  baseContentCommandSchema,
  baseContentReviewResponseSchema,
  type AdminContentFailure,
  type BaseContentCommand,
  type BaseContentReviewResponse,
  type BaseContentTarget,
  type SupportedLocale,
} from "@fan-support/contracts";
import { computeIdolTranslationContentHash } from "@fan-support/content";
import type {
  BaseContentRepositories,
  BaseContentTransactionManager,
  JsonValue,
} from "@fan-support/persistence-port";
import { createBaseContentUseCases } from "./base-content.js";
import { digestAdminContentToken } from "./admin-content-tokens.js";
const id = (n: number) =>
  `75000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tokenPepper = "ac".repeat(32);
const sessionToken = Buffer.alloc(32, 3).toString("base64url");
const csrfToken = Buffer.alloc(32, 4).toString("base64url");
const now = "2026-09-06T10:00:00.818Z";
const principal = adminPrincipalSchema.parse({
  schemaVersion: 1,
  actorId: id(1),
  sessionId: id(2),
  authorizedAt: now,
  expiresAt: "2026-09-06T11:00:00.000Z",
});
const target: BaseContentTarget = baseContentTargetSchema.parse({
  owner: { kind: "IDOL", idolId: id(3) },
  revisionId: id(4),
  locale: "ja",
});
const fail = (code: AdminContentFailure["code"]): AdminContentFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});
const fields = (locale: string) => ({
  displayName: `Name ${locale}`,
  shortBio: `Bio ${locale}`,
  fullBio: `Biography ${locale}`,
  seoTitle: `Title ${locale}`,
  seoDescription: `Description ${locale}`,
});
function review(): Extract<BaseContentReviewResponse, { outcome: "SUCCESS" }> {
  const en = computeIdolTranslationContentHash(fields("en"));
  const ja = computeIdolTranslationContentHash(fields("ja"));
  const r = baseContentReviewResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "REVIEW",
    context: {
      schemaVersion: 1,
      target,
      structureEditorId: id(10),
      lifecycle: { status: "DRAFT" },
      audit: {
        id: id(20),
        reviewId: id(21),
        reviewSequence: 1,
        locale: "ja",
        sourceHash: ja,
        translatedFromSourceHash: en,
        origin: "HUMAN",
        editorId: principal.actorId,
        editedAt: "2026-09-06T09:00:00.000Z",
        review: { status: "DRAFT" },
      },
      currentEnglishSourceHash: en,
      stale: false,
    },
    content: {
      kind: "IDOL",
      structure: {
        themeAccent: "#D4AF37",
        heroTextTone: "light",
        displayOrder: 0,
      },
      media: [],
      fields: fields("ja"),
    },
    source: { kind: "IDOL", fields: fields("en") },
  });
  if (r.outcome !== "SUCCESS") throw new Error("fixture");
  return r;
}
function mutation(
  r = review(),
): Extract<BaseContentCommand, { action: "SUBMIT_REVIEW" }> {
  return {
    schemaVersion: 1,
    action: "SUBMIT_REVIEW",
    target,
    expectedVersion: r.context.audit.reviewSequence,
    expectedContentHash: r.context.audit.sourceHash,
    expectedSourceHash: r.context.currentEnglishSourceHash,
    reasonCode: "CONTENT_REVIEWED",
    idempotencyKey: "base-review-0001" as Extract<
      BaseContentCommand,
      { action: "SUBMIT_REVIEW" }
    >["idempotencyKey"],
  };
}
function request(command: BaseContentCommand, requestId = id(50)) {
  return { schemaVersion: 1, requestId, sessionToken, csrfToken, command };
}
const issueCommand: BaseContentCommand = {
  schemaVersion: 1,
  action: "ISSUE_PREVIEW",
  target,
  ttlSeconds: 60,
  reasonCode: "CONTENT_PREVIEWED",
};
function harness() {
  const events: string[] = [];
  const state = {
    review: review(),
    grants: ["ja"] as SupportedLocale[],
    reservation: undefined as { hash: string; result: string } | undefined,
  };
  const authorize = vi.fn<
    BaseContentRepositories["authorization"]["authorize"]
  >(async (c) => {
    events.push("authorize");
    return c.locales.some((l) => !state.grants.includes(l))
      ? fail("FORBIDDEN")
      : { schemaVersion: 1, outcome: "SUCCESS", principal };
  });
  const read = vi.fn<BaseContentRepositories["baseContentReviews"]["read"]>(
    async () => {
      events.push("read");
      return structuredClone(state.review);
    },
  );
  const append = vi.fn<BaseContentRepositories["baseContentReviews"]["append"]>(
    async () => {
      events.push("append");
      return {
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "MUTATION",
        resultId: id(60),
        replayed: false,
      };
    },
  );
  const issue = vi.fn<BaseContentRepositories["baseContentPreviews"]["issue"]>(
    async () => {
      events.push("issue");
      return {
        schemaVersion: 1,
        outcome: "SUCCESS",
        grantId: id(61),
        createdAt: now,
        expiresAt: "2026-09-06T10:01:00.818Z",
      };
    },
  );
  const preview = vi.fn<BaseContentRepositories["baseContentPreviews"]["read"]>(
    async () => {
      events.push("preview");
      return {
        schemaVersion: 1,
        outcome: "SUCCESS",
        target,
        content: state.review.content,
      };
    },
  );
  const revoke = vi.fn<
    BaseContentRepositories["baseContentPreviews"]["revoke"]
  >(async (c) => {
    events.push("revoke");
    return {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      resultId: c.grantId,
      replayed: false,
    };
  });
  const begin = vi.fn<BaseContentRepositories["idempotency"]["begin"]>(
    async (c) => {
      events.push("begin");
      return {
        schemaVersion: 1,
        operation: "BEGIN_IDEMPOTENCY",
        outcome: "SUCCESS",
        value:
          state.reservation === undefined
            ? { decision: "STARTED" }
            : state.reservation.hash === c.canonicalRequestHash
              ? {
                  decision: "REPLAY",
                  safeResultReference: state.reservation.result,
                }
              : { decision: "CONFLICT" },
      };
    },
  );
  const complete = vi.fn<BaseContentRepositories["idempotency"]["complete"]>(
    async (c) => {
      events.push("complete");
      state.reservation = {
        hash: c.canonicalRequestHash,
        result: c.safeResultReference,
      };
      return {
        schemaVersion: 1,
        operation: "COMPLETE_IDEMPOTENCY",
        outcome: "SUCCESS",
        value: { completed: true },
      };
    },
  );
  const repositories: BaseContentRepositories = {
    authorization: { authorize },
    baseContentReviews: { read, append },
    baseContentPreviews: { issue, read: preview, revoke },
    idempotency: { begin, complete },
  };
  const transactions: BaseContentTransactionManager = {
    async runInBaseContentTransaction<Result extends JsonValue>(
      work: (r: BaseContentRepositories) => Promise<Result>,
    ): Promise<Result> {
      events.push("transaction");
      const old = state.reservation;
      try {
        const result = await work(repositories);
        events.push("commit");
        return result;
      } catch (error) {
        events.push("rollback");
        state.reservation = old;
        throw error;
      }
    },
  };
  return {
    events,
    state,
    authorize,
    read,
    append,
    issue,
    preview,
    revoke,
    begin,
    complete,
    transactions,
    useCases: createBaseContentUseCases({ transactions, tokenPepper }),
  };
}
describe("base content application boundary", () => {
  test("microsecond session lifetime remains valid and idempotency retains its canonical timestamp", async () => {
    const h = harness();
    h.authorize.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      principal: {
        ...principal,
        authorizedAt: "2026-09-06T10:00:00.818001Z",
        expiresAt: "2026-09-06T10:00:00.818002Z",
      },
    });
    expect(await h.useCases.execute(request(mutation()))).toMatchObject({
      outcome: "SUCCESS",
    });
    expect(h.begin.mock.calls[0]![0].expiresAt).toBe(
      "2026-09-07T10:00:00.818001Z",
    );
  });
  test("one microsecond beyond preview TTL is rejected without a rounding tolerance", async () => {
    const h = harness();
    h.issue.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      grantId: id(61),
      createdAt: "2026-09-06T10:00:00.818000Z",
      expiresAt: "2026-09-06T10:01:00.818001Z",
    });
    expect(await h.useCases.execute(request(issueCommand))).toEqual(
      fail("CONTENT_UNAVAILABLE"),
    );
  });
  test("preview session cap compares equivalent offsets with full precision", async () => {
    const h = harness();
    h.authorize.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      principal: {
        ...principal,
        authorizedAt: "2026-09-06T18:00:00.818000+08:00",
        expiresAt: "2026-09-06T18:00:01.818001+08:00",
      },
    });
    h.issue
      .mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "SUCCESS",
        grantId: id(61),
        createdAt: "2026-09-06T10:00:00.818000Z",
        expiresAt: "2026-09-06T10:00:01.818001Z",
      })
      .mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "SUCCESS",
        grantId: id(61),
        createdAt: "2026-09-06T10:00:00.818000Z",
        expiresAt: "2026-09-06T10:00:01.818002Z",
      });
    expect(await h.useCases.execute(request(issueCommand))).toMatchObject({
      outcome: "SUCCESS",
    });
    expect(await h.useCases.execute(request(issueCommand))).toEqual(
      fail("CONTENT_UNAVAILABLE"),
    );
  });
  test("replay remains valid after terminal inherited approval and revision validation", async () => {
    const h = harness();
    const c = mutation();
    await h.useCases.execute(request(c));
    const context = h.state.review.context;
    context.lifecycle = { status: "VALIDATED", validatedAt: now };
    context.audit.reviewSequence = 3;
    context.audit.review = {
      status: "APPROVED",
      reviewerId: id(90) as typeof context.audit.editorId,
      reviewedAt: now,
      reviewedSourceHash: context.currentEnglishSourceHash,
      reviewedContentHash: context.audit.sourceHash,
    };
    expect(await h.useCases.execute(request(c))).toMatchObject({
      outcome: "SUCCESS",
      replayed: true,
    });
    expect(h.append).toHaveBeenCalledTimes(1);
  });
  test("malformed idempotency replay never returns an arbitrary stored response", async () => {
    const h = harness();
    h.begin.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      operation: "BEGIN_IDEMPOTENCY",
      value: {
        decision: "REPLAY",
        safeResultReference: "result-ref:v1:invalid",
      },
    });
    expect(await h.useCases.execute(request(mutation()))).toEqual(
      fail("CONTENT_UNAVAILABLE"),
    );
    expect(h.append).not.toHaveBeenCalled();
    expect(h.events.at(-1)).toBe("rollback");
  });
  test("revocation rejects a different grant returned by the repository", async () => {
    const h = harness();
    h.revoke.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      resultId: id(99),
      replayed: false,
    });
    const c = baseContentCommandSchema.parse({
      schemaVersion: 1,
      action: "REVOKE_PREVIEW",
      grantId: id(61),
      reasonCode: "PREVIEW_REVOKED",
      idempotencyKey: "base-revoke-0001",
    });
    expect(await h.useCases.execute(request(c))).toEqual(
      fail("CONTENT_UNAVAILABLE"),
    );
    expect(h.complete).not.toHaveBeenCalled();
  });
  test("assigned-language read sees selected text and real English; only its locale is authorized", async () => {
    const h = harness();
    expect(
      await h.useCases.execute(
        request({ schemaVersion: 1, action: "READ_REVIEW", target }),
      ),
    ).toEqual(h.state.review);
    expect(
      h.authorize.mock.calls.every(
        ([c]) => c.locales.length === 1 && c.locales[0] === "ja",
      ),
    ).toBe(true);
    expect(h.begin).not.toHaveBeenCalled();
  });
  test.each(["FORBIDDEN", "UNAUTHENTICATED", "CSRF_INVALID"] as const)(
    "%s rejects before canonical content and replay",
    async (code) => {
      const h = harness();
      h.authorize.mockResolvedValue(fail(code));
      expect(await h.useCases.execute(request(mutation()))).toEqual(fail(code));
      expect(h.read).not.toHaveBeenCalled();
      expect(h.begin).not.toHaveBeenCalled();
    },
  );
  test("submit uses trusted actor and safe result reference; transport requestId does not change replay", async () => {
    const h = harness();
    const c = mutation();
    expect(await h.useCases.execute(request(c))).toMatchObject({
      outcome: "SUCCESS",
      replayed: false,
    });
    expect(h.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SUBMIT",
        actorId: principal.actorId,
        requestId: id(50),
      }),
    );
    expect(h.complete.mock.calls[0]![0].safeResultReference).toBe(
      `result-ref:v1:${id(60)}`,
    );
    expect(h.begin.mock.calls[0]![0].expiresAt).toBe(
      "2026-09-07T10:00:00.818Z",
    );
    h.state.review.context.audit.reviewSequence = 2;
    h.state.review.context.audit.review = {
      status: "IN_REVIEW",
      submittedAt: now,
    };
    expect(await h.useCases.execute(request(c, id(51)))).toMatchObject({
      outcome: "SUCCESS",
      replayed: true,
    });
    expect(h.append).toHaveBeenCalledTimes(1);
    h.state.grants = [];
    expect(await h.useCases.execute(request(c))).toEqual(fail("FORBIDDEN"));
    expect(h.begin).toHaveBeenCalledTimes(2);
  });
  test("changed command conflicts with an existing key", async () => {
    const h = harness();
    const c = mutation();
    await h.useCases.execute(request(c));
    expect(
      await h.useCases.execute(request({ ...c, reasonCode: "OTHER_REASON" })),
    ).toEqual(fail("IDEMPOTENCY_CONFLICT"));
  });
  test("STALE read succeeds and mutation rolls back after reservation", async () => {
    const h = harness();
    h.state.review.context.audit.translatedFromSourceHash = "a".repeat(
      64,
    ) as typeof h.state.review.context.currentEnglishSourceHash;
    h.state.review.context.stale = true;
    expect(
      await h.useCases.execute(
        request({ schemaVersion: 1, action: "READ_REVIEW", target }),
      ),
    ).toMatchObject({ outcome: "SUCCESS", context: { stale: true } });
    expect(await h.useCases.execute(request(mutation(h.state.review)))).toEqual(
      fail("STALE_CONTENT"),
    );
    expect(h.append).not.toHaveBeenCalled();
    expect(h.events.at(-1)).toBe("rollback");
  });
  test.each(["content", "source", "target"] as const)(
    "tampered narrow %s is rejected before replay",
    async (part) => {
      const h = harness();
      if (part === "target")
        h.state.review.context.target = { ...target, revisionId: id(999) };
      else {
        const v = h.state.review[part];
        if (v.kind !== "IDOL") throw new Error("fixture");
        v.fields.shortBio = "tampered";
      }
      expect(await h.useCases.execute(request(mutation()))).toEqual(
        fail("CONTENT_UNAVAILABLE"),
      );
      expect(h.begin).not.toHaveBeenCalled();
    },
  );
  test("invalid ICU can be read, but newly submitted content is invalid", async () => {
    const h = harness();
    if (h.state.review.content.kind !== "IDOL") throw new Error("fixture");
    h.state.review.content.fields.shortBio = "Hello {name}";
    h.state.review.context.audit.sourceHash = computeIdolTranslationContentHash(
      h.state.review.content.fields,
    ) as typeof h.state.review.context.audit.sourceHash;
    expect(
      await h.useCases.execute(
        request({ schemaVersion: 1, action: "READ_REVIEW", target }),
      ),
    ).toMatchObject({ outcome: "SUCCESS" });
    expect(await h.useCases.execute(request(mutation(h.state.review)))).toEqual(
      fail("INVALID_CONTENT"),
    );
  });
  test("approval requires independent editor and structure author", async () => {
    const h = harness();
    h.state.review.context.audit.reviewSequence = 2;
    h.state.review.context.audit.review = {
      status: "IN_REVIEW",
      submittedAt: now,
    };
    const c = {
      ...mutation(h.state.review),
      action: "APPROVE_REVIEW" as const,
    };
    expect(await h.useCases.execute(request(c))).toEqual(fail("SELF_REVIEW"));
    h.state.review.context.audit.editorId = id(
      9,
    ) as typeof h.state.review.context.audit.editorId;
    h.state.review.context.structureEditorId = principal.actorId;
    expect(await h.useCases.execute(request(c))).toEqual(fail("SELF_REVIEW"));
    h.state.review.context.structureEditorId = id(10);
    expect(await h.useCases.execute(request(c))).toMatchObject({
      outcome: "SUCCESS",
    });
    expect(h.authorize.mock.lastCall?.[0].permission).toBe(
      "content.translation.review",
    );
  });
  test.each(["begin", "complete"] as const)(
    "returned %s serialization conflict rolls back instead of 503",
    async (phase) => {
      for (const code of ["TRANSACTION_ABORTED", "VERSION_CONFLICT"] as const) {
        const h = harness();
        const error = {
          schemaVersion: 1 as const,
          code,
          recovery:
            code === "TRANSACTION_ABORTED"
              ? ("RETRY_SAME_COMMAND" as const)
              : ("NONE" as const),
          ...(code === "TRANSACTION_ABORTED" ? { retryAfterMs: 100 } : {}),
        };
        if (phase === "begin")
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
        expect(await h.useCases.execute(request(mutation()))).toEqual(
          fail("CONFLICT"),
        );
        expect(h.events.at(-1)).toBe("rollback");
        expect(h.state.reservation).toBeUndefined();
      }
    },
  );
  test("repository receipt rejection and exception never commit an idempotency reservation", async () => {
    const h = harness();
    h.append
      .mockResolvedValueOnce(fail("INVALID_REVIEW_STATE"))
      .mockRejectedValueOnce(new Error("unsafe internal detail"));
    expect(await h.useCases.execute(request(mutation()))).toEqual(
      fail("INVALID_REVIEW_STATE"),
    );
    expect(await h.useCases.execute(request(mutation()))).toEqual(
      fail("CONTENT_UNAVAILABLE"),
    );
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.events.at(-1)).toBe("rollback");
  });
  test("preview issue returns raw token once and persists a separate purpose digest", async () => {
    const h = harness();
    const r = await h.useCases.execute(request(issueCommand));
    expect(r.outcome).toBe("SUCCESS");
    if (r.outcome !== "SUCCESS" || r.kind !== "PREVIEW_GRANT")
      throw new Error("fixture");
    expect(Buffer.from(r.token, "base64url")).toHaveLength(32);
    const c = h.issue.mock.calls[0]![0];
    expect(c.tokenDigest).toBe(
      digestAdminContentToken({
        tokenPepper,
        purpose: "base-content-preview",
        token: r.token,
      }),
    );
    expect(JSON.stringify(c)).not.toContain(r.token);
    expect(h.begin).not.toHaveBeenCalled();
    expect(Object.keys(r).sort()).toEqual([
      "expiresAt",
      "grantId",
      "kind",
      "outcome",
      "schemaVersion",
      "token",
    ]);
  });
  test("backward clock during canonical authorization and issue is valid", async () => {
    const h = harness();
    h.authorize.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      principal: { ...principal, authorizedAt: "2026-09-06T10:00:00.660Z" },
    });
    h.issue.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      grantId: id(61),
      createdAt: "2026-09-06T10:00:00.656Z",
      expiresAt: "2026-09-06T10:01:00.656Z",
    });
    expect(await h.useCases.execute(request(issueCommand))).toMatchObject({
      outcome: "SUCCESS",
    });
    expect(await h.useCases.execute(request(mutation()))).toMatchObject({
      outcome: "SUCCESS",
    });
  });
  test.each(["ttl", "session", "zero"] as const)(
    "invalid preview %s deadline rolls back",
    async (bound) => {
      const h = harness();
      h.issue.mockResolvedValue({
        schemaVersion: 1,
        outcome: "SUCCESS",
        grantId: id(61),
        createdAt: now,
        expiresAt:
          bound === "ttl"
            ? "2026-09-06T10:01:00.819Z"
            : bound === "session"
              ? "2026-09-06T11:01:00.000Z"
              : now,
      });
      expect(await h.useCases.execute(request(issueCommand))).toEqual(
        fail("CONTENT_UNAVAILABLE"),
      );
      expect(h.events.at(-1)).toBe("rollback");
    },
  );
  test("expired canonical principal is refused", async () => {
    const h = harness();
    h.authorize.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      principal: { ...principal, authorizedAt: principal.expiresAt },
    });
    expect(await h.useCases.execute(request(mutation()))).toEqual(
      fail("UNAUTHENTICATED"),
    );
    expect(h.read).not.toHaveBeenCalled();
  });
  test("bearer preview has no raw admin session and checks returned target", async () => {
    const h = harness();
    expect(
      await h.useCases.readPreview({
        schemaVersion: 1,
        target,
        token: sessionToken,
      }),
    ).toMatchObject({ outcome: "SUCCESS", content: { fields: fields("ja") } });
    expect(h.authorize).not.toHaveBeenCalled();
    expect(h.preview.mock.calls[0]![0].tokenDigest).toBe(
      digestAdminContentToken({
        tokenPepper,
        purpose: "base-content-preview",
        token: sessionToken,
      }),
    );
    h.preview.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      target: { ...target, locale: "en" },
      content: h.state.review.content,
    });
    expect(
      await h.useCases.readPreview({
        schemaVersion: 1,
        target,
        token: sessionToken,
      }),
    ).toEqual(fail("PREVIEW_UNAVAILABLE"));
  });
  test("preview rejects cross-language alias and internal errors without leakage", async () => {
    const h = harness();
    if (h.state.review.content.kind !== "IDOL") throw new Error("fixture");
    h.preview
      .mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "SUCCESS",
        target,
        content: {
          ...h.state.review.content,
          aliases: [{ id: "en", locale: "en", text: "English" }],
        },
      })
      .mockRejectedValueOnce(new Error("unsafe internal detail"));
    for (let i = 0; i < 2; i++)
      expect(
        await h.useCases.readPreview({
          schemaVersion: 1,
          target,
          token: sessionToken,
        }),
      ).toEqual(fail("PREVIEW_UNAVAILABLE"));
  });
  test("own grant revocation needs current basic preview permission even after locale withdrawal", async () => {
    const h = harness();
    h.state.grants = [];
    const c = baseContentCommandSchema.parse({
      schemaVersion: 1,
      action: "REVOKE_PREVIEW",
      grantId: id(61),
      reasonCode: "PREVIEW_REVOKED",
      idempotencyKey: "base-revoke-0001",
    });
    expect(await h.useCases.execute(request(c))).toMatchObject({
      outcome: "SUCCESS",
    });
    expect(h.authorize.mock.calls[0]![0]).toMatchObject({
      permission: "content.preview",
      locales: [],
    });
    expect(h.read).not.toHaveBeenCalled();
    expect(await h.useCases.execute(request(c))).toMatchObject({
      replayed: true,
    });
  });
  test("bad configuration and noncanonical tokens fail without echoing secret", async () => {
    const h = harness();
    for (const secret of [undefined, new String(tokenPepper), "bad-secret"]) {
      expect(() =>
        createBaseContentUseCases({
          transactions: h.transactions,
          tokenPepper: secret as string,
        }),
      ).toThrow("invalid admin token configuration");
    }
    expect(
      await h.useCases.execute({
        ...request(mutation()),
        sessionToken: sessionToken + "=",
      }),
    ).toEqual(fail("INVALID_COMMAND"));
    expect(h.authorize).not.toHaveBeenCalled();
  });
  test("new token purpose preserves all three established HMAC outputs", () => {
    const purposes = [
      "admin-session",
      "admin-csrf",
      "content-preview",
      "base-content-preview",
    ] as const;
    const digests = purposes.map((purpose) => {
      const digest = digestAdminContentToken({
        tokenPepper,
        purpose,
        token: sessionToken,
      });
      expect(digest).toBe(
        createHmac("sha256", Buffer.from(tokenPepper, "hex"))
          .update(`fan-support:admin-token:v1:${purpose}:`)
          .update(sessionToken)
          .digest("hex"),
      );
      return digest;
    });
    expect(new Set(digests).size).toBe(4);
  });
});

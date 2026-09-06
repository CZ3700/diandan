/// <reference types="node" />
import { describe, expect, test, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
  adminPrincipalSchema,
  contentAuthoringCommandSchema,
  contentAuthoringSnapshotSchema,
  type AdminContentFailure,
  type ContentAuthoringCommand,
  type ContentAuthoringSnapshot,
  type ContentAuthoringChanges,
  type SupportedLocale,
} from "@fan-support/contracts";
import {
  computeContentAuthoringSnapshotHash,
  computeIdolTranslationContentHash,
  prepareContentAuthoring,
  prepareIdolAliasDraft,
  prepareGiftDetailDraft,
} from "@fan-support/content";
import type {
  ContentAuthoringRepositories,
  ContentAuthoringTransactionManager,
  JsonValue,
} from "@fan-support/persistence-port";
import { createContentAuthoringUseCases } from "./content-authoring.js";
import { digestAdminContentToken } from "./admin-content-tokens.js";

const id = (n: number) =>
  `72000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
const fail = (code: AdminContentFailure["code"]): AdminContentFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});
function create(): Extract<ContentAuthoringCommand, { action: "CREATE" }> {
  const parsed = contentAuthoringCommandSchema.parse({
    schemaVersion: 1,
    action: "CREATE",
    target: { kind: "IDOL", idolId: id(3) },
    expectedVersion: 0,
    reasonCode: "CONTENT_CREATED",
    idempotencyKey: "authoring-create-001",
    content: {
      kind: "IDOL",
      structure: {
        themeAccent: "#D4AF37",
        heroTextTone: "light",
        displayOrder: 0,
      },
      media: [],
      translations: SUPPORTED_LOCALES.map((locale) => ({
        locale,
        origin: "HUMAN",
        fields: {
          displayName: `Name ${locale}`,
          shortBio: `Biography ${locale}`,
          fullBio: `Full biography ${locale}`,
          seoTitle: `Title ${locale}`,
          seoDescription: `Description ${locale}`,
        },
      })),
    },
  });
  if (parsed.action !== "CREATE") throw new Error("fixture");
  return parsed;
}
function snapshot(
  approved = true,
  command = create(),
): ContentAuthoringSnapshot {
  const plan = prepareContentAuthoring(command, null, {
    actorId: id(4),
    createdAt: "2026-09-05T10:00:00.123456Z",
  });
  const value = contentAuthoringSnapshotSchema.parse({
    schemaVersion: 1,
    target: command.target,
    revisionId: id(10),
    revisionNumber: 1,
    headVersion: 1,
    lifecycle: { status: "DRAFT" },
    createdBy: id(4),
    createdAt: "2026-09-05T10:00:00.123456Z",
    contentHash: "0".repeat(64),
    content: plan.content,
    translationAudits: plan.translationAudits.map((row, index) => ({
      ...row,
      id: id(20 + index),
      reviewId: id(40 + index),
      reviewSequence: approved ? 3 : 1,
      review: approved
        ? {
            status: "APPROVED",
            reviewerId: id(5),
            reviewedAt: "2026-09-05T11:00:00.654321Z",
            reviewedContentHash: row.sourceHash,
            reviewedSourceHash: row.translatedFromSourceHash,
          }
        : { status: "DRAFT" },
    })),
    extensions: {},
  });
  return refresh(value);
}
function giftWithDetails(): ContentAuthoringSnapshot {
  const command = contentAuthoringCommandSchema.parse({
    ...create(),
    target: { kind: "GIFT", giftId: id(3) },
    content: {
      kind: "GIFT",
      structure: {
        category: "OTHER",
        contents: [{ componentCode: "CARD", quantity: 1, unit: "ITEM" }],
        deliveryEstimate: { minimum: 1, maximum: 2, unit: "DAY" },
        requiresSafetyNotice: false,
        shippingMode: "internal_to_idol",
      },
      media: [],
      translations: [
        {
          locale: "en",
          origin: "HUMAN",
          fields: {
            title: "Gift",
            shortDescription: "Summary",
            description: "Description",
            fulfillmentDescription: "Preparation",
            variantLabels: [{ giftVariantId: id(8), label: "Standard" }],
            seoTitle: "Gift",
            seoDescription: "Description",
          },
        },
      ],
    },
  });
  if (command.action !== "CREATE") throw new Error("fixture");
  const value = snapshot(true, command);
  if (value.content.kind !== "GIFT") throw new Error("fixture");
  const details = prepareGiftDetailDraft(
    {
      schemaVersion: 1,
      document: {
        schemaVersion: 1,
        id: id(90),
        giftRevisionId: value.revisionId,
        blocks: [{ id: "intro", kind: "PARAGRAPH" }],
      },
      translations: ["en", "th"].map((locale, index) => ({
        id: id(91 + index),
        locale,
        origin: "HUMAN",
        blocks: [
          { blockId: "intro", kind: "PARAGRAPH", text: `Detail ${locale}` },
        ],
      })),
      actorId: id(4),
      requestId: id(93),
      reasonCode: "CONTENT_CREATED",
    },
    now,
  );
  if (details.outcome !== "SUCCESS") throw new Error("fixture");
  value.extensions.details = details;
  value.content.details = {
    blocks: details.document.blocks,
    translations: details.translations.map((row) => ({
      locale: row.locale,
      origin: row.origin,
      blocks: row.blocks,
    })),
  };
  return refresh(value);
}
function refresh(value: ContentAuthoringSnapshot) {
  value.contentHash = computeContentAuthoringSnapshotHash(
    value,
  ) as ContentAuthoringSnapshot["contentHash"];
  return value;
}
function copy(
  value: ContentAuthoringSnapshot,
  changes: ContentAuthoringChanges = { kind: "IDOL" },
): ContentAuthoringCommand {
  return contentAuthoringCommandSchema.parse({
    schemaVersion: 1,
    action: "COPY",
    target: value.target,
    sourceRevisionId: value.revisionId,
    expectedSourceHash: value.contentHash,
    expectedVersion: value.headVersion,
    idempotencyKey: "authoring-copy-001",
    reasonCode: "CONTENT_EDITED",
    changes,
  });
}
function textChanges(
  value: ContentAuthoringSnapshot,
  locale: SupportedLocale,
): ContentAuthoringChanges {
  if (value.content.kind !== "IDOL") throw new Error("fixture");
  const row = value.content.translations.find(
    (item) => item.locale === locale,
  )!;
  return {
    kind: "IDOL",
    translations: [
      {
        ...row,
        fields: { ...row.fields, shortBio: `New biography ${locale}` },
      },
    ],
  };
}
function read(value: ContentAuthoringSnapshot): ContentAuthoringCommand {
  return {
    schemaVersion: 1,
    action: "READ",
    target: value.target,
    revisionId: value.revisionId,
  };
}
function request(command: ContentAuthoringCommand, requestId = id(60)) {
  return { schemaVersion: 1, requestId, sessionToken, csrfToken, command };
}
function harness(value = snapshot()) {
  const state = {
    snapshot: value,
    grants: [...SUPPORTED_LOCALES] as SupportedLocale[],
    reservation: undefined as { hash: string; result: string } | undefined,
  };
  const events: string[] = [];
  const authorize = vi.fn<
    ContentAuthoringRepositories["authorization"]["authorize"]
  >(async (command) => {
    events.push("authorize");
    if (command.locales.some((locale) => !state.grants.includes(locale)))
      return fail("FORBIDDEN");
    return { schemaVersion: 1, outcome: "SUCCESS", principal };
  });
  const load = vi.fn<ContentAuthoringRepositories["contentAuthoring"]["read"]>(
    async () => {
      events.push("read");
      return {
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "REVISION",
        snapshot: structuredClone(state.snapshot),
      };
    },
  );
  const write = vi.fn<
    ContentAuthoringRepositories["contentAuthoring"]["write"]
  >(async () => {
    events.push("write");
    return {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      resultId: id(70),
      replayed: false,
    };
  });
  const begin = vi.fn<ContentAuthoringRepositories["idempotency"]["begin"]>(
    async (command) => {
      events.push("begin");
      return {
        schemaVersion: 1,
        operation: "BEGIN_IDEMPOTENCY",
        outcome: "SUCCESS",
        value:
          state.reservation === undefined
            ? { decision: "STARTED" }
            : state.reservation.hash === command.canonicalRequestHash
              ? {
                  decision: "REPLAY",
                  safeResultReference: state.reservation.result,
                }
              : { decision: "CONFLICT" },
      };
    },
  );
  const complete = vi.fn<
    ContentAuthoringRepositories["idempotency"]["complete"]
  >(async (command) => {
    events.push("complete");
    state.reservation = {
      hash: command.canonicalRequestHash,
      result: command.safeResultReference,
    };
    return {
      schemaVersion: 1,
      operation: "COMPLETE_IDEMPOTENCY",
      outcome: "SUCCESS",
      value: { completed: true },
    };
  });
  const repositories: ContentAuthoringRepositories = {
    authorization: { authorize },
    contentAuthoring: { read: load, write },
    idempotency: { begin, complete },
  };
  const transactions: ContentAuthoringTransactionManager = {
    async runInContentAuthoringTransaction<Result extends JsonValue>(
      work: (repositories: ContentAuthoringRepositories) => Promise<Result>,
    ): Promise<Result> {
      events.push("transaction");
      const previous = state.reservation;
      try {
        const result = await work(repositories);
        events.push("commit");
        return result;
      } catch (error) {
        state.reservation = previous;
        events.push("rollback");
        throw error;
      }
    },
  };
  return {
    state,
    events,
    authorize,
    load,
    write,
    begin,
    complete,
    transactions,
    useCases: createContentAuthoringUseCases({ transactions, tokenPepper }),
  };
}

describe("immutable content authoring application", () => {
  test("CREATE authorizes every input locale, writes trusted actor and reserves only a safe reference", async () => {
    const h = harness();
    const result = await h.useCases.execute(request(create()));
    expect(result).toEqual({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      resultId: id(70),
      replayed: false,
    });
    expect(h.events).toEqual([
      "transaction",
      "authorize",
      "begin",
      "write",
      "complete",
      "commit",
    ]);
    expect(h.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: "content.edit",
        locales: [...SUPPORTED_LOCALES],
        sessionTokenDigest: digestAdminContentToken({
          tokenPepper,
          purpose: "admin-session",
          token: sessionToken,
        }),
        csrfTokenDigest: digestAdminContentToken({
          tokenPepper,
          purpose: "admin-csrf",
          token: csrfToken,
        }),
      }),
    );
    expect(h.write).toHaveBeenCalledWith({
      schemaVersion: 1,
      command: create(),
      actorId: principal.actorId,
      requestId: id(60),
    });
    expect(h.begin.mock.calls[0]![0]).toMatchObject({
      idempotencyOperation: "content.authoring.create",
      expiresAt: "2026-09-07T10:00:00.818Z",
    });
    expect(h.complete.mock.calls[0]![0].safeResultReference).toBe(
      `result-ref:v1:${id(70)}`,
    );
    expect(
      JSON.stringify([
        h.authorize.mock.calls,
        h.begin.mock.calls,
        h.complete.mock.calls,
        h.write.mock.calls,
      ]),
    ).not.toContain(sessionToken);
  });
  test("READ verifies full canonical snapshot then requires every actual locale", async () => {
    const h = harness();
    const result = await h.useCases.execute(request(read(h.state.snapshot)));
    expect(result).toMatchObject({
      outcome: "SUCCESS",
      kind: "REVISION",
      snapshot: h.state.snapshot,
    });
    expect(h.events).toEqual([
      "transaction",
      "authorize",
      "read",
      "authorize",
      "commit",
    ]);
    expect(h.authorize.mock.calls[1]![0]).toMatchObject({
      permission: "content.read",
      locales: [...SUPPORTED_LOCALES],
    });
  });
  test("single-locale writers can COPY exactly that translation and get only a revision reference", async () => {
    const h = harness();
    h.state.grants = ["ja"];
    const result = await h.useCases.execute(
      request(copy(h.state.snapshot, textChanges(h.state.snapshot, "ja"))),
    );
    expect(result).toMatchObject({ outcome: "SUCCESS", kind: "MUTATION" });
    expect(result).not.toHaveProperty("snapshot");
    expect(h.authorize.mock.calls[1]![0].locales).toEqual(["ja"]);
    expect(h.begin.mock.calls[0]![0].idempotencyOperation).toBe(
      "content.authoring.copy",
    );
  });
  test("verbatim unapproved copies still allow one-locale edits without claiming a new human translation", async () => {
    const h = harness(snapshot(false));
    h.state.grants = ["ja"];
    expect(
      await h.useCases.execute(
        request(copy(h.state.snapshot, textChanges(h.state.snapshot, "ja"))),
      ),
    ).toMatchObject({ outcome: "SUCCESS" });
    const plan = prepareContentAuthoring(
      h.write.mock.calls[0]![0].command,
      h.state.snapshot,
      { actorId: principal.actorId, createdAt: now },
    );
    expect(
      plan.translationAudits.every(
        (row) =>
          row.editorId === principal.actorId && row.review.status === "DRAFT",
      ),
    ).toBe(true);
    expect(
      plan.content.translations.find((row) => row.locale === "en"),
    ).toEqual(
      h.state.snapshot.content.translations.find((row) => row.locale === "en"),
    );
  });
  test.each(["en", "structure", "media"])(
    "COPY %s changes require all affected base languages",
    async (change) => {
      const h = harness();
      h.state.grants = ["ja"];
      const changes: ContentAuthoringChanges =
        change === "en"
          ? textChanges(h.state.snapshot, "en")
          : change === "structure"
            ? {
                kind: "IDOL",
                structure: {
                  themeAccent: "#112233",
                  heroTextTone: "light",
                  displayOrder: 0,
                },
              }
            : {
                kind: "IDOL",
                media: [
                  {
                    role: "PORTRAIT",
                    mediaAssetId: id(80) as never,
                    mediaMetadataRevisionId: id(81) as never,
                    sortOrder: 0,
                  },
                ],
              };
      expect(
        await h.useCases.execute(request(copy(h.state.snapshot, changes))),
      ).toEqual(fail("FORBIDDEN"));
      expect(h.begin).not.toHaveBeenCalled();
    },
  );
  test("copied global aliases require all languages because their new author and review are independent", async () => {
    const value = snapshot();
    if (value.content.kind !== "IDOL") throw new Error("fixture");
    const extension = prepareIdolAliasDraft(
      {
        schemaVersion: 1,
        id: id(90),
        idolRevisionId: value.revisionId,
        actorId: id(4),
        requestId: id(91),
        reasonCode: "CONTENT_CREATED",
        aliases: [{ id: "name", locale: null, text: "Name" }],
      },
      now,
    );
    if (extension.outcome !== "SUCCESS") throw new Error("fixture");
    value.content.aliases = extension.aliasSet.aliases;
    value.extensions.aliases = extension.aliasSet;
    refresh(value);
    const h = harness(value);
    h.state.grants = ["ja"];
    expect(
      await h.useCases.execute(request(copy(value, textChanges(value, "ja")))),
    ).toEqual(fail("FORBIDDEN"));
    expect(h.begin).not.toHaveBeenCalled();
  });
  test("READ full snapshot never leaks unassigned languages", async () => {
    const h = harness();
    h.state.grants = ["ja"];
    expect(await h.useCases.execute(request(read(h.state.snapshot)))).toEqual(
      fail("FORBIDDEN"),
    );
  });
  test.each(["READ", "COPY"] as const)(
    "%s includes detail languages absent from the base fields",
    async (action) => {
      const value = giftWithDetails();
      const h = harness(value);
      h.state.grants = ["en"];
      const command =
        action === "READ" ? read(value) : copy(value, { kind: "GIFT" });
      expect(await h.useCases.execute(request(command))).toEqual(
        fail("FORBIDDEN"),
      );
      expect(h.authorize.mock.calls[1]![0].locales).toEqual(["en", "th"]);
      expect(h.begin).not.toHaveBeenCalled();
    },
  );
  test("replacing old details still requires the language being removed", async () => {
    const value = giftWithDetails();
    if (value.content.kind !== "GIFT") throw new Error("fixture");
    const h = harness(value);
    h.state.grants = ["en"];
    const command = copy(value, {
      kind: "GIFT",
      details: {
        blocks: value.content.details!.blocks,
        translations: value.content.details!.translations.filter(
          (row) => row.locale === "en",
        ),
      },
    });
    expect(await h.useCases.execute(request(command))).toEqual(
      fail("FORBIDDEN"),
    );
    expect(h.begin).not.toHaveBeenCalled();
  });
  test.each(["UNAUTHENTICATED", "FORBIDDEN", "CSRF_INVALID"] as const)(
    "%s authorization fails before reads and replay",
    async (code) => {
      const h = harness();
      h.authorize.mockResolvedValue(fail(code));
      expect(await h.useCases.execute(request(copy(h.state.snapshot)))).toEqual(
        fail(code),
      );
      expect(h.load).not.toHaveBeenCalled();
      expect(h.begin).not.toHaveBeenCalled();
      expect(h.write).not.toHaveBeenCalled();
    },
  );
  test("replays exclude transport requestId and still reauthorize current locales", async () => {
    const h = harness();
    const command = copy(h.state.snapshot, textChanges(h.state.snapshot, "ja"));
    expect(await h.useCases.execute(request(command))).toMatchObject({
      replayed: false,
    });
    expect(await h.useCases.execute(request(command, id(61)))).toMatchObject({
      replayed: true,
      resultId: id(70),
    });
    expect(h.write).toHaveBeenCalledTimes(1);
    h.state.grants = [];
    expect(await h.useCases.execute(request(command, id(62)))).toEqual(
      fail("FORBIDDEN"),
    );
    expect(h.begin).toHaveBeenCalledTimes(2);
  });
  test("a committed copy replays after the source review advances and its snapshot hash changes", async () => {
    const h = harness(snapshot(false));
    const command = copy(h.state.snapshot, textChanges(h.state.snapshot, "ja"));
    expect(await h.useCases.execute(request(command))).toMatchObject({
      replayed: false,
    });
    const audit = h.state.snapshot.translationAudits[0]!;
    audit.review = { status: "IN_REVIEW", submittedAt: now };
    audit.reviewId = id(99);
    audit.reviewSequence = 2;
    refresh(h.state.snapshot);
    expect(await h.useCases.execute(request(command, id(61)))).toMatchObject({
      replayed: true,
    });
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  test("new COPY with stale source hash rolls back its reservation before writes", async () => {
    const h = harness();
    const command = copy(h.state.snapshot);
    if (command.action !== "COPY") throw new Error("fixture");
    command.expectedSourceHash = "f".repeat(
      64,
    ) as typeof command.expectedSourceHash;
    expect(await h.useCases.execute(request(command))).toEqual(
      fail("STALE_CONTENT"),
    );
    expect(h.begin).toHaveBeenCalledOnce();
    expect(h.write).not.toHaveBeenCalled();
    expect(h.events.at(-1)).toBe("rollback");
  });
  test("stale owner version rolls back without a persisted idempotency record", async () => {
    const h = harness();
    h.write.mockResolvedValue(fail("STALE_VERSION"));
    expect(await h.useCases.execute(request(create()))).toEqual(
      fail("STALE_VERSION"),
    );
    expect(h.events.at(-1)).toBe("rollback");
    expect(h.complete).not.toHaveBeenCalled();
  });
  test.each(["target", "revision", "hash", "fields"])(
    "rejects canonical %s tampering before exposing content",
    async (field) => {
      const h = harness();
      const command = read(h.state.snapshot);
      if (field === "target")
        h.state.snapshot.target = { kind: "IDOL", idolId: id(98) as never };
      if (field === "revision") h.state.snapshot.revisionId = id(98);
      if (field === "hash")
        h.state.snapshot.contentHash = "f".repeat(64) as never;
      if (field === "fields" && h.state.snapshot.content.kind === "IDOL")
        h.state.snapshot.content.translations[0]!.fields.shortBio =
          "Tampered text";
      expect(await h.useCases.execute(request(command))).toEqual(
        fail("CONTENT_UNAVAILABLE"),
      );
      expect(h.begin).not.toHaveBeenCalled();
    },
  );
  test("database wall-clock rollback between authorizations remains valid", async () => {
    const h = harness();
    h.authorize
      .mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "SUCCESS",
        principal,
      })
      .mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "SUCCESS",
        principal: { ...principal, authorizedAt: "2026-09-06T10:00:00.656Z" },
      });
    expect(
      await h.useCases.execute(request(read(h.state.snapshot))),
    ).toMatchObject({ outcome: "SUCCESS" });
  });
  test.each(["actorId", "sessionId", "expiresAt"])(
    "a changed canonical %s fails closed",
    async (field) => {
      const h = harness();
      h.authorize
        .mockResolvedValueOnce({
          schemaVersion: 1,
          outcome: "SUCCESS",
          principal,
        })
        .mockResolvedValueOnce({
          schemaVersion: 1,
          outcome: "SUCCESS",
          principal: {
            ...principal,
            [field]:
              field === "expiresAt" ? "2026-09-06T12:00:00.000Z" : id(98),
          },
        });
      expect(await h.useCases.execute(request(read(h.state.snapshot)))).toEqual(
        fail("CONTENT_UNAVAILABLE"),
      );
    },
  );
  test("expired canonical session is rejected even if the repository claims success", async () => {
    const h = harness();
    h.authorize.mockResolvedValue({
      schemaVersion: 1,
      outcome: "SUCCESS",
      principal: { ...principal, authorizedAt: principal.expiresAt },
    });
    expect(await h.useCases.execute(request(create()))).toEqual(
      fail("UNAUTHENTICATED"),
    );
  });
  test.each([undefined, "", "x".repeat(64)])(
    "invalid server pepper fails safely at composition",
    (pepper) => {
      expect(() =>
        createContentAuthoringUseCases({
          transactions: harness().transactions,
          tokenPepper: pepper as string,
        }),
      ).toThrow("invalid admin token configuration");
    },
  );
  test("malformed tokens and unknown actor fields are rejected before a transaction", async () => {
    const h = harness();
    for (const extra of [
      { sessionToken: "invalid" },
      { csrfToken: "invalid" },
      { actorId: id(1) },
    ])
      expect(
        await h.useCases.execute({ ...request(create()), ...extra }),
      ).toEqual(fail("INVALID_COMMAND"));
    expect(h.events).toEqual([]);
  });
  test("unavailable persistence and failed completion never reveal private payload or leave committed work", async () => {
    const h = harness();
    h.complete.mockRejectedValue(new Error(`private ${sessionToken}`));
    expect(await h.useCases.execute(request(create()))).toEqual(
      fail("CONTENT_UNAVAILABLE"),
    );
    expect(h.events.at(-1)).toBe("rollback");
  });
  test.each(["begin", "complete"] as const)(
    "%s maps returned PostgreSQL concurrency failures to conflicts and rolls back",
    async (stage) => {
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
        if (stage === "begin")
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
        expect(await h.useCases.execute(request(create()))).toEqual(
          fail("CONFLICT"),
        );
        expect(h.events.at(-1)).toBe("rollback");
        if (stage === "begin") expect(h.write).not.toHaveBeenCalled();
        expect(h.state.reservation).toBeUndefined();
      }
    },
  );
  test("idempotency payload conflicts never write a second revision", async () => {
    const h = harness();
    await h.useCases.execute(request(create()));
    const command = create();
    command.reasonCode = "CHANGED_REASON";
    expect(await h.useCases.execute(request(command))).toEqual(
      fail("IDEMPOTENCY_CONFLICT"),
    );
    expect(h.write).toHaveBeenCalledOnce();
  });
  test("idempotency distinguishes raw Unicode changes that alter approval inheritance", async () => {
    const value = snapshot();
    if (value.content.kind !== "IDOL") throw new Error("fixture");
    const japanese = value.content.translations.find(
      (row) => row.locale === "ja",
    )!;
    japanese.fields.shortBio = "Cafe\u0301";
    const audit = value.translationAudits.find((row) => row.locale === "ja")!;
    audit.sourceHash = computeIdolTranslationContentHash(
      japanese.fields,
    ) as typeof audit.sourceHash;
    if (audit.review.status !== "APPROVED") throw new Error("fixture");
    audit.review.reviewedContentHash = audit.sourceHash;
    refresh(value);
    const h = harness(value);
    const first = copy(value, { kind: "IDOL", translations: [japanese] });
    const second = copy(value, {
      kind: "IDOL",
      translations: [
        { ...japanese, fields: { ...japanese.fields, shortBio: "Café" } },
      ],
    });
    expect(await h.useCases.execute(request(first))).toMatchObject({
      outcome: "SUCCESS",
      replayed: false,
    });
    expect(await h.useCases.execute(request(second, id(61)))).toEqual(
      fail("IDEMPOTENCY_CONFLICT"),
    );
    expect(h.write).toHaveBeenCalledOnce();
  });
  test("invalid new ICU content is rejected without entering persistence mutation", async () => {
    const h = harness();
    const command = create();
    if (command.content.kind !== "IDOL") throw new Error("fixture");
    command.content.translations[0]!.fields.shortBio = "Hello {name}";
    expect(await h.useCases.execute(request(command))).toEqual(
      fail("INVALID_COMMAND"),
    );
    expect(h.write).not.toHaveBeenCalled();
  });
});

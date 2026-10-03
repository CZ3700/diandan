import { describe, expect, test, vi } from "vitest";
import { slugSchema } from "@fan-support/contracts";
import { createManagementCenterOperationRepository } from "./management-center-operation-repository.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";
const id = "00000000-0000-4000-8000-000000000001";
const intent = {
  kind: "SAVE_ARTIST",
  sourceLocale: "th",
  id: null,
  expectedVersion: 0,
  name: "Artist",
  description: "Description",
  image: { uploadId: id },
};
const row = {
  id,
  actor_id: id,
  session_id: id,
  request_id: id,
  intent,
  intent_hash: Buffer.from("a".repeat(64), "hex"),
  status: "QUEUED",
  version: "1",
  target_id: id,
  result: null,
  updated_at: "2026-09-08T00:00:00Z",
  authorized_until: "2026-09-08T01:00:00Z",
  checkpoint: {
    retryRequested: false,
    sourceAssetId: null,
    jobs: [],
    preparedMedia: null,
  },
  lease_token_digest: null,
  lease_expires_at: null,
};
/**
 * Replies are consumed in query order, except the two ADR-022 lookups, which are answered by
 * what the account holds and who the artist belongs to.
 */
function fixture(
  replies: unknown[][],
  access: { grants?: string[]; broker?: string | null } = {},
) {
  const queries: string[] = [];
  const grants = access.grants ?? ["management.direct"];
  const query = vi.fn(async (sql: string) => {
    queries.push(sql);
    if (sql.includes("p.permission_key=ANY($2::text[])"))
      return { rows: grants.map((key) => ({ permission_key: key })) };
    if (sql.includes("public.idol_current_broker($1)"))
      return { rows: [{ broker_id: access.broker ?? null }] };
    return {
      rows: /^(SAVEPOINT|RELEASE|ROLLBACK)/u.test(sql)
        ? []
        : (replies.shift() ?? []),
    };
  });
  const client = { query, release: vi.fn() } as TransactionClient;
  const scope: TransactionScopeControl = {
    trackOperation: (work) => work(),
    markRollbackOnly: vi.fn(),
  };
  return {
    repository: createManagementCenterOperationRepository(
      client,
      scope,
      "https://media.example.test",
    ),
    queries,
    query,
  };
}
test("a gift with a real inventory item rejects a policy change before queueing or publication", async () => {
  const f = fixture([
    [],
    [{ id, version: "2", status: "active" }],
    [{ inventory_item_id: id, inventory_policy: "TRACKED" }],
  ]);
  const result = await f.repository.submit({
    principal: {
      schemaVersion: 1,
      actorId: id,
      sessionId: id,
      authorizedAt: "2026-09-08T00:00:00Z",
      expiresAt: "2026-09-08T01:00:00Z",
    },
    requestId: id,
    intent: {
      kind: "SAVE_GIFT",
      sourceLocale: "th",
      id,
      expectedVersion: 2,
      name: "Gift",
      description: "Description",
      image: null,
      giftKind: "VIRTUAL",
      category: "OTHER",
      price: { market: "TEST", currency: "USD", amountMinor: 1000 },
      inventory: { policy: "PROCURE_ON_DEMAND" },
      eligibility: { rule: "ALL_ACTIVE_ARTISTS" },
    } as never,
    intentHash: "a".repeat(64),
    idempotencyKey: "management-policy-test",
  });
  expect(result).toMatchObject({
    outcome: "FAILURE",
    code: "INVENTORY_POLICY_LOCKED",
  });
  expect(f.queries.some((sql) => sql.startsWith("INSERT"))).toBe(false);
});
test("zero tracked stock still requires a real active location before queueing", async () => {
  const f = fixture([[], []]);
  const result = await f.repository.submit({
    principal: {
      schemaVersion: 1,
      actorId: id,
      sessionId: id,
      authorizedAt: "2026-09-08T00:00:00Z",
      expiresAt: "2026-09-08T01:00:00Z",
    },
    requestId: id,
    intent: {
      kind: "SAVE_GIFT",
      sourceLocale: "th",
      id: null,
      expectedVersion: 0,
      name: "Gift",
      description: "Description",
      image: { uploadId: id },
      giftKind: "VIRTUAL",
      category: "OTHER",
      price: { market: "TEST", currency: "USD", amountMinor: 1000 },
      inventory: { policy: "TRACKED", locationId: id, quantity: 0 },
      eligibility: { rule: "ALL_ACTIVE_ARTISTS" },
    } as never,
    intentHash: "a".repeat(64),
    idempotencyKey: "management-zero-stock",
  });
  expect(result).toMatchObject({ outcome: "FAILURE", code: "NOT_FOUND" });
  expect(
    f.queries.some((sql) =>
      sql.includes(
        "FROM public.inventory_locations WHERE id=$1 AND status='ACTIVE' FOR SHARE",
      ),
    ),
  ).toBe(true);
  expect(f.queries.some((sql) => sql.startsWith("INSERT"))).toBe(false);
});
test("idempotent replay keeps a permanent receipt and does not insert another target", async () => {
  const f = fixture([[row]]);
  const result = await f.repository.submit({
    principal: {
      schemaVersion: 1,
      actorId: id,
      sessionId: id,
      authorizedAt: "2026-09-08T00:00:00Z",
      expiresAt: "2026-09-08T01:00:00Z",
    },
    requestId: id,
    intent: intent as never,
    intentHash: "a".repeat(64),
    idempotencyKey: "management-submit-01",
  });
  expect(result).toMatchObject({
    outcome: "SUCCESS",
    kind: "OPERATION",
    operation: { operationId: id },
  });
  expect(
    f.queries.some((sql) => /INSERT INTO public\.(idols|gifts)/u.test(sql)),
  ).toBe(false);
});
test("same idempotency key with different intent is rejected", async () => {
  const f = fixture([[row]]);
  const result = await f.repository.submit({
    principal: {
      schemaVersion: 1,
      actorId: id,
      sessionId: id,
      authorizedAt: "2026-09-08T00:00:00Z",
      expiresAt: "2026-09-08T01:00:00Z",
    },
    requestId: id,
    intent: intent as never,
    intentHash: "b".repeat(64),
    idempotencyKey: "management-submit-01",
  });
  expect(result).toMatchObject({
    outcome: "FAILURE",
    code: "IDEMPOTENCY_CONFLICT",
  });
});
test("a stale fence cannot publish or alter another claim", async () => {
  const f = fixture([[]]);
  expect(
    await f.repository.complete({
      operationId: id,
      leaseTokenDigest: "a".repeat(64),
      result: {
        targetId: id,
        handle: slugSchema.parse("artist"),
        revisionId: id,
        publicationId: id,
        version: 1,
      },
    }),
  ).toMatchObject({ outcome: "FAILURE" });
  expect(
    f.queries.some((sql) =>
      sql.includes("UPDATE public.management_operations"),
    ),
  ).toBe(false);
});
test("claim uses locked bounded queue selection and rechecks live session", async () => {
  const f = fixture([[row], []]);
  expect(
    await f.repository.claim({
      leaseTokenDigest: "a".repeat(64),
      leaseSeconds: 60,
    }),
  ).toMatchObject({ outcome: "FAILURE", code: "NEEDS_AUTHORIZATION" });
  expect(
    f.queries.some(
      (sql) => sql.includes("SKIP LOCKED") && sql.includes("LIMIT 1"),
    ),
  ).toBe(true);
  expect(
    f.queries.some(
      (sql) =>
        sql.includes("s.revoked_at IS NULL") &&
        sql.includes("s.authenticated_with_mfa") &&
        sql.includes("s.expires_at>clock_timestamp()"),
    ),
  ).toBe(true);
});
test("an explicit authorized retry records one media retry request", async () => {
  const f = fixture([
    [
      {
        ...row,
        status: "FAILED",
        failure_code: "MEDIA_FAILED",
        failure_retryable: true,
      },
    ],
    [{ id }],
    [{ locale: "th" }],
    [],
    [row],
  ]);
  await f.repository.retry({
    principal: {
      schemaVersion: 1,
      actorId: id,
      sessionId: id,
      authorizedAt: "2026-09-08T00:00:00Z",
      expiresAt: "2026-09-08T01:00:00Z",
    },
    requestId: id,
    operationId: id,
    expectedVersion: 1,
    idempotencyKey: "management-retry-01",
  });
  expect(
    f.queries.some(
      (sql) =>
        sql.includes(
          "jsonb_set(checkpoint,'{retryRequested}','true'::jsonb)",
        ) && sql.includes("retry_key=$5"),
    ),
  ).toBe(true);
});

describe("archiving an old poster (L2-09)", () => {
  const current = "00000000-0000-4000-8000-00000000000a";
  const old = "00000000-0000-4000-8000-00000000000b";
  const archive = (
    f: ReturnType<typeof fixture>,
    revisionId = old,
    expectedVersion = 4,
  ) =>
    f.repository.archivePoster({
      principal: {
        schemaVersion: 1,
        actorId: id,
        sessionId: id,
        authorizedAt: "2026-09-08T00:00:00Z",
        expiresAt: "2026-09-08T01:00:00Z",
      },
      requestId: id,
      revisionId,
      expectedVersion,
    });
  const head = [{ homepage_revision_id: current, version: "4" }];
  const writes = (f: ReturnType<typeof fixture>) =>
    f.queries.filter((sql) => /^(UPDATE|INSERT)/u.test(sql.trim()));
  test("the homepage poster and a stale head are refused without any write", async () => {
    for (const [revisionId, version] of [
      [current, 4],
      [old, 3],
    ] as const) {
      const f = fixture([[], head]);
      expect(await archive(f, revisionId, version)).toMatchObject({
        outcome: "FAILURE",
        code: "TARGET_CONFLICT",
      });
      expect(writes(f)).toEqual([]);
      const lock = f.queries.findIndex((sql) =>
        sql.includes("fan-support:homepage"),
      );
      const read = f.queries.findIndex((sql) =>
        sql.includes("homepage_publication_heads"),
      );
      expect(lock).toBeGreaterThanOrEqual(0);
      expect(lock).toBeLessThan(read);
    }
  });
  test("a queued restore of the same poster wins; an archived poster is already done", async () => {
    const queued = fixture([
      [],
      head,
      [{ lifecycle: "SUPERSEDED" }],
      [{ "?column?": 1 }],
    ]);
    expect(await archive(queued)).toMatchObject({ code: "TARGET_CONFLICT" });
    expect(writes(queued)).toEqual([]);
    const repeated = fixture([[], head, [{ lifecycle: "ARCHIVED" }]]);
    expect(await archive(repeated)).toEqual({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "POSTER_ARCHIVED",
      revisionId: old,
    });
    expect(writes(repeated)).toEqual([]);
  });
  test("a superseded poster is archived with an audit in the same transaction", async () => {
    const f = fixture([
      [],
      head,
      [{ lifecycle: "SUPERSEDED" }],
      [],
      [{ audit_id: id, now: "2026-09-29T00:00:00.000000Z" }],
      [],
      [],
    ]);
    expect(await archive(f)).toMatchObject({
      outcome: "SUCCESS",
      kind: "POSTER_ARCHIVED",
    });
    const [update, audit] = writes(f);
    expect(update).toContain("lifecycle='ARCHIVED'");
    expect(update).toContain("lifecycle='SUPERSEDED'");
    expect(audit).toContain("INSERT INTO public.audit_logs");
    const auditCall = f.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO public.audit_logs"),
    );
    expect((auditCall as unknown[] | undefined)?.[1]).toEqual(
      expect.arrayContaining([
        "HOMEPAGE_POSTER_ARCHIVE",
        "HOMEPAGE_REVISION",
        old,
        "DAILY_CENTER_DELETE",
      ]),
    );
  });
});

// ADR-022 / L3-11: a broker manages only the artists assigned to it.
describe("a broker in the daily center", () => {
  const broker = "00000000-0000-4000-8000-0000000000b1";
  const other = "00000000-0000-4000-8000-0000000000b2";
  const principal = {
    schemaVersion: 1 as const,
    actorId: broker,
    sessionId: id,
    authorizedAt: "2026-09-08T00:00:00Z",
    expiresAt: "2026-09-08T01:00:00Z",
  };
  const assignedOnly = { grants: ["management.assigned"] };
  const forbidden = { outcome: "FAILURE", code: "FORBIDDEN" };
  const list = (section: "ARTISTS" | "GIFTS" | "POSTERS") =>
    ({
      schemaVersion: 1,
      action: "LIST",
      section,
      page: 1,
      pageSize: 12,
    }) as const;
  const submit = (f: ReturnType<typeof fixture>, value: unknown) =>
    f.repository.submit({
      principal,
      requestId: id,
      intent: value as never,
      intentHash: "a".repeat(64),
      idempotencyKey: "management-broker-01",
    });
  const untouched = (f: ReturnType<typeof fixture>) =>
    f.queries.every(
      (sql) =>
        sql.includes("p.permission_key=ANY($2::text[])") ||
        sql.includes("public.idol_current_broker($1)") ||
        /^(SAVEPOINT|RELEASE|ROLLBACK)/u.test(sql),
    );
  test("has no gifts, posters or assignment filter", async () => {
    for (const command of [
      list("GIFTS"),
      list("POSTERS"),
      { ...list("ARTISTS"), assignment: { kind: "UNASSIGNED" } as const },
    ]) {
      const f = fixture([], assignedOnly);
      expect(await f.repository.list({ principal, command })).toMatchObject(
        forbidden,
      );
      expect(untouched(f)).toBe(true);
    }
    const poster = fixture([], assignedOnly);
    expect(
      await poster.repository.archivePoster({
        principal,
        requestId: id,
        revisionId: id,
        expectedVersion: 1,
      }),
    ).toMatchObject(forbidden);
    expect(untouched(poster)).toBe(true);
  });
  test("lists only its own artists", async () => {
    const f = fixture([[{ total: "0" }], []], assignedOnly);
    expect(
      await f.repository.list({ principal, command: list("ARTISTS") }),
    ).toMatchObject({ kind: "LIST", totalItems: 0 });
    const count = f.query.mock.calls.find(([sql]) =>
      String(sql).includes("count(*)"),
    );
    expect(String(count?.[0])).toContain("public.idol_current_broker(o.id)=$1");
    expect((count as unknown[] | undefined)?.[1]).toEqual([broker]);
  });
  test("cannot save a gift, a poster, or an artist that is not its own", async () => {
    const gift = fixture([], assignedOnly);
    expect(
      await submit(gift, {
        ...intent,
        kind: "SAVE_GIFT",
        giftKind: "VIRTUAL",
        category: "OTHER",
        price: { market: "TEST", currency: "USD", amountMinor: 1000 },
        inventory: { policy: "PROCURE_ON_DEMAND" },
        eligibility: { rule: "ALL_ACTIVE_ARTISTS" },
      }),
    ).toMatchObject(forbidden);
    const poster = fixture([], assignedOnly);
    expect(
      await submit(poster, {
        kind: "RESTORE_POSTER",
        sourceLocale: "th",
        expectedVersion: 1,
        sourceRevisionId: id,
      }),
    ).toMatchObject(forbidden);
    const edit = { ...intent, id, expectedVersion: 2, image: null };
    for (const owner of [other, null]) {
      const f = fixture([], { ...assignedOnly, broker: owner });
      expect(await submit(f, edit)).toMatchObject(forbidden);
      expect(untouched(f)).toBe(true);
    }
    expect(untouched(gift) && untouched(poster)).toBe(true);
  });
  test("saves a new artist and edits its own", async () => {
    const created = fixture([[], [{ id }], [], [row]], assignedOnly);
    expect(await submit(created, intent)).toMatchObject({ outcome: "SUCCESS" });
    const own = fixture(
      [[], [{ id, version: "2", status: "active" }], [], [row]],
      { ...assignedOnly, broker },
    );
    expect(
      await submit(own, { ...intent, id, expectedVersion: 2, image: null }),
    ).toMatchObject({ outcome: "SUCCESS" });
  });
  test("reads the original image of its own artists only", async () => {
    const target = { kind: "ARTIST", id, expectedVersion: 2 } as const;
    for (const owner of [other, null]) {
      const f = fixture([], { ...assignedOnly, broker: owner });
      expect(
        await f.repository.readImageSource({ principal, target }),
      ).toMatchObject(forbidden);
      expect(untouched(f)).toBe(true);
    }
    const gift = fixture([], { ...assignedOnly, broker });
    expect(
      await gift.repository.readImageSource({
        principal,
        target: { ...target, kind: "GIFT" },
      }),
    ).toMatchObject(forbidden);
    const own = fixture([[]], { ...assignedOnly, broker });
    expect(
      await own.repository.readImageSource({ principal, target }),
    ).toMatchObject({ code: "TARGET_CONFLICT" });
  });
  test("loses queued work for an artist that was reassigned away", async () => {
    const queued = {
      ...row,
      actor_id: broker,
      intent: { ...intent, id, expectedVersion: 2, image: null },
    };
    const f = fixture([[queued], [{ id }], []], {
      ...assignedOnly,
      broker: other,
    });
    expect(
      await f.repository.claim({
        leaseTokenDigest: "a".repeat(64),
        leaseSeconds: 60,
      }),
    ).toMatchObject({ outcome: "FAILURE", code: "NEEDS_AUTHORIZATION" });
    expect(
      f.queries.some((sql) =>
        sql.includes("failure_code='NEEDS_AUTHORIZATION'"),
      ),
    ).toBe(true);
    expect(f.queries.some((sql) => sql.includes("SET status='RUNNING'"))).toBe(
      false,
    );
  });
});

describe("assigning an artist (L3-11)", () => {
  const broker = "00000000-0000-4000-8000-0000000000b1";
  const other = "00000000-0000-4000-8000-0000000000b2";
  const view = (brokerId: string, active = true) => [
    { broker_id: brokerId, display_name: "Mina Park", active },
  ];
  const artist = [{ id, status: "active" }];
  const assign = (
    f: ReturnType<typeof fixture>,
    brokerId: string | null,
    expectedBrokerId: string | null,
  ) =>
    f.repository.assignArtist({
      principal: {
        schemaVersion: 1,
        actorId: id,
        sessionId: id,
        authorizedAt: "2026-09-08T00:00:00Z",
        expiresAt: "2026-09-08T01:00:00Z",
      },
      requestId: id,
      artistId: id,
      brokerId,
      expectedBrokerId,
    });
  const owner = { grants: ["management.direct", "idols.assign"] };
  const writes = (f: ReturnType<typeof fixture>) =>
    f.queries.filter((sql) => /^(UPDATE|INSERT)/u.test(sql.trim()));
  test("needs idols.assign: daily operations and brokers are refused before any read", async () => {
    for (const grants of [["management.direct"], ["management.assigned"]]) {
      const f = fixture([], { grants });
      expect(await assign(f, broker, null)).toMatchObject({
        outcome: "FAILURE",
        code: "FORBIDDEN",
      });
      expect(f.queries.some((sql) => sql.includes("public.idols"))).toBe(false);
    }
  });
  test("a missing or deleted artist is not found", async () => {
    for (const found of [[], [{ id, status: "archived" }]]) {
      const f = fixture([found], owner);
      expect(await assign(f, broker, null)).toMatchObject({
        code: "NOT_FOUND",
      });
      expect(writes(f)).toEqual([]);
    }
  });
  test("writes one audited row under the artist lock and reports the broker", async () => {
    const f = fixture(
      [
        artist,
        [],
        [],
        view(broker),
        [{ now: "2026-09-30T00:00:00.000000Z" }],
        [],
        [],
        view(broker),
      ],
      owner,
    );
    expect(await assign(f, broker, null)).toEqual({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "ARTIST_ASSIGNED",
      artistId: id,
      assignment: { brokerId: broker, displayName: "Mina Park", active: true },
    });
    const [audit, assignment] = writes(f);
    expect(audit).toContain("INSERT INTO public.audit_logs");
    expect(assignment).toContain("INSERT INTO public.idol_assignments");
    const lock = f.queries.findIndex((sql) =>
      sql.includes("fan-support:idol-assignment:"),
    );
    const read = f.queries.findIndex((sql) =>
      sql.includes("FROM public.idol_assignments WHERE idol_id=$1"),
    );
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(read);
    const row = f.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO public.idol_assignments"),
    ) as unknown[] | undefined;
    // sequence 1, broker, no previous broker, ASSIGNED, no operation.
    expect((row?.[1] as unknown[]).slice(1, 7)).toEqual([
      id,
      1,
      broker,
      null,
      "ASSIGNED",
      null,
    ]);
  });
  test("reassigns from the broker the editor saw, and back to unassigned", async () => {
    const latest = [
      {
        sequence: "3",
        broker_identity_id: broker,
        created_at: "2026-09-29T00:00:00.000000Z",
      },
    ];
    const moved = fixture(
      [
        artist,
        [],
        latest,
        view(other),
        [{ now: "2026-09-30T00:00:00.000000Z" }],
        [],
        [],
        view(other),
      ],
      owner,
    );
    expect(await assign(moved, other, broker)).toMatchObject({
      assignment: { brokerId: other },
    });
    const row = moved.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO public.idol_assignments"),
    ) as unknown[] | undefined;
    expect((row?.[1] as unknown[]).slice(2, 5)).toEqual([4, other, broker]);
    const cleared = fixture(
      [artist, [], latest, [{ now: "2026-09-30T00:00:00.000000Z" }], [], []],
      owner,
    );
    expect(await assign(cleared, null, broker)).toMatchObject({
      kind: "ARTIST_ASSIGNED",
      assignment: null,
    });
    expect(writes(cleared)).toHaveLength(2);
  });
  test("a stale editor, an inactive broker and a repeat change nothing", async () => {
    const latest = [
      {
        sequence: "1",
        broker_identity_id: broker,
        created_at: "2026-09-29T00:00:00.000000Z",
      },
    ];
    const stale = fixture([artist, [], latest], owner);
    expect(await assign(stale, other, null)).toMatchObject({
      code: "TARGET_CONFLICT",
    });
    const inactive = fixture([artist, [], [], view(broker, false)], owner);
    expect(await assign(inactive, broker, null)).toMatchObject({
      code: "NOT_FOUND",
    });
    const unknown = fixture([artist, [], [], []], owner);
    expect(await assign(unknown, broker, null)).toMatchObject({
      code: "NOT_FOUND",
    });
    const repeated = fixture([artist, [], latest, view(broker)], owner);
    expect(await assign(repeated, broker, null)).toMatchObject({
      kind: "ARTIST_ASSIGNED",
      assignment: { brokerId: broker },
    });
    for (const f of [stale, inactive, unknown, repeated])
      expect(writes(f)).toEqual([]);
  });
});

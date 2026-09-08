import { expect, test, vi } from "vitest";
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
function fixture(replies: unknown[][]) {
  const queries: string[] = [];
  const query = vi.fn(async (sql: string) => {
    queries.push(sql);
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
    [{ role_id: id }],
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

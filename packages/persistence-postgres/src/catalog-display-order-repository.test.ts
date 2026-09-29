import { describe, expect, test, vi } from "vitest";
import { catalogDisplayOrderCommandSchema } from "@fan-support/contracts";
import {
  createCatalogDisplayOrderRepository,
  displayOrderItemsSql,
} from "./catalog-display-order-repository.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

const actor = "00000000-0000-4000-8000-000000000001";
const first = "00000000-0000-4000-8000-00000000000a";
const second = "00000000-0000-4000-8000-00000000000b";
const principal = {
  schemaVersion: 1 as const,
  actorId: actor,
  sessionId: actor,
  authorizedAt: "2026-09-29T00:00:00Z",
  expiresAt: "2026-09-29T01:00:00Z",
};
const hash = "c".repeat(64);
function fixture(replies: unknown[][]) {
  const queries: { sql: string; values: unknown[] | undefined }[] = [];
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    queries.push({ sql, values });
    return { rows: replies.shift() ?? [] };
  });
  const client = { query, release: vi.fn() } as unknown as TransactionClient;
  const scope = {
    trackOperation: <T>(work: () => Promise<T>) => work(),
    markRollbackOnly: vi.fn(),
  } as TransactionScopeControl;
  return {
    queries,
    repository: createCatalogDisplayOrderRepository(
      client,
      scope,
      "https://media.example.test/",
    ),
  };
}
const items = [
  {
    id: second,
    status: "active",
    name: "Beta",
    media_asset_id: null,
    manual_position: 1,
  },
  {
    id: first,
    status: "paused",
    name: "Alpha",
    media_asset_id: null,
    manual_position: null,
  },
];
const save = (orderedIds: string[], expectedVersion = 2) => ({
  command: catalogDisplayOrderCommandSchema.parse({
    schemaVersion: 1,
    action: "SAVE",
    kind: "IDOL",
    expectedVersion,
    orderedIds,
    idempotencyKey: "display-order-save-01",
  }),
  principal,
  requestId: actor,
  requestHash: hash,
});
const writes = (f: ReturnType<typeof fixture>) =>
  f.queries.filter(({ sql }) => sql.trim().startsWith("INSERT"));

describe("storefront display order (L2-10)", () => {
  test("reading lists storefront-visible items in storefront order and marks manual ones", async () => {
    const f = fixture([[{ version: "2" }], items]);
    expect(
      await f.repository.execute({
        command: { schemaVersion: 1, action: "READ", kind: "IDOL" },
        principal,
        requestId: actor,
        requestHash: hash,
      }),
    ).toEqual({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "DISPLAY_ORDER",
      orderKind: "IDOL",
      version: 2,
      items: [
        {
          id: second,
          name: "Beta",
          image: null,
          status: "active",
          manual: true,
        },
        {
          id: first,
          name: "Alpha",
          image: null,
          status: "paused",
          manual: false,
        },
      ],
      replayed: false,
    });
    expect(writes(f)).toEqual([]);
  });
  test("the storefront order puts manual positions first, then the content default", () => {
    expect(displayOrderItemsSql("IDOL")).toContain(
      "ORDER BY manual_position NULLS LAST,r.display_order,o.id",
    );
    expect(displayOrderItemsSql("GIFT")).toContain(
      "ORDER BY manual_position NULLS LAST,p.published_at DESC NULLS LAST,o.id",
    );
    expect(displayOrderItemsSql("GIFT")).toContain(
      "WHERE o.status IN ('active','paused')",
    );
  });
  test("a stale version or an unknown item is refused without writing", async () => {
    const stale = fixture([[], [], [{ version: "3" }]]);
    expect(await stale.repository.execute(save([first]))).toMatchObject({
      outcome: "FAILURE",
      code: "STALE_VERSION",
    });
    expect(writes(stale)).toEqual([]);
    const unknown = fixture([[], [], [{ version: "2" }], [{ total: "1" }]]);
    expect(
      await unknown.repository.execute(save([first, second])),
    ).toMatchObject({ outcome: "FAILURE", code: "NOT_FOUND" });
    expect(writes(unknown)).toEqual([]);
  });
  test("a retried request replays the current order; another request with the same key conflicts", async () => {
    const replay = fixture([
      [],
      [{ kind: "IDOL", request_hash: hash }],
      [{ version: "3" }],
      items,
    ]);
    expect(await replay.repository.execute(save([first]))).toMatchObject({
      outcome: "SUCCESS",
      replayed: true,
      version: 3,
    });
    expect(writes(replay)).toEqual([]);
    const conflict = fixture([
      [],
      [{ kind: "IDOL", request_hash: "d".repeat(64) }],
    ]);
    expect(await conflict.repository.execute(save([first]))).toMatchObject({
      outcome: "FAILURE",
      code: "IDEMPOTENCY_CONFLICT",
    });
  });
  test("saving locks the kind, audits and appends the next version in one transaction", async () => {
    const f = fixture([
      [],
      [],
      [{ version: "2" }],
      [{ total: "2" }],
      [{ id: second, audit_id: first, now: "2026-09-29T00:00:00.000000Z" }],
      [],
      [],
      [{ version: "3" }],
      items,
    ]);
    expect(await f.repository.execute(save([second, first]))).toMatchObject({
      outcome: "SUCCESS",
      version: 3,
      replayed: false,
    });
    expect(f.queries[0]?.sql).toContain("fan-support:display-order:");
    const [audit, order] = writes(f);
    expect(audit?.sql).toContain("'CATALOG_DISPLAY_ORDER_SAVE'");
    expect(audit?.values).toEqual(
      expect.arrayContaining([actor, "IDOL_ORDER"]),
    );
    expect(order?.sql).toContain("INSERT INTO public.catalog_display_orders");
    expect(order?.values).toEqual(
      expect.arrayContaining(["IDOL", 3, [second, first]]),
    );
  });
});

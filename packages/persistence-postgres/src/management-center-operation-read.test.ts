import { expect, test, vi } from "vitest";
import {
  readManagementCenterContext,
  readManagementCenterList,
} from "./management-center-operation-read.js";
import type { TransactionClient } from "./transaction-runner.js";
const id = "00000000-0000-4000-8000-000000000001";
test("daily price editing stays in the current published operation scope while reading actual price rows", async () => {
  const db = client([
    [{ total: "1" }],
    [
      {
        id,
        revision_id: id,
        version: 2,
        source_locale: "th",
        name: "Gift",
        description: "Description",
        status: "active",
        handle: "gift",
        media_asset_id: null,
        gift_kind: "WISH",
        category: "OTHER",
      },
    ],
    [
      {
        id,
        inventory_policy: "PROCURE_ON_DEMAND",
        variant_count: "1",
        inventory_item_id: null,
        location_id: null,
        configured_location_id: null,
        configured_market: "TEST_B",
        configured_currency: "EUR",
        quantity: "0",
        all_artists: true,
      },
    ],
    [{ market: "TEST_B", currency: "EUR", amount_minor: "2200" }],
  ]);
  const result = await readManagementCenterList(
    db,
    {
      schemaVersion: 1,
      action: "LIST",
      section: "GIFTS",
      page: 1,
      pageSize: 10,
    },
    "https://media.example.test",
    { scope: "ALL" },
  );
  expect(result).toMatchObject({
    items: [
      { price: { market: "TEST_B", currency: "EUR", amountMinor: 2200 } },
    ],
  });
  expect(vi.mocked(db.query).mock.calls[3]![1]).toEqual([id, "TEST_B", "EUR"]);
  expect(vi.mocked(db.query).mock.calls[3]![0]).toContain(
    "$2::text IS NULL OR (h.market=$2 AND h.currency=$3)",
  );
});
test("gift listing reads the current daily gift kind before the legacy profile", async () => {
  const db = client([
    [{ total: "1" }],
    [
      {
        id,
        revision_id: id,
        version: 2,
        source_locale: "th",
        name: "Wish",
        description: "Description",
        status: "active",
        handle: "wish",
        media_asset_id: null,
        gift_kind: "WISH",
        category: "OTHER",
      },
    ],
    [
      {
        id,
        inventory_policy: "PROCURE_ON_DEMAND",
        variant_count: "1",
        inventory_item_id: null,
        location_id: null,
        configured_location_id: null,
        quantity: "0",
        all_artists: true,
      },
    ],
    [{ market: "TEST", currency: "USD", amount_minor: "1000" }],
  ]);
  const result = await readManagementCenterList(
    db,
    {
      schemaVersion: 1,
      action: "LIST",
      section: "GIFTS",
      page: 1,
      pageSize: 10,
    },
    "https://media.example.test",
    { scope: "ALL" },
  );
  expect(result).toMatchObject({
    items: [{ giftKind: "WISH", canEdit: true }],
  });
  expect(vi.mocked(db.query).mock.calls[1]![0]).toContain(
    "coalesce(d.document->>'giftKind',profile.gift_kind,'OTHER') gift_kind",
  );
  expect(vi.mocked(db.query).mock.calls[3]![1]).toEqual([id, null, null]);
});
test.each([false, true])(
  "zero stock retains the current published location setting and an explicit item lock %s",
  async (hasItem) => {
    const db = client([
      [{ total: "1" }],
      [
        {
          id,
          revision_id: id,
          version: 2,
          source_locale: "th",
          name: "Gift",
          description: "Description",
          status: "active",
          handle: "gift",
          media_asset_id: null,
          gift_kind: "VIRTUAL",
          category: "OTHER",
        },
      ],
      [
        {
          id,
          inventory_policy: "TRACKED",
          variant_count: "1",
          inventory_item_id: hasItem ? id : null,
          location_id: null,
          configured_location_id: id,
          quantity: "0",
          all_artists: true,
        },
      ],
      [{ market: "TEST", currency: "USD", amount_minor: "1000" }],
    ]);
    const value = await readManagementCenterList(
      db,
      {
        schemaVersion: 1,
        action: "LIST",
        section: "GIFTS",
        page: 1,
        pageSize: 10,
      },
      "https://media.example.test",
      { scope: "ALL" },
    );
    expect(value).toMatchObject({
      items: [
        {
          canEdit: true,
          inventoryPolicyLocked: hasItem,
          inventory: { policy: "TRACKED", locationId: id, quantity: 0 },
        },
      ],
    });
    const sql = vi
      .mocked(db.query)
      .mock.calls.map(([text]) => text)
      .join("\n");
    expect(sql).toContain("configured.status='SUCCEEDED'");
    expect(sql).toContain(
      "configured.result->>'publicationId'=manifest.publication_id::text",
    );
    expect(sql).toContain("configured_location.status='ACTIVE'");
    expect(sql).not.toMatch(/INSERT|UPDATE public.inventory/u);
  },
);
const principal = {
  schemaVersion: 1,
  actorId: id,
  sessionId: id,
  authorizedAt: "2026-09-08T00:00:00Z",
  expiresAt: "2026-09-08T01:00:00Z",
} as const;
function client(replies: unknown[][]): TransactionClient {
  return {
    query: vi.fn(async () => ({ rows: replies.shift() ?? [] })),
    release: vi.fn(),
  };
}
test("empty configuration stays explicit and never invents a region or currency", async () => {
  const db = client([[], [], [], []]);
  const result = await readManagementCenterContext(db, principal, {
    direct: true,
    assigned: false,
    assign: true,
  });
  expect(result).toMatchObject({
    kind: "CONTEXT",
    markets: [],
    defaults: null,
    poster: { available: false },
    operations: [],
    artists: { scope: "ALL", canAssign: true, brokers: [] },
  });
});
test("a broker's context carries no markets, defaults, poster or broker directory", async () => {
  const db = client([[]]);
  const result = await readManagementCenterContext(db, principal, {
    direct: false,
    assigned: true,
    assign: false,
  });
  expect(result).toMatchObject({
    kind: "CONTEXT",
    markets: [],
    defaults: null,
    poster: { available: false },
    artists: { scope: "ASSIGNED", canAssign: false, brokers: [] },
  });
  // Only the account's own recent operations are read.
  expect(vi.mocked(db.query)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(db.query).mock.calls[0]![1]).toEqual([id]);
});
const broker = "00000000-0000-4000-8000-000000000002";
const artistRow = {
  id,
  version: 2,
  source_locale: "th",
  name: "Artist",
  description: "Description",
  status: "active",
  handle: "artist",
  media_asset_id: null,
};
const artists = {
  schemaVersion: 1,
  action: "LIST",
  section: "ARTISTS",
  page: 1,
  pageSize: 10,
} as const;
test("artist name search binds literal text in both the scoped count and page before pagination", async () => {
  const db = client([
    [{ total: "2" }],
    [{ ...artistRow, broker_id: broker }],
    [{ broker_id: broker, display_name: "Mina Park", active: true }],
  ]);
  const response = await readManagementCenterList(
    db,
    { ...artists, search: "艺人%_'", page: 2, pageSize: 1 },
    "https://media.example.test/",
    { scope: "ASSIGNED", brokerId: broker },
  );
  expect(response).toMatchObject({
    totalItems: 2,
    page: 2,
    items: [{ id, assignment: { brokerId: broker } }],
  });
  const [count, page] = vi.mocked(db.query).mock.calls;
  for (const [sql, values] of [count!, page!]) {
    expect(sql).toContain("public.idol_current_broker(o.id)=$1");
    expect(sql).toContain(
      "strpos(lower(coalesce(d.document->'source'->'fields'->>'displayName',t.display_name,o.handle)),lower($2))>0",
    );
    expect(sql).not.toContain("艺人");
    expect(sql).not.toMatch(/\bILIKE\b/u);
    expect((values as unknown[]).slice(0, 2)).toEqual([broker, "艺人%_'"]);
  }
  expect(page![1]).toEqual([broker, "艺人%_'", 1, 1]);
});
test("gift kind uses the same current revision classification in count and page", async () => {
  const db = client([[{ total: "0" }], []]);
  await readManagementCenterList(
    db,
    { ...artists, section: "GIFTS", giftKind: "WISH", page: 3, pageSize: 12 },
    "https://media.example.test/",
    { scope: "ALL" },
  );
  const [count, page] = vi.mocked(db.query).mock.calls;
  for (const [sql] of [count!, page!])
    expect(sql).toContain(
      "coalesce(d.document->>'giftKind',profile.gift_kind,'OTHER')=$1",
    );
  expect(count![1]).toEqual(["WISH"]);
  expect(page![1]).toEqual(["WISH", 12, 24]);
});
test.each(["PRICE_ASC", "PRICE_DESC"] as const)(
  "%s uses published default scope without changing the gift edit price or dropping unpriced entries",
  async (sort) => {
    const giftRow = {
      ...artistRow,
      revision_id: id,
      gift_kind: "OTHER",
      category: "OTHER",
      status: "paused",
    };
    const variant = {
      id,
      inventory_policy: "PROCURE_ON_DEMAND",
      variant_count: "1",
      inventory_item_id: null,
      location_id: null,
      configured_location_id: null,
      configured_market: "TEST_B",
      configured_currency: "EUR",
      all_artists: true,
    };
    const db = client([
      [{ market: "TEST_A", currency: "USD" }],
      [{ total: "2" }],
      [
        { ...giftRow, sort_amount_minor: "1500" },
        { ...giftRow, id: broker, sort_amount_minor: null },
      ],
      [variant],
      [{ market: "TEST_B", currency: "EUR", amount_minor: "2200" }],
      [variant],
      [{ market: "TEST_B", currency: "EUR", amount_minor: "2200" }],
    ]);
    const result = await readManagementCenterList(
      db,
      { ...artists, section: "GIFTS", sort },
      "https://media.example.test/",
      { scope: "ALL" },
    );
    expect(result).toMatchObject({
      priceScope: { market: "TEST_A", currency: "USD" },
      totalItems: 2,
      items: [
        {
          status: "paused",
          giftKind: "OTHER",
          price: { market: "TEST_B", currency: "EUR", amountMinor: 2200 },
          sortPrice: { market: "TEST_A", currency: "USD", amountMinor: 1500 },
        },
        {
          sortPrice: null,
          price: { market: "TEST_B", currency: "EUR", amountMinor: 2200 },
        },
      ],
    });
    const [defaults, count, page] = vi.mocked(db.query).mock.calls;
    expect(defaults![0]).toContain("c.lifecycle='PUBLISHED'");
    expect(defaults![0]).toContain("m.status='ACTIVE'");
    expect(defaults![0]).toContain("m.default_currency=d.currency");
    expect(count![1]).toEqual([]);
    expect(page![1]).toEqual(["TEST_A", "USD", 10, 0]);
    expect(page![0]).toContain(
      `sort_price.amount_minor ${sort === "PRICE_ASC" ? "ASC" : "DESC"} NULLS LAST,o.created_at DESC,o.id DESC`,
    );
    expect(page![0]).toContain("h.market=$1 AND h.currency=$2");
    expect(page![0]).toContain(
      "publication.action='ROLLBACK' AND p.status IN('PUBLISHED','SUPERSEDED')",
    );
    expect(page![0]).toContain("b.valid_from<=transaction_timestamp()");
    expect(page![0]).toContain("p.valid_to>transaction_timestamp()");
    expect(page![0]).not.toContain("amount_minor IS NOT NULL");
    expect(vi.mocked(db.query).mock.calls[4]![1]).toEqual([
      id,
      "TEST_B",
      "EUR",
    ]);
  },
);
test("missing or invalid default price scope returns the existing typed failure before listing", async () => {
  for (const rows of [
    [],
    [{ market: "TEST", currency: null }],
    [{ market: "TEST", currency: "INVALID" }],
  ]) {
    const db = client([rows]);
    expect(
      await readManagementCenterList(
        db,
        { ...artists, section: "GIFTS", sort: "PRICE_ASC" },
        "https://media.example.test/",
        { scope: "ALL" },
      ),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "DEFAULTS_NOT_CONFIGURED",
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  }
});
test("NEWEST remains usable without a price scope and omits comparison metadata", async () => {
  const db = client([[{ total: "0" }], []]);
  const result = await readManagementCenterList(
    db,
    { ...artists, section: "GIFTS", sort: "NEWEST" },
    "https://media.example.test/",
    { scope: "ALL" },
  );
  expect(result).toMatchObject({ outcome: "SUCCESS", items: [] });
  expect(result).not.toHaveProperty("priceScope");
  expect(db.query).toHaveBeenCalledTimes(2);
});
test("a broker's artist list counts and reads only the artists assigned to it", async () => {
  const db = client([
    [{ total: "1" }],
    [{ ...artistRow, broker_id: broker }],
    [{ broker_id: broker, display_name: "Mina Park", active: true }],
  ]);
  const result = await readManagementCenterList(
    db,
    artists,
    "https://media.example.test/",
    { scope: "ASSIGNED", brokerId: broker },
  );
  expect(result).toMatchObject({
    totalItems: 1,
    items: [
      {
        assignment: {
          brokerId: broker,
          displayName: "Mina Park",
          active: true,
        },
      },
    ],
  });
  const [count, page] = vi.mocked(db.query).mock.calls;
  for (const [sql, values] of [count!, page!]) {
    expect(String(sql)).toContain("public.idol_current_broker(o.id)=$1");
    expect((values as unknown[])[0]).toBe(broker);
  }
  expect(page![1]).toEqual([broker, 10, 0]);
});
test("a broker's own scope is not widened by an assignment filter", async () => {
  const db = client([[{ total: "0" }], []]);
  await readManagementCenterList(
    db,
    { ...artists, assignment: { kind: "UNASSIGNED" } },
    "https://media.example.test/",
    { scope: "ASSIGNED", brokerId: broker },
  );
  for (const [sql, values] of vi.mocked(db.query).mock.calls) {
    expect(String(sql)).toContain("public.idol_current_broker(o.id)=$1");
    expect(String(sql)).not.toContain("IS NULL");
    expect((values as unknown[])[0]).toBe(broker);
  }
});
test("everyone else narrows the artist list to unassigned or one broker", async () => {
  const unassigned = client([[{ total: "1" }], [{ ...artistRow }]]);
  expect(
    await readManagementCenterList(
      unassigned,
      { ...artists, assignment: { kind: "UNASSIGNED" } },
      "https://media.example.test/",
      { scope: "ALL" },
    ),
  ).toMatchObject({ items: [{ assignment: null }] });
  for (const [sql] of vi.mocked(unassigned.query).mock.calls)
    expect(String(sql)).toContain("public.idol_current_broker(o.id) IS NULL");
  const one = client([[{ total: "0" }], []]);
  await readManagementCenterList(
    one,
    { ...artists, assignment: { kind: "BROKER", brokerId: broker } },
    "https://media.example.test/",
    { scope: "ALL" },
  );
  expect(vi.mocked(one.query).mock.calls[1]![1]).toEqual([broker, 10, 0]);
  const all = client([[{ total: "0" }], []]);
  await readManagementCenterList(all, artists, "https://media.example.test/", {
    scope: "ALL",
  });
  for (const [sql] of vi.mocked(all.query).mock.calls)
    expect(String(sql)).not.toContain("idol_current_broker(o.id)=");
});
test("artist list returns the actual source language and a safe processed image only", async () => {
  const db = client([
    [{ total: "1" }],
    [
      {
        id,
        version: 2,
        source_locale: "th",
        name: "Artist",
        description: "Description",
        status: "active",
        handle: "artist",
        media_asset_id: id,
      },
    ],
    [{ object_key: "processed/artist.webp" }],
  ]);
  const result = await readManagementCenterList(
    db,
    {
      schemaVersion: 1,
      action: "LIST",
      section: "ARTISTS",
      page: 1,
      pageSize: 10,
    },
    "https://media.example.test/",
    { scope: "ALL" },
  );
  expect(result).toMatchObject({
    kind: "LIST",
    items: [
      {
        sourceLocale: "th",
        image: { url: "https://media.example.test/processed/artist.webp" },
      },
    ],
  });
  expect(JSON.stringify(result)).not.toContain("object_key");
});
test.each(["ARTISTS", "GIFTS"] as const)(
  "deleted (archived) entries leave both the %s count and page",
  async (section) => {
    const db = client([[{ total: "0" }], []]);
    await readManagementCenterList(
      db,
      { schemaVersion: 1, action: "LIST", section, page: 1, pageSize: 10 },
      "https://media.example.test/",
      { scope: "ALL" },
    );
    const [count, page] = vi
      .mocked(db.query)
      .mock.calls.map(([sql]) => String(sql));
    expect(count).toContain("WHERE o.status<>'archived'");
    expect(page).toContain("WHERE o.status<>'archived'");
  },
);
test("corrupt thumbnail keys cannot turn into a foreign private response URL", async () => {
  const db = client([
    [{ total: "1" }],
    [
      {
        id,
        version: 2,
        source_locale: "th",
        name: "Artist",
        description: "Description",
        status: "active",
        handle: "artist",
        media_asset_id: id,
      },
    ],
    [{ object_key: "https://other.example.test/image.webp" }],
  ]);
  await expect(
    readManagementCenterList(
      db,
      {
        schemaVersion: 1,
        action: "LIST",
        section: "ARTISTS",
        page: 1,
        pageSize: 10,
      },
      "https://media.example.test/",
      { scope: "ALL" },
    ),
  ).rejects.toThrow("origin");
});
test("a missing history image does not erase its historical entry or authorize restore", async () => {
  const db = client([
    [{ total: "1" }],
    [
      {
        id,
        version: 3,
        current: false,
        source_locale: "ja",
        desktop_media_asset_id: id,
        created_at: "2026-09-08T00:00:00Z",
      },
    ],
    [],
  ]);
  expect(
    await readManagementCenterList(
      db,
      {
        schemaVersion: 1,
        action: "LIST",
        section: "POSTERS",
        page: 1,
        pageSize: 10,
      },
      "https://media.example.test/",
      { scope: "ALL" },
    ),
  ).toMatchObject({
    items: [
      { sourceRevisionId: id, image: null, canRestore: false, canDelete: true },
    ],
  });
});
test("deleted posters leave the history and the homepage poster is never deletable", async () => {
  const db = client([
    [{ total: "1" }],
    [
      {
        id,
        version: 3,
        current: true,
        source_locale: "en",
        desktop_media_asset_id: null,
        created_at: "2026-09-08T00:00:00Z",
      },
    ],
  ]);
  expect(
    await readManagementCenterList(
      db,
      {
        schemaVersion: 1,
        action: "LIST",
        section: "POSTERS",
        page: 1,
        pageSize: 10,
      },
      "https://media.example.test/",
      { scope: "ALL" },
    ),
  ).toMatchObject({ items: [{ current: true, canDelete: false }] });
  const sql = vi.mocked(db.query).mock.calls.map(([text]) => String(text));
  expect(sql.every((text) => text.includes("r.lifecycle<>'ARCHIVED'"))).toBe(
    true,
  );
});
test("missing result rows cannot masquerade as a successful complete page", async () => {
  const db = client([[{ total: "2" }], []]);
  await expect(
    readManagementCenterList(
      db,
      {
        schemaVersion: 1,
        action: "LIST",
        section: "ARTISTS",
        page: 1,
        pageSize: 10,
      },
      "https://media.example.test/",
      { scope: "ALL" },
    ),
  ).rejects.toThrow();
});

test("a gift without a current price cannot be edited by inventing one", async () => {
  const db = client([
    [{ total: "1" }],
    [
      {
        id,
        revision_id: id,
        version: 2,
        source_locale: "en",
        name: "Gift",
        description: "Description",
        status: "active",
        handle: "gift",
        media_asset_id: null,
        gift_kind: "VIRTUAL",
        category: "OTHER",
      },
    ],
    [
      {
        id,
        inventory_policy: "PROCURE_ON_DEMAND",
        variant_count: "1",
        inventory_item_id: null,
        location_id: null,
        configured_location_id: null,
        quantity: "0",
        all_artists: true,
      },
    ],
    [],
  ]);
  const response = await readManagementCenterList(
    db,
    {
      schemaVersion: 1,
      action: "LIST",
      section: "GIFTS",
      page: 1,
      pageSize: 10,
    },
    "https://media.example.test",
    { scope: "ALL" },
  );
  expect(response).toMatchObject({ items: [{ price: null, canEdit: false }] });
});

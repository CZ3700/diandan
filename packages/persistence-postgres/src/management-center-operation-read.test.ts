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
  );
  expect(result).toMatchObject({
    items: [{ giftKind: "WISH", canEdit: true }],
  });
  expect(vi.mocked(db.query).mock.calls[1]![0]).toContain(
    "coalesce(d.document->>'giftKind',profile.gift_kind) gift_kind",
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
function client(replies: unknown[][]): TransactionClient {
  return {
    query: vi.fn(async () => ({ rows: replies.shift() ?? [] })),
    release: vi.fn(),
  };
}
test("empty configuration stays explicit and never invents a region or currency", async () => {
  const db = client([[], [], [], []]);
  const result = await readManagementCenterContext(db, {
    schemaVersion: 1,
    actorId: id,
    sessionId: id,
    authorizedAt: "2026-09-08T00:00:00Z",
    expiresAt: "2026-09-08T01:00:00Z",
  });
  expect(result).toMatchObject({
    kind: "CONTEXT",
    markets: [],
    defaults: null,
    poster: { available: false },
    operations: [],
  });
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
    );
    const [count, page] = vi
      .mocked(db.query)
      .mock.calls.map(([sql]) => String(sql));
    expect(count).toContain("WHERE status<>'archived'");
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
  );
  expect(response).toMatchObject({ items: [{ price: null, canEdit: false }] });
});

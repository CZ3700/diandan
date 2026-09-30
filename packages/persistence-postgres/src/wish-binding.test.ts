import { expect, test, vi } from "vitest";
import type { ManagementCenterClaim } from "@fan-support/contracts";
import {
  prepareDailyWishBinding,
  readWishGiftSummary,
  writeWishPurchaseLink,
} from "./wish-binding.js";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const bound = {
  wish_id: id(1),
  gift_id: id(2),
  gift_variant_id: id(3),
  idol_id: id(4),
  inventory_location_id: id(5),
};
const claim = (patch: Record<string, unknown> = {}) =>
  ({
    operation: { operationId: id(6) },
    intent: {
      kind: "SAVE_GIFT",
      giftKind: "WISH",
      eligibility: { rule: "SINGLE_ARTIST", idolId: id(4) },
      inventory: { policy: "TRACKED", locationId: id(5), quantity: 0 },
      commerceEdit: { inventory: { mode: "PRESERVE" } },
      ...patch,
    },
  }) as ManagementCenterClaim;
const clientWith = (rows: Record<string, unknown>[]) => ({
  query: vi.fn<
    (
      sql: string,
      values?: unknown[],
    ) => Promise<{ rows: Record<string, unknown>[] }>
  >(async () => ({ rows })),
  release: vi.fn(),
});

test("a supported bound wish preserves its zero stock and identity on content edits", async () => {
  const client = clientWith([bound]);
  await expect(
    prepareDailyWishBinding(
      client,
      claim(),
      id(2),
      id(3),
      "2026-10-01T00:00:00Z",
    ),
  ).resolves.toBeUndefined();
  expect(client.query).toHaveBeenCalledTimes(1);
  for (const patch of [
    { giftKind: "PHYSICAL" },
    { eligibility: { rule: "SINGLE_ARTIST", idolId: id(9) } },
    { inventory: { policy: "TRACKED", locationId: id(9), quantity: 1 } },
    { commerceEdit: { inventory: { mode: "SET" } } },
  ])
    await expect(
      prepareDailyWishBinding(
        client,
        claim(patch),
        id(2),
        id(3),
        "2026-10-01T00:00:00Z",
      ),
    ).rejects.toThrow();
});

test("unbound, mismatched and multiple-unit wishes cannot acquire an order link", async () => {
  const input = {
    orderItemId: id(7),
    cartItemId: id(8),
    giftId: id(2),
    giftVariantId: id(3),
    idolId: id(4),
    quantity: 1,
    giftKind: "WISH",
  };
  for (const rows of [[], [{ ...bound, allowed: false }]]) {
    const client = clientWith(rows);
    await expect(writeWishPurchaseLink(client, input)).rejects.toThrow(
      "Wish purchase is unavailable",
    );
    expect(client.query).toHaveBeenCalledTimes(1);
  }
  const client = clientWith([{ ...bound, allowed: true }]);
  await expect(
    writeWishPurchaseLink(client, { ...input, quantity: 2 }),
  ).rejects.toThrow();
  await expect(writeWishPurchaseLink(client, input)).resolves.toBe(true);
  expect(client.query).toHaveBeenLastCalledWith(
    expect.stringContaining("INSERT INTO public.wish_purchase_links"),
    [id(7), id(1), id(8)],
  );
});

test("public status projects only the explicit public artist fields", async () => {
  const client = clientWith([
    {
      ...bound,
      handle: "artist",
      artist_name: "Artist",
      wish_status: "SUPPORTED",
      private_secret: "do-not-project",
    },
  ]);
  expect(await readWishGiftSummary(client, id(2), "en")).toEqual({
    schemaVersion: 1,
    wishId: id(1),
    artistId: id(4),
    artistName: "Artist",
    artistHandle: "artist",
    status: "SUPPORTED",
  });
  expect(
    await readWishGiftSummary(clientWith([]), id(2), "en"),
  ).toBeUndefined();
});

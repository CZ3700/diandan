import { expect, test } from "vitest";
import {
  slugSchema,
  managementCenterResponseSchema,
  managementCenterListItemSchema,
} from "@fan-support/contracts";
import type { ManagementContext } from "./api";
import {
  changeDraftGiftKind,
  contentDraftErrors,
  initialContentDraft,
} from "./form-model";

const artistId = "10000000-0000-4000-8000-000000000002";
const locationId = "10000000-0000-4000-8000-000000000003";
const context = managementCenterResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "CONTEXT",
  capability: "DIRECT_OPERATOR_V1",
  markets: [{ market: "GLOBAL", currencies: ["USD"] }],
  defaults: {
    priceScope: { market: "GLOBAL", currency: "USD" },
    inventoryPolicy: "PROCURE_ON_DEMAND",
    inventoryLocationId: locationId,
    eligibility: "ALL_ACTIVE_ARTISTS",
  },
  giftKinds: ["WISH", "PHYSICAL"],
  categories: ["OTHER"],
  poster: { available: false, version: 0, currentRevisionId: null },
  operations: [],
  artists: { scope: "ALL", canAssign: false, brokers: [] },
}) as ManagementContext;

test("a new wish starts with a single tracked gift and no silently chosen artist", () => {
  expect(initialContentDraft("en", context, null)).toMatchObject({
    giftKind: "WISH",
    policy: "TRACKED",
    quantity: "1",
    locationId,
    wishArtistId: "",
  });
});
test("switching back to an ordinary gift clears the recipient and restores its stock draft", () => {
  const ordinary = {
    ...initialContentDraft("en", context, null),
    giftKind: "PHYSICAL" as const,
    policy: "TRACKED" as const,
    quantity: "7",
  };
  const wish = changeDraftGiftKind(ordinary, "WISH");
  expect(wish).toMatchObject({
    policy: "TRACKED",
    quantity: "1",
    wishArtistId: "",
  });
  const returned = changeDraftGiftKind(
    { ...wish, wishArtistId: artistId },
    "PHYSICAL",
    ordinary,
  );
  expect(returned).toMatchObject({
    giftKind: "PHYSICAL",
    policy: "TRACKED",
    quantity: "7",
    wishArtistId: "",
  });
});

test("a wish requires an explicit recipient while ordinary gifts do not", () => {
  const draft = {
    ...initialContentDraft("en", context, null),
    name: "Studio wish",
    description: "A new wish",
    price: "25",
    policy: "TRACKED" as const,
    quantity: "1",
    wishArtistId: "",
  };
  expect(contentDraftErrors("SAVE_GIFT", draft, "en", false)).toMatchObject({
    wishArtistId: "wishArtistRequired",
  });
  expect(
    contentDraftErrors(
      "SAVE_GIFT",
      { ...draft, wishArtistId: artistId },
      "en",
      false,
    ),
  ).toEqual({});
  expect(
    contentDraftErrors(
      "SAVE_GIFT",
      { ...draft, giftKind: "PHYSICAL" },
      "en",
      false,
    ),
  ).toEqual({});
});

test("an existing supported wish reads its fixed artist and preserves its real zero stock", () => {
  const item = managementCenterListItemSchema.parse({
    kind: "GIFT" as const,
    id: "10000000-0000-4000-8000-000000000001",
    version: 2,
    sourceLocale: "en" as const,
    name: "Studio wish",
    description: "A new wish",
    image: null,
    status: "active" as const,
    handle: slugSchema.parse("studio-wish"),
    giftKind: "WISH" as const,
    category: "OTHER" as const,
    price: { market: "GLOBAL", currency: "USD", amountMinor: 2500 },
    inventory: { policy: "TRACKED" as const, quantity: 0, locationId },
    eligibility: { rule: "EXPLICIT_ARTISTS" as const },
    canEdit: true,
    inventoryPolicyLocked: true,
    wish: {
      schemaVersion: 1 as const,
      wishId: "10000000-0000-4000-8000-000000000004",
      artistId,
      artistName: "Mira",
      artistHandle: slugSchema.parse("mira"),
      status: "SUPPORTED" as const,
    },
  });
  if (item.kind !== "GIFT") throw new Error("Expected gift fixture");
  expect(initialContentDraft("en", context, item)).toMatchObject({
    wishArtistId: artistId,
    policy: "TRACKED",
    quantity: "0",
  });
});

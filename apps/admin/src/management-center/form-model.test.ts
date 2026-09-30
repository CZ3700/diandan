import { expect, it } from "vitest";
import { managementCenterResponseSchema } from "@fan-support/contracts";
import { contentDraftErrors, initialContentDraft } from "./form-model";
import type { ManagementContext } from "./api";
const context = managementCenterResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "CONTEXT",
  capability: "DIRECT_OPERATOR_V1",
  markets: [{ market: "GLOBAL", currencies: ["USD"] }],
  defaults: {
    priceScope: { market: "GLOBAL", currency: "USD" },
    inventoryPolicy: "PROCURE_ON_DEMAND",
    inventoryLocationId: null,
    eligibility: "ALL_ACTIVE_ARTISTS",
  },
  giftKinds: ["PHYSICAL", "VIRTUAL"],
  categories: ["OTHER"],
  poster: { available: false, version: 0, currentRevisionId: null },
  operations: [],
  artists: { scope: "ALL", canAssign: false, brokers: [] },
}) as ManagementContext;
it("starts with the interface content language and actual configured scope without fake stock", () => {
  const draft = initialContentDraft("zh-CN", context, null);
  expect(draft.sourceLocale).toBe("zh-CN");
  expect(draft.market).toBe("GLOBAL");
  expect(draft.currency).toBe("USD");
  expect(draft.policy).toBe("PROCURE_ON_DEMAND");
  expect(draft.quantity).toBe("");
  expect(draft.price).toBe("");
});
it("keeps defaults unconfigured when the server has not selected a market", () => {
  const draft = initialContentDraft("th", { ...context, defaults: null }, null);
  expect(draft.market).toBe("");
  expect(draft.currency).toBe("");
});
it("does not silently classify every new gift as flowers from enum order", () => {
  const draft = initialContentDraft(
    "zh-CN",
    { ...context, categories: ["FLOWERS", "FOOD", "OTHER"] },
    null,
  );
  expect(draft.category).toBe("OTHER");
});
it("starts a new gift as prepare-per-order even if legacy editor defaults tracked stock", () => {
  const draft = initialContentDraft(
    "en",
    {
      ...context,
      defaults: { ...context.defaults!, inventoryPolicy: "TRACKED" },
    },
    null,
  );
  expect(draft.policy).toBe("PROCURE_ON_DEMAND");
  expect(draft.quantity).toBe("");
});
it("reports missing image and fields and requires real stock configuration only for tracked gifts", () => {
  const draft = initialContentDraft("en", context, null);
  expect(contentDraftErrors("SAVE_ARTIST", draft, "en", true)).toMatchObject({
    image: "imageRequired",
    name: "required",
    description: "required",
  });
  const valid = {
    ...draft,
    name: "Artist gift",
    description: "Original description",
    price: "10.29",
  };
  expect(contentDraftErrors("SAVE_GIFT", valid, "en", false)).toEqual({});
  expect(
    contentDraftErrors(
      "SAVE_GIFT",
      { ...valid, policy: "TRACKED" },
      "en",
      false,
    ),
  ).toMatchObject({ quantity: "invalidQuantity", locationId: "noLocation" });
});
it("keeps an existing tracked gift's location instead of adopting a later workspace default", async () => {
  const { managementCenterListItemSchema } =
    await import("@fan-support/contracts");
  const item = managementCenterListItemSchema.parse({
    kind: "GIFT",
    id: "10000000-0000-4000-8000-000000000001",
    version: 2,
    sourceLocale: "en",
    name: "Gift",
    description: "Original",
    image: null,
    status: "active",
    handle: "gift",
    giftKind: "PHYSICAL",
    category: "OTHER",
    price: { market: "GLOBAL", currency: "USD", amountMinor: 2400 },
    inventory: {
      policy: "TRACKED",
      quantity: 7,
      locationId: "10000000-0000-4000-8000-000000000002",
    },
    eligibility: { rule: "ALL_ACTIVE_ARTISTS" },
    canEdit: true,
    inventoryPolicyLocked: true,
  });
  if (item.kind !== "GIFT") throw new Error("Fixture must be a gift");
  const draft = initialContentDraft(
    "en",
    {
      ...context,
      defaults: {
        ...context.defaults!,
        inventoryLocationId: "10000000-0000-4000-8000-000000000003",
      },
    },
    item,
  );
  expect(draft.locationId).toBe("10000000-0000-4000-8000-000000000002");
  expect(draft.quantity).toBe("7");
});

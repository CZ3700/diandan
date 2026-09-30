import { expect, test } from "vitest";
import type { ContentDraft } from "./form-model";

const subject = await import("./gift-submission").catch(() => undefined);
const draft = {
  sourceLocale: "en",
  name: "Wish",
  description: "One wish",
  giftKind: "WISH",
  category: "OTHER",
  market: "GLOBAL",
  currency: "USD",
  price: "25.00",
  policy: "TRACKED",
  quantity: "1",
  locationId: "10000000-0000-4000-8000-000000000003",
  wishArtistId: "10000000-0000-4000-8000-000000000002",
} as const satisfies ContentDraft;

test("wish submission binds exactly the chosen artist and one real tracked unit", () => {
  expect(subject?.giftSubmissionFields).toBeTypeOf("function");
  expect(subject!.giftSubmissionFields(draft, "en")).toMatchObject({
    giftKind: "WISH",
    eligibility: { rule: "SINGLE_ARTIST", idolId: draft.wishArtistId },
    inventory: { policy: "TRACKED", quantity: 1, locationId: draft.locationId },
    price: { amountMinor: 2500, market: "GLOBAL", currency: "USD" },
  });
});
test("ordinary gifts keep the original audience even if a stale wish selection exists", () => {
  expect(subject?.giftSubmissionFields).toBeTypeOf("function");
  expect(
    subject!.giftSubmissionFields(
      {
        ...draft,
        giftKind: "PHYSICAL",
        policy: "PROCURE_ON_DEMAND",
        quantity: "",
      },
      "en",
    ),
  ).toMatchObject({
    eligibility: { rule: "ALL_ACTIVE_ARTISTS" },
    inventory: { policy: "PROCURE_ON_DEMAND" },
  });
});

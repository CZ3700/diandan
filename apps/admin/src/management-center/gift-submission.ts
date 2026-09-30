import {
  currencySchema,
  idolIdSchema,
  marketSchema,
  minorAmountSchema,
  type ManagementCenterIntent,
  type SupportedLocale,
} from "@fan-support/contracts";
import type { ContentDraft } from "./form-model";
import { parseManagementPrice } from "./inputs";

type GiftIntent = Extract<ManagementCenterIntent, { kind: "SAVE_GIFT" }>;

/** Serialize gift-only form fields through the shared money and recipient contracts. */
export function giftSubmissionFields(
  draft: ContentDraft,
  locale: SupportedLocale,
): Pick<
  GiftIntent,
  "giftKind" | "category" | "price" | "inventory" | "eligibility"
> {
  return {
    giftKind: draft.giftKind,
    category: draft.category,
    price: {
      market: marketSchema.parse(draft.market),
      currency: currencySchema.parse(draft.currency),
      amountMinor: minorAmountSchema.parse(
        parseManagementPrice(draft.price, locale, draft.currency),
      ),
    },
    inventory:
      draft.policy === "TRACKED"
        ? {
            policy: "TRACKED",
            locationId: draft.locationId,
            quantity: Number(draft.quantity),
          }
        : { policy: draft.policy },
    eligibility:
      draft.giftKind === "WISH"
        ? {
            rule: "SINGLE_ARTIST",
            idolId: idolIdSchema.parse(draft.wishArtistId),
          }
        : { rule: "ALL_ACTIVE_ARTISTS" },
  };
}

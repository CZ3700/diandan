import type {
  ManagementCenterIntent,
  ManagementCenterListItem,
  SupportedLocale,
} from "@fan-support/contracts";
import { idolIdSchema } from "@fan-support/contracts";
import type { ManagementContext } from "./api";
import type { ManagementCopy } from "./copy";
import { parseManagementPrice, priceInputValue } from "./inputs";
export type EditableItem = Exclude<
  ManagementCenterListItem,
  { kind: "POSTER" }
>;
type GiftIntent = Extract<ManagementCenterIntent, { kind: "SAVE_GIFT" }>;
export type ContentDraft = {
  sourceLocale: SupportedLocale;
  name: string;
  description: string;
  giftKind: GiftIntent["giftKind"];
  category: GiftIntent["category"];
  market: string;
  currency: string;
  price: string;
  policy: GiftIntent["inventory"]["policy"];
  quantity: string;
  locationId: string;
  wishArtistId: string;
};
export type FormErrors = Partial<
  Record<keyof ContentDraft | "image", keyof ManagementCopy | undefined>
>;
export function initialContentDraft(
  locale: SupportedLocale,
  context: ManagementContext,
  item: EditableItem | null,
): ContentDraft {
  const gift = item?.kind === "GIFT" ? item : null;
  const scope = gift?.price ?? context.defaults?.priceScope;
  const inventory = gift?.inventory;
  const giftKind = gift?.giftKind ?? context.giftKinds[0]!;
  const wish = item?.kind === "GIFT" && "wish" in item ? item.wish : undefined;
  const newWish = giftKind === "WISH" && !wish;
  return {
    sourceLocale: item?.sourceLocale ?? locale,
    name: item?.name ?? "",
    description: item?.description ?? "",
    giftKind,
    wishArtistId: wish?.artistId ?? "",
    category:
      gift?.category ??
      (context.categories.includes("OTHER") ? "OTHER" : context.categories[0]!),
    market: scope?.market ?? "",
    currency: scope?.currency ?? "",
    price: gift?.price
      ? priceInputValue(gift.price.amountMinor, locale, gift.price.currency)
      : "",
    policy: newWish ? "TRACKED" : (inventory?.policy ?? "PROCURE_ON_DEMAND"),
    quantity: newWish
      ? "1"
      : inventory?.policy === "TRACKED"
        ? String(inventory.quantity)
        : "",
    locationId:
      inventory?.policy === "TRACKED"
        ? inventory.locationId
        : (context.defaults?.inventoryLocationId ?? ""),
  };
}
/** A wish's single purchase is configured once; ordinary gifts retain their usual defaults. */
export function changeDraftGiftKind(
  draft: ContentDraft,
  giftKind: ContentDraft["giftKind"],
  ordinaryInventory: Pick<ContentDraft, "policy" | "quantity"> = {
    policy: "PROCURE_ON_DEMAND",
    quantity: "",
  },
): ContentDraft {
  if (giftKind === draft.giftKind) return draft;
  if (giftKind === "WISH")
    return {
      ...draft,
      giftKind,
      policy: "TRACKED",
      quantity: "1",
      wishArtistId: "",
    };
  return {
    ...draft,
    giftKind,
    wishArtistId: "",
    ...(draft.giftKind === "WISH"
      ? {
          policy: ordinaryInventory.policy,
          quantity: ordinaryInventory.quantity,
        }
      : {}),
  };
}
export function contentDraftErrors(
  kind: "SAVE_ARTIST" | "SAVE_GIFT",
  draft: ContentDraft,
  locale: SupportedLocale,
  needsImage: boolean,
): FormErrors {
  const errors: FormErrors = {};
  if (needsImage) errors.image = "imageRequired";
  if (!draft.name.trim()) errors.name = "required";
  if (!draft.description.trim()) errors.description = "required";
  if (kind === "SAVE_GIFT") {
    if (
      draft.giftKind === "WISH" &&
      !idolIdSchema.safeParse(draft.wishArtistId).success
    )
      errors.wishArtistId = "wishArtistRequired";
    if (!draft.market || !draft.currency) errors.price = "noMarket";
    else if (parseManagementPrice(draft.price, locale, draft.currency) === null)
      errors.price = "invalidPrice";
    if (draft.policy === "TRACKED") {
      if (
        !/^(0|[1-9]\d*)$/u.test(draft.quantity) ||
        !Number.isSafeInteger(Number(draft.quantity))
      )
        errors.quantity = "invalidQuantity";
      if (!draft.locationId) errors.locationId = "noLocation";
    }
  }
  return errors;
}

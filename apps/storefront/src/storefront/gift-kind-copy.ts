import type { GiftKind } from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";

/** The four first-release kinds fans browse by (ADR-019); OTHER stays reachable under "all". */
export const BROWSABLE_GIFT_KINDS = [
  "VIRTUAL",
  "PHYSICAL",
  "WISH",
  "MERCHANDISE",
] as const satisfies readonly GiftKind[];
export type BrowsableGiftKind = (typeof BROWSABLE_GIFT_KINDS)[number];

export function isBrowsableGiftKind(
  kind: GiftKind | null | undefined,
): kind is BrowsableGiftKind {
  return BROWSABLE_GIFT_KINDS.some((value) => value === kind);
}

/** One name per kind across tiles, filters, cards and the gift detail page. */
export function giftKindLabel(copy: StorefrontCopy, kind: GiftKind): string {
  switch (kind) {
    case "VIRTUAL":
      return copy.giftKindVirtual;
    case "PHYSICAL":
      return copy.giftKindPhysical;
    case "WISH":
      return copy.giftKindWish;
    case "MERCHANDISE":
      return copy.giftKindMerchandise;
    case "OTHER":
      return copy.giftKindOther;
  }
}

export function giftKindBody(
  copy: StorefrontCopy,
  kind: BrowsableGiftKind,
): string {
  switch (kind) {
    case "VIRTUAL":
      return copy.giftKindVirtualBody;
    case "PHYSICAL":
      return copy.giftKindPhysicalBody;
    case "WISH":
      return copy.giftKindWishBody;
    case "MERCHANDISE":
      return copy.giftKindMerchandiseBody;
  }
}

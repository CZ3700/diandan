import type {
  PublishedGiftDetails,
  PublishedGiftView,
} from "@fan-support/contracts";

/**
 * The paragraphs under a gift's name on its own page. A card shows the start of the
 * description (the daily centre keeps its first 160 characters as the summary); this page
 * is where a fan reads all of it, so the full text replaces a summary it begins with.
 */
export function giftDetailSummary(
  gift: Pick<PublishedGiftView, "shortDescription" | "subtitle">,
  details: PublishedGiftDetails,
): readonly string[] {
  const lead = gift.shortDescription.trim();
  const full = details.format === "LEGACY_TEXT" ? details.text.trim() : "";
  return [
    ...(full.startsWith(lead) ? [] : [lead]),
    ...(full ? [full] : []),
  ].filter((text) => text !== "" && text !== gift.subtitle?.trim());
}

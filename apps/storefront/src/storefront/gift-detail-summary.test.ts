import { expect, test } from "vitest";
import { giftDetailSummary } from "./gift-detail-summary";

const text = (value: string) =>
  ({ format: "LEGACY_TEXT", text: value }) as const;

test("a description longer than the card summary is shown in full on the gift page", () => {
  const description = `${"A long, careful description. ".repeat(12)}The end.`;
  expect(description.length).toBeGreaterThan(160);
  // The daily centre publishes the first 160 characters as the summary.
  const shortDescription = description.slice(0, 160);
  expect(giftDetailSummary({ shortDescription }, text(description))).toEqual([
    description,
  ]);
});

test("a description that fits the summary is shown once", () => {
  expect(
    giftDetailSummary(
      { shortDescription: "Two short sentences." },
      text("Two short sentences."),
    ),
  ).toEqual(["Two short sentences."]);
});

test("a separately written summary stays ahead of the description", () => {
  expect(
    giftDetailSummary(
      { shortDescription: "A bright bouquet." },
      text("Twelve roses, tied by hand."),
    ),
  ).toEqual(["A bright bouquet.", "Twelve roses, tied by hand."]);
});

test("structured details contribute nothing; the summary alone is shown", () => {
  expect(
    giftDetailSummary(
      { shortDescription: "A bright bouquet." },
      {
        format: "BLOCKS",
        blocks: [{ id: "one", kind: "PARAGRAPH", text: "Twelve roses." }],
      },
    ),
  ).toEqual(["A bright bouquet."]);
});

test("nothing repeats the subtitle and empty text is left out", () => {
  expect(
    giftDetailSummary(
      {
        shortDescription: "Prepared for an artist",
        subtitle: "Prepared for an artist",
      },
      text("Prepared for an artist"),
    ),
  ).toEqual([]);
  expect(giftDetailSummary({ shortDescription: "  " }, text(" "))).toEqual([]);
});

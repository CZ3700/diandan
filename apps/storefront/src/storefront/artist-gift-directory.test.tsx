import type { ReactElement } from "react";
import { expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./storefront-page-reads", () => ({
  readCommerceContext: reads.context,
}));
vi.mock("./gift-directory-section", () => ({
  GiftDirectorySection: () => null,
}));

import { ArtistGiftDirectory } from "./artist-gift-directory";

const markets = (list: { market: string; currencies: string[] }[]) => ({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "STOREFRONT_CONTEXT",
  markets: list,
  policies: [],
});
const props = (values: Record<string, string>) =>
  ({
    locale: "en",
    copy: {},
    values,
    basePath: "/idols/aurora",
    headingLevel: 2,
  }) as never;
const valuesOf = async (values: Record<string, string>) =>
  (
    (await ArtistGiftDirectory(props(values))) as ReactElement<{
      values: Record<string, string>;
    }>
  ).props.values;

it("prices an artist's gifts without a region step when one market is published", async () => {
  reads.context.mockResolvedValue(
    markets([{ market: "US", currencies: ["USD"] }]),
  );
  expect(await valuesOf({ idol: "artist-1" })).toEqual({
    idol: "artist-1",
    market: "US",
    currency: "USD",
  });
  expect(await valuesOf({ idol: "artist-1", market: "US" })).toEqual({
    idol: "artist-1",
    market: "US",
  });
});

it("keeps the explicit region choice whenever markets or currencies can differ", async () => {
  for (const context of [
    markets([
      { market: "US", currencies: ["USD"] },
      { market: "JAPAN", currencies: ["JPY"] },
    ]),
    markets([{ market: "GLOBAL", currencies: ["USD", "JPY"] }]),
    { schemaVersion: 1, outcome: "FAILURE", code: "COMMERCE_UNAVAILABLE" },
  ]) {
    reads.context.mockResolvedValue(context);
    expect(await valuesOf({ idol: "artist-1" })).toEqual({ idol: "artist-1" });
  }
});

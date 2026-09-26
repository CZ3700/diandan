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
const propsOf = async (values: Record<string, string>) =>
  (
    (await ArtistGiftDirectory(props(values))) as ReactElement<{
      values: Record<string, string>;
      implicitScope?: { market: string; currency: string };
    }>
  ).props;

it("prices an artist's gifts without a region step or a market in the URL when one market is published", async () => {
  reads.context.mockResolvedValue(
    markets([{ market: "US", currencies: ["USD"] }]),
  );
  const scoped = await propsOf({ idol: "artist-1" });
  expect(scoped.values).toEqual({ idol: "artist-1" });
  expect(scoped.implicitScope).toEqual({ market: "US", currency: "USD" });
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
    const result = await propsOf({ idol: "artist-1" });
    expect(result.values).toEqual({ idol: "artist-1" });
    expect(result).not.toHaveProperty("implicitScope");
  }
});

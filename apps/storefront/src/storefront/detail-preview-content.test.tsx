import { beforeEach, expect, test, vi } from "vitest";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";
import { directoryFixturePage } from "./directory-fixture";
const reads = vi.hoisted(() => ({
  artists: vi.fn(),
  gifts: vi.fn(),
  detail: vi.fn(),
  context: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./gift-page-reads", () => ({
  artistRead: reads.artists,
  readCommerceContext: reads.context,
  commerceRead: vi.fn(),
}));
vi.mock("../server/public-gift-browse", () => ({
  readGiftBrowse: reads.gifts,
}));
vi.mock("./gift-detail-page-reads", () => ({
  readGiftDetailPage: reads.detail,
}));
import { DetailPreviewContent } from "./detail-preview-content";
import { PageState } from "./page-parts";
import { ArtistDetailBody } from "./artist-detail-body";
import { GiftDetail } from "./gift-detail";

beforeEach(() => {
  vi.clearAllMocks();
  reads.artists.mockResolvedValue(directoryFixturePage([1]));
  reads.context.mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "COMMERCE_UNAVAILABLE",
  });
});
test("artist preview uses the actual first published artist and shared body", async () => {
  const copy = await loadStorefrontCopy("en");
  const result = await DetailPreviewContent({
    locale: "en",
    page: "artist",
    copy,
  });
  expect(result.type).toBe(ArtistDetailBody);
  expect(result.props.artist).toMatchObject({ handle: "fictional-1" });
  expect(reads.artists).toHaveBeenCalledWith("en");
  expect(reads.gifts).not.toHaveBeenCalled();
});
for (const page of ["artist", "gift"] as const) {
  test(`${page} empty content remains different from unavailable content`, async () => {
    const copy = await loadStorefrontCopy("en");
    const read = page === "artist" ? reads.artists : reads.gifts;
    read.mockResolvedValue({ schemaVersion: 1, outcome: "SUCCESS", items: [] });
    const empty = await DetailPreviewContent({ locale: "en", page, copy });
    expect(empty.type).toBe(PageState);
    expect(empty.props.title).toBe(
      page === "artist" ? copy.artistEmptyTitle : copy.giftEmpty,
    );
    read.mockResolvedValue({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CATALOG_UNAVAILABLE",
    });
    const error = await DetailPreviewContent({ locale: "en", page, copy });
    expect(error.type).toBe(PageState);
    expect(error.props.title).toBe(copy.contentError);
    expect(reads.detail).not.toHaveBeenCalled();
  });
}
test("gift preview forwards the actual sample recipient without inventing a market or an offer", async () => {
  const copy = await loadStorefrontCopy("en");
  reads.gifts.mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    items: [{ handle: "published-gift" }],
  });
  const detail = {
    handle: "published-gift",
    selection: { kind: "CONTEXT_REQUIRED" },
    result: {
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "COMMERCE_UNAVAILABLE",
    },
  };
  reads.detail.mockResolvedValue(detail);
  const result = await DetailPreviewContent({
    locale: "en",
    page: "gift",
    copy,
  });
  const values = { idol: "a0000000-0000-4000-8000-000000000001" };
  expect(reads.detail).toHaveBeenCalledWith("en", "published-gift", values);
  expect(reads.gifts).toHaveBeenCalledWith({
    schemaVersion: 1,
    locale: "en",
    page: 1,
    pageSize: 1,
  });
  expect(result.type).toBe(PageState);
  expect(result.props.title).toBe(copy.contentError);
});

test("gift preview renders the same purchase body when public content exists without an artist", async () => {
  const copy = await loadStorefrontCopy("en");
  reads.artists.mockResolvedValue(directoryFixturePage([]));
  reads.gifts.mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    items: [{ handle: "published-gift" }],
  });
  const content = { schemaVersion: 1, outcome: "SUCCESS" };
  const artists = Promise.resolve(directoryFixturePage([]));
  reads.detail.mockResolvedValue({
    handle: "published-gift",
    result: content,
    artists,
    selection: { kind: "CONTEXT_REQUIRED" },
  });
  const result = await DetailPreviewContent({
    locale: "en",
    page: "gift",
    copy,
  });
  expect(result.type).toBe(GiftDetail);
  expect(result.props.content).toBe(content);
  expect(result.props.artists).toBe(artists);
  expect(result.props.commerce).toBeUndefined();
  expect(reads.detail).toHaveBeenCalledWith("en", "published-gift", {});
  expect(result.props.contextQuery).toBe("");
  expect(result.props.soleOffer).toBeTypeOf("function");
});

test("a paused first artist remains the real sample instead of inventing an eligible recipient", async () => {
  const copy = await loadStorefrontCopy("en");
  const directory = directoryFixturePage([1, 2]);
  if (directory.outcome !== "SUCCESS" || !directory.items[0])
    throw new Error("Missing fixture");
  directory.items[0].acceptingGifts = false;
  reads.artists.mockResolvedValue(directory);
  reads.gifts.mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    items: [{ handle: "published-gift" }],
  });
  reads.detail.mockResolvedValue({
    handle: "published-gift",
    result: { outcome: "FAILURE", code: "COMMERCE_UNAVAILABLE" },
    selection: { kind: "CONTEXT_REQUIRED" },
  });
  await DetailPreviewContent({ locale: "en", page: "gift", copy });
  expect(reads.detail).toHaveBeenCalledWith("en", "published-gift", {
    idol: directory.items[0].id,
  });
});

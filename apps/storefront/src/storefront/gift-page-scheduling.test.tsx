import { beforeEach, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("../server/runtime-config", () => ({
  loadStorefrontRuntimeConfig: () => ({}),
  loadStorefrontPresentationConfig: () => ({ name: "Test studio" }),
}));
vi.mock("../server/storefront-copy", () => ({
  loadStorefrontCopy: async () => ({}),
}));
const reads = vi.hoisted(() => ({
  context: vi.fn(),
  gift: vi.fn(),
  commerce: vi.fn(),
  artists: vi.fn(),
}));
vi.mock("./gift-page-reads", () => ({
  readCommerceContext: reads.context,
  giftRead: reads.gift,
  commerceRead: reads.commerce,
  artistRead: reads.artists,
  policyRead: vi.fn(),
  giftDirectoryRead: vi.fn(),
}));
vi.mock("./site-header", () => ({ SiteHeader: () => null }));
vi.mock("./page-parts", () => ({
  SiteFooter: () => null,
  PageState: () => null,
}));
vi.mock("./commerce-context", () => ({
  MarketChoices: () => null,
  PolicyLinks: () => null,
}));
vi.mock("./gift-directory-section", () => ({
  GiftDirectorySection: () => null,
}));
vi.mock("./gift-detail", () => ({ GiftDetail: () => null }));
vi.mock("./gift-content", () => ({ PolicyBody: () => null }));
vi.mock("./gift-seo", () => ({
  GiftPageSeo: () => null,
  loadGiftSeo: vi.fn(),
}));

import { createGiftStorefrontPage } from "./gift-page-factory";

const success = { schemaVersion: 1, outcome: "SUCCESS" };
const missing = {
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "NOT_FOUND",
};
const query = { market: "GLOBAL", currency: "USD" };
const Page = createGiftStorefrontPage("en", "gift");
function render(
  values: Readonly<Record<string, string | string[] | undefined>> = query,
  handle = "rose-palace",
) {
  return Page({
    params: Promise.resolve({ handle }),
    searchParams: Promise.resolve(values),
  });
}
beforeEach(() => {
  for (const read of Object.values(reads)) read.mockReset();
  reads.context.mockResolvedValue(success);
  reads.gift.mockResolvedValue(success);
  reads.commerce.mockResolvedValue(success);
  reads.artists.mockResolvedValue(success);
});

test.each(["context", "gift", "commerce"] as const)(
  "a slow %s read does not serialize independent gift page reads",
  async (blocked) => {
    let release!: (value: typeof success) => void;
    reads[blocked].mockReturnValue(
      new Promise<typeof success>((resolve) => {
        release = resolve;
      }),
    );
    const pending = render();
    try {
      // All inputs are resolved promises; allow the page's scheduling work to settle.
      for (let turn = 0; turn < 20; turn++) await Promise.resolve();
      expect(reads.context).toHaveBeenCalledOnce();
      expect(reads.gift).toHaveBeenCalledWith("en", "rose-palace");
      expect(reads.commerce).toHaveBeenCalledWith(
        "en",
        "rose-palace",
        "GLOBAL",
        "USD",
        undefined,
      );
      expect(reads.artists).toHaveBeenCalledWith("en", undefined);
    } finally {
      release(success);
      await pending;
    }
  },
);

test.each(["gift", "commerce"] as const)(
  "a missing %s never returns a page shell",
  async (read) => {
    reads[read].mockResolvedValue(missing);
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  },
);

test("an invalid handle never queries a gift or scoped commerce", async () => {
  await expect(render(query, "bad/handle")).rejects.toThrow("NEXT_NOT_FOUND");
  expect(reads.gift).not.toHaveBeenCalled();
  expect(reads.commerce).not.toHaveBeenCalled();
});

test.each([
  ["missing", {}],
  ["invalid empty", { market: "", currency: "" }],
] as const)("%s market never invents a scoped offer", async (_, values) => {
  await render(values);
  expect(reads.commerce).not.toHaveBeenCalled();
});

test.each(["context", "gift", "commerce", "artists"] as const)(
  "an unexpected %s rejection never returns a page shell",
  async (read) => {
    reads[read].mockRejectedValue(new Error("read unavailable"));
    await expect(render()).rejects.toThrow("read unavailable");
  },
);

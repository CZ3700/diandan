import { PassThrough } from "node:stream";
import type { ReactElement, ReactNode } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import {
  giftBrowseResponseSchema,
  giftDirectoryResponseSchema,
  storefrontContextResponseSchema,
  type StorefrontContextResponse,
} from "@fan-support/contracts";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";
import { giftBrowseFixture } from "./gift-browse-fixture";

const reads = vi.hoisted(() => ({
  context: vi.fn(),
  directory: vi.fn(),
  browse: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./storefront-page-reads", () => ({
  readCommerceContext: reads.context,
}));
vi.mock("./gift-page-reads", () => ({
  readCommerceContext: reads.context,
  giftDirectoryRead: reads.directory,
}));
vi.mock("../server/public-gift-browse", () => ({
  readGiftBrowse: reads.browse,
}));

import { GiftBrowseBody, GiftBrowseSection } from "./gift-browse-section";

const sole = storefrontContextResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "STOREFRONT_CONTEXT",
  markets: [{ market: "US", currencies: ["USD"] }],
  policies: [],
});
const pageInfo = {
  schemaVersion: 1 as const,
  page: 1,
  pageSize: 12,
  totalItems: 2,
  totalPages: 1,
  hasPreviousPage: false,
  hasNextPage: false,
  paginationLimited: false,
};
const gifts = [1, 2].map((number) => ({
  ...giftBrowseFixture("en"),
  id: `10000000-0000-4000-8000-00000000000${number}`,
  handle: `fictional-gift-${number}`,
  title: `Fictional gift ${number}`,
}));
const browse = giftBrowseResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  catalogVersion: "a".repeat(64),
  items: gifts,
  pageInfo,
});
const priced = giftDirectoryResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  catalogVersion: "a".repeat(64),
  // The priced order differs from the content order.
  items: [...gifts].reverse().map((gift, index) => ({
    schemaVersion: 1,
    gift,
    offer: {
      schemaVersion: 1,
      market: "US",
      currency: "USD",
      priceMinor: 900 + index * 100,
      purchasable: true,
    },
  })),
  pageInfo,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function stream(element: ReactElement) {
  const response = new PassThrough();
  let html = "";
  response.on("data", (chunk: Buffer) => {
    html += chunk.toString("utf8");
  });
  const errors: unknown[] = [];
  const ended = new Promise<void>((resolve) => response.once("end", resolve));
  const rendering = renderToPipeableStream(element, {
    onShellReady() {
      rendering.pipe(response);
    },
    onShellError(error) {
      errors.push(error);
      response.end();
    },
    onError(error) {
      errors.push(error);
    },
  });
  return { html: () => html, ended, errors };
}

/** The body is always rendered inside its section, never as the whole document. */
const inSection = (body: ReactNode) => <div>{body}</div>;

beforeEach(() => {
  reads.context.mockReset().mockResolvedValue(sole);
  reads.directory.mockReset().mockResolvedValue(priced);
  reads.browse.mockReset().mockResolvedValue(browse);
});

// User request 2026-09-30 (L2-17): the gift section starts at its gifts.
test.each([
  [2, "h2"],
  [1, "h1"],
] as const)(
  "the gift section has no visible title, only a level-%s name for the page outline",
  async (headingLevel, tag) => {
    const copy = await loadStorefrontCopy("zh-CN");
    const rendered = stream(
      <GiftBrowseSection
        locale="zh-CN"
        copy={copy}
        values={{}}
        basePath="/"
        headingLevel={headingLevel}
        pricing={{}}
      />,
    );
    await rendered.ended;
    const html = rendered.html();
    expect(html).toContain(
      `<${tag} id="featured-gifts-title" class="storefront-sr-only">${copy.navGifts}</${tag}>`,
    );
    expect(html).toContain('aria-labelledby="featured-gifts-title"');
    for (const gone of [copy.giftTitle, copy.giftBody, copy.giftEyebrow])
      expect(html).not.toContain(gone);
    expect(html).not.toContain("storefront-section-heading");
    // The links inside are followed in place by the navigation frame.
    expect(html).toMatch(
      /<div class="gift-navigation" data-gift-navigation="true" tabindex="-1">/u,
    );
  },
);

test("while the sole market's prices are read, the content cards hold their price line and then give way to priced cards", async () => {
  const slow = deferred<StorefrontContextResponse>();
  reads.context.mockReturnValue(slow.promise);
  const copy = await loadStorefrontCopy("en");
  const rendered = stream(
    inSection(
      await GiftBrowseBody({
        locale: "en",
        copy,
        values: {},
        basePath: "/",
        headingLevel: 2,
        pricing: {},
      }),
    ),
  );
  await vi.waitFor(
    () => expect(rendered.html()).toContain("data-gift-browse"),
    {
      timeout: 300,
    },
  );
  const first = rendered.html();
  expect(first.match(/data-gift-price-pending="true"/gu)).toHaveLength(2);
  expect(first).not.toContain("fs-price");
  expect(first).not.toContain("data-gift-sort");
  expect(first.indexOf("Fictional gift 1")).toBeLessThan(
    first.indexOf("Fictional gift 2"),
  );
  slow.resolve(sole);
  await rendered.ended;
  const settled = rendered.html().slice(first.length);
  expect(settled).toContain('data-gift-priced="true"');
  expect(settled.match(/class="fs-price"/gu)).toHaveLength(2);
  expect(settled).not.toContain("data-gift-price-pending");
  expect(settled).toContain("data-gift-sort");
});

test.each([
  { sort: "PRICE_DESC" },
  { availability: "PURCHASABLE" },
  { priceMinMinor: "100" },
  { priceMaxMinor: "900" },
])(
  "%j needs prices, so a placeholder holds the list instead of the content in another order",
  async (values) => {
    const slow = deferred<StorefrontContextResponse>();
    reads.context.mockReturnValue(slow.promise);
    const copy = await loadStorefrontCopy("en");
    const rendered = stream(
      inSection(
        await GiftBrowseBody({
          locale: "en",
          copy,
          values,
          basePath: "/",
          headingLevel: 2,
          pricing: {},
        }),
      ),
    );
    await vi.waitFor(
      () => expect(rendered.html()).toContain("data-gift-placeholder"),
      { timeout: 300 },
    );
    const first = rendered.html();
    expect(first).not.toContain("Fictional gift");
    expect(first).not.toContain("data-gift-link");
    expect(first.match(/<li class="gift-directory-card">/gu)).toHaveLength(2);
    expect(first).toContain(`role="status">${copy.loading}</p>`);
    slow.resolve(sole);
    await rendered.ended;
    const settled = rendered.html().slice(first.length);
    expect(settled.indexOf("Fictional gift 2")).toBeLessThan(
      settled.indexOf("Fictional gift 1"),
    );
    expect(settled).toContain("fs-price");
  },
);

test("the recommended order and an unfiltered availability still stream the content list first", async () => {
  const slow = deferred<StorefrontContextResponse>();
  reads.context.mockReturnValue(slow.promise);
  const copy = await loadStorefrontCopy("en");
  const rendered = stream(
    inSection(
      await GiftBrowseBody({
        locale: "en",
        copy,
        values: { sort: "RECOMMENDED", availability: "ALL", kind: "" },
        basePath: "/",
        headingLevel: 2,
        pricing: {},
      }),
    ),
  );
  await vi.waitFor(
    () => expect(rendered.html()).toContain("data-gift-browse"),
    {
      timeout: 300,
    },
  );
  expect(rendered.html()).not.toContain("data-gift-placeholder");
  expect(rendered.html()).toContain("Fictional gift 1");
  slow.resolve(sole);
  await rendered.ended;
  // An empty kind left by the older filter form no longer loses the prices.
  expect(rendered.html()).toContain("fs-price");
});

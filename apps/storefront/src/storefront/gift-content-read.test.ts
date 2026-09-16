import { beforeEach, expect, test, vi } from "vitest";
import { slugSchema } from "@fan-support/contracts";
import { parseGiftSelection } from "./gift-selection";

vi.mock("server-only", () => ({}));
const reads = vi.hoisted(() => ({
  gift: vi.fn(),
  commerce: vi.fn(),
  cacheArguments: [] as unknown[][],
}));
// Inspect the cache-key boundary only. Actual request-local deduplication is
// verified by the compiled Next acceptance fixture, not this non-RSC harness.
vi.mock("react", () => ({
  cache:
    (read: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) => {
      reads.cacheArguments.push(args);
      return read(...args);
    },
}));
vi.mock("./gift-page-reads", () => ({
  giftRead: reads.gift,
  commerceRead: reads.commerce,
}));
import { readSelectedGiftContent } from "./gift-content-read";

const handle = slugSchema.parse("published-gift");
const idol = "20000000-0000-4000-8000-000000000001";
const query = { market: "GLOBAL", currency: "USD", idol };
beforeEach(() => {
  reads.cacheArguments.length = 0;
  reads.gift.mockReset().mockResolvedValue({
    outcome: "FAILURE",
    code: "NOT_FOUND",
    schemaVersion: 1,
  });
  reads.commerce.mockReset().mockResolvedValue({
    outcome: "FAILURE",
    code: "NOT_FOUND",
    schemaVersion: 1,
  });
});

test("independently parsed page and metadata selections use identical primitive cache keys", async () => {
  await readSelectedGiftContent(
    "en",
    handle,
    parseGiftSelection({
      ...query,
      variant: "2abc0000-0000-4000-8000-000000000001",
      cart: "first-context",
    }),
  );
  await readSelectedGiftContent(
    "en",
    handle,
    parseGiftSelection({
      ...query,
      variant: "2abc0000-0000-4000-8000-000000000002",
      cart: "second-context",
    }),
  );
  expect(reads.cacheArguments).toEqual([
    ["en", handle, "GLOBAL", "USD", idol],
    ["en", handle, "GLOBAL", "USD", idol],
  ]);
});

test("locale, handle, market, currency and recipient each remain in the cache key", async () => {
  await readSelectedGiftContent("en", handle, parseGiftSelection(query));
  await readSelectedGiftContent("ja", handle, parseGiftSelection(query));
  await readSelectedGiftContent(
    "en",
    slugSchema.parse("another-gift"),
    parseGiftSelection(query),
  );
  await readSelectedGiftContent(
    "en",
    handle,
    parseGiftSelection({ ...query, market: "OTHER" }),
  );
  await readSelectedGiftContent(
    "en",
    handle,
    parseGiftSelection({ ...query, currency: "JPY" }),
  );
  await readSelectedGiftContent(
    "en",
    handle,
    parseGiftSelection({
      ...query,
      idol: "20000000-0000-4000-8000-000000000002",
    }),
  );
  expect(
    new Set(reads.cacheArguments.map((args) => JSON.stringify(args))).size,
  ).toBe(6);
  expect(
    reads.cacheArguments.every(
      (args) =>
        args.length === 5 &&
        args.every((arg) => typeof arg === "string" || arg === undefined),
    ),
  ).toBe(true);
});

test.each([
  {},
  { idol },
  { ...query, market: ["GLOBAL", "OTHER"] },
  { ...query, variant: "invalid" },
])(
  "a non-scoped selection has a consistent primitive key and no commerce request: %j",
  async (values) => {
    await readSelectedGiftContent("en", handle, parseGiftSelection(values));
    expect(reads.cacheArguments).toEqual([
      ["en", handle, undefined, undefined, undefined],
    ]);
    expect(reads.gift).toHaveBeenCalledExactlyOnceWith("en", handle);
    expect(reads.commerce).not.toHaveBeenCalled();
  },
);

import { expect, test, vi } from "vitest";
import { managementCenterClaimSchema } from "@fan-support/contracts";
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  book: vi.fn(),
  write: vi.fn(),
}));
vi.mock("./gift-commerce-pricing-data.js", () => ({
  priceContext: mocks.context,
  loadCommerceBook: mocks.book,
}));
vi.mock("./gift-commerce-pricing-write.js", () => ({
  writeCommercePrice: mocks.write,
}));
import { publishDailyGiftPrice } from "./daily-publication-price.js";
const id = "d1000000-0000-4000-8000-000000000001",
  time = "2026-09-08T00:00:00Z";
const claim = () =>
  managementCenterClaimSchema.parse({
    schemaVersion: 1,
    actorId: id,
    sessionId: id,
    requestId: id,
    operation: {
      operationId: id,
      version: 1,
      kind: "SAVE_GIFT",
      sourceLocale: "zh-CN",
      status: "PROCESSING",
      targetId: id,
      updatedAt: time,
      result: null,
      failure: null,
    },
    intent: {
      kind: "SAVE_GIFT",
      sourceLocale: "zh-CN",
      id: null,
      expectedVersion: 0,
      name: "礼物",
      description: "介绍",
      image: { uploadId: id },
      giftKind: "WISH",
      category: "OTHER",
      price: { market: "TEST", currency: "USD", amountMinor: 1234 },
      inventory: { policy: "PROCURE_ON_DEMAND" },
      eligibility: { rule: "ALL_ACTIVE_ARTISTS" },
    },
    intentHash: "a".repeat(64),
    authorizedUntil: "2026-09-08T01:00:00Z",
    leaseTokenDigest: "b".repeat(64),
    leaseExpiresAt: "2026-09-08T00:01:00Z",
    checkpoint: {
      sourceAssetId: null,
      jobs: [],
      preparedMedia: null,
      retryRequested: false,
    },
  });
test("daily price changes clone the current whole book and publish its returned immutable revision on the same client", async () => {
  const client = { query: vi.fn(), release: vi.fn() };
  mocks.context.mockResolvedValue({
    owner: { status: "ACTIVE" },
    head: { price_book_id: id, price_book_revision: 4 },
    authoringVersion: 7,
    headVersion: 3,
  });
  mocks.book.mockResolvedValue({
    book: {
      priceBookId: id,
      revision: 4,
      contentHash: "a".repeat(64),
      validFrom: "2026-09-01T00:00:00Z",
      validUntil: null,
      singleWindow: true,
    },
  });
  const base = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MUTATION",
    resultId: id,
    market: "TEST",
    currency: "USD",
    priceBookId: id,
    revision: 8,
    contentHash: "c".repeat(64),
    replayed: false,
  };
  mocks.write
    .mockResolvedValueOnce({
      ...base,
      action: "CREATE_PRICE_REVISION",
      headVersion: 3,
    })
    .mockResolvedValueOnce({
      ...base,
      action: "PUBLISH_PRICE_BOOK",
      headVersion: 4,
      publicationId: id,
    });
  expect(await publishDailyGiftPrice(client, claim(), id, time)).toEqual({
    pricePublicationId: id,
  });
  expect(mocks.write.mock.calls[0]?.[0]).toBe(client);
  expect(mocks.write.mock.calls[1]?.[0]).toBe(client);
  expect(mocks.write.mock.calls[0]?.[1].command).toMatchObject({
    source: { priceBookId: id, revision: 4, contentHash: "a".repeat(64) },
    expectedBookRevision: 7,
    expectedHeadVersion: 3,
    changes: [{ giftVariantId: id, unitAmountMinor: 1234 }],
  });
  expect(mocks.write.mock.calls[1]?.[1].command).toMatchObject({
    priceBookId: id,
    revision: 8,
    expectedContentHash: "c".repeat(64),
    expectedHeadVersion: 3,
  });
  expect(client.query).toHaveBeenCalledWith(
    "SET CONSTRAINTS public.gift_price_revision_receipt_validate IMMEDIATE",
  );
  expect(client.query.mock.invocationCallOrder[0]).toBeGreaterThan(
    mocks.write.mock.invocationCallOrder[0]!,
  );
  expect(client.query.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.write.mock.invocationCallOrder[1]!,
  );
  expect(client.query).toHaveBeenLastCalledWith(
    "SET CONSTRAINTS public.gift_price_revision_receipt_validate DEFERRED",
  );
});
test("a market without a current published source does not accidentally publish another editor's draft prices", async () => {
  mocks.write.mockClear();
  mocks.context.mockResolvedValue({
    owner: { status: "ACTIVE" },
    head: null,
    authoringVersion: 3,
    headVersion: 0,
  });
  await expect(
    publishDailyGiftPrice(
      { query: vi.fn(), release: vi.fn() },
      claim(),
      id,
      time,
    ),
  ).rejects.toThrow();
  expect(mocks.write).not.toHaveBeenCalled();
});

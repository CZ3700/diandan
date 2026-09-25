import { expect, test, vi } from "vitest";
import { createGiftCommerceUseCases } from "./gift-commerce.js";
import { giftCommerceCommandSchema } from "@fan-support/contracts";
import { PersistenceTransactionFailureError } from "@fan-support/persistence-port";

const id = "10000000-0000-4000-8000-000000000001";
const otherId = "10000000-0000-4000-8000-000000000002";
const principal = {
  schemaVersion: 1,
  actorId: id,
  sessionId: otherId,
  authorizedAt: "2026-09-06T20:00:00.000789Z",
  expiresAt: "2026-09-06T21:00:00.123456Z",
};
const create = {
  schemaVersion: 1,
  action: "CREATE_GIFT",
  handle: "studio-gift",
  expectedBaseVersion: 0,
  idempotencyKey: "create-studio-gift",
  reasonCode: "STUDIO_SETUP",
};
const success = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "MUTATION",
  action: "CREATE_GIFT",
  resultId: otherId,
  giftId: id,
  baseVersion: 1,
  replayed: false,
};
const request = (command: unknown = create) => ({
  schemaVersion: 1,
  requestId: id,
  sessionToken: "A".repeat(43),
  csrfToken: "E".repeat(43),
  command,
});
const saveContent = {
  schemaVersion: 1,
  action: "SAVE_GIFT_CONTENT",
  expectedBaseVersion: 1,
  giftKind: "WISH",
  reasonCode: "GIFT_CONTENT_EDITED",
  idempotencyKey: "save-gift-content",
  authoring: {
    schemaVersion: 1,
    action: "CREATE",
    target: { kind: "GIFT", giftId: id },
    expectedVersion: 0,
    content: {
      kind: "GIFT",
      structure: {
        category: "OTHER",
        contents: [{ componentCode: "CARD", quantity: 1, unit: "ITEM" }],
        deliveryEstimate: { minimum: 1, maximum: 2, unit: "DAY" },
        requiresSafetyNotice: false,
        shippingMode: "internal_to_idol",
      },
      media: [],
      translations: ["en", "ja"].map((locale) => ({
        locale,
        origin: "HUMAN",
        fields: {
          title: `Gift ${locale}`,
          shortDescription: `Summary ${locale}`,
          description: `Description ${locale}`,
          fulfillmentDescription: `Studio prepares ${locale}`,
          variantLabels: [
            { giftVariantId: otherId, label: `Standard ${locale}` },
          ],
          seoTitle: `Gift ${locale}`,
          seoDescription: `Description ${locale}`,
        },
      })),
    },
  },
};
const failure = (code = "FORBIDDEN") => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});

function harness() {
  const authorization = {
    authorize: vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      principal,
    })),
    context: vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      principal,
      permissions: ["commerce.read", "gift.manage"],
      localeScopes: ["en"],
    })),
  };
  const catalog = {
    read: vi.fn(async () => failure("NOT_FOUND")),
    write: vi.fn(async () => success),
    readReceipt: vi.fn(async () => success),
  };
  const pricing = {
    ...catalog,
    read: vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "COMMERCE_CONTEXT",
      markets: [],
      inventoryLocations: [],
    })),
  };
  const inventory = { ...catalog };
  const idempotency = {
    begin: vi.fn(async () => ({
      schemaVersion: 1,
      operation: "BEGIN_IDEMPOTENCY",
      outcome: "SUCCESS",
      value: { decision: "STARTED" },
    })),
    complete: vi.fn(async () => ({
      schemaVersion: 1,
      operation: "COMPLETE_IDEMPOTENCY",
      outcome: "SUCCESS",
      value: { completed: true },
    })),
  };
  const repositories = {
    authorization,
    catalog,
    pricing,
    inventory,
    idempotency,
    contentAuthorization: { authorize: vi.fn() },
    contentAuthoring: { read: vi.fn() },
  };
  const boundary = { commits: 0, rollbacks: 0 };
  const app = createGiftCommerceUseCases({
    tokenPepper: "a".repeat(64),
    transactions: {
      runInGiftCommerceTransaction: async (
        work: (value: unknown) => Promise<unknown>,
      ) => {
        try {
          const result = await work(repositories);
          boundary.commits++;
          return result;
        } catch (error) {
          boundary.rollbacks++;
          throw error;
        }
      },
    } as never,
  });
  return { app, ...repositories, boundary };
}

test.each([
  undefined,
  null,
  7,
  { toString: () => "a".repeat(64) },
  "a".repeat(63),
])(
  "invalid commerce token configuration is rejected at construction",
  (tokenPepper) => {
    expect(() =>
      createGiftCommerceUseCases({
        tokenPepper: tokenPepper as never,
        transactions: { runInGiftCommerceTransaction: vi.fn() },
      }),
    ).toThrow();
  },
);

test("a new commerce write authorizes before reserving idempotency and returns its exact receipt", async () => {
  const state = harness();
  expect(await state.app.execute(request())).toEqual(success);
  expect(state.authorization.authorize).toHaveBeenCalledWith(
    expect.objectContaining({ permission: "gift.manage", locales: [] }),
  );
  expect(
    state.authorization.authorize.mock.invocationCallOrder[0],
  ).toBeLessThan(state.idempotency.begin.mock.invocationCallOrder[0]!);
  expect(state.catalog.write).toHaveBeenCalledWith(
    expect.objectContaining({ principal, requestId: id, command: create }),
  );
  expect(state.idempotency.complete).toHaveBeenCalledWith(
    expect.objectContaining({
      safeResultReference: `result-ref:v1:${otherId}`,
    }),
  );
  expect(state.boundary).toEqual({ commits: 1, rollbacks: 0 });
});

test("content authorization checks the current scope without replacing the commerce transaction time", async () => {
  const state = harness();
  state.contentAuthorization.authorize.mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    principal: { ...principal, authorizedAt: "2026-09-06T20:00:02.000789Z" },
  });
  state.catalog.write.mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MUTATION",
    action: "SAVE_GIFT_CONTENT",
    resultId: otherId,
    giftId: id,
    giftRevisionId: otherId,
    authoringVersion: 1,
    profileHash: "a".repeat(64),
    replayed: false,
  } as never);
  expect(await state.app.execute(request(saveContent))).toMatchObject({
    outcome: "SUCCESS",
    action: "SAVE_GIFT_CONTENT",
  });
  expect(state.contentAuthorization.authorize).toHaveBeenCalledWith(
    expect.objectContaining({
      permission: "content.edit",
      locales: ["en", "ja"],
    }),
  );
  expect(
    state.contentAuthorization.authorize.mock.invocationCallOrder[0],
  ).toBeLessThan(state.idempotency.begin.mock.invocationCallOrder[0]!);
  expect(state.catalog.write).toHaveBeenCalledWith(
    expect.objectContaining({ principal }),
  );
  expect(state.idempotency.begin).toHaveBeenCalledWith(
    expect.objectContaining({ expiresAt: "2026-09-07T20:00:00.000789Z" }),
  );
});

test.each([
  [failure("FORBIDDEN"), "FORBIDDEN"],
  [
    {
      schemaVersion: 1,
      outcome: "SUCCESS",
      principal: { ...principal, actorId: otherId },
    },
    "COMMERCE_UNAVAILABLE",
  ],
])(
  "failed or mismatched content authorization still blocks commerce persistence",
  async (authorization, code) => {
    const state = harness();
    state.contentAuthorization.authorize.mockResolvedValue(authorization);
    expect(await state.app.execute(request(saveContent))).toEqual(
      failure(code as string),
    );
    expect(state.catalog.write).not.toHaveBeenCalled();
    expect(state.idempotency.begin).not.toHaveBeenCalled();
  },
);

test.each([
  [{ schemaVersion: 1, action: "CONTEXT" }, "commerce.read"],
  [
    { schemaVersion: 1, action: "READ_GIFT", giftId: id, locale: "ja" },
    "commerce.read",
  ],
  [
    {
      schemaVersion: 1,
      action: "READ_PRICES",
      market: "DEMO",
      currency: "USD",
      revision: null,
      page: 1,
      pageSize: 10,
    },
    "commerce.read",
  ],
  [
    {
      schemaVersion: 1,
      action: "READ_INVENTORY",
      giftVariantId: id,
      inventoryLocationId: null,
      view: "BALANCES",
      page: 1,
      pageSize: 10,
    },
    "commerce.read",
  ],
  [create, "gift.manage"],
  [
    {
      ...create,
      action: "SET_GIFT_STATUS",
      giftId: id,
      expectedBaseVersion: 1,
      handle: undefined,
      status: "paused",
    },
    "gift.manage",
  ],
  [
    {
      schemaVersion: 1,
      action: "CREATE_INVENTORY_LOCATION",
      code: "STUDIO_MAIN",
      expectedVersion: 0,
      idempotencyKey: "location-create-fixture",
      reasonCode: "SETUP",
    },
    "inventory.manage",
  ],
  [
    {
      schemaVersion: 1,
      action: "ADJUST_INVENTORY",
      giftVariantId: id,
      inventoryLocationId: otherId,
      expectedVariantVersion: 1,
      expectedBalanceVersion: 0,
      deltaOnHand: 3,
      idempotencyKey: "stock-adjust-fixture",
      reasonCode: "STOCK_RECEIPT",
    },
    "inventory.manage",
  ],
  [
    {
      schemaVersion: 1,
      action: "CREATE_PRICE_REVISION",
      market: "DEMO",
      currency: "USD",
      expectedBookRevision: 0,
      expectedHeadVersion: 0,
      source: null,
      validFrom: "2026-09-06T20:00:00Z",
      validUntil: null,
      changes: [{ giftVariantId: id, unitAmountMinor: 1234 }],
      idempotencyKey: "price-create-fixture",
      reasonCode: "SETUP",
    },
    "pricing.manage",
  ],
] as const)(
  "the exact permission for %j cannot be inferred from another role",
  async (input, permission) => {
    const command = giftCommerceCommandSchema.parse(
      JSON.parse(JSON.stringify(input)),
    );
    const state = harness();
    state.authorization.authorize.mockResolvedValueOnce(failure() as never);
    expect(await state.app.execute(request(command))).toMatchObject({
      code: "FORBIDDEN",
    });
    expect(state.authorization.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ permission }),
    );
    expect(state.idempotency.begin).not.toHaveBeenCalled();
    expect(state.catalog.write).not.toHaveBeenCalled();
  },
);

test("the context combines safe configuration with actual current capabilities", async () => {
  const state = harness();
  expect(
    await state.app.execute(request({ schemaVersion: 1, action: "CONTEXT" })),
  ).toEqual({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "COMMERCE_CONTEXT",
    markets: [],
    inventoryLocations: [],
    permissions: ["commerce.read", "gift.manage"],
    localeScopes: ["en"],
  });
  expect(state.idempotency.begin).not.toHaveBeenCalled();
});

test("a configuration repository cannot invent capabilities or a principal", async () => {
  const state = harness();
  state.pricing.read.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "COMMERCE_CONTEXT",
    markets: [],
    inventoryLocations: [],
    permissions: ["inventory.manage"],
  } as never);
  expect(
    await state.app.execute(request({ schemaVersion: 1, action: "CONTEXT" })),
  ).toMatchObject({ code: "COMMERCE_UNAVAILABLE" });
});

test("replay rechecks authority before retrieving a receipt or returning prior success", async () => {
  const state = harness();
  state.idempotency.begin.mockResolvedValue({
    schemaVersion: 1,
    operation: "BEGIN_IDEMPOTENCY",
    outcome: "SUCCESS",
    value: {
      decision: "REPLAY",
      safeResultReference: `result-ref:v1:${otherId}`,
    },
  } as never);
  expect(await state.app.execute(request())).toEqual({
    ...success,
    replayed: true,
  });
  expect(state.catalog.write).not.toHaveBeenCalled();
  expect(state.catalog.readReceipt).toHaveBeenCalledWith({
    schemaVersion: 1,
    resultId: otherId,
    actorId: id,
  });
  state.catalog.readReceipt.mockClear();
  state.authorization.authorize.mockResolvedValueOnce(failure() as never);
  expect(await state.app.execute(request())).toMatchObject({
    code: "FORBIDDEN",
  });
  expect(state.catalog.readReceipt).not.toHaveBeenCalled();
});

test.each(["BEGIN_IDEMPOTENCY", "COMPLETE_IDEMPOTENCY"] as const)(
  "%s concurrency failure rejects the transaction instead of committing partial commerce state",
  async (operation) => {
    const state = harness();
    state.idempotency[
      operation === "BEGIN_IDEMPOTENCY" ? "begin" : "complete"
    ].mockResolvedValueOnce({
      schemaVersion: 1,
      operation,
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "TRANSACTION_ABORTED",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 100,
      },
    } as never);
    expect(await state.app.execute(request())).toMatchObject({
      code: "CONFLICT",
    });
    expect(state.boundary).toEqual({ commits: 0, rollbacks: 1 });
  },
);

test.each([
  { ...success, baseVersion: 2 },
  { ...success, action: "SET_GIFT_STATUS" },
  { ...success, replayed: true },
] as const)(
  "a mismatched write receipt is rejected before completing idempotency",
  async (receipt) => {
    const state = harness();
    state.catalog.write.mockResolvedValueOnce(receipt as never);
    expect(await state.app.execute(request())).toMatchObject({
      code: "COMMERCE_UNAVAILABLE",
    });
    expect(state.idempotency.complete).not.toHaveBeenCalled();
    expect(state.boundary.rollbacks).toBe(1);
  },
);

test("new domain rejection codes survive transport-safe rollback", async () => {
  const state = harness();
  state.catalog.write.mockResolvedValueOnce(
    failure("INVENTORY_POLICY_LOCKED") as never,
  );
  expect(await state.app.execute(request())).toEqual(
    failure("INVENTORY_POLICY_LOCKED"),
  );
  expect(state.boundary.rollbacks).toBe(1);
});

test("SQL uniqueness failure is a safe conflict while arbitrary infrastructure text is hidden", async () => {
  const state = harness();
  state.catalog.write.mockRejectedValueOnce(
    new PersistenceTransactionFailureError({
      schemaVersion: 1,
      outcome: "FAILURE",
      operation: "RUN_TRANSACTION",
      error: { schemaVersion: 1, code: "ALREADY_EXISTS", recovery: "NONE" },
    }),
  );
  expect(await state.app.execute(request())).toMatchObject({
    code: "ALREADY_EXISTS",
  });
  state.catalog.write.mockRejectedValueOnce(
    new Error("private database connection"),
  );
  expect(await state.app.execute(request())).toEqual(
    failure("COMMERCE_UNAVAILABLE"),
  );
});

test("commerce requires its transaction manager before executing requests", () => {
  expect(() =>
    createGiftCommerceUseCases({
      tokenPepper: "a".repeat(64),
      transactions: {} as never,
    }),
  ).toThrow();
});

test.each([
  null,
  {},
  { schemaVersion: 2 },
  { schemaVersion: 1, actorId: "spoofed" },
])("malformed commerce requests never enter a transaction", async (request) => {
  const runInGiftCommerceTransaction = vi.fn();
  const app = createGiftCommerceUseCases({
    tokenPepper: "a".repeat(64),
    transactions: { runInGiftCommerceTransaction },
  });
  expect(await app.execute(request)).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "INVALID_COMMAND",
  });
  expect(runInGiftCommerceTransaction).not.toHaveBeenCalled();
});

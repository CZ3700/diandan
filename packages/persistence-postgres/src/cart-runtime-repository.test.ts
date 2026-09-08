import { expect, test, vi } from "vitest";
import {
  cartRuntimeAppendItemCommandSchema,
  cartRuntimeCredentialCommandSchema,
  cartRuntimeInitializeRecordCommandSchema,
  cartRuntimeResolveGiftCommandSchema,
} from "@fan-support/contracts";
import type { CartRuntimeRepository } from "@fan-support/persistence-port";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

const modulePath = "./cart-runtime-repository.js";
const loaded = (await import(modulePath).catch(() => ({}))) as {
  createCartRuntimeRepository?: (
    client: TransactionClient,
    scope: TransactionScopeControl,
  ) => CartRuntimeRepository;
};
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const accesses = [
  {
    schemaVersion: 1 as const,
    tokenDigest: "a".repeat(64),
    pepperVersion: "test-v1",
  },
];
const at = "2026-09-08T16:00:00.123456Z";
const row = (extra = {}) => ({
  id: id(1),
  version: "1",
  status: "ACTIVE",
  expired: false,
  presentation_locale: "en",
  market: "TEST",
  currency: "USD",
  expires_at: "2026-09-09T16:00:00.123456Z",
  created_at: at,
  updated_at: at,
  ...extra,
});
const scope: TransactionScopeControl = {
  markRollbackOnly: vi.fn(),
  trackOperation: async (work) => work(),
};
function repository(responses: unknown[][]) {
  expect(loaded.createCartRuntimeRepository).toBeTypeOf("function");
  const query = vi.fn<
    (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>
  >(async () => ({
    rows: responses.shift() ?? [],
  }));
  return {
    query,
    repo: loaded.createCartRuntimeRepository!(
      { query, release: vi.fn() },
      scope,
    ),
  };
}
const credential = () =>
  cartRuntimeCredentialCommandSchema.parse({ schemaVersion: 1, accesses });
const append = () =>
  cartRuntimeAppendItemCommandSchema.parse({
    schemaVersion: 1,
    accesses,
    cartId: id(1),
    expectedCartVersion: 1,
    cartItemId: id(2),
    supportIntentId: id(3),
    giftVariantId: id(4),
    idolId: id(5),
    quantity: 2,
    observedPriceId: id(6),
    createdPresentationLocale: "ja",
    fanMessageLocale: "und",
    displayMode: "anonymous",
    privateContent: {
      fanMessageCiphertext: null,
      displayNameCiphertext: null,
      encryptedDataKey: "enc:v1:" + "A".repeat(40),
      encryptionKeyVersion: "test-key-v1",
    },
    requestId: id(7),
    correlationId: id(8),
  });

test("initialization retains the active credential only and requires a real current commerce scope", async () => {
  const command = cartRuntimeInitializeRecordCommandSchema.parse({
    schemaVersion: 1,
    accesses: [
      ...accesses,
      {
        schemaVersion: 1,
        tokenDigest: "b".repeat(64),
        pepperVersion: "retired-v1",
      },
    ],
    cartId: id(1),
    presentationLocale: "en",
    market: "TEST",
    currency: "USD",
    expiresAt: row().expires_at,
  });
  const unavailable = repository([[], []]);
  await expect(unavailable.repo.initialize(command)).rejects.toMatchObject({
    code: "COMMERCE_UNAVAILABLE",
  });
  expect(
    unavailable.query.mock.calls.some(([sql]) =>
      sql.includes("INSERT INTO public.carts"),
    ),
  ).toBe(false);
  const valid = repository([[], [{ market: "TEST" }], [row()]]);
  expect(await valid.repo.initialize(command)).toMatchObject({
    id: id(1),
    market: "TEST",
    currency: "USD",
  });
  const write = valid.query.mock.calls.find(([sql]) =>
    sql.includes("INSERT INTO public.carts"),
  );
  expect(write?.[1]).toContain(accesses[0]!.tokenDigest);
  expect(write?.[1]).not.toContain("b".repeat(64));
});

test("initialization reuses only the same existing scope and never revives an expired cart", async () => {
  const command = cartRuntimeInitializeRecordCommandSchema.parse({
    schemaVersion: 1,
    accesses,
    cartId: id(99),
    presentationLocale: "ja",
    market: "TEST",
    currency: "USD",
    expiresAt: row().expires_at,
  });
  for (const [extra, code] of [
    [{ expired: true }, "CART_EXPIRED"],
    [{ currency: "JPY" }, "SCOPE_MISMATCH"],
  ] as const) {
    const { repo, query } = repository([[row(extra)]]);
    await expect(repo.initialize(command)).rejects.toMatchObject({ code });
    expect(query).toHaveBeenCalledTimes(1);
  }
  const { repo, query } = repository([[row()]]);
  expect(await repo.initialize(command)).toMatchObject({
    id: id(1),
    presentationLocale: "en",
  });
  expect(query).toHaveBeenCalledTimes(1);
});

test("gift resolution binds both identifiers without guessing a default variant", async () => {
  const { repo, query } = repository([[]]);
  const command = cartRuntimeResolveGiftCommandSchema.parse({
    schemaVersion: 1,
    giftId: id(3),
    giftVariantId: id(4),
  });
  expect(await repo.resolveGiftHandle(command)).toBeNull();
  expect(query.mock.calls[0]?.[1]).toEqual([id(3), id(4)]);
  expect(query.mock.calls[0]?.[0]).toContain("FOR SHARE OF gift,variant");
});

test("credential lookup retains PostgreSQL expiry and microseconds without exposing credential columns", async () => {
  const { repo, query } = repository([[row({ expired: true })]]);
  const result = await repo.findByCredentialForUpdate(
    credential() as Parameters<
      CartRuntimeRepository["findByCredentialForUpdate"]
    >[0],
  );
  expect(result).toMatchObject({
    id: id(1),
    expired: true,
    status: "ACTIVE",
    createdAt: at,
  });
  expect(result).not.toHaveProperty("tokenDigest");
  expect(query.mock.calls[0]?.[0]).toContain("clock_timestamp()");
  expect(query.mock.calls[0]?.[0]).toContain("FOR UPDATE");
});

test("ambiguous or malformed credential sets never silently select another cart", async () => {
  const ambiguous = repository([[row(), row({ id: id(9) })]]);
  await expect(
    ambiguous.repo.findByCredentialForUpdate(
      credential() as Parameters<
        CartRuntimeRepository["findByCredentialForUpdate"]
      >[0],
    ),
  ).rejects.toMatchObject({ code: "INVALID_ACCESS" });
  const invalid = repository([]);
  await expect(
    invalid.repo.findByCredentialForUpdate({ schemaVersion: 1, accesses: [] }),
  ).rejects.toMatchObject({ code: "INVALID_ACCESS" });
  expect(invalid.query).not.toHaveBeenCalled();
});

test("cart IDs alone cannot read another visitor's rows or mutation receipt", async () => {
  const { repo, query } = repository([]);
  await expect(
    repo.listItems({ schemaVersion: 1, cartId: id(1) } as Parameters<
      CartRuntimeRepository["listItems"]
    >[0]),
  ).rejects.toMatchObject({ code: "INVALID_ACCESS" });
  await expect(
    repo.findReceipt({
      schemaVersion: 1,
      cartId: id(1),
      cartItemId: id(2),
    } as Parameters<CartRuntimeRepository["findReceipt"]>[0]),
  ).rejects.toMatchObject({ code: "INVALID_ACCESS" });
  expect(query).not.toHaveBeenCalled();
});

test("safe item read preserves every persisted row without selecting any private material", async () => {
  const item = {
    id: id(2),
    cart_id: id(1),
    gift_id: id(9),
    gift_variant_id: id(4),
    idol_id: id(5),
    version: "1",
    quantity: 2,
    observed_price_id: id(6),
    display_mode: "anonymous",
    has_fan_message: false,
  };
  const { repo, query } = repository([[row()], [row()], [item]]);
  await repo.findByCredentialForUpdate(
    credential() as Parameters<
      CartRuntimeRepository["findByCredentialForUpdate"]
    >[0],
  );
  const items = await repo.listItems({
    schemaVersion: 1,
    cartId: id(1),
  } as Parameters<CartRuntimeRepository["listItems"]>[0]);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    id: id(2),
    giftId: id(9),
    idolId: id(5),
    hasFanMessage: false,
    nicknameProvided: false,
  });
  const sql = String(query.mock.calls.at(-1)?.[0]);
  expect(sql).not.toMatch(
    /ciphertext|encrypted_data_key|encryption_key_version/iu,
  );
  expect(sql).toContain("LEFT JOIN");
  expect(sql).toContain("intent.status IS DISTINCT FROM 'CANCELED'");
});

test("append refuses an expired, locked, changed or foreign cart before writing either child", async () => {
  for (const [extra, code] of [
    [{ expired: true }, "CART_EXPIRED"],
    [{ status: "LOCKED" }, "CART_LOCKED"],
    [{ version: "2" }, "IN_PROGRESS"],
    [{ id: id(10) }, "INVALID_ACCESS"],
  ] as const) {
    const { repo, query } = repository([[row(extra)]]);
    await expect(
      repo.appendItem(
        append() as Parameters<CartRuntimeRepository["appendItem"]>[0],
      ),
    ).rejects.toMatchObject({ code });
    expect(
      query.mock.calls.every(
        ([sql]) => !/\bINSERT\b|\bUPDATE public\.carts\b/u.test(String(sql)),
      ),
    ).toBe(true);
  }
});

test("anonymous empty intent stores a real wrapped key while its message and name remain null", async () => {
  const { repo, query } = repository([
    [row()],
    [{ id: id(2), version: "1", occurred_at: at }],
    [],
    [row({ version: "2", presentation_locale: "ja" })],
  ]);
  const receipt = await repo.appendItem(
    append() as Parameters<CartRuntimeRepository["appendItem"]>[0],
  );
  expect(receipt).toEqual({
    schemaVersion: 1,
    cartId: id(1),
    cartItemId: id(2),
    supportIntentId: id(3),
    cartVersion: 2,
    itemVersion: 1,
    occurredAt: at,
  });
  const intentWrite = query.mock.calls.find(([sql]) =>
    String(sql).includes("INSERT INTO public.support_intents"),
  );
  expect(intentWrite).toBeDefined();
  expect(intentWrite?.[1]).toContain(null);
  expect(intentWrite?.[1]).toContain("test-key-v1");
  expect(intentWrite?.[1]).toContainEqual(Buffer.alloc(30));
  expect(String(intentWrite?.[0])).toContain("'PENDING'");
  expect(
    query.mock.calls.some(([sql]) =>
      /inventory_(balances|ledger|reservations)/u.test(String(sql)),
    ),
  ).toBe(false);
});

test("receipt replay binds both cart and item and returns its original committed cart version", async () => {
  const { repo, query } = repository([
    [row({ version: "5" })],
    [row({ version: "5" })],
    [
      {
        cart_id: id(1),
        cart_item_id: id(2),
        support_intent_id: id(3),
        cart_version: "2",
        item_version: "1",
        occurred_at: at,
      },
    ],
  ]);
  await repo.findByCredentialForUpdate(
    credential() as Parameters<
      CartRuntimeRepository["findByCredentialForUpdate"]
    >[0],
  );
  const result = await repo.findReceipt({
    schemaVersion: 1,
    cartId: id(1),
    cartItemId: id(2),
  } as Parameters<CartRuntimeRepository["findReceipt"]>[0]);
  expect(result).toMatchObject({ cartVersion: 2, occurredAt: at });
  expect(String(query.mock.calls.at(-1)?.[0])).toContain("CART_ITEM_ADDED");
  expect(query.mock.calls.at(-1)?.[1]).toEqual([id(1), id(2)]);
});

import { Buffer } from "node:buffer";
import { expect, test, vi } from "vitest";
import {
  cartEditLoadItemCommandSchema,
  cartEditWriteMutationCommandSchema,
  cartEditFindMutationReceiptCommandSchema,
} from "@fan-support/contracts";
import type { CartEditRepository } from "@fan-support/persistence-port";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

const modulePath = "./cart-edit-repository.js";
const loaded = (await import(modulePath).catch(() => ({}))) as {
  createCartEditRepository?: (
    client: TransactionClient,
    scope: TransactionScopeControl,
  ) => CartEditRepository;
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
const cart = (extra = {}) => ({
  id: id(1),
  version: "2",
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
const item = (extra = {}) => ({
  id: id(2),
  cart_id: id(1),
  gift_id: id(3),
  gift_variant_id: id(4),
  idol_id: id(5),
  version: "1",
  quantity: 2,
  observed_price_id: id(6),
  display_mode: "anonymous",
  has_fan_message: false,
  support_intent_id: id(7),
  intent_version: "1",
  fan_message_locale: "und",
  intent_status: "ACTIVE",
  privacy_state: "ACTIVE",
  intent_expired: false,
  fan_message_ciphertext: null,
  display_name_ciphertext: null,
  encrypted_data_key: Buffer.alloc(32),
  encryption_key_version: "test-key-v1",
  ...extra,
});
const target = () =>
  cartEditLoadItemCommandSchema.parse({
    schemaVersion: 1,
    accesses,
    cartId: id(1),
    itemId: id(2),
    expectedCartVersion: 2,
    expectedItemVersion: 1,
  });
const scope: TransactionScopeControl = {
  markRollbackOnly: vi.fn(),
  trackOperation: async (work) => work(),
};
function setup(responses: unknown[][]) {
  expect(loaded.createCartEditRepository).toBeTypeOf("function");
  const query = vi.fn<
    (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>
  >(async () => ({ rows: responses.shift() ?? [] }));
  return {
    query,
    repo: loaded.createCartEditRepository!({ query, release: vi.fn() }, scope),
  };
}
test("cart edit authenticates every operation and refuses locked, expired, stale or removed targets", async () => {
  for (const [cartRow, itemRow, code] of [
    [null, null, "INVALID_ACCESS"],
    [cart({ status: "LOCKED" }), null, "CART_LOCKED"],
    [cart({ expired: true }), null, "CART_EXPIRED"],
    [cart({ version: "3" }), null, "VERSION_CONFLICT"],
    [cart(), item({ intent_status: "CANCELED" }), "CART_ITEM_REMOVED"],
    [cart(), item({ privacy_state: "PURGED" }), "CART_LOCKED"],
    [cart(), item({ version: "2" }), "VERSION_CONFLICT"],
  ] as const) {
    const { repo, query } = setup([
      cartRow ? [cartRow] : [],
      itemRow ? [itemRow] : [],
    ]);
    await expect(repo.loadItemForUpdate(target())).rejects.toMatchObject({
      code,
    });
    expect(query.mock.calls.every(([sql]) => !sql.includes("INSERT"))).toBe(
      true,
    );
  }
});
test("private editor persists a cart/item/intent bound audit before returning any ciphertext", async () => {
  const { repo, query } = setup([
    [cart()],
    [item()],
    [
      {
        access_audit_id: id(8),
        fan_message_ciphertext: null,
        display_name_ciphertext: null,
        encrypted_data_key: Buffer.alloc(32),
        encryption_key_version: "test-key-v1",
      },
    ],
  ]);
  const result = await repo.loadPrivateForEdit({
    ...target(),
    requestId: id(9),
    correlationId: id(10),
  });
  expect(result?.snapshot.intentVersion).toBe(1);
  expect(result?.accessAuditId).toBe(id(8));
  expect(query.mock.calls[2]?.[0]).toContain("cart_private_access_receipts");
  expect(query.mock.calls[2]?.[0]).toContain("audit_logs");
  expect(result?.privateContent.fanMessageCiphertext).toBeNull();
});
test("post-decryption confirmation refuses changed intent or missing exact first-transaction audit", async () => {
  for (const [intentVersion, audits] of [
    [2, [{ access_audit_id: id(8) }]],
    [1, []],
  ] as const) {
    const { repo } = setup([
      [cart()],
      [item({ intent_version: String(intentVersion) })],
      [...audits],
    ]);
    await expect(
      repo.confirmPrivateRead({
        ...target(),
        requestId: id(9),
        correlationId: id(10),
        expectedIntentVersion: 1,
        accessAuditId: id(8),
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  }
});
test("stale write rejects before any mutation; receipts authenticate the cart without requiring the historical item to remain visible", async () => {
  const write = cartEditWriteMutationCommandSchema.parse({
    ...target(),
    expectedIntentVersion: 1,
    receiptId: id(11),
    eventId: id(12),
    requestId: id(9),
    correlationId: id(10),
    presentationLocale: "ja",
    change: { kind: "REMOVE" },
  });
  const first = setup([[cart()], [item({ intent_version: "2" })]]);
  await expect(first.repo.writeMutation(write)).rejects.toMatchObject({
    code: "VERSION_CONFLICT",
  });
  expect(first.query.mock.calls.every(([sql]) => !sql.includes("INSERT"))).toBe(
    true,
  );
  const second = setup([[cart()], []]);
  expect(
    await second.repo.findMutationReceipt(
      cartEditFindMutationReceiptCommandSchema.parse({
        schemaVersion: 1,
        accesses,
        cartId: id(1),
        receiptId: id(11),
      }),
    ),
  ).toBeNull();
  expect(second.query.mock.calls[1]?.[0]).toContain(
    "cart_item_mutation_receipts",
  );
});

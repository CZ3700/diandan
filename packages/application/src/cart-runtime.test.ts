import { beforeEach, expect, test, vi } from "vitest";
import {
  cartRuntimeRequestContextSchema,
  type CartRuntimeAppendItemCommand,
  type CartRuntimeItemRecord,
} from "@fan-support/contracts";
import {
  PersistenceTransactionFailureError,
  type CartRuntimeRepositories,
  type CartRuntimeTransactionManager,
} from "@fan-support/persistence-port";
import type {
  KeyManagementPort,
  SupportIntentKeyPort,
} from "@fan-support/key-management-port";
import { fixture, id } from "./cart-runtime.test-fixtures.js";

const canonical = vi.hoisted(() => ({ readGift: vi.fn() }));
vi.mock("./storefront-commerce.js", () => ({
  createStorefrontCommerceUseCases: () => canonical,
}));
const path = "./cart-runtime.js";
const runtime = (await import(path).catch(() => ({}))) as {
  createCartRuntimeUseCases?: (deps: unknown) => {
    initialize(input: unknown, context: unknown): Promise<unknown>;
    read(input: unknown, context: unknown): Promise<unknown>;
    add(input: unknown, context: unknown): Promise<unknown>;
  };
};
beforeEach(() => canonical.readGift.mockReset());
function harness() {
  const f = fixture();
  canonical.readGift.mockResolvedValue(f.current);
  let header = f.cart;
  let inTransaction = false;
  let pending = false;
  let items: CartRuntimeItemRecord[] = [];
  let completed: { hash: string; ref: string } | null = null;
  const appended: CartRuntimeAppendItemCommand[] = [];
  const events: unknown[] = [];
  const encrypted = (operation: string, value: unknown) => ({
    schemaVersion: 1,
    operation,
    outcome: "SUCCESS",
    value,
  });
  const keyValue = {
    encryptedDataKey: "enc:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    keyVersion: "key-v1",
    algorithm: "AES_256_GCM",
  };
  const keyManagement = {
    generateSupportIntentKey: vi.fn(async () => {
      expect(inTransaction).toBe(false);
      expect(pending).toBe(false);
      return encrypted("GENERATE_SUPPORT_INTENT_KEY", keyValue);
    }),
    encryptEnvelope: vi.fn(async () => {
      expect(inTransaction).toBe(false);
      expect(pending).toBe(false);
      return encrypted("ENCRYPT_ENVELOPE", {
        ...keyValue,
        ciphertext: "enc:v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      });
    }),
    encryptEnvelopeFields: vi.fn(async () => {
      expect(inTransaction).toBe(false);
      expect(pending).toBe(false);
      return encrypted("ENCRYPT_ENVELOPE_FIELDS", {
        ...keyValue,
        fields: [
          {
            purpose: "SUPPORT_INTENT_MESSAGE",
            ciphertext: "enc:v1:ccccccccccccccccccccccccccccccccccccccccccc",
          },
          {
            purpose: "SUPPORT_INTENT_DISPLAY_NAME",
            ciphertext: "enc:v1:ddddddddddddddddddddddddddddddddddddddddddd",
          },
        ],
      });
    }),
    decryptEnvelope: vi.fn(),
    computeBlindIndex: vi.fn(),
  } as unknown as KeyManagementPort & SupportIntentKeyPort;
  const success = (operation: string, value: unknown) => ({
    schemaVersion: 1,
    operation,
    outcome: "SUCCESS",
    value,
  });
  const repositories = {
    cartRuntime: {
      initialize: vi.fn(async () => header),
      findByCredentialForUpdate: vi.fn(async () => header),
      listItems: vi.fn(async () => items),
      resolveGiftHandle: vi.fn(async () => ({
        schemaVersion: 1,
        giftId: f.command.giftId,
        handle: "test-gift",
      })),
      appendItem: vi.fn(async (command: CartRuntimeAppendItemCommand) => {
        appended.push(command);
        header = {
          ...header,
          version: header.version + 1,
          presentationLocale: command.createdPresentationLocale,
        };
        items.push({
          ...f.item,
          id: command.cartItemId,
          displayMode: command.displayMode,
          nicknameProvided:
            command.privateContent.displayNameCiphertext !== null,
          hasFanMessage: command.privateContent.fanMessageCiphertext !== null,
        });
        return {
          schemaVersion: 1,
          cartId: header.id,
          cartItemId: command.cartItemId,
          supportIntentId: command.supportIntentId,
          cartVersion: header.version,
          itemVersion: 1,
          occurredAt: "2026-09-08T00:00:00.123Z",
        };
      }),
      findReceipt: vi.fn(async ({ cartItemId }: { cartItemId: string }) =>
        items.some((item) => item.id === cartItemId)
          ? {
              schemaVersion: 1,
              cartId: header.id,
              cartItemId,
              supportIntentId: appended[0]!.supportIntentId,
              cartVersion: header.version,
              itemVersion: 1,
              occurredAt: "2026-09-08T00:00:00.123Z",
            }
          : null,
      ),
    },
    storefrontCommerce: {},
    idempotency: {
      begin: vi.fn(
        async ({ canonicalRequestHash }: { canonicalRequestHash: string }) => {
          if (completed)
            return success(
              "BEGIN_IDEMPOTENCY",
              completed.hash === canonicalRequestHash
                ? { decision: "REPLAY", safeResultReference: completed.ref }
                : { decision: "CONFLICT" },
            );
          if (pending)
            return success("BEGIN_IDEMPOTENCY", { decision: "IN_PROGRESS" });
          pending = true;
          return success("BEGIN_IDEMPOTENCY", { decision: "STARTED" });
        },
      ),
      complete: vi.fn(
        async ({
          canonicalRequestHash,
          safeResultReference,
        }: {
          canonicalRequestHash: string;
          safeResultReference: string;
        }) => {
          pending = false;
          completed = { hash: canonicalRequestHash, ref: safeResultReference };
          return success("COMPLETE_IDEMPOTENCY", { completed: true });
        },
      ),
    },
    outbox: {
      append: vi.fn(async (command: { event: { eventId: string } }) => {
        events.push(command);
        return success("APPEND_OUTBOX_EVENT", {
          appended: true,
          eventId: command.event.eventId,
        });
      }),
    },
  };
  const transactions: CartRuntimeTransactionManager = {
    async runInCartRuntimeTransaction(work) {
      const original = {
        header,
        items: [...items],
        completed,
        pending,
        eventCount: events.length,
      };
      inTransaction = true;
      try {
        return await work(repositories as unknown as CartRuntimeRepositories);
      } catch (error) {
        header = original.header;
        items = original.items;
        completed = original.completed;
        pending = original.pending;
        events.splice(original.eventCount);
        throw error;
      } finally {
        inTransaction = false;
      }
    },
  };
  const context = cartRuntimeRequestContextSchema.parse({
    schemaVersion: 1,
    accesses: [
      {
        schemaVersion: 1,
        tokenDigest: "a".repeat(64),
        pepperVersion: "key-v1",
      },
    ],
    requestId: id(40),
    correlationId: id(41),
    idempotencyKey: "cart-test-add-0001",
  });
  expect(runtime.createCartRuntimeUseCases).toBeTypeOf("function");
  const app = runtime.createCartRuntimeUseCases!({
    transactions,
    keyManagement,
    now: () => new Date("2026-09-08T00:00:00Z"),
  });
  return {
    f,
    context,
    app,
    repositories,
    keyManagement,
    appended,
    events,
    transactions,
    count: () => items.length,
  };
}
test("lost add response replays one item, intent and outbox without storing raw private text", async () => {
  const h = harness();
  const command = {
    ...h.f.command,
    displayMode: "nickname",
    displayName: "PRIVATE-NAME",
    fanMessage: "PRIVATE-MESSAGE",
  };
  expect(await h.app.add(command, h.context)).toMatchObject({
    outcome: "SUCCESS",
    action: "ADDED",
  });
  const replay = await h.app.add(command, h.context);
  expect(replay).toMatchObject({ outcome: "SUCCESS", action: "REPLAYED" });
  expect(h.count()).toBe(1);
  expect(h.events).toHaveLength(1);
  expect(h.appended).toHaveLength(1);
  expect(JSON.stringify([replay, h.events, h.appended])).not.toMatch(
    /PRIVATE-NAME|PRIVATE-MESSAGE/,
  );
  expect(h.appended[0]?.privateContent).toMatchObject({
    fanMessageCiphertext: "enc:v1:ccccccccccccccccccccccccccccccccccccccccccc",
    displayNameCiphertext: "enc:v1:ddddddddddddddddddddddddddddddddddddddddddd",
  });
  expect(h.events[0]).toMatchObject({
    event: { occurredAt: "2026-09-08T00:00:00.123Z" },
    aggregateVersion: 2,
  });
  expect(
    await h.app.add({ ...command, fanMessage: "different" }, h.context),
  ).toMatchObject({ outcome: "FAILURE", code: "IDEMPOTENCY_CONFLICT" });
});
test("anonymous empty intent uses wrapped key without a fictional message", async () => {
  const h = harness();
  expect(await h.app.add(h.f.command, h.context)).toMatchObject({
    outcome: "SUCCESS",
  });
  expect(h.keyManagement.generateSupportIntentKey).toHaveBeenCalledOnce();
  expect(h.keyManagement.encryptEnvelope).not.toHaveBeenCalled();
  expect(h.appended[0]?.privateContent).toMatchObject({
    fanMessageCiphertext: null,
    displayNameCiphertext: null,
  });
});

test("a completed add replays without a new encryption operation", async () => {
  const h = harness();
  expect(await h.app.add(h.f.command, h.context)).toMatchObject({
    action: "ADDED",
  });
  vi.mocked(h.keyManagement.generateSupportIntentKey).mockRejectedValue(
    new Error("KMS encryption unavailable"),
  );
  expect(await h.app.add(h.f.command, h.context)).toMatchObject({
    action: "REPLAYED",
  });
  expect(h.keyManagement.generateSupportIntentKey).toHaveBeenCalledOnce();
  expect(h.count()).toBe(1);
});
test("auth, expiry and invalid command stop before KMS or idempotency writes", async () => {
  const h = harness();
  h.repositories.cartRuntime.findByCredentialForUpdate.mockResolvedValueOnce(
    null as never,
  );
  expect(await h.app.add(h.f.command, h.context)).toMatchObject({
    code: "CART_NOT_FOUND",
  });
  h.repositories.cartRuntime.findByCredentialForUpdate.mockResolvedValueOnce({
    ...h.f.cart,
    expired: true,
  });
  expect(await h.app.add(h.f.command, h.context)).toMatchObject({
    code: "CART_EXPIRED",
  });
  expect(
    await h.app.add({ ...h.f.command, quantity: 0 }, h.context),
  ).toMatchObject({ code: "INVALID_COMMAND" });
  expect(h.keyManagement.generateSupportIntentKey).not.toHaveBeenCalled();
  expect(h.repositories.idempotency.begin).not.toHaveBeenCalled();
});
test("outbox failure rolls back item, intent and claim; the exact request can then succeed", async () => {
  const h = harness();
  h.repositories.outbox.append.mockRejectedValueOnce(
    new Error("PRIVATE-DB-ERROR"),
  );
  expect(await h.app.add(h.f.command, h.context)).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "TEMPORARY_UNAVAILABLE",
  });
  expect(h.count()).toBe(0);
  expect(h.events).toHaveLength(0);
  expect(await h.app.add(h.f.command, h.context)).toMatchObject({
    action: "ADDED",
  });
  expect(h.count()).toBe(1);
});
test("price changes roll back and do not quietly replace the observed price", async () => {
  const h = harness();
  expect(
    await h.app.add({ ...h.f.command, observedPriceId: id(91) }, h.context),
  ).toMatchObject({ code: "PRICE_CHANGED" });
  expect(h.count()).toBe(0);
  expect(h.events).toHaveLength(0);
});
test("ambiguous commit retains reconciliation status instead of claiming definite failure", async () => {
  const h = harness();
  vi.spyOn(h.transactions, "runInCartRuntimeTransaction").mockRejectedValueOnce(
    new PersistenceTransactionFailureError({
      schemaVersion: 1,
      operation: "RUN_TRANSACTION",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "TRANSACTION_OUTCOME_UNKNOWN",
        recovery: "RECONCILE_REQUIRED",
      },
    }),
  );
  expect(await h.app.add(h.f.command, h.context)).toMatchObject({
    code: "TRANSACTION_OUTCOME_UNKNOWN",
  });
});

test("replaying an add after its item was removed never revives the line", async () => {
  const h = harness();
  expect(await h.app.add(h.f.command, h.context)).toMatchObject({
    action: "ADDED",
  });
  h.repositories.cartRuntime.listItems.mockResolvedValue([]);
  expect(await h.app.add(h.f.command, h.context)).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CART_ITEM_REMOVED",
  });
  expect(h.appended).toHaveLength(1);
  expect(h.keyManagement.generateSupportIntentKey).toHaveBeenCalledOnce();
});

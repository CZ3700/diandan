import { Buffer } from "node:buffer";
import { beforeEach, expect, test, vi } from "vitest";
import {
  cartRuntimeRequestContextSchema,
  type CartEditWriteMutationCommand,
  type CartEditMutationReceipt,
} from "@fan-support/contracts";
import {
  CartEditRepositoryError,
  PersistenceTransactionFailureError,
  type CartEditRepositories,
  type CartEditTransactionManager,
} from "@fan-support/persistence-port";
import type {
  KeyManagementPort,
  SupportIntentKeyPort,
} from "@fan-support/key-management-port";
import { fixture, id } from "./cart-runtime.test-fixtures.js";
const current = vi.hoisted(() => ({ readGift: vi.fn() }));
vi.mock("./storefront-commerce.js", () => ({
  createStorefrontCommerceUseCases: () => current,
}));
const path = "./cart-edit.js";
const module = (await import(path).catch(() => ({}))) as {
  createCartEditUseCases?: (deps: {
    transactions: CartEditTransactionManager;
    keyManagement: KeyManagementPort & SupportIntentKeyPort;
  }) => {
    update(input: unknown, context: unknown): Promise<unknown>;
    remove(input: unknown, context: unknown): Promise<unknown>;
    readEditor(input: unknown, context: unknown): Promise<unknown>;
  };
};
beforeEach(() => current.readGift.mockReset());
const wrapped = "enc:v1:" + "a".repeat(43);
const ciphertext = "enc:v1:" + "b".repeat(43);
const privateMessage = () => ["test", "private", "message"].join("-");
const privateName = () => ["test", "private", "name"].join("-");
const success = (operation: string, value: unknown) => ({
  schemaVersion: 1,
  operation,
  outcome: "SUCCESS",
  value,
});
function harness() {
  const f = fixture();
  let state = {
    cart: f.cart,
    item: f.item,
    intentVersion: 1,
    removed: false,
    fanMessageLocale: "und",
    audits: 0,
    privateContent: {
      fanMessageCiphertext: null as string | null,
      displayNameCiphertext: null as string | null,
      encryptedDataKey: wrapped,
      encryptionKeyVersion: "key-v1",
    },
    receipts: [] as CartEditMutationReceipt[],
    claims: {} as Record<string, { hash: string; ref?: string }>,
  };
  let inTransaction = false;
  let afterDecrypt = () => {};
  current.readGift.mockResolvedValue(f.current);
  const snapshot = () => ({
    schemaVersion: 1 as const,
    cart: state.cart,
    item: state.item,
    supportIntentId: id(60),
    intentVersion: state.intentVersion,
    fanMessageLocale: state.fanMessageLocale,
  });
  const load = vi.fn(
    async (command: {
      itemId: string;
      expectedCartVersion: number;
      expectedItemVersion: number;
    }) => {
      if (state.removed || command.itemId !== state.item.id) return null;
      if (
        command.expectedCartVersion !== state.cart.version ||
        command.expectedItemVersion !== state.item.version
      )
        throw new CartEditRepositoryError("VERSION_CONFLICT");
      return snapshot();
    },
  );
  const repositories = {
    cartRuntime: {
      findByCredentialForUpdate: vi.fn(async () => state.cart),
      listItems: vi.fn(async () => (state.removed ? [] : [state.item])),
      resolveGiftHandle: vi.fn(async () => ({
        schemaVersion: 1,
        giftId: f.command.giftId,
        handle: "test-gift",
      })),
    },
    cartEdit: {
      loadItemForUpdate: load,
      loadPrivateForEdit: vi.fn(async (command: Parameters<typeof load>[0]) => {
        const loaded = await load(command);
        if (!loaded) return null;
        state.audits++;
        return {
          schemaVersion: 1,
          snapshot: loaded,
          accessAuditId: id(70),
          privateContent: state.privateContent,
        };
      }),
      confirmPrivateRead: vi.fn(
        async (
          command: Parameters<typeof load>[0] & {
            expectedIntentVersion: number;
          },
        ) => {
          if (state.cart.expired)
            throw new CartEditRepositoryError("CART_EXPIRED");
          if (command.expectedIntentVersion !== state.intentVersion)
            throw new CartEditRepositoryError("VERSION_CONFLICT");
          return load(command);
        },
      ),
      writeMutation: vi.fn(async (command: CartEditWriteMutationCommand) => {
        state.cart = {
          ...state.cart,
          version: state.cart.version + 1,
          presentationLocale: command.presentationLocale,
        };
        state.item = { ...state.item, version: state.item.version + 1 };
        if (command.change.kind === "QUANTITY")
          state.item = {
            ...state.item,
            quantity: command.change.quantity,
            observedPriceId: command.change.observedPriceId,
          };
        else {
          state.intentVersion++;
          if (command.change.kind === "REMOVE") state.removed = true;
          else {
            state.privateContent = command.change.privateContent;
            state.fanMessageLocale = command.change.fanMessageLocale;
            state.item = {
              ...state.item,
              displayMode: command.change.displayMode,
              hasFanMessage:
                command.change.privateContent.fanMessageCiphertext !== null,
              nicknameProvided:
                command.change.privateContent.displayNameCiphertext !== null,
            };
          }
        }
        const receipt: CartEditMutationReceipt = {
          schemaVersion: 1,
          receiptId: command.receiptId,
          cartId: state.cart.id,
          cartItemId: state.item.id,
          supportIntentId: id(60) as CartEditMutationReceipt["supportIntentId"],
          mutationKind: command.change.kind,
          cartVersion: state.cart.version,
          itemVersion: state.item.version,
          intentVersion: state.intentVersion,
          occurredAt: "2026-09-08T00:00:00.000123Z",
        };
        state.receipts.push(receipt);
        return receipt;
      }),
      findMutationReceipt: vi.fn(
        async ({ receiptId }: { receiptId: string }) =>
          state.receipts.find((r) => r.receiptId === receiptId) ?? null,
      ),
    },
    storefrontCommerce: {},
    idempotency: {
      begin: vi.fn(
        async (c: {
          idempotencyOperation: string;
          idempotencyKey: string;
          canonicalRequestHash: string;
        }) => {
          const key = c.idempotencyOperation + c.idempotencyKey;
          const old = state.claims[key];
          if (old)
            return success(
              "BEGIN_IDEMPOTENCY",
              old.hash !== c.canonicalRequestHash
                ? { decision: "CONFLICT" }
                : old.ref
                  ? { decision: "REPLAY", safeResultReference: old.ref }
                  : { decision: "IN_PROGRESS" },
            );
          state.claims[key] = { hash: c.canonicalRequestHash };
          return success("BEGIN_IDEMPOTENCY", { decision: "STARTED" });
        },
      ),
      complete: vi.fn(
        async (c: {
          idempotencyOperation: string;
          idempotencyKey: string;
          canonicalRequestHash: string;
          safeResultReference: string;
        }) => {
          state.claims[c.idempotencyOperation + c.idempotencyKey] = {
            hash: c.canonicalRequestHash,
            ref: c.safeResultReference,
          };
          return success("COMPLETE_IDEMPOTENCY", { completed: true });
        },
      ),
    },
    outbox: {},
  };
  const assertOutside = () => {
    expect(inTransaction).toBe(false);
    expect(Object.values(state.claims).every((c) => c.ref !== undefined)).toBe(
      true,
    );
  };
  const keyValue = {
    encryptedDataKey: wrapped,
    keyVersion: "key-v1",
    algorithm: "AES_256_GCM",
  };
  const keys = {
    generateSupportIntentKey: vi.fn(async () => {
      assertOutside();
      return success("GENERATE_SUPPORT_INTENT_KEY", keyValue);
    }),
    encryptEnvelope: vi.fn(async () => {
      assertOutside();
      return success("ENCRYPT_ENVELOPE", { ...keyValue, ciphertext });
    }),
    encryptEnvelopeFields: vi.fn(async () => {
      assertOutside();
      return success("ENCRYPT_ENVELOPE_FIELDS", {
        ...keyValue,
        fields: [
          { purpose: "SUPPORT_INTENT_MESSAGE", ciphertext },
          { purpose: "SUPPORT_INTENT_DISPLAY_NAME", ciphertext },
        ],
      });
    }),
    decryptEnvelope: vi.fn(async (c: { purpose: string }) => {
      expect(inTransaction).toBe(false);
      expect(state.audits).toBeGreaterThan(0);
      afterDecrypt();
      return success("DECRYPT_ENVELOPE", {
        plaintextBase64: Buffer.from(
          c.purpose === "SUPPORT_INTENT_MESSAGE"
            ? privateMessage()
            : privateName(),
        ).toString("base64url"),
      });
    }),
    computeBlindIndex: vi.fn(),
  } as unknown as KeyManagementPort & SupportIntentKeyPort;
  const transactions: CartEditTransactionManager = {
    async runInCartEditTransaction(work) {
      const prior = structuredClone(state);
      inTransaction = true;
      try {
        return await work(repositories as unknown as CartEditRepositories);
      } catch (error) {
        state = prior;
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
    idempotencyKey: "cart-edit-test-0001",
  });
  const target = {
    schemaVersion: 1,
    itemId: f.item.id,
    expectedCartVersion: 1,
    expectedItemVersion: 1,
    presentationLocale: "en",
  };
  const quantity = {
    ...target,
    operation: "UPDATE_CART_ITEM",
    change: {
      kind: "QUANTITY",
      quantity: 3,
      observedPriceId: f.command.observedPriceId,
    },
  };
  expect(module.createCartEditUseCases).toBeTypeOf("function");
  const app = module.createCartEditUseCases!({
    transactions,
    keyManagement: keys,
  });
  return {
    app,
    f,
    target,
    quantity,
    context,
    repositories,
    keys,
    transactions,
    state: () => state,
    afterDecrypt: (callback: () => void) => {
      afterDecrypt = callback;
    },
  };
}
test("quantity commits one version transition and same-key replay accepts original versions", async () => {
  const h = harness();
  expect(await h.app.update(h.quantity, h.context)).toMatchObject({
    action: "UPDATED",
    cart: { version: 2, items: [{ quantity: 3, version: 2 }] },
  });
  expect(await h.app.update(h.quantity, h.context)).toMatchObject({
    action: "REPLAYED",
  });
  expect(h.state().receipts).toHaveLength(1);
  expect(h.keys.generateSupportIntentKey).not.toHaveBeenCalled();
  expect(
    await h.app.update(
      { ...h.quantity, change: { ...h.quantity.change, quantity: 4 } },
      h.context,
    ),
  ).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
});
test("removal retains receipt and replay succeeds with the line absent", async () => {
  const h = harness();
  const command = { ...h.target, operation: "REMOVE_CART_ITEM" };
  expect(await h.app.remove(command, h.context)).toMatchObject({
    action: "REMOVED",
    cart: { items: [] },
  });
  expect(await h.app.remove(command, h.context)).toMatchObject({
    action: "REPLAYED",
    cart: { items: [] },
  });
  expect(h.state().receipts).toHaveLength(1);
});
test("stale versions, foreign item and changed price leave the cart untouched", async () => {
  const h = harness();
  expect(
    await h.app.update({ ...h.quantity, expectedItemVersion: 9 }, h.context),
  ).toMatchObject({ code: "VERSION_CONFLICT" });
  expect(
    await h.app.remove(
      { ...h.target, itemId: id(99), operation: "REMOVE_CART_ITEM" },
      h.context,
    ),
  ).toMatchObject({ code: "ITEM_NOT_FOUND" });
  expect(
    await h.app.update(
      {
        ...h.quantity,
        change: { ...h.quantity.change, observedPriceId: id(99) },
      },
      h.context,
    ),
  ).toMatchObject({ code: "PRICE_CHANGED" });
  expect(h.state().cart.version).toBe(1);
  expect(h.state().receipts).toHaveLength(0);
});
test("personalization encrypts outside the transaction and ordinary response contains no private fields", async () => {
  const h = harness();
  const command = {
    ...h.target,
    operation: "UPDATE_CART_ITEM",
    change: {
      kind: "PERSONALIZATION",
      displayMode: "nickname",
      displayName: privateName(),
      fanMessage: privateMessage(),
      fanMessageLocale: "ja",
    },
  };
  const result = await h.app.update(command, h.context);
  expect(result).toMatchObject({
    action: "UPDATED",
    cart: { items: [{ hasFanMessage: true, nicknameProvided: true }] },
  });
  expect(
    JSON.stringify([result, h.state().receipts, h.state().claims]),
  ).not.toContain(privateMessage());
  expect(
    JSON.stringify([result, h.state().receipts, h.state().claims]),
  ).not.toContain(privateName());
  expect(await h.app.update(command, h.context)).toMatchObject({
    action: "REPLAYED",
  });
  expect(h.keys.encryptEnvelopeFields).toHaveBeenCalledOnce();
});
test("private read is audited before decryption and reauthorized before returning editor contents", async () => {
  const h = harness();
  h.state().privateContent.fanMessageCiphertext = ciphertext;
  h.state().item.hasFanMessage = true;
  const result = await h.app.readEditor(
    { ...h.target, operation: "READ_CART_ITEM_EDITOR" },
    h.context,
  );
  expect(result).toMatchObject({
    action: "EDITOR_READ",
    content: { fanMessage: privateMessage() },
  });
  expect(h.state().audits).toBe(1);
  expect(h.repositories.cartEdit.confirmPrivateRead).toHaveBeenCalledOnce();
});
test("private read refuses a cart that expires during KMS decryption", async () => {
  const h = harness();
  h.state().privateContent.fanMessageCiphertext = ciphertext;
  h.state().item.hasFanMessage = true;
  h.afterDecrypt(() => {
    h.state().cart.expired = true;
  });
  const result = await h.app.readEditor(
    { ...h.target, operation: "READ_CART_ITEM_EDITOR" },
    h.context,
  );
  expect(result).toMatchObject({ code: "CART_EXPIRED" });
  expect(JSON.stringify(result)).not.toContain(privateMessage());
});
test("write failure rolls back the item and claim so an exact explicit retry can succeed", async () => {
  const h = harness();
  h.repositories.idempotency.complete.mockRejectedValueOnce(
    new Error("private failure"),
  );
  expect(await h.app.update(h.quantity, h.context)).toMatchObject({
    code: "TEMPORARY_UNAVAILABLE",
  });
  expect(h.state().cart.version).toBe(1);
  expect(h.state().receipts).toHaveLength(0);
  expect(await h.app.update(h.quantity, h.context)).toMatchObject({
    action: "UPDATED",
  });
});
test.each(["QUANTITY", "PERSONALIZATION", "REMOVE"] as const)(
  "%s refuses a receipt with an inconsistent intent version and rolls back",
  async (kind) => {
    const h = harness();
    const write =
      h.repositories.cartEdit.writeMutation.getMockImplementation()!;
    h.repositories.cartEdit.writeMutation.mockImplementationOnce(
      async (command) => ({
        ...(await write(command)),
        intentVersion: 99,
      }),
    );
    const command =
      kind === "REMOVE"
        ? { ...h.target, operation: "REMOVE_CART_ITEM" }
        : kind === "QUANTITY"
          ? h.quantity
          : {
              ...h.target,
              operation: "UPDATE_CART_ITEM",
              change: {
                kind,
                displayMode: "anonymous",
                fanMessageLocale: "und",
              },
            };
    const result =
      kind === "REMOVE"
        ? await h.app.remove(command, h.context)
        : await h.app.update(command, h.context);
    expect(result).toMatchObject({
      outcome: "FAILURE",
      code: "TEMPORARY_UNAVAILABLE",
    });
    expect(h.state().cart.version).toBe(1);
    expect(h.state().receipts).toHaveLength(0);
  },
);
test("uncertain commit is not automatically repeated or misreported as a definite failure", async () => {
  const h = harness();
  const run = vi
    .spyOn(h.transactions, "runInCartEditTransaction")
    .mockRejectedValueOnce(
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
  expect(await h.app.update(h.quantity, h.context)).toMatchObject({
    code: "TRANSACTION_OUTCOME_UNKNOWN",
  });
  expect(run).toHaveBeenCalledOnce();
});

test("invalid access and locked carts stop before any private read or encryption", async () => {
  const h = harness();
  expect(await h.app.update(h.quantity, {})).toMatchObject({
    code: "INVALID_ACCESS",
  });
  h.repositories.cartRuntime.findByCredentialForUpdate.mockResolvedValueOnce(
    null as never,
  );
  expect(
    await h.app.readEditor(
      { ...h.target, operation: "READ_CART_ITEM_EDITOR" },
      h.context,
    ),
  ).toMatchObject({ code: "CART_NOT_FOUND" });
  h.repositories.cartRuntime.findByCredentialForUpdate.mockResolvedValueOnce({
    ...h.f.cart,
    status: "LOCKED",
  });
  expect(
    await h.app.remove(
      { ...h.target, operation: "REMOVE_CART_ITEM" },
      h.context,
    ),
  ).toMatchObject({ code: "CART_LOCKED" });
  expect(h.repositories.cartEdit.loadPrivateForEdit).not.toHaveBeenCalled();
  expect(h.keys.decryptEnvelope).not.toHaveBeenCalled();
});
test("clearing personalization keeps a real wrapped key and does not create fictional private text", async () => {
  const h = harness();
  h.state().privateContent = {
    ...h.state().privateContent,
    fanMessageCiphertext: ciphertext,
    displayNameCiphertext: ciphertext,
  };
  h.state().item = {
    ...h.state().item,
    hasFanMessage: true,
    nicknameProvided: true,
    displayMode: "nickname",
  };
  expect(
    await h.app.update(
      {
        ...h.target,
        operation: "UPDATE_CART_ITEM",
        change: {
          kind: "PERSONALIZATION",
          displayMode: "anonymous",
          fanMessageLocale: "und",
        },
      },
      h.context,
    ),
  ).toMatchObject({
    action: "UPDATED",
    cart: {
      items: [
        {
          displayMode: "anonymous",
          hasFanMessage: false,
          nicknameProvided: false,
        },
      ],
    },
  });
  expect(h.keys.generateSupportIntentKey).toHaveBeenCalledOnce();
  expect(h.state().privateContent).toMatchObject({
    fanMessageCiphertext: null,
    displayNameCiphertext: null,
    encryptedDataKey: wrapped,
  });
});
test("an update replay returns current state after a later legitimate edit", async () => {
  const h = harness();
  expect(await h.app.update(h.quantity, h.context)).toMatchObject({
    action: "UPDATED",
  });
  const second = {
    ...h.quantity,
    expectedCartVersion: 2,
    expectedItemVersion: 2,
    change: { ...h.quantity.change, quantity: 4 },
  };
  expect(
    await h.app.update(second, {
      ...h.context,
      idempotencyKey: "cart-edit-test-0002",
    }),
  ).toMatchObject({ action: "UPDATED" });
  expect(await h.app.update(h.quantity, h.context)).toMatchObject({
    action: "REPLAYED",
    cart: { version: 3, items: [{ quantity: 4, version: 3 }] },
  });
  expect(h.state().receipts).toHaveLength(2);
});
test("a private edit that changed while decrypting cannot return stale private content", async () => {
  const h = harness();
  h.state().privateContent.fanMessageCiphertext = ciphertext;
  h.state().item.hasFanMessage = true;
  h.afterDecrypt(() => {
    h.state().intentVersion++;
  });
  const result = await h.app.readEditor(
    { ...h.target, operation: "READ_CART_ITEM_EDITOR" },
    h.context,
  );
  expect(result).toMatchObject({ code: "VERSION_CONFLICT" });
  expect(JSON.stringify(result)).not.toContain(privateMessage());
});
test("invalid encrypted bytes are not silently converted into replacement-character text", async () => {
  const h = harness();
  h.state().privateContent.fanMessageCiphertext = ciphertext;
  h.state().item.hasFanMessage = true;
  vi.mocked(h.keys.decryptEnvelope).mockResolvedValueOnce(
    success("DECRYPT_ENVELOPE", {
      plaintextBase64: Buffer.from([0xff]).toString("base64url"),
    }) as never,
  );
  expect(
    await h.app.readEditor(
      { ...h.target, operation: "READ_CART_ITEM_EDITOR" },
      h.context,
    ),
  ).toMatchObject({ code: "TEMPORARY_UNAVAILABLE" });
  expect(h.repositories.cartEdit.confirmPrivateRead).not.toHaveBeenCalled();
});

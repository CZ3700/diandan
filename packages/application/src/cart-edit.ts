import { randomUUID } from "node:crypto";
import {
  cartEditUpdateCommandSchema,
  cartEditRemoveCommandSchema,
  cartEditorReadCommandSchema,
  cartEditItemSnapshotSchema,
  cartEditPrivateSnapshotSchema,
  cartEditMutationReceiptSchema,
  cartEditResponseSchema,
  cartEditorResponseSchema,
  cartRuntimeRequestContextSchema,
  type CartEditItemSnapshot,
  type CartEditPrivateSnapshot,
  type CartEditWriteMutationCommand,
  type CartRuntimeRequestContext,
  type CartRuntimeHeader,
  type CartEditResponse,
  type CartEditorResponse,
} from "@fan-support/contracts";
import { decideCartRuntimeAdd } from "@fan-support/cart";
import type {
  KeyManagementPort,
  SupportIntentKeyPort,
} from "@fan-support/key-management-port";
import type {
  CartEditRepositories,
  CartEditTransactionManager,
} from "@fan-support/persistence-port";
import {
  beginCartEdit,
  mutationKind,
  type CartMutationCommand,
} from "./cart-edit-idempotency.js";
import {
  authenticateCartEdit,
  cartEditFailure,
  cartEditPersistenceSuccess,
  cartEditTransactions,
  rejectCartEdit,
  withCartEditFailure,
} from "./cart-edit-transaction.js";
import {
  readCartRuntimeGift,
  readCartRuntimeView,
} from "./cart-runtime-view.js";
import { encryptCartRuntimeIntent } from "./cart-runtime-private.js";
import { decryptCartEditor } from "./cart-editor-private.js";

const same = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();
function target(
  command: Pick<
    CartMutationCommand,
    "itemId" | "expectedCartVersion" | "expectedItemVersion"
  >,
  cart: CartRuntimeHeader,
  context: CartRuntimeRequestContext,
) {
  return {
    schemaVersion: 1 as const,
    accesses: context.accesses,
    cartId: cart.id,
    itemId: command.itemId,
    expectedCartVersion: command.expectedCartVersion,
    expectedItemVersion: command.expectedItemVersion,
  };
}
function requireSnapshot(
  input: unknown,
  command: {
    itemId: string;
    expectedCartVersion: number;
    expectedItemVersion: number;
  },
  cart: CartRuntimeHeader,
): CartEditItemSnapshot {
  if (!input) return rejectCartEdit("ITEM_NOT_FOUND");
  const snapshot = cartEditItemSnapshotSchema.parse(input);
  if (
    !same(snapshot.cart.id, cart.id) ||
    !same(snapshot.item.id, command.itemId)
  )
    return rejectCartEdit("INVALID_ACCESS");
  if (
    snapshot.cart.version !== command.expectedCartVersion ||
    cart.version !== command.expectedCartVersion ||
    snapshot.item.version !== command.expectedItemVersion
  )
    return rejectCartEdit("VERSION_CONFLICT");
  return snapshot;
}
class PreparePersonalization extends Error {
  constructor(readonly snapshot: CartEditItemSnapshot) {
    super("Prepare encrypted cart personalization outside the transaction");
  }
}

export function createCartEditUseCases({
  transactions,
  keyManagement,
}: Readonly<{
  transactions: CartEditTransactionManager;
  keyManagement: KeyManagementPort & SupportIntentKeyPort;
}>) {
  const run = cartEditTransactions(transactions);
  async function write(
    command: CartMutationCommand,
    context: CartRuntimeRequestContext,
    prepared?: {
      snapshot: CartEditItemSnapshot;
      privateContent: CartEditPrivateSnapshot["privateContent"];
    },
  ): Promise<CartEditResponse> {
    return run(async (repos) => {
      const cart = await authenticateCartEdit(repos, context);
      const claim = await beginCartEdit(repos, cart, command, context);
      if (claim.kind === "REPLAY") return claim.response;
      const snapshot = requireSnapshot(
        await repos.cartEdit.loadItemForUpdate(target(command, cart, context)),
        command,
        cart,
      );
      let change: CartEditWriteMutationCommand["change"];
      if (command.operation === "REMOVE_CART_ITEM") change = { kind: "REMOVE" };
      else if (command.change.kind === "QUANTITY") {
        const decision = decideCartRuntimeAdd({
          schemaVersion: 1,
          cart,
          command: {
            schemaVersion: 1,
            operation: "ADD_CART_ITEM",
            presentationLocale: command.presentationLocale,
            market: cart.market,
            currency: cart.currency,
            idolId: snapshot.item.idolId,
            giftId: snapshot.item.giftId,
            giftVariantId: snapshot.item.giftVariantId,
            quantity: command.change.quantity,
            observedPriceId: command.change.observedPriceId,
            displayMode: "anonymous",
            fanMessageLocale: "und",
          },
          current: await readCartRuntimeGift(
            repos,
            cart,
            command.presentationLocale,
            snapshot.item,
          ),
        });
        if (decision.outcome === "FAILURE")
          return rejectCartEdit(decision.code);
        change = { ...command.change, observedPriceId: decision.priceId };
      } else {
        if (!prepared) throw new PreparePersonalization(snapshot);
        if (
          !same(prepared.snapshot.supportIntentId, snapshot.supportIntentId) ||
          prepared.snapshot.intentVersion !== snapshot.intentVersion
        )
          return rejectCartEdit("VERSION_CONFLICT");
        change = {
          kind: "PERSONALIZATION",
          displayMode: command.change.displayMode,
          fanMessageLocale: command.change.fanMessageLocale,
          privateContent: prepared.privateContent,
        };
      }
      return persist(
        repos,
        cart,
        command,
        context,
        snapshot,
        change,
        claim.identity,
      );
    });
  }
  async function persist(
    repos: CartEditRepositories,
    cart: CartRuntimeHeader,
    command: CartMutationCommand,
    context: CartRuntimeRequestContext,
    snapshot: CartEditItemSnapshot,
    change: CartEditWriteMutationCommand["change"],
    identity: Extract<
      Awaited<ReturnType<typeof beginCartEdit>>,
      { kind: "NEW" }
    >["identity"],
  ): Promise<CartEditResponse> {
    const receiptId = randomUUID();
    const receipt = cartEditMutationReceiptSchema.parse(
      await repos.cartEdit.writeMutation({
        ...target(command, cart, context),
        expectedIntentVersion: snapshot.intentVersion,
        receiptId,
        eventId: randomUUID(),
        requestId: context.requestId,
        correlationId: context.correlationId,
        presentationLocale: command.presentationLocale,
        change,
      }),
    );
    if (
      receipt.receiptId !== receiptId ||
      !same(receipt.cartId, cart.id) ||
      !same(receipt.cartItemId, command.itemId) ||
      !same(receipt.supportIntentId, snapshot.supportIntentId) ||
      receipt.mutationKind !== mutationKind(command) ||
      receipt.cartVersion !== cart.version + 1 ||
      receipt.itemVersion !== snapshot.item.version + 1 ||
      receipt.intentVersion !==
        snapshot.intentVersion + (change.kind === "QUANTITY" ? 0 : 1)
    )
      return rejectCartEdit("TEMPORARY_UNAVAILABLE");
    const completion = cartEditPersistenceSuccess(
      await repos.idempotency.complete({
        ...identity,
        operation: "COMPLETE_IDEMPOTENCY",
        status: "SUCCEEDED",
        safeResultReference: `result-ref:v1:${receiptId}`,
      }),
    );
    if (completion.operation !== "COMPLETE_IDEMPOTENCY")
      return rejectCartEdit("TEMPORARY_UNAVAILABLE");
    return {
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: change.kind === "REMOVE" ? "REMOVED" : "UPDATED",
      cartItemId: receipt.cartItemId,
      cart: await readCartRuntimeView(
        repos,
        await authenticateCartEdit(repos, context),
        command.presentationLocale,
      ),
    };
  }
  async function mutate(
    input: unknown,
    trusted: unknown,
    operation: "UPDATE_CART_ITEM" | "REMOVE_CART_ITEM",
  ): Promise<CartEditResponse> {
    const parsed = (
      operation === "UPDATE_CART_ITEM"
        ? cartEditUpdateCommandSchema
        : cartEditRemoveCommandSchema
    ).safeParse(input);
    const context = cartRuntimeRequestContextSchema.safeParse(trusted);
    if (!parsed.success || (context.success && !context.data.idempotencyKey))
      return cartEditFailure("INVALID_COMMAND");
    if (!context.success) return cartEditFailure("INVALID_ACCESS");
    const command = parsed.data;
    return withCartEditFailure(async () => {
      try {
        return cartEditResponseSchema.parse(await write(command, context.data));
      } catch (error) {
        if (
          !(error instanceof PreparePersonalization) ||
          command.operation !== "UPDATE_CART_ITEM" ||
          command.change.kind !== "PERSONALIZATION"
        )
          throw error;
        const privateContent = await encryptCartRuntimeIntent(
          keyManagement,
          command.change,
          error.snapshot.supportIntentId,
        );
        return cartEditResponseSchema.parse(
          await write(command, context.data, {
            snapshot: error.snapshot,
            privateContent,
          }),
        );
      }
    });
  }
  return Object.freeze({
    update: (input: unknown, trusted: unknown) =>
      mutate(input, trusted, "UPDATE_CART_ITEM"),
    remove: (input: unknown, trusted: unknown) =>
      mutate(input, trusted, "REMOVE_CART_ITEM"),
    async readEditor(
      input: unknown,
      trusted: unknown,
    ): Promise<CartEditorResponse> {
      const command = cartEditorReadCommandSchema.safeParse(input),
        context = cartRuntimeRequestContextSchema.safeParse(trusted);
      if (!command.success) return cartEditFailure("INVALID_COMMAND");
      if (!context.success) return cartEditFailure("INVALID_ACCESS");
      return withCartEditFailure(async () => {
        const data = await run(async (repos) => {
          const cart = await authenticateCartEdit(repos, context.data);
          const stored = await repos.cartEdit.loadPrivateForEdit({
            ...target(command.data, cart, context.data),
            requestId: context.data.requestId,
            correlationId: context.data.correlationId,
          });
          if (!stored) return rejectCartEdit("ITEM_NOT_FOUND");
          const parsed = cartEditPrivateSnapshotSchema.parse(stored);
          requireSnapshot(parsed.snapshot, command.data, cart);
          return parsed;
        });
        const content = await decryptCartEditor(keyManagement, data);
        const confirmed = await run(async (repos) => {
          const cart = await authenticateCartEdit(repos, context.data);
          const snapshot = requireSnapshot(
            await repos.cartEdit.confirmPrivateRead({
              ...target(command.data, cart, context.data),
              requestId: context.data.requestId,
              correlationId: context.data.correlationId,
              expectedIntentVersion: data.snapshot.intentVersion,
              accessAuditId: data.accessAuditId,
            }),
            command.data,
            cart,
          );
          if (
            !same(snapshot.supportIntentId, data.snapshot.supportIntentId) ||
            snapshot.intentVersion !== data.snapshot.intentVersion
          )
            return rejectCartEdit("VERSION_CONFLICT");
          return snapshot;
        });
        return cartEditorResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          action: "EDITOR_READ",
          cartItemId: confirmed.item.id,
          cartVersion: confirmed.cart.version,
          itemVersion: confirmed.item.version,
          content,
        });
      });
    },
  });
}

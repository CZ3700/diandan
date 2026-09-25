import { createHash } from "node:crypto";
import {
  cartEditMutationReceiptSchema,
  type CartEditUpdateCommand,
  type CartEditRemoveCommand,
  type CartRuntimeHeader,
  type CartRuntimeRequestContext,
} from "@fan-support/contracts";
import type { CartEditRepositories } from "@fan-support/persistence-port";
import {
  cartEditPersistenceSuccess,
  rejectCartEdit,
} from "./cart-edit-transaction.js";
import { readCartRuntimeView } from "./cart-runtime-view.js";

export type CartMutationCommand = CartEditUpdateCommand | CartEditRemoveCommand;
export const mutationKind = (command: CartMutationCommand) =>
  command.operation === "REMOVE_CART_ITEM" ? "REMOVE" : command.change.kind;
/** Hash only in memory; a receipt stores the opaque hash and safe reference, never the private request. */
export async function beginCartEdit(
  repos: CartEditRepositories,
  cart: CartRuntimeHeader,
  command: CartMutationCommand,
  context: CartRuntimeRequestContext,
) {
  const identity = {
    schemaVersion: 1 as const,
    actor: `actor-ref:v1:guest:${cart.id}`,
    idempotencyOperation:
      command.operation === "REMOVE_CART_ITEM"
        ? "cart.item.remove"
        : "cart.item.update",
    idempotencyKey: context.idempotencyKey!,
    canonicalRequestHash: createHash("sha256")
      .update(JSON.stringify(command), "utf8")
      .digest("hex"),
  };
  const claim = cartEditPersistenceSuccess(
    await repos.idempotency.begin({
      ...identity,
      operation: "BEGIN_IDEMPOTENCY",
      expiresAt: cart.expiresAt,
    }),
  );
  if (claim.operation !== "BEGIN_IDEMPOTENCY")
    return rejectCartEdit("TEMPORARY_UNAVAILABLE");
  if (claim.value.decision === "CONFLICT")
    return rejectCartEdit("IDEMPOTENCY_CONFLICT");
  if (claim.value.decision === "IN_PROGRESS")
    return rejectCartEdit("IN_PROGRESS");
  if (claim.value.decision === "STARTED")
    return { kind: "NEW", identity } as const;
  const prefix = "result-ref:v1:";
  if (!claim.value.safeResultReference.startsWith(prefix))
    return rejectCartEdit("TEMPORARY_UNAVAILABLE");
  const stored = await repos.cartEdit.findMutationReceipt({
    schemaVersion: 1,
    accesses: context.accesses,
    cartId: cart.id,
    receiptId: claim.value.safeResultReference.slice(prefix.length),
  });
  if (!stored) return rejectCartEdit("TEMPORARY_UNAVAILABLE");
  const receipt = cartEditMutationReceiptSchema.parse(stored);
  if (
    receipt.cartId !== cart.id ||
    receipt.cartItemId.toLowerCase() !== command.itemId.toLowerCase() ||
    receipt.mutationKind !== mutationKind(command) ||
    receipt.cartVersion > cart.version
  )
    return rejectCartEdit("TEMPORARY_UNAVAILABLE");
  return {
    kind: "REPLAY",
    response: {
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "REPLAYED",
      cartItemId: receipt.cartItemId,
      cart: await readCartRuntimeView(repos, cart, command.presentationLocale),
    },
  } as const;
}

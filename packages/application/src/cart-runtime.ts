/// <reference types="node" />
import { createHash, randomUUID } from "node:crypto";
import {
  idempotencyKeySchema,
  type IdempotencyKey,
  cartIdSchema,
  cartItemIdSchema,
  supportIntentIdSchema,
  eventIdSchema,
  cartRuntimeAddCommandSchema,
  cartRuntimeHeaderSchema,
  cartRuntimeInitializeCommandSchema,
  cartRuntimeItemRecordSchema,
  cartRuntimeReadCommandSchema,
  cartRuntimeReceiptSchema,
  cartRuntimeRequestContextSchema,
  cartRuntimeResponseSchema,
  persistencePortResponseSchema,
  type CartRuntimeAddCommand,
  type CartRuntimeFailureCode,
  type CartRuntimeHeader,
  type CartRuntimeRequestContext,
  type CartRuntimeResponse,
  type StorefrontGiftResponse,
  type SupportedLocale,
} from "@fan-support/contracts";
import {
  canonicalCartRuntimeRequest,
  decideCartRuntimeAdd,
  projectCartRuntimeView,
} from "@fan-support/cart";
import type {
  KeyManagementPort,
  SupportIntentKeyPort,
} from "@fan-support/key-management-port";
import {
  CartRuntimeRepositoryError,
  PersistenceTransactionFailureError,
  type CartRuntimeRepositories,
  type CartRuntimeTransactionManager,
  type JsonValue,
} from "@fan-support/persistence-port";
import { createStorefrontCommerceUseCases } from "./storefront-commerce.js";
import { encryptCartRuntimeIntent } from "./cart-runtime-private.js";

const fail = (code: CartRuntimeFailureCode) =>
  ({ schemaVersion: 1, outcome: "FAILURE", code }) as const;
const reject = (code: CartRuntimeFailureCode): never => {
  throw new CartRuntimeRepositoryError(code);
};
class EncryptionRequired extends Error {
  constructor() {
    super("New cart intent requires encryption");
  }
}

async function beginAdd(
  repos: CartRuntimeRepositories,
  cart: CartRuntimeHeader,
  command: CartRuntimeAddCommand,
  idempotencyKey: IdempotencyKey,
) {
  const identity = {
    schemaVersion: 1 as const,
    actor: `actor-ref:v1:guest:${cart.id}`,
    idempotencyOperation: "cart.item.add",
    idempotencyKey,
    canonicalRequestHash: createHash("sha256")
      .update(canonicalCartRuntimeRequest(command), "utf8")
      .digest("hex"),
  };
  const reservation = persistenceSuccess(
    await repos.idempotency.begin({
      ...identity,
      operation: "BEGIN_IDEMPOTENCY",
      expiresAt: cart.expiresAt,
    }),
  );
  if (reservation.operation !== "BEGIN_IDEMPOTENCY")
    return reject("TEMPORARY_UNAVAILABLE");
  if (reservation.value.decision === "CONFLICT")
    return reject("IDEMPOTENCY_CONFLICT");
  if (reservation.value.decision === "IN_PROGRESS")
    return reject("IN_PROGRESS");
  if (reservation.value.decision === "STARTED")
    return { kind: "NEW", identity } as const;
  const ref = reservation.value.safeResultReference;
  if (!ref.startsWith("result-ref:v1:")) return reject("TEMPORARY_UNAVAILABLE");
  const stored = await repos.cartRuntime.findReceipt({
    schemaVersion: 1,
    cartId: cart.id,
    cartItemId: cartItemIdSchema.parse(ref.slice("result-ref:v1:".length)),
  });
  if (!stored) return reject("TEMPORARY_UNAVAILABLE");
  const receipt = cartRuntimeReceiptSchema.parse(stored);
  if (receipt.cartId !== cart.id) return reject("TEMPORARY_UNAVAILABLE");
  return {
    kind: "REPLAY",
    response: {
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "REPLAYED",
      cartItemId: receipt.cartItemId,
      cart: await readView(repos, cart, command.presentationLocale),
    },
  } as const;
}
function usable(cart: CartRuntimeHeader | null): CartRuntimeHeader {
  if (cart === null) return reject("CART_NOT_FOUND");
  const parsed = cartRuntimeHeaderSchema.parse(cart);
  if (parsed.expired || parsed.status === "EXPIRED")
    return reject("CART_EXPIRED");
  return parsed;
}
function writable(
  cart: CartRuntimeHeader,
  scope: { market: string; currency: string },
): void {
  if (cart.status !== "ACTIVE") reject("CART_LOCKED");
  if (cart.market !== scope.market || cart.currency !== scope.currency)
    reject("SCOPE_MISMATCH");
}
async function authenticate(
  repos: CartRuntimeRepositories,
  context: CartRuntimeRequestContext,
) {
  return usable(
    await repos.cartRuntime.findByCredentialForUpdate({
      schemaVersion: 1,
      accesses: context.accesses,
    }),
  );
}
async function currentGift(
  repos: CartRuntimeRepositories,
  cart: CartRuntimeHeader,
  locale: SupportedLocale,
  target: { giftId: string; giftVariantId: string; idolId: string },
): Promise<StorefrontGiftResponse> {
  const resolved = await repos.cartRuntime.resolveGiftHandle({
    schemaVersion: 1,
    giftId: target.giftId as CartRuntimeAddCommand["giftId"],
    giftVariantId:
      target.giftVariantId as CartRuntimeAddCommand["giftVariantId"],
  });
  if (!resolved)
    return { schemaVersion: 1, outcome: "FAILURE", code: "NOT_FOUND" };
  // Bind the established publication/price validator to this already-open write transaction.
  const reader = createStorefrontCommerceUseCases({
    transactions: {
      runInStorefrontCommerceTransaction: (work) =>
        work({ storefrontCommerce: repos.storefrontCommerce }),
    },
  });
  const current = await reader.readGift({
    schemaVersion: 1,
    handle: resolved.handle,
    locale,
    market: cart.market,
    currency: cart.currency,
    idolId: target.idolId,
  });
  if (current.outcome === "FAILURE" && current.code === "CONTENT_UNAVAILABLE")
    reject(current.code);
  return current;
}
async function readView(
  repos: CartRuntimeRepositories,
  cart: CartRuntimeHeader,
  locale: SupportedLocale,
) {
  const stored = await repos.cartRuntime.listItems({
    schemaVersion: 1,
    cartId: cart.id,
  });
  const items = [];
  for (const row of stored) {
    const item = cartRuntimeItemRecordSchema.parse(row);
    items.push({ item, current: await currentGift(repos, cart, locale, item) });
  }
  return projectCartRuntimeView({
    schemaVersion: 1,
    cart,
    presentationLocale: locale,
    items,
  });
}
function persistenceSuccess(input: unknown) {
  const result = persistencePortResponseSchema.parse(input);
  if (result.outcome === "FAILURE") {
    if (result.error.code === "TRANSACTION_ABORTED")
      throw new PersistenceTransactionFailureError({
        schemaVersion: 1,
        operation: "RUN_TRANSACTION",
        outcome: "FAILURE",
        error: result.error,
      });
    return reject(
      result.error.code === "TRANSACTION_OUTCOME_UNKNOWN"
        ? "TRANSACTION_OUTCOME_UNKNOWN"
        : result.error.code === "IDEMPOTENCY_CONFLICT"
          ? "IDEMPOTENCY_CONFLICT"
          : "TEMPORARY_UNAVAILABLE",
    );
  }
  return result;
}

export function createCartRuntimeUseCases({
  transactions,
  keyManagement,
  now = () => new Date(),
  cartTtlMs = 86_400_000,
}: {
  transactions: CartRuntimeTransactionManager;
  keyManagement: KeyManagementPort & SupportIntentKeyPort;
  now?: () => Date;
  cartTtlMs?: number;
}) {
  if (
    !Number.isSafeInteger(cartTtlMs) ||
    cartTtlMs < 60_000 ||
    cartTtlMs > 2_592_000_000
  )
    throw new TypeError("Invalid cart lifetime");
  async function transaction<Result extends JsonValue>(
    work: (repos: CartRuntimeRepositories) => Promise<Result>,
  ): Promise<Result> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await transactions.runInCartRuntimeTransaction(work);
      } catch (error) {
        // Only a proven rollback can be retried automatically. An uncertain commit must be reconciled.
        if (
          error instanceof PersistenceTransactionFailureError &&
          error.failure.error.code === "TRANSACTION_ABORTED" &&
          attempt < 2
        )
          continue;
        throw error;
      }
    }
  }
  async function execute(
    work: () => Promise<unknown>,
  ): Promise<CartRuntimeResponse> {
    try {
      return cartRuntimeResponseSchema.parse(await work());
    } catch (error) {
      if (error instanceof CartRuntimeRepositoryError) return fail(error.code);
      if (
        error instanceof PersistenceTransactionFailureError &&
        error.failure.error.code === "TRANSACTION_OUTCOME_UNKNOWN"
      )
        return fail("TRANSACTION_OUTCOME_UNKNOWN");
      return fail("TEMPORARY_UNAVAILABLE");
    }
  }
  return Object.freeze({
    async initialize(
      input: unknown,
      trusted: unknown,
    ): Promise<CartRuntimeResponse> {
      const command = cartRuntimeInitializeCommandSchema.safeParse(input),
        context = cartRuntimeRequestContextSchema.safeParse(trusted);
      if (!command.success) return fail("INVALID_COMMAND");
      if (!context.success) return fail("INVALID_ACCESS");
      const cartId = cartIdSchema.parse(randomUUID());
      return execute(() =>
        transaction(async (repos) => {
          const existing = await repos.cartRuntime.findByCredentialForUpdate({
            schemaVersion: 1,
            accesses: context.data.accesses,
          });
          const cart = usable(
            existing ??
              (await repos.cartRuntime.initialize({
                schemaVersion: 1,
                accesses: context.data.accesses,
                cartId,
                presentationLocale: command.data.presentationLocale,
                market: command.data.market,
                currency: command.data.currency,
                expiresAt: new Date(now().getTime() + cartTtlMs).toISOString(),
              })),
          );
          writable(cart, command.data);
          return {
            schemaVersion: 1,
            outcome: "SUCCESS",
            action: "INITIALIZED",
            cart: await readView(repos, cart, command.data.presentationLocale),
          };
        }),
      );
    },
    async read(input: unknown, trusted: unknown): Promise<CartRuntimeResponse> {
      const command = cartRuntimeReadCommandSchema.safeParse(input),
        context = cartRuntimeRequestContextSchema.safeParse(trusted);
      if (!command.success) return fail("INVALID_COMMAND");
      if (!context.success) return fail("INVALID_ACCESS");
      return execute(() =>
        transaction(async (repos) => ({
          schemaVersion: 1,
          outcome: "SUCCESS",
          action: "READ",
          cart: await readView(
            repos,
            await authenticate(repos, context.data),
            command.data.presentationLocale,
          ),
        })),
      );
    },
    async add(input: unknown, trusted: unknown): Promise<CartRuntimeResponse> {
      const parsed = cartRuntimeAddCommandSchema.safeParse(input),
        context = cartRuntimeRequestContextSchema.safeParse(trusted);
      if (
        !parsed.success ||
        (context.success && context.data.idempotencyKey === undefined)
      )
        return fail("INVALID_COMMAND");
      if (!context.success) return fail("INVALID_ACCESS");
      const command = parsed.data,
        request = context.data,
        idempotencyKey = request.idempotencyKey!;
      return execute(async () => {
        try {
          return await transaction(async (repos) => {
            const cart = await authenticate(repos, request);
            writable(cart, command);
            const claim = await beginAdd(repos, cart, command, idempotencyKey);
            if (claim.kind === "REPLAY") return claim.response;
            // Roll back the provisional claim before calling KMS. Never commit
            // an IN_PROGRESS receipt across an external encryption operation.
            throw new EncryptionRequired();
          });
        } catch (error) {
          if (!(error instanceof EncryptionRequired)) throw error;
        }
        const supportIntentId = supportIntentIdSchema.parse(randomUUID()),
          cartItemId = cartItemIdSchema.parse(randomUUID()),
          eventId = eventIdSchema.parse(randomUUID());
        const privateContent = await encryptCartRuntimeIntent(
          keyManagement,
          command,
          supportIntentId,
        );
        return transaction(async (repos) => {
          const cart = await authenticate(repos, request);
          writable(cart, command);
          const claim = await beginAdd(repos, cart, command, idempotencyKey);
          if (claim.kind === "REPLAY") return claim.response;
          const { identity } = claim;
          const current = await currentGift(
            repos,
            cart,
            command.presentationLocale,
            command,
          );
          const decision = decideCartRuntimeAdd({
            schemaVersion: 1,
            cart,
            command,
            current,
          });
          if (decision.outcome === "FAILURE") return reject(decision.code);
          const receipt = cartRuntimeReceiptSchema.parse(
            await repos.cartRuntime.appendItem({
              schemaVersion: 1,
              accesses: request.accesses,
              cartId: cart.id,
              expectedCartVersion: cart.version,
              cartItemId,
              supportIntentId,
              giftVariantId: command.giftVariantId,
              idolId: command.idolId,
              quantity: command.quantity,
              observedPriceId: decision.priceId,
              createdPresentationLocale: command.presentationLocale,
              fanMessageLocale: command.fanMessageLocale,
              displayMode: command.displayMode,
              privateContent,
              requestId: request.requestId,
              correlationId: request.correlationId,
            }),
          );
          const event = persistenceSuccess(
            await repos.outbox.append({
              schemaVersion: 1,
              operation: "APPEND_OUTBOX_EVENT",
              event: {
                schemaVersion: 1,
                eventId,
                eventType: "CART_ITEM_ADDED",
                aggregateId: cart.id,
                occurredAt: receipt.occurredAt,
                correlationId: request.correlationId,
                requestId: request.requestId,
                payload: { cartId: cart.id, cartItemId: receipt.cartItemId },
              },
              aggregateVersion: receipt.cartVersion,
              primarySubjectId: cart.id,
              secondarySubjectId: receipt.cartItemId,
              market: cart.market,
              currency: cart.currency,
              idempotencyKey: idempotencyKeySchema.parse(
                `cart.item.add:${receipt.cartItemId}`,
              ),
              availableAt: receipt.occurredAt,
            }),
          );
          if (event.operation !== "APPEND_OUTBOX_EVENT")
            return reject("TEMPORARY_UNAVAILABLE");
          const completion = persistenceSuccess(
            await repos.idempotency.complete({
              ...identity,
              operation: "COMPLETE_IDEMPOTENCY",
              status: "SUCCEEDED",
              safeResultReference: `result-ref:v1:${receipt.cartItemId}`,
            }),
          );
          if (completion.operation !== "COMPLETE_IDEMPOTENCY")
            return reject("TEMPORARY_UNAVAILABLE");
          const updated = await authenticate(repos, request);
          return {
            schemaVersion: 1,
            outcome: "SUCCESS",
            action: "ADDED",
            cartItemId: receipt.cartItemId,
            cart: await readView(repos, updated, command.presentationLocale),
          };
        });
      });
    },
  });
}

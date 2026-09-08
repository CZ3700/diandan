import { canonicalPublicationValue } from "@fan-support/content";
import { randomUUID } from "node:crypto";
import {
  cartRuntimeRequestContextSchema,
  checkoutPreflightValidateCommandSchema,
  checkoutPreflightCreateCommandSchema,
  checkoutPreflightReadCommandSchema,
  checkoutPreflightResponseSchema,
  checkoutPreflightSaveCommandSchema,
  type CheckoutPreflightResponse,
} from "@fan-support/contracts";
import {
  projectCheckoutPreflight,
  projectCheckoutSession,
  selectCheckoutInventory,
} from "@fan-support/domain";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import type { CheckoutPreflightTransactionManager } from "@fan-support/persistence-port";
import { checkoutCreator } from "./checkout-create.js";
import { beginCheckout, completeCheckout } from "./checkout-idempotency.js";
import { createCheckoutObservation } from "./checkout-observation.js";
import {
  readCheckoutCurrent,
  readCheckoutObservation,
  readCheckoutSession,
} from "./checkout-preflight-records.js";
import {
  authenticateCheckout,
  checkoutFailure,
  checkoutTransactions,
  rejectCheckout,
  requireCheckoutCart,
  withCheckoutFailure,
} from "./checkout-transaction.js";

export function createCheckoutPreflightUseCases({
  transactions,
  keyManagement,
  preflightTtlMs = 900_000,
}: {
  transactions: CheckoutPreflightTransactionManager;
  keyManagement: KeyManagementPort;
  preflightTtlMs?: number;
}) {
  if (
    !Number.isSafeInteger(preflightTtlMs) ||
    preflightTtlMs < 1_000 ||
    preflightTtlMs > 3_600_000
  )
    throw new TypeError("Invalid checkout preflight lifetime");
  const run = checkoutTransactions(transactions);
  const create = checkoutCreator(transactions, keyManagement);
  const execute = async (
    work: () => Promise<unknown>,
  ): Promise<CheckoutPreflightResponse> =>
    checkoutPreflightResponseSchema.parse(
      await withCheckoutFailure(async () =>
        checkoutPreflightResponseSchema.parse(await work()),
      ),
    );
  return Object.freeze({
    async validate(
      input: unknown,
      trusted: unknown,
    ): Promise<CheckoutPreflightResponse> {
      const command = checkoutPreflightValidateCommandSchema.safeParse(input),
        context = cartRuntimeRequestContextSchema.safeParse(trusted);
      if (
        !command.success ||
        (context.success && context.data.idempotencyKey === undefined)
      )
        return checkoutFailure("INVALID_COMMAND");
      if (!context.success) return checkoutFailure("INVALID_ACCESS");
      return execute(() =>
        run(async (repos) => {
          const cart = await authenticateCheckout(repos, context.data);
          requireCheckoutCart(cart, command.data.expectedCartVersion);
          const claim = await beginCheckout(
            repos,
            cart,
            command.data,
            context.data,
          );
          if (claim.kind === "REPLAY")
            return {
              schemaVersion: 1,
              outcome: "SUCCESS",
              action: "VALIDATED",
              replayed: true,
              preflight: projectCheckoutPreflight(
                await readCheckoutObservation(
                  repos,
                  cart,
                  context.data,
                  claim.reference,
                ),
              ),
            };
          const current = await readCheckoutCurrent(
            repos,
            cart,
            context.data,
            command.data.presentationLocale,
          );
          const inventory = selectCheckoutInventory(current);
          if (inventory.outcome === "FAILURE")
            return rejectCheckout(inventory.code);
          const observation = createCheckoutObservation(
            current,
            randomUUID(),
            randomUUID(),
            preflightTtlMs,
          );
          const stored = await repos.checkoutPreflight.savePreflight(
            checkoutPreflightSaveCommandSchema.parse({
              schemaVersion: 1,
              accesses: context.data.accesses,
              cartId: cart.id,
              observation,
            }),
          );
          if (
            canonicalPublicationValue(stored) !==
            canonicalPublicationValue(observation)
          )
            return rejectCheckout("CONTENT_UNAVAILABLE");
          await completeCheckout(repos, claim.identity, observation.id);
          return {
            schemaVersion: 1,
            outcome: "SUCCESS",
            action: "VALIDATED",
            replayed: false,
            preflight: projectCheckoutPreflight(observation),
          };
        }),
      );
    },
    async create(
      input: unknown,
      trusted: unknown,
    ): Promise<CheckoutPreflightResponse> {
      const command = checkoutPreflightCreateCommandSchema.safeParse(input),
        context = cartRuntimeRequestContextSchema.safeParse(trusted);
      if (
        !command.success ||
        (context.success && context.data.idempotencyKey === undefined)
      )
        return checkoutFailure("INVALID_COMMAND");
      if (!context.success) return checkoutFailure("INVALID_ACCESS");
      return execute(() => create(command.data, context.data));
    },
    async read(
      input: unknown,
      trusted: unknown,
    ): Promise<CheckoutPreflightResponse> {
      const command = checkoutPreflightReadCommandSchema.safeParse(input),
        context = cartRuntimeRequestContextSchema.safeParse(trusted);
      if (!command.success) return checkoutFailure("INVALID_COMMAND");
      if (!context.success) return checkoutFailure("INVALID_ACCESS");
      return execute(() =>
        run(async (repos) => {
          const cart = await authenticateCheckout(repos, context.data);
          return {
            schemaVersion: 1,
            outcome: "SUCCESS",
            action: "READ",
            checkout: projectCheckoutSession(
              await readCheckoutSession(
                repos,
                cart,
                context.data,
                command.data.checkoutSessionId,
              ),
            ),
          };
        }),
      );
    },
  });
}

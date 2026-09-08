import { randomUUID } from "node:crypto";
import {
  checkoutPreflightCommitCommandSchema,
  checkoutPreflightReceiptSchema,
  type CartRuntimeRequestContext,
  type CheckoutPreflightCreateCommand,
} from "@fan-support/contracts";
import { projectCheckoutSession } from "@fan-support/domain";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import type { CheckoutPreflightTransactionManager } from "@fan-support/persistence-port";
import { encryptCheckoutContact } from "./checkout-contact.js";
import { beginCheckout, completeCheckout } from "./checkout-idempotency.js";
import { appendCheckoutFulfillmentEvents } from "./checkout-outbox.js";
import {
  prepareCheckoutInventory,
  applyCheckoutInventory,
} from "./checkout-inventory.js";
import {
  readCheckoutCurrent,
  readCheckoutObservation,
  readCheckoutSession,
  requireCheckoutConsent,
  requireUnchangedCheckout,
} from "./checkout-preflight-records.js";
import {
  authenticateCheckout,
  checkoutTransactions,
  rejectCheckout,
  requireCheckoutCart,
} from "./checkout-transaction.js";

class ContactEncryptionRequired extends Error {
  constructor() {
    super("Checkout contact requires encryption");
  }
}
export function checkoutCreator(
  transactions: CheckoutPreflightTransactionManager,
  keyManagement: KeyManagementPort,
) {
  const run = checkoutTransactions(transactions);
  return async (
    command: CheckoutPreflightCreateCommand,
    context: CartRuntimeRequestContext,
  ) => {
    try {
      return await run(async (repos) => {
        const cart = await authenticateCheckout(repos, context);
        const claim = await beginCheckout(repos, cart, command, context);
        if (claim.kind === "REPLAY")
          return {
            schemaVersion: 1 as const,
            outcome: "SUCCESS" as const,
            action: "REPLAYED" as const,
            checkout: projectCheckoutSession(
              await readCheckoutSession(repos, cart, context, claim.reference),
            ),
          };
        requireCheckoutCart(cart, command.expectedCartVersion);
        requireCheckoutConsent(
          await readCheckoutObservation(
            repos,
            cart,
            context,
            command.preflightId,
          ),
          command,
        );
        // Roll back the provisional receipt. No SQL transaction spans an external KMS call.
        throw new ContactEncryptionRequired();
      });
    } catch (error) {
      if (!(error instanceof ContactEncryptionRequired)) throw error;
    }
    const contactId = randomUUID();
    const contact = {
      id: contactId,
      ...(await encryptCheckoutContact(
        keyManagement,
        command.email,
        contactId,
      )),
    };
    return run(async (repos) => {
      const cart = await authenticateCheckout(repos, context);
      const claim = await beginCheckout(repos, cart, command, context);
      if (claim.kind === "REPLAY")
        return {
          schemaVersion: 1 as const,
          outcome: "SUCCESS" as const,
          action: "REPLAYED" as const,
          checkout: projectCheckoutSession(
            await readCheckoutSession(repos, cart, context, claim.reference),
          ),
        };
      requireCheckoutCart(cart, command.expectedCartVersion);
      const observation = await readCheckoutObservation(
        repos,
        cart,
        context,
        command.preflightId,
      );
      requireCheckoutConsent(observation, command);
      const current = await readCheckoutCurrent(
        repos,
        cart,
        context,
        observation.consent.presentationLocale,
      );
      requireUnchangedCheckout(observation, current);
      const reservations = await prepareCheckoutInventory(
        repos,
        current,
        observation.quote,
      );
      const commit = checkoutPreflightCommitCommandSchema.parse({
        schemaVersion: 1,
        accesses: context.accesses,
        cartId: cart.id,
        preflightId: observation.id,
        expectedCartVersion: cart.version,
        expectedConsentHash: observation.consentHash,
        checkoutSessionId: randomUUID(),
        orderId: randomUUID(),
        publicOrderId: randomUUID(),
        contact,
        items: observation.consent.lines.map((line) => ({
          cartItemId: line.cartItemId,
          orderItemId: randomUUID(),
          fulfillmentId: randomUUID(),
          fulfillmentEventId: randomUUID(),
        })),
        createdOrderEventId: randomUUID(),
        pendingOrderEventId: randomUUID(),
        eventId: randomUUID(),
        requestId: context.requestId,
        correlationId: context.correlationId,
      });
      const receipt = checkoutPreflightReceiptSchema.parse(
        await repos.checkoutPreflight.commit(commit),
      );
      if (
        receipt.preflightId !== observation.id ||
        receipt.cartId !== cart.id ||
        receipt.checkoutSessionId !== commit.checkoutSessionId ||
        receipt.orderId !== commit.orderId ||
        receipt.publicOrderId !== commit.publicOrderId ||
        receipt.cartVersion !== cart.version + 1
      )
        return rejectCheckout("CONTENT_UNAVAILABLE");
      await applyCheckoutInventory(repos, reservations, receipt.occurredAt);
      await appendCheckoutFulfillmentEvents(
        repos,
        commit,
        observation.consent,
        receipt.occurredAt,
      );
      await completeCheckout(repos, claim.identity, receipt.checkoutSessionId);
      return {
        schemaVersion: 1 as const,
        outcome: "SUCCESS" as const,
        action: "CREATED" as const,
        checkout: projectCheckoutSession(
          await readCheckoutSession(
            repos,
            cart,
            context,
            receipt.checkoutSessionId,
          ),
        ),
      };
    });
  };
}

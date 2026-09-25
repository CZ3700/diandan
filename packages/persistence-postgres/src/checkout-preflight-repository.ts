import {
  checkoutPreflightLoadCurrentCommandSchema,
  checkoutPreflightSaveCommandSchema,
  checkoutPreflightFindCommandSchema,
  checkoutPreflightCommitCommandSchema,
  checkoutPreflightReadSessionCommandSchema,
  checkoutPreflightSessionRecordSchema,
} from "@fan-support/contracts";
import {
  canonicalPublicationValue,
  hashPublicationValue,
} from "@fan-support/content";
import {
  CheckoutPreflightRepositoryError,
  CartRuntimeRepositoryError,
  parsePersistenceTransactionFailure,
  PersistenceTransactionFailureError,
  type CheckoutPreflightRepository,
} from "@fan-support/persistence-port";
import { loadCheckoutCurrent } from "./checkout-preflight-current.js";
import {
  authorizeCheckout,
  readCheckoutObservation,
  rejectCheckout,
  checkoutReceipt,
  checkoutReceiptColumns,
} from "./checkout-preflight-data.js";
import { writeCheckout } from "./checkout-preflight-write.js";
import { cartTimestamp } from "./cart-runtime-data.js";
import { draftRows } from "./content-draft-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

export function createCheckoutPreflightRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  publicMediaBaseUrl: string,
): CheckoutPreflightRepository {
  // This private transaction-local witness cannot be supplied by a caller or reused after COMMIT.
  const verifiedConsents = new Map<string, string>();
  const run = <Result>(work: () => Promise<Result>) =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof CheckoutPreflightRepositoryError) throw error;
        if (error instanceof CartRuntimeRepositoryError)
          throw new CheckoutPreflightRepositoryError(error.code);
        const failure = parsePersistenceTransactionFailure(error);
        if (failure) throw new PersistenceTransactionFailureError(failure);
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  async function requireFresh(preflightId: string) {
    const [row] = await draftRows(
      client,
      `SELECT expires_at>clock_timestamp() fresh FROM public.checkout_preflight_observations WHERE id=$1::uuid`,
      [preflightId],
    );
    if (row?.["fresh"] !== true) return rejectCheckout("PREFLIGHT_EXPIRED");
  }
  return {
    loadCurrent(input) {
      return run(async () => {
        const command =
          checkoutPreflightLoadCurrentCommandSchema.safeParse(input);
        if (!command.success) return rejectCheckout("INVALID_COMMAND");
        const current = await loadCheckoutCurrent(
          client,
          scope,
          publicMediaBaseUrl,
          command.data,
        );
        verifiedConsents.set(
          current.cart.id.toLowerCase(),
          canonicalPublicationValue(current.consent),
        );
        return current;
      });
    },
    savePreflight(input) {
      return run(async () => {
        const parsed = checkoutPreflightSaveCommandSchema.safeParse(input);
        if (!parsed.success) return rejectCheckout("INVALID_COMMAND");
        const command = parsed.data,
          observation = command.observation;
        const cart = await authorizeCheckout(
          client,
          command.accesses,
          command.cartId,
        );
        if (
          cart.id !== observation.consent.cartId ||
          cart.version !== observation.consent.cartVersion
        )
          return rejectCheckout("VERSION_CONFLICT");
        if (
          verifiedConsents.get(cart.id.toLowerCase()) !==
            canonicalPublicationValue(observation.consent) ||
          hashPublicationValue(
            "fan-support.checkout-consent.v1",
            observation.consent,
          ) !== observation.consentHash
        )
          return rejectCheckout("PREFLIGHT_CHANGED");
        await client.query(
          `INSERT INTO public.checkout_preflight_observations(id,cart_id,cart_version,consent_hash,observation,created_at,expires_at) VALUES($1::uuid,$2::uuid,$3::bigint,$4,$5::jsonb,$6::timestamptz,$7::timestamptz)`,
          [
            observation.id,
            cart.id,
            cart.version,
            observation.consentHash,
            canonicalPublicationValue(observation),
            observation.createdAt,
            observation.expiresAt,
          ],
        );
        await requireFresh(observation.id);
        return observation;
      });
    },
    readPreflight(input) {
      return run(async () => {
        const parsed = checkoutPreflightFindCommandSchema.safeParse(input);
        if (!parsed.success) return rejectCheckout("INVALID_COMMAND");
        const command = parsed.data;
        await authorizeCheckout(
          client,
          command.accesses,
          command.cartId,
          false,
        );
        const observation = await readCheckoutObservation(
          client,
          command.cartId,
          command.preflightId,
        );
        if (observation) await requireFresh(command.preflightId);
        return observation;
      });
    },
    commit(input) {
      return run(async () => {
        const parsed = checkoutPreflightCommitCommandSchema.safeParse(input);
        if (!parsed.success) return rejectCheckout("INVALID_COMMAND");
        const command = parsed.data;
        const cart = await authorizeCheckout(
          client,
          command.accesses,
          command.cartId,
        );
        if (cart.version !== command.expectedCartVersion)
          return rejectCheckout("VERSION_CONFLICT");
        const observation = await readCheckoutObservation(
          client,
          cart.id,
          command.preflightId,
        );
        if (!observation) return rejectCheckout("PREFLIGHT_NOT_FOUND");
        await requireFresh(command.preflightId);
        if (
          observation.consentHash !== command.expectedConsentHash ||
          observation.consent.cartVersion !== cart.version ||
          verifiedConsents.get(cart.id.toLowerCase()) !==
            canonicalPublicationValue(observation.consent)
        )
          return rejectCheckout("PREFLIGHT_CHANGED");
        return writeCheckout(client, command, observation);
      });
    },
    readSession(input) {
      return run(async () => {
        const parsed =
          checkoutPreflightReadSessionCommandSchema.safeParse(input);
        if (!parsed.success) return rejectCheckout("INVALID_COMMAND");
        const command = parsed.data;
        await authorizeCheckout(
          client,
          command.accesses,
          command.cartId,
          false,
        );
        const rows = await draftRows(
          client,
          `SELECT ${checkoutReceiptColumns} FROM public.checkout_preflight_receipts WHERE cart_id=$1::uuid AND checkout_session_id=$2::uuid`,
          [command.cartId, command.checkoutSessionId],
        );
        if (rows.length === 0) return null;
        if (rows.length !== 1) return rejectCheckout("CONTENT_UNAVAILABLE");
        const receipt = checkoutReceipt(rows[0]!);
        const observation = await readCheckoutObservation(
          client,
          command.cartId,
          receipt.preflightId,
        );
        const [session] = await draftRows(
          client,
          `SELECT s.status,o.order_status,o.payment_status,s.quote_expires_at<=clock_timestamp() expired,${cartTimestamp("clock_timestamp()")} evaluated_at FROM public.checkout_sessions s JOIN public.orders o ON o.checkout_session_id=s.id AND o.cart_id=s.cart_id WHERE s.id=$1::uuid AND s.cart_id=$2::uuid`,
          [command.checkoutSessionId, command.cartId],
        );
        return checkoutPreflightSessionRecordSchema.parse({
          schemaVersion: 1,
          receipt,
          observation,
          evaluatedAt: session?.["evaluated_at"],
          expired: session?.["expired"],
          status: session?.["status"],
          orderStatus: session?.["order_status"],
          paymentStatus: session?.["payment_status"],
        });
      });
    },
  };
}

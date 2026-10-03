import {
  orderAccessIssueCommandSchema,
  orderAccessExchangeCommandSchema,
  orderAccessBootstrapCommandSchema,
  orderAccessReadCommandSchema,
  orderAccessRevokeCommandSchema,
  orderAccessLocateCommandSchema,
  orderAccessProofCommandSchema,
  orderAccessRateCommandSchema,
  orderAccessGrantSchema,
  orderAccessRevokedSchema,
  orderAccessLocatedSchema,
} from "@fan-support/contracts";
import {
  CartRuntimeRepositoryError,
  OrderAccessRepositoryError,
  type OrderAccessRepository,
} from "@fan-support/persistence-port";
import { findCartForUpdate } from "./cart-runtime-data.js";
import { draftRows } from "./content-draft-data.js";
import {
  activeAccessSession,
  activeAccessToken,
  confirmBootstrapCart,
  locatedSessionOrder,
  lockAccessOrder,
  oneAccessRow,
  orderAccessOrderColumns,
  rejectOrderAccess,
  requirePaidOrder,
  sessionOwner,
  tokenOwner,
} from "./order-access-data.js";
import {
  locateOrderAccessProof,
  readOrderAccessDetail,
} from "./order-access-read.js";
import { consumeOrderAccessRate } from "./order-access-rate.js";
import {
  auditOrderAccess,
  consumeAccessToken,
  insertAccessToken,
  retireAccessSessions,
  retireAccessTokens,
} from "./order-access-write.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

export function createOrderAccessRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  publicMediaBaseUrl: string,
): OrderAccessRepository {
  const run = <Result>(work: () => Promise<Result>): Promise<Result> =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof OrderAccessRepositoryError) throw error;
        if (error instanceof CartRuntimeRepositoryError)
          return rejectOrderAccess("ACCESS_DENIED");
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  return {
    issue(input) {
      return run(async () => {
        const parsed = orderAccessIssueCommandSchema.safeParse(input);
        if (!parsed.success) return rejectOrderAccess("INVALID_REQUEST");
        const command = parsed.data;
        const owner = oneAccessRow(
          await draftRows(
            client,
            `SELECT cart_id FROM public.orders WHERE id=$1::uuid`,
            [command.orderId],
          ),
        );
        const order = await lockAccessOrder(
          client,
          command.orderId,
          owner["cart_id"],
        );
        requirePaidOrder(order);
        await retireAccessTokens(client, order["id"]);
        await retireAccessSessions(client, order["id"]);
        const token = await insertAccessToken(
          client,
          order["id"],
          command.tokenCredential,
          command.linkTtlSeconds,
        );
        await auditOrderAccess(
          client,
          command,
          "ISSUE",
          order["id"],
          token["id"],
          null,
        );
        return orderAccessGrantSchema.parse({
          schemaVersion: 1,
          publicOrderId: order["public_order_id"],
          expiresAt: token["expires_at"],
        });
      });
    },
    exchange(input) {
      return run(async () => {
        const parsed = orderAccessExchangeCommandSchema.safeParse(input);
        if (!parsed.success) return rejectOrderAccess("INVALID_REQUEST");
        const command = parsed.data;
        const owner = await tokenOwner(client, command.tokenCandidates);
        const order = await lockAccessOrder(
          client,
          owner["order_id"],
          owner["cart_id"],
        );
        const token = await activeAccessToken(
          client,
          order["id"],
          command.tokenCandidates,
        );
        requirePaidOrder(order);
        await retireAccessSessions(client, order["id"]);
        const session = await consumeAccessToken(
          client,
          order,
          token["id"],
          command.sessionCredential,
          command.sessionTtlSeconds,
        );
        await auditOrderAccess(
          client,
          command,
          "EXCHANGE",
          order["id"],
          token["id"],
          session.sessionId,
        );
        return session.grant;
      });
    },
    bootstrap(input) {
      return run(async () => {
        const parsed = orderAccessBootstrapCommandSchema.safeParse(input);
        if (!parsed.success) return rejectOrderAccess("INVALID_REQUEST");
        const command = parsed.data;
        const cart = await findCartForUpdate(client, command.cartAccesses);
        if (!cart || cart.expired || cart.status === "EXPIRED")
          return rejectOrderAccess("ACCESS_DENIED");
        const order = oneAccessRow(
          await draftRows(
            client,
            `SELECT ${orderAccessOrderColumns} FROM public.orders o WHERE o.checkout_session_id=$1::uuid AND o.cart_id=$2::uuid FOR UPDATE OF o`,
            [command.checkoutSessionId, cart.id],
          ),
        );
        requirePaidOrder(order);
        if (cart.status !== "CONVERTED")
          return rejectOrderAccess("PAYMENT_NOT_CONFIRMED");
        await confirmBootstrapCart(client, cart.id);
        await retireAccessSessions(client, order["id"]);
        const token = await insertAccessToken(
          client,
          order["id"],
          command.tokenCredential,
          command.sessionTtlSeconds,
          "CHECKOUT_BOOTSTRAP",
        );
        const session = await consumeAccessToken(
          client,
          order,
          token["id"],
          command.sessionCredential,
          command.sessionTtlSeconds,
        );
        await auditOrderAccess(
          client,
          command,
          "BOOTSTRAP",
          order["id"],
          token["id"],
          session.sessionId,
        );
        await confirmBootstrapCart(client, cart.id);
        return session.grant;
      });
    },
    read(input) {
      return run(async () => {
        const parsed = orderAccessReadCommandSchema.safeParse(input);
        if (!parsed.success) return rejectOrderAccess("INVALID_REQUEST");
        const command = parsed.data;
        const owner = await sessionOwner(
          client,
          command.sessionCandidates,
          command.publicOrderId,
        );
        const order = await lockAccessOrder(
          client,
          owner["order_id"],
          owner["cart_id"],
        );
        await activeAccessSession(
          client,
          order["id"],
          command.publicOrderId,
          command.sessionCandidates,
        );
        const detail = await readOrderAccessDetail(
          client,
          order,
          publicMediaBaseUrl,
        );
        // A large historical projection can cross a short expiry without releasing its row locks.
        await activeAccessSession(
          client,
          order["id"],
          command.publicOrderId,
          command.sessionCandidates,
        );
        return detail;
      });
    },
    revoke(input) {
      return run(async () => {
        const parsed = orderAccessRevokeCommandSchema.safeParse(input);
        if (!parsed.success) return rejectOrderAccess("INVALID_REQUEST");
        const command = parsed.data;
        const owner = await sessionOwner(
          client,
          command.sessionCandidates,
          command.publicOrderId,
        );
        const order = await lockAccessOrder(
          client,
          owner["order_id"],
          owner["cart_id"],
        );
        const session = await activeAccessSession(
          client,
          order["id"],
          command.publicOrderId,
          command.sessionCandidates,
        );
        await retireAccessTokens(client, order["id"]);
        await retireAccessSessions(client, order["id"]);
        await auditOrderAccess(
          client,
          command,
          "REVOKE",
          order["id"],
          session["exchanged_token_id"],
          session["id"],
        );
        return orderAccessRevokedSchema.parse({
          schemaVersion: 1,
          publicOrderId: command.publicOrderId,
        });
      });
    },
    locate(input) {
      return run(async () => {
        const parsed = orderAccessLocateCommandSchema.safeParse(input);
        if (!parsed.success) return rejectOrderAccess("INVALID_REQUEST");
        // Resolves an identifier only; the following read re-authorizes under aggregate locks.
        const session = await locatedSessionOrder(
          client,
          parsed.data.sessionCandidates,
          parsed.data.publicOrderNo,
        );
        return orderAccessLocatedSchema.parse({
          schemaVersion: 1,
          publicOrderId: session["public_order_id"],
        });
      });
    },
    locateProof(input) {
      return run(async () => {
        const parsed = orderAccessProofCommandSchema.safeParse(input);
        if (!parsed.success) return rejectOrderAccess("INVALID_REQUEST");
        return locateOrderAccessProof(client, parsed.data);
      });
    },
    consumeRateLimit(input) {
      return run(async () => {
        const parsed = orderAccessRateCommandSchema.safeParse(input);
        if (!parsed.success) return rejectOrderAccess("INVALID_REQUEST");
        return consumeOrderAccessRate(client, parsed.data);
      });
    },
  };
}

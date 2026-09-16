import {
  commerceExpiryCommandSchema,
  commerceExpiryListCommandSchema,
  commerceExpiryListResultSchema,
  commerceExpiryResultSchema,
  type CommerceExpiryCommand,
  type CommerceExpiryResult,
} from "@fan-support/contracts";
import {
  parsePersistenceTransactionFailure,
  PersistenceTransactionFailureError,
  type CommerceExpiryRepository,
  type InventoryRepository,
} from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import { cartTimestamp } from "./cart-runtime-data.js";
import {
  auditExpiry,
  cancelExpiredCheckout,
  expireAccess,
  expiryResult,
  rejectExpiry,
} from "./commerce-expiry-data.js";
import { expireInventory } from "./commerce-expiry-inventory.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

const terminalFailures = ["FAILED", "CANCELED", "EXPIRED"];
const dueSql = `WITH candidates AS (
  SELECT c.id cart_id,c.expires_at due_at FROM public.carts c
    WHERE c.status='ACTIVE' AND c.expires_at<=transaction_timestamp()
  UNION ALL
  SELECT o.cart_id,o.quote_expires_at FROM public.orders o JOIN public.carts c ON c.id=o.cart_id
    WHERE c.status='LOCKED' AND o.order_status='PENDING_PAYMENT' AND o.payment_status IN('UNPAID','PENDING')
      AND o.quote_expires_at<=transaction_timestamp()
      AND NOT EXISTS(SELECT 1 FROM public.payment_attempts a WHERE a.order_id=o.id AND a.status NOT IN('FAILED','CANCELED','EXPIRED'))
  UNION ALL
  SELECT o.cart_id,r.expires_at FROM public.inventory_reservations r JOIN public.orders o ON o.id=r.locked_order_id
    JOIN public.carts c ON c.id=o.cart_id JOIN public.payment_attempts a ON a.id=o.current_payment_attempt_id AND a.order_id=o.id
    WHERE c.status='LOCKED' AND o.order_status='PENDING_PAYMENT' AND o.payment_status='PENDING'
      AND a.status='UNKNOWN' AND r.status='ACTIVE' AND r.expires_at<=transaction_timestamp()
  UNION ALL
  SELECT o.cart_id,t.expires_at FROM public.order_access_tokens t JOIN public.orders o ON o.id=t.order_id
    WHERE t.status='ACTIVE' AND t.expires_at<=transaction_timestamp()
  UNION ALL
  SELECT o.cart_id,s.expires_at FROM public.order_access_sessions s JOIN public.orders o ON o.id=s.order_id
    WHERE s.status='ACTIVE' AND s.expires_at<=transaction_timestamp()
) SELECT cart_id FROM candidates GROUP BY cart_id ORDER BY min(due_at),cart_id LIMIT $1`;

async function expireCart(
  client: TransactionClient,
  inventory: InventoryRepository,
  command: CommerceExpiryCommand,
): Promise<CommerceExpiryResult> {
  // Never claim a child row before its cart. Payment application and access exchange own this same lock.
  const [cart] = await draftRows(
    client,
    `SELECT c.id,c.status,c.locked_order_id,c.version,c.expires_at<=transaction_timestamp() due,
      c.updated_at<=transaction_timestamp() AND transaction_timestamp()<=clock_timestamp() clock_valid,
      ${cartTimestamp("transaction_timestamp()")} at
     FROM public.carts c WHERE c.id=$1::uuid FOR UPDATE SKIP LOCKED`,
    [command.cartId],
  );
  if (!cart) return expiryResult("BUSY");
  if (cart["clock_valid"] !== true) return expiryResult("DEFERRED");
  const at = String(cart["at"]);
  const result = expiryResult("NOT_DUE");
  if (cart["status"] === "ACTIVE") {
    if (cart["due"] !== true) return result;
    const intents = await draftRows(
      client,
      `SELECT s.id,s.status,s.expires_at<=transaction_timestamp() due,s.updated_at<=transaction_timestamp() clock_valid,
        EXISTS(SELECT 1 FROM public.order_items o WHERE o.support_intent_id=s.id) ordered
       FROM public.cart_items i JOIN public.support_intents s ON s.cart_item_id=i.id WHERE i.cart_id=$1::uuid ORDER BY s.id FOR UPDATE OF s`,
      [command.cartId],
    );
    if (
      intents.some(
        (s) =>
          s["ordered"] === true ||
          !["ACTIVE", "CANCELED", "EXPIRED"].includes(String(s["status"])),
      )
    )
      rejectExpiry("INTEGRITY_VIOLATION");
    if (
      intents.some(
        (s) =>
          s["clock_valid"] !== true ||
          (s["status"] === "ACTIVE" && s["due"] !== true),
      )
    )
      return expiryResult("DEFERRED");
    const changed = await draftRows(
      client,
      `UPDATE public.support_intents SET status='EXPIRED',version=version+1,updated_at=$2::timestamptz WHERE cart_item_id IN(SELECT id FROM public.cart_items WHERE cart_id=$1::uuid) AND status='ACTIVE' AND expires_at<=$2::timestamptz AND expires_at<=clock_timestamp() RETURNING id`,
      [command.cartId, at],
    );
    if (
      changed.length !== intents.filter((s) => s["status"] === "ACTIVE").length
    )
      rejectExpiry("INTEGRITY_VIOLATION");
    result.expiredIntents = changed.length;
    const expired = await draftRows(
      client,
      `UPDATE public.carts SET status='EXPIRED',version=version+1,updated_at=$2::timestamptz WHERE id=$1::uuid AND status='ACTIVE' AND expires_at<=$2::timestamptz AND expires_at<=clock_timestamp() RETURNING id`,
      [command.cartId, at],
    );
    if (expired.length !== 1) rejectExpiry("INTEGRITY_VIOLATION");
    result.expiredCart = true;
    await auditExpiry(
      client,
      command,
      "CART",
      command.cartId,
      "CART_EXPIRED",
      "CART_LIFETIME_ELAPSED",
      at,
    );
  } else if (cart["locked_order_id"] !== null) {
    const [order] = await draftRows(
      client,
      `SELECT o.*,o.quote_expires_at<=transaction_timestamp() due,o.updated_at<=transaction_timestamp() clock_valid FROM public.orders o WHERE o.id=$1::uuid AND o.cart_id=$2::uuid FOR UPDATE OF o SKIP LOCKED`,
      [cart["locked_order_id"], command.cartId],
    );
    if (!order) return expiryResult("BUSY");
    if (order["clock_valid"] !== true) return expiryResult("DEFERRED");
    if (
      cart["status"] === "LOCKED" &&
      order["order_status"] === "PENDING_PAYMENT"
    ) {
      // Recovery may hold an attempt before its order. Skip contested attempts instead of reversing that lock.
      const attempts = await draftRows(
        client,
        `SELECT a.id,a.status,a.updated_at<=transaction_timestamp() clock_valid FROM public.payment_attempts a WHERE a.order_id=$1::uuid ORDER BY a.id FOR UPDATE OF a SKIP LOCKED`,
        [order["id"]],
      );
      const [count] = await draftRows(
        client,
        `SELECT count(*)::integer count FROM public.payment_attempts WHERE order_id=$1::uuid`,
        [order["id"]],
      );
      if (attempts.length !== Number(count?.["count"]))
        return expiryResult("BUSY");
      if (attempts.some((a) => a["clock_valid"] !== true))
        return expiryResult("DEFERRED");
      const current = attempts.find(
        (a) => a["id"] === order["current_payment_attempt_id"],
      );
      const canceled =
        order["due"] === true &&
        attempts.every((a) => terminalFailures.includes(String(a["status"]))) &&
        (attempts.length === 0
          ? order["current_payment_attempt_id"] === null &&
            order["payment_status"] === "UNPAID"
          : current !== undefined && order["payment_status"] === "PENDING");
      const unknown =
        current?.["status"] === "UNKNOWN" &&
        order["payment_status"] === "PENDING" &&
        attempts.every(
          (a) =>
            a === current || terminalFailures.includes(String(a["status"])),
        );
      if (canceled || unknown) {
        const intents = await draftRows(
          client,
          `SELECT s.id,s.status,s.updated_at<=transaction_timestamp() clock_valid FROM public.order_items i JOIN public.support_intents s ON s.id=i.support_intent_id WHERE i.order_id=$1::uuid ORDER BY s.id FOR UPDATE OF s`,
          [order["id"]],
        );
        if (
          !intents.length ||
          intents.some((s) => s["status"] !== "CHECKOUT_LOCKED")
        )
          rejectExpiry("INTEGRITY_VIOLATION");
        if (intents.some((s) => s["clock_valid"] !== true))
          return expiryResult("DEFERRED");
        const [session] = await draftRows(
          client,
          `SELECT id,status,updated_at<=transaction_timestamp() clock_valid FROM public.checkout_sessions WHERE id=$1::uuid FOR UPDATE SKIP LOCKED`,
          [order["checkout_session_id"]],
        );
        if (!session) return expiryResult("BUSY");
        if (session["clock_valid"] !== true) return expiryResult("DEFERRED");
        result.expiredReservations = await expireInventory(
          client,
          inventory,
          order["id"],
          at,
          command,
        );
        if (canceled) {
          const [active] = await draftRows(
            client,
            `SELECT count(*)::integer count FROM public.inventory_reservations WHERE locked_order_id=$1::uuid AND status='ACTIVE'`,
            [order["id"]],
          );
          if (Number(active?.["count"]) !== 0)
            rejectExpiry("INTEGRITY_VIOLATION");
          await cancelExpiredCheckout(client, command, order, at, result);
          if (result.canceledIntents !== intents.length)
            rejectExpiry("INTEGRITY_VIOLATION");
        }
      } else if (
        attempts.some((a) => !terminalFailures.includes(String(a["status"])))
      )
        result.decision = "DEFERRED";
    }
    await expireAccess(client, command, order["id"], at, result);
  }
  if (
    result.expiredCart ||
    result.expiredIntents ||
    result.expiredReservations ||
    result.expiredTokens ||
    result.expiredSessions ||
    result.canceledOrders
  )
    result.decision = "APPLIED";
  return commerceExpiryResultSchema.parse(result);
}

export function createCommerceExpiryRepository(
  client: TransactionClient,
  inventory: InventoryRepository,
  scope: TransactionScopeControl,
): CommerceExpiryRepository {
  const run = <T>(work: () => Promise<T>) =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        const failure = parsePersistenceTransactionFailure(error);
        if (failure) throw new PersistenceTransactionFailureError(failure);
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  return {
    listDue(input) {
      return run(async () => {
        const parsed = commerceExpiryListCommandSchema.safeParse(input);
        if (!parsed.success) return rejectExpiry("INVALID_COMMAND");
        const rows = await draftRows(client, dueSql, [parsed.data.limit]);
        return commerceExpiryListResultSchema.parse({
          schemaVersion: 1,
          cartIds: rows.map((row) => row["cart_id"]),
        });
      });
    },
    expireCart(input) {
      return run(async () => {
        const parsed = commerceExpiryCommandSchema.safeParse(input);
        if (!parsed.success) return rejectExpiry("INVALID_COMMAND");
        return expireCart(client, inventory, parsed.data);
      });
    },
  };
}

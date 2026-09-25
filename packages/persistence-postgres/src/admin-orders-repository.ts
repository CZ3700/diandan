import {
  adminOrdersStoreRequestSchema,
  adminOrdersConfirmPrivateSchema,
  adminOrdersResponseSchema,
  type AdminOrdersPermission,
  type AdminOrdersStoreRequest,
} from "@fan-support/contracts";
import type { AdminOrdersRepository } from "@fan-support/persistence-port";
import {
  adminOrdersFailure,
  lockAdminOrder,
  readAdminOrderReceipt,
} from "./admin-orders-data.js";
import {
  authorizeAdminOrders,
  confirmAdminOrdersAuthority,
  readAdminOrdersCapabilities,
} from "./admin-orders-authorization.js";
import {
  prepareAdminOrderPrivate,
  confirmAdminOrderPrivate,
} from "./admin-orders-private.js";
import {
  readAdminOrdersList,
  readAdminOrdersDetail,
} from "./admin-orders-read.js";
import {
  addAdminOrderNote,
  reviewAdminOrderMessage,
  mutateAdminOrderFulfillment,
} from "./admin-orders-write.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";
function permission(
  command: AdminOrdersStoreRequest["command"],
): AdminOrdersPermission {
  switch (command.action) {
    case "REVIEW_MESSAGE":
      return "orders.message.review";
    case "PREPARE":
    case "DELIVER":
      return "orders.fulfillment";
    case "HOLD":
    case "RESUME":
      return "orders.manage";
    case "ADD_NOTE":
      return "orders.note";
    default:
      return "orders.read";
  }
}
/** Only canonical PG facts and short, audited transactions cross this boundary. */
export function createAdminOrdersRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  configuration: { publicMediaBaseUrl: string },
): AdminOrdersRepository {
  const tracked = <T>(work: () => Promise<T>) =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  return {
    execute: (input) =>
      tracked(async () => {
        const parsed = adminOrdersStoreRequestSchema.safeParse(input);
        if (!parsed.success) return adminOrdersFailure("INVALID_COMMAND");
        const request = parsed.data,
          c = request.command;
        if (
          ["READ_MESSAGE", "READ_NOTES", "RESEND_NOTIFICATION"].includes(
            c.action,
          )
        )
          return adminOrdersFailure("INVALID_COMMAND");
        if (c.action === "CONTEXT") {
          const result = await readAdminOrdersCapabilities(
            client,
            request.access,
          );
          if (result.outcome === "FAILURE") return result;
          return adminOrdersResponseSchema.parse({
            schemaVersion: 1,
            outcome: "SUCCESS",
            kind: "CONTEXT",
            actorId: result.principal.actorId,
            permissions: result.principal.permissions,
            reviewLocales: result.principal.reviewLocales,
          });
        }
        const auth = await authorizeAdminOrders(client, request.access, {
          permission: permission(c),
          ...(c.action === "REVIEW_MESSAGE"
            ? { reviewLocale: c.reviewLocale }
            : {}),
        });
        if (auth.outcome === "FAILURE") return auth;
        const principal = auth.principal;
        if (!principal.permissions.includes("orders.read"))
          return adminOrdersFailure("FORBIDDEN");
        if (c.action === "LIST") return readAdminOrdersList(client, request);
        if (!("orderId" in c)) return adminOrdersFailure("INVALID_COMMAND");
        if ("idempotencyKey" in c)
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [
              `admin-orders:${principal.actorId}:${c.action}:${c.idempotencyKey}`,
            ],
          );
        const order = await lockAdminOrder(client, c.orderId);
        if (!order) return adminOrdersFailure("NOT_FOUND");
        const expired = await confirmAdminOrdersAuthority(client, principal);
        if (expired) return expired;
        if (c.action === "DETAIL")
          return readAdminOrdersDetail(
            client,
            order,
            principal,
            configuration.publicMediaBaseUrl,
          );
        const prior = await readAdminOrderReceipt(client, request, principal);
        if (prior) return prior;
        if (!("expectedOrderVersion" in c))
          return adminOrdersFailure("INVALID_COMMAND");
        if (Number(order["version"]) !== c.expectedOrderVersion)
          return adminOrdersFailure("STALE_VERSION");
        if (order["writable_at_transaction"] !== true)
          return adminOrdersFailure("CONFLICT");
        if (c.action === "ADD_NOTE")
          return addAdminOrderNote(client, request, principal);
        if (c.action === "REVIEW_MESSAGE")
          return reviewAdminOrderMessage(client, request, principal);
        return mutateAdminOrderFulfillment(client, request, principal, order);
      }),
    preparePrivate: (input) =>
      tracked(async () => {
        const parsed = adminOrdersStoreRequestSchema.safeParse(input);
        return parsed.success
          ? prepareAdminOrderPrivate(client, parsed.data)
          : adminOrdersFailure("INVALID_COMMAND");
      }),
    confirmPrivate: (input) =>
      tracked(async () => {
        const parsed = adminOrdersConfirmPrivateSchema.safeParse(input);
        return parsed.success
          ? confirmAdminOrderPrivate(client, parsed.data)
          : adminOrdersFailure("INVALID_COMMAND");
      }),
  };
}

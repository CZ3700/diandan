import {
  adminOrdersStoreRequestSchema,
  adminOrdersConfirmPrivateSchema,
  adminOrdersProofCompletionSchema,
  adminOrdersResponseSchema,
  type AdminOrdersAccess,
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
  attachDeliveryProofs,
  withdrawDeliveryProof,
} from "./admin-order-proofs-write.js";
import { readAdminProofRendition } from "./admin-order-proofs-read.js";
import {
  completeAdminProofUpload,
  readAdminProofUpload,
  replayProofReservation,
  reserveAdminProofUpload,
} from "./admin-order-proof-uploads.js";
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
    case "BEGIN_PROOF_UPLOAD":
    case "COMPLETE_PROOF_UPLOAD":
    case "ATTACH_PROOFS":
      return "orders.fulfillment";
    case "HOLD":
    case "RESUME":
    case "WITHDRAW_PROOF":
      return "orders.manage";
    case "ADD_NOTE":
      return "orders.note";
    default:
      return "orders.read";
  }
}
/** Authorizes a proof step, then confirms the principal still reads orders. */
async function proofPrincipal(
  client: TransactionClient,
  access: AdminOrdersAccess,
  permission: AdminOrdersPermission,
) {
  const auth = await authorizeAdminOrders(client, access, { permission });
  if (auth.outcome === "FAILURE") return auth;
  if (!auth.principal.permissions.includes("orders.read"))
    return adminOrdersFailure("FORBIDDEN");
  const expired = await confirmAdminOrdersAuthority(client, auth.principal);
  return expired ?? auth;
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
          [
            "READ_MESSAGE",
            "READ_NOTES",
            "RESEND_NOTIFICATION",
            "BEGIN_PROOF_UPLOAD",
            "COMPLETE_PROOF_UPLOAD",
            "VIEW_PROOF",
          ].includes(c.action)
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
        if (c.action === "ATTACH_PROOFS")
          return attachDeliveryProofs(client, request, principal);
        if (c.action === "WITHDRAW_PROOF")
          return withdrawDeliveryProof(client, request, principal);
        return mutateAdminOrderFulfillment(client, request, principal, order);
      }),
    reserveProofUpload: (input) =>
      tracked(async () => {
        const parsed = adminOrdersStoreRequestSchema.safeParse(input);
        if (
          !parsed.success ||
          parsed.data.command.action !== "BEGIN_PROOF_UPLOAD"
        )
          return adminOrdersFailure("INVALID_COMMAND");
        const request = parsed.data,
          c = parsed.data.command;
        const auth = await authorizeAdminOrders(client, request.access, {
          permission: "orders.fulfillment",
        });
        if (auth.outcome === "FAILURE") return auth;
        const principal = auth.principal;
        if (!principal.permissions.includes("orders.read"))
          return adminOrdersFailure("FORBIDDEN");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`admin-orders:${principal.actorId}:${c.action}:${c.idempotencyKey}`],
        );
        const order = await lockAdminOrder(client, c.orderId);
        if (!order) return adminOrdersFailure("NOT_FOUND");
        const expired = await confirmAdminOrdersAuthority(client, principal);
        if (expired) return expired;
        const prior = await readAdminOrderReceipt(client, request, principal);
        if (prior?.outcome === "FAILURE") return prior;
        if (prior)
          return replayProofReservation(
            client,
            request,
            principal,
            prior.resultId,
          );
        if (Number(order["version"]) !== c.expectedOrderVersion)
          return adminOrdersFailure("STALE_VERSION");
        if (order["writable_at_transaction"] !== true)
          return adminOrdersFailure("CONFLICT");
        return reserveAdminProofUpload(client, request, principal);
      }),
    readProofUpload: (input) =>
      tracked(async () => {
        const parsed = adminOrdersStoreRequestSchema.safeParse(input);
        if (
          !parsed.success ||
          parsed.data.command.action !== "COMPLETE_PROOF_UPLOAD"
        )
          return adminOrdersFailure("INVALID_COMMAND");
        const auth = await proofPrincipal(
          client,
          parsed.data.access,
          "orders.fulfillment",
        );
        if (auth.outcome === "FAILURE") return auth;
        return readAdminProofUpload(client, parsed.data, auth.principal);
      }),
    completeProofUpload: (input) =>
      tracked(async () => {
        const parsed = adminOrdersProofCompletionSchema.safeParse(input);
        if (!parsed.success) return adminOrdersFailure("INVALID_COMMAND");
        const auth = await proofPrincipal(
          client,
          parsed.data.access,
          "orders.fulfillment",
        );
        if (auth.outcome === "FAILURE") return auth;
        return completeAdminProofUpload(client, parsed.data, auth.principal);
      }),
    readProofRendition: (input) =>
      tracked(async () => {
        const parsed = adminOrdersStoreRequestSchema.safeParse(input);
        if (!parsed.success || parsed.data.command.action !== "VIEW_PROOF")
          return adminOrdersFailure("INVALID_COMMAND");
        const auth = await proofPrincipal(
          client,
          parsed.data.access,
          "orders.read",
        );
        if (auth.outcome === "FAILURE") return auth;
        return readAdminProofRendition(client, parsed.data, auth.principal);
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

import { createHmac } from "node:crypto";
import {
  adminOrdersAccessSchema,
  adminOrdersFailureSchema,
  adminOrdersPrivateConfirmationSchema,
  adminOrdersPrivateSnapshotSchema,
  adminOrdersRequestSchema,
  adminOrdersResponseSchema,
  adminOrdersStoreRequestSchema,
  type AdminOrdersCommand,
  type AdminOrdersFailure,
  type AdminOrdersPrivateResponse,
  type AdminOrdersRequest,
  type AdminOrdersResponse,
  type AdminOrdersStoreRequest,
} from "@fan-support/contracts";
import type {
  AdminOrdersTransactionManager,
  JsonValue,
} from "@fan-support/persistence-port";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";
import {
  decryptAdminOrdersPrivate,
  encryptAdminOrderNote,
} from "./admin-orders-private.js";

export type AdminOrdersDependencies = Readonly<{
  transactions: AdminOrdersTransactionManager;
  keys: KeyManagementPort;
  tokenPepper: string;
}>;
export type AdminOrdersUseCases = Readonly<{
  execute(
    input: unknown,
  ): Promise<AdminOrdersResponse | AdminOrdersPrivateResponse>;
}>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as JsonValue;
const failure = (code: AdminOrdersFailure["code"]): AdminOrdersFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});

function storeRequest(request: AdminOrdersRequest, tokenPepper: string) {
  const { command } = request;
  const access = adminOrdersAccessSchema.parse({
    schemaVersion: 1,
    requestId: request.requestId,
    correlationId: request.requestId,
    sessionTokenDigest: digestAdminContentToken({
      tokenPepper,
      purpose: "admin-session",
      token: request.sessionToken,
    }),
    csrfTokenDigest: digestAdminContentToken({
      tokenPepper,
      purpose: "admin-csrf",
      token: request.csrfToken,
    }),
  });
  // Keyed fingerprints do not disclose low-entropy free-form notes in idempotency storage.
  const requestHash =
    "idempotencyKey" in command
      ? createHmac("sha256", Buffer.from(tokenPepper, "hex"))
          .update("fan-support:admin-orders:v1:")
          .update(JSON.stringify(command))
          .digest("hex")
      : null;
  return { schemaVersion: 1 as const, access, command, requestHash };
}

async function readPrivate(
  dependencies: AdminOrdersDependencies,
  input: AdminOrdersStoreRequest,
) {
  const command = input.command;
  if (command.action !== "READ_MESSAGE" && command.action !== "READ_NOTES")
    return failure("INVALID_COMMAND");
  const raw = await dependencies.transactions.runInAdminOrdersTransaction(
    async ({ adminOrders }) => json(await adminOrders.preparePrivate(input)),
  );
  const denied = adminOrdersFailureSchema.safeParse(raw);
  if (denied.success) return denied.data;
  const snapshot = adminOrdersPrivateSnapshotSchema.parse(raw);
  if (
    snapshot.orderId !== command.orderId ||
    (command.action === "READ_MESSAGE"
      ? snapshot.kind !== "MESSAGE" ||
        snapshot.itemId !== command.itemId ||
        snapshot.intentVersion !== command.expectedIntentVersion ||
        snapshot.reviewLocale !== command.reviewLocale
      : snapshot.kind !== "NOTES")
  )
    return failure("TEMPORARY_UNAVAILABLE");
  const content = await decryptAdminOrdersPrivate(dependencies.keys, snapshot);
  const confirmed = await dependencies.transactions.runInAdminOrdersTransaction(
    async ({ adminOrders }) =>
      json(
        await adminOrders.confirmPrivate({
          schemaVersion: 1,
          access: input.access,
          accessId: snapshot.accessId,
        }),
      ),
  );
  const revoked = adminOrdersFailureSchema.safeParse(confirmed);
  if (revoked.success) return revoked.data;
  const authority = adminOrdersPrivateConfirmationSchema.parse(confirmed);
  return authority.accessId === snapshot.accessId
    ? content
    : failure("TEMPORARY_UNAVAILABLE");
}

function validateResultTarget(
  response: AdminOrdersResponse,
  command: AdminOrdersCommand,
) {
  if (response.outcome === "FAILURE") return response;
  switch (command.action) {
    case "CONTEXT":
      if (response.kind !== "CONTEXT") return failure("TEMPORARY_UNAVAILABLE");
      break;
    case "LIST":
      if (
        response.kind !== "LIST" ||
        response.page !== command.page ||
        response.pageSize !== command.pageSize
      )
        return failure("TEMPORARY_UNAVAILABLE");
      break;
    case "DETAIL":
      if (response.kind !== "DETAIL" || response.orderId !== command.orderId)
        return failure("TEMPORARY_UNAVAILABLE");
      break;
    default:
      if (response.kind !== "MUTATION" || response.orderId !== command.orderId)
        return failure("TEMPORARY_UNAVAILABLE");
  }
  return response;
}

/** Authenticated operations stay in PostgreSQL; only audited encryption/decryption crosses transactions. */
export function createAdminOrdersUseCases(
  dependencies: AdminOrdersDependencies,
): AdminOrdersUseCases {
  if (
    typeof dependencies?.transactions?.runInAdminOrdersTransaction !==
      "function" ||
    typeof dependencies.keys?.decryptEnvelope !== "function" ||
    typeof dependencies.keys?.encryptEnvelope !== "function"
  )
    throw new TypeError("Invalid admin orders configuration");
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  return Object.freeze({
    async execute(input: unknown) {
      const parsed = adminOrdersRequestSchema.safeParse(input);
      if (!parsed.success) return failure("INVALID_COMMAND");
      try {
        const raw = storeRequest(parsed.data, dependencies.tokenPepper);
        let stored: AdminOrdersStoreRequest;
        if (raw.command.action === "ADD_NOTE") {
          const context = adminOrdersResponseSchema.parse(
            await dependencies.transactions.runInAdminOrdersTransaction(
              async ({ adminOrders }) =>
                json(
                  await adminOrders.execute(
                    adminOrdersStoreRequestSchema.parse({
                      ...raw,
                      command: { schemaVersion: 1, action: "CONTEXT" },
                      requestHash: null,
                    }),
                  ),
                ),
            ),
          );
          if (context.outcome === "FAILURE") return context;
          if (
            context.kind !== "CONTEXT" ||
            !context.permissions.includes("orders.note")
          )
            return failure("FORBIDDEN");
          const { note, ...command } = raw.command;
          stored = adminOrdersStoreRequestSchema.parse({
            ...raw,
            command: {
              ...command,
              envelope: await encryptAdminOrderNote(dependencies.keys, note),
            },
          });
        } else stored = adminOrdersStoreRequestSchema.parse(raw);
        if (
          stored.command.action === "READ_MESSAGE" ||
          stored.command.action === "READ_NOTES"
        )
          return await readPrivate(dependencies, stored);
        const response = adminOrdersResponseSchema.parse(
          await dependencies.transactions.runInAdminOrdersTransaction(
            async ({ adminOrders, adminOrderResends }) =>
              json(
                stored.command.action === "RESEND_NOTIFICATION"
                  ? await adminOrderResends.request(stored)
                  : await adminOrders.execute(stored),
              ),
          ),
        );
        return validateResultTarget(response, parsed.data.command);
      } catch {
        return failure("TEMPORARY_UNAVAILABLE");
      }
    },
  });
}

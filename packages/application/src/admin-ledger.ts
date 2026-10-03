import {
  adminLedgerFailureSchema,
  adminLedgerRequestSchema,
  adminLedgerResponseSchema,
  adminLedgerTimeZoneSchema,
  adminOrdersAccessSchema,
  adminOrdersPrivateConfirmationSchema,
  adminOrdersPrivateSnapshotSchema,
  type AdminLedgerFailure,
  type AdminLedgerMessageResponse,
  type AdminLedgerRequest,
  type AdminLedgerResponse,
  type AdminLedgerStoreRequest,
} from "@fan-support/contracts";
import type {
  AdminLedgerTransactionManager,
  JsonValue,
} from "@fan-support/persistence-port";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";
import { decryptAdminOrdersPrivate } from "./admin-orders-private.js";

/** ADR-022 / L3-12: the artist ledger. Figures stay in PostgreSQL; only an audited message read decrypts. */
export type AdminLedgerDependencies = Readonly<{
  transactions: AdminLedgerTransactionManager;
  keys: KeyManagementPort;
  tokenPepper: string;
  /** Deployment configuration: the IANA zone whose calendar days the ledger reports (Asia/Shanghai by default). */
  timeZone: string;
}>;
export type AdminLedgerUseCases = Readonly<{
  execute(
    input: unknown,
  ): Promise<AdminLedgerResponse | AdminLedgerMessageResponse>;
}>;

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as JsonValue;
const failure = (code: AdminLedgerFailure["code"]): AdminLedgerFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});

function storeRequest(
  request: AdminLedgerRequest,
  tokenPepper: string,
  timeZone: string,
): AdminLedgerStoreRequest {
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
  return { schemaVersion: 1, access, command: request.command, timeZone };
}

async function readMessage(
  dependencies: AdminLedgerDependencies,
  input: AdminLedgerStoreRequest,
): Promise<AdminLedgerMessageResponse> {
  const command = input.command;
  if (command.action !== "READ_MESSAGE") return failure("INVALID_COMMAND");
  const raw = await dependencies.transactions.runInAdminLedgerTransaction(
    async ({ adminLedger }) => json(await adminLedger.prepareMessage(input)),
  );
  const denied = adminLedgerFailureSchema.safeParse(raw);
  if (denied.success) return denied.data;
  const snapshot = adminOrdersPrivateSnapshotSchema.parse(raw);
  if (
    snapshot.kind !== "MESSAGE" ||
    snapshot.orderId !== command.orderId ||
    snapshot.itemId !== command.itemId ||
    snapshot.intentVersion !== command.expectedIntentVersion ||
    snapshot.reviewLocale !== command.reviewLocale
  )
    return failure("TEMPORARY_UNAVAILABLE");
  const content = await decryptAdminOrdersPrivate(dependencies.keys, snapshot);
  const confirmed = await dependencies.transactions.runInAdminLedgerTransaction(
    async ({ adminLedger }) =>
      json(
        await adminLedger.confirmMessage({
          schemaVersion: 1,
          access: input.access,
          accessId: snapshot.accessId,
        }),
      ),
  );
  const revoked = adminLedgerFailureSchema.safeParse(confirmed);
  if (revoked.success) return revoked.data;
  const authority = adminOrdersPrivateConfirmationSchema.parse(confirmed);
  if (
    authority.accessId !== snapshot.accessId ||
    content.outcome !== "SUCCESS" ||
    content.kind !== "MESSAGE"
  )
    return failure("TEMPORARY_UNAVAILABLE");
  return content;
}

function validTimeZone(timeZone: string): boolean {
  if (!adminLedgerTimeZoneSchema.safeParse(timeZone).success) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function createAdminLedgerUseCases(
  dependencies: AdminLedgerDependencies,
): AdminLedgerUseCases {
  if (
    typeof dependencies?.transactions?.runInAdminLedgerTransaction !==
      "function" ||
    typeof dependencies.keys?.decryptEnvelope !== "function" ||
    !validTimeZone(dependencies.timeZone)
  )
    throw new TypeError("Invalid admin ledger configuration");
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  return Object.freeze({
    async execute(input: unknown) {
      const parsed = adminLedgerRequestSchema.safeParse(input);
      if (!parsed.success) return failure("INVALID_COMMAND");
      try {
        const stored = storeRequest(
          parsed.data,
          dependencies.tokenPepper,
          dependencies.timeZone,
        );
        if (stored.command.action === "READ_MESSAGE")
          return await readMessage(dependencies, stored);
        const response = adminLedgerResponseSchema.parse(
          await dependencies.transactions.runInAdminLedgerTransaction(
            async ({ adminLedger }) => json(await adminLedger.execute(stored)),
          ),
        );
        // Each read answers with its own kind; anything else is a store fault, never something to show.
        return response.outcome === "FAILURE" ||
          response.kind === stored.command.action
          ? response
          : failure("TEMPORARY_UNAVAILABLE");
      } catch {
        return failure("TEMPORARY_UNAVAILABLE");
      }
    },
  });
}

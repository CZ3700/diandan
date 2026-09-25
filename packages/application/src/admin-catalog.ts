import { createHash } from "node:crypto";
import {
  adminAuthorizationResponseSchema,
  adminCatalogRequestSchema,
  adminCatalogResponseSchema,
  adminCatalogMutationSchema,
  idolHandleResolutionCommandSchema,
  idolHandleResolutionSchema,
  persistencePortResponseSchema,
  sourceHashSchema,
  SUPPORTED_LOCALES,
  type AdminCatalogRequest,
  type AdminCatalogResponse,
  type PersistencePortError,
} from "@fan-support/contracts";
import type {
  AdminCatalogRepositories,
  AdminCatalogTransactionManager,
  JsonValue,
} from "@fan-support/persistence-port";
import { parsePersistenceTransactionFailure } from "@fan-support/persistence-port";
import {
  adminContentErrorResult,
  adminContentFailure,
  rejectAdminContent,
  requireAdminSuccess,
} from "./admin-content-results.js";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
function rejectPersistence(error: PersistencePortError): never {
  return rejectAdminContent(
    error.code === "TRANSACTION_ABORTED" || error.code === "VERSION_CONFLICT"
      ? "CONFLICT"
      : error.code === "IDEMPOTENCY_CONFLICT"
        ? "IDEMPOTENCY_CONFLICT"
        : "CONTENT_UNAVAILABLE",
  );
}
async function execute(
  repositories: AdminCatalogRepositories,
  request: AdminCatalogRequest,
  tokenPepper: string,
): Promise<AdminCatalogResponse> {
  const command = request.command;
  const read =
    command.action === "READ_OWNER" ||
    command.action === "READ_HISTORY" ||
    command.action === "LIST_OWNERS";
  const permission = read ? "content.read" : "content.edit";
  const principal = requireAdminSuccess(
    adminAuthorizationResponseSchema.parse(
      await repositories.authorization.authorize({
        schemaVersion: 1,
        permission,
        locales: read
          ? "locale" in command
            ? [command.locale]
            : []
          : [...SUPPORTED_LOCALES],
        sessionTokenDigest: sourceHashSchema.parse(
          digestAdminContentToken({
            tokenPepper,
            purpose: "admin-session",
            token: request.sessionToken,
          }),
        ),
        csrfTokenDigest: sourceHashSchema.parse(
          digestAdminContentToken({
            tokenPepper,
            purpose: "admin-csrf",
            token: request.csrfToken,
          }),
        ),
      }),
    ),
  ).principal;
  if (
    command.action === "READ_OWNER" ||
    command.action === "READ_HISTORY" ||
    command.action === "LIST_OWNERS"
  )
    return requireAdminSuccess(
      adminCatalogResponseSchema.parse(
        await repositories.adminCatalog.read(command),
      ),
    );
  const identity = {
    schemaVersion: 1 as const,
    actor: `actor-ref:v1:admin:${principal.actorId.toLowerCase()}`,
    idempotencyOperation: `admin.catalog.${command.action.toLowerCase()}`,
    idempotencyKey: command.idempotencyKey,
    canonicalRequestHash: createHash("sha256")
      .update(
        JSON.stringify(
          canonical({ purpose: "admin-catalog-command-v1", command }),
        ),
      )
      .digest("hex"),
  };
  const begin = persistencePortResponseSchema.parse(
    await repositories.idempotency.begin({
      ...identity,
      operation: "BEGIN_IDEMPOTENCY",
      expiresAt: new Date(
        Date.parse(principal.authorizedAt) + 86_400_000,
      ).toISOString(),
    }),
  );
  if (begin.outcome === "FAILURE") rejectPersistence(begin.error);
  if (begin.operation !== "BEGIN_IDEMPOTENCY")
    rejectAdminContent("CONTENT_UNAVAILABLE");
  if (begin.value.decision === "CONFLICT")
    rejectAdminContent("IDEMPOTENCY_CONFLICT");
  if (begin.value.decision === "IN_PROGRESS") rejectAdminContent("CONFLICT");
  if (begin.value.decision === "REPLAY") {
    const prefix = "result-ref:v1:";
    if (!begin.value.safeResultReference.startsWith(prefix))
      rejectAdminContent("CONTENT_UNAVAILABLE");
    const receipt = requireAdminSuccess(
      adminCatalogResponseSchema.parse(
        await repositories.adminCatalog.readReceipt({
          schemaVersion: 1,
          resultId: begin.value.safeResultReference.slice(prefix.length),
          actorId: principal.actorId,
        }),
      ),
    );
    if (receipt.kind !== "MUTATION") rejectAdminContent("CONTENT_UNAVAILABLE");
    return { ...receipt, replayed: true };
  }
  const result = requireAdminSuccess(
    adminCatalogResponseSchema.parse(
      await repositories.adminCatalog.write({
        schemaVersion: 1,
        requestId: request.requestId,
        principal,
        command,
      }),
    ),
  );
  if (
    result.kind !== "MUTATION" ||
    result.replayed ||
    result.baseVersion !== command.expectedBaseVersion + 1 ||
    (command.action !== "CREATE_IDOL" &&
      result.idolId.toLowerCase() !== command.idolId.toLowerCase()) ||
    (command.action === "CREATE_IDOL" &&
      (result.handle !== command.handle ||
        result.status !== "draft" ||
        result.acceptingGifts)) ||
    (command.action === "RENAME_IDOL" && result.handle !== command.newHandle) ||
    (command.action === "SET_IDOL_STATUS" &&
      (result.status !== command.status ||
        result.acceptingGifts !== command.acceptingGifts))
  )
    rejectAdminContent("CONTENT_UNAVAILABLE");
  const completed = persistencePortResponseSchema.parse(
    await repositories.idempotency.complete({
      ...identity,
      operation: "COMPLETE_IDEMPOTENCY",
      status: "SUCCEEDED",
      safeResultReference: `result-ref:v1:${result.resultId.toLowerCase()}`,
    }),
  );
  if (completed.outcome === "FAILURE") rejectPersistence(completed.error);
  if (completed.operation !== "COMPLETE_IDEMPOTENCY")
    rejectAdminContent("CONTENT_UNAVAILABLE");
  return adminCatalogMutationSchema.parse(result);
}
export type AdminCatalogDependencies = Readonly<{
  transactions: AdminCatalogTransactionManager;
  tokenPepper: string;
}>;
export function createAdminCatalogUseCases(
  dependencies: AdminCatalogDependencies,
) {
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  return Object.freeze({
    async execute(input: unknown): Promise<AdminCatalogResponse> {
      const parsed = adminCatalogRequestSchema.safeParse(input);
      if (!parsed.success) return adminContentFailure("INVALID_COMMAND");
      try {
        return adminCatalogResponseSchema.parse(
          await dependencies.transactions.runInAdminCatalogTransaction(
            async (repositories) =>
              JSON.parse(
                JSON.stringify(
                  await execute(
                    repositories,
                    parsed.data,
                    dependencies.tokenPepper,
                  ),
                ),
              ) as JsonValue,
          ),
        );
      } catch (error) {
        return parsePersistenceTransactionFailure(error)?.error.code ===
          "ALREADY_EXISTS"
          ? adminContentFailure("ALREADY_EXISTS")
          : adminContentErrorResult(error);
      }
    },
    async resolveHandle(input: unknown) {
      const parsed = idolHandleResolutionCommandSchema.safeParse(input);
      if (!parsed.success) return adminContentFailure("INVALID_COMMAND");
      try {
        return idolHandleResolutionSchema.parse(
          await dependencies.transactions.runInAdminCatalogTransaction(
            async (repositories) =>
              JSON.parse(
                JSON.stringify(
                  await repositories.adminCatalog.resolveHandle(parsed.data),
                ),
              ) as JsonValue,
          ),
        );
      } catch (error) {
        return adminContentErrorResult(error);
      }
    },
  });
}
export type AdminCatalogUseCases = ReturnType<
  typeof createAdminCatalogUseCases
>;

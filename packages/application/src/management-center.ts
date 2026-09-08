import { createHash } from "node:crypto";
import {
  managementCenterAuthorizationSchema,
  managementCenterClaimSchema,
  managementCenterFailureSchema,
  managementCenterOperationSchema,
  managementCenterPreparedMediaSchema,
  managementCenterRequestSchema,
  managementCenterResponseSchema,
  type ManagementCenterFailure,
  type ManagementCenterResponse,
} from "@fan-support/contracts";
import type {
  ManagementCenterFence,
  ManagementCenterMediaPreparationPort,
  ManagementCenterTransactionManager,
} from "@fan-support/persistence-port";
import { PersistenceTransactionFailureError } from "@fan-support/persistence-port";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";

const failure = (
  code: ManagementCenterFailure["code"],
): ManagementCenterFailure => ({ schemaVersion: 1, outcome: "FAILURE", code });
const canRetry = (code: ManagementCenterFailure["code"]) =>
  [
    "MEDIA_FAILED",
    "UPLOAD_NOT_READY",
    "MANAGEMENT_UNAVAILABLE",
    "CONTENT_UNAVAILABLE",
    "NEEDS_AUTHORIZATION",
    "PUBLICATION_FAILED",
  ].includes(code);
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
export function hashManagementCenterIntent(intent: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(intent)))
    .digest("hex");
}
export type ManagementCenterUseCases = Readonly<{
  execute(input: unknown): Promise<ManagementCenterResponse>;
}>;
export function createManagementCenterUseCases(
  dependencies: Readonly<{
    transactions: ManagementCenterTransactionManager;
    tokenPepper: string;
    resourceManagement: Readonly<{ execute(input: unknown): Promise<unknown> }>;
  }>,
): ManagementCenterUseCases {
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  return Object.freeze({
    async execute(input: unknown): Promise<ManagementCenterResponse> {
      const parsed = managementCenterRequestSchema.safeParse(input);
      if (!parsed.success) return failure("INVALID_COMMAND");
      const request = parsed.data,
        command = request.command;
      try {
        const response =
          await dependencies.transactions.runInManagementCenterTransaction(
            async ({ operations }) => {
              const authorized = managementCenterAuthorizationSchema.parse(
                await operations.authorize({
                  sessionTokenDigest: digestAdminContentToken({
                    tokenPepper: dependencies.tokenPepper,
                    purpose: "admin-session",
                    token: request.sessionToken,
                  }),
                  csrfTokenDigest: digestAdminContentToken({
                    tokenPepper: dependencies.tokenPepper,
                    purpose: "admin-csrf",
                    token: request.csrfToken,
                  }),
                  ...(command.action === "SUBMIT"
                    ? { sourceLocale: command.intent.sourceLocale }
                    : {}),
                }),
              );
              if (authorized.outcome === "FAILURE") return authorized;
              const principal = authorized.principal;
              switch (command.action) {
                case "CONTEXT":
                  return managementCenterResponseSchema.parse(
                    await operations.context(principal),
                  );
                case "LIST":
                  return managementCenterResponseSchema.parse(
                    await operations.list({ principal, command }),
                  );
                case "SUBMIT":
                  return managementCenterResponseSchema.parse(
                    await operations.submit({
                      principal,
                      requestId: request.requestId,
                      intent: command.intent,
                      intentHash: hashManagementCenterIntent(command.intent),
                      idempotencyKey: command.idempotencyKey,
                    }),
                  );
                case "READ_OPERATION":
                  return managementCenterResponseSchema.parse(
                    await operations.read({
                      actorId: principal.actorId,
                      operationId: command.operationId,
                    }),
                  );
                case "RETRY_OPERATION":
                  return managementCenterResponseSchema.parse(
                    await operations.retry({
                      principal,
                      requestId: request.requestId,
                      operationId: command.operationId,
                      expectedVersion: command.expectedVersion,
                      idempotencyKey: command.idempotencyKey,
                    }),
                  );
                case "PREPARE_UPLOAD":
                  return {
                    schemaVersion: 1 as const,
                    outcome: "UPLOAD_AUTHORIZED" as const,
                  };
              }
            },
          );
        if (response.outcome !== "UPLOAD_AUTHORIZED")
          return managementCenterResponseSchema.parse(response);
        if (command.action !== "PREPARE_UPLOAD")
          return failure("INVALID_COMMAND");
        // Signing and object storage never run while the management transaction holds locks.
        return managementCenterResponseSchema.parse(
          await dependencies.resourceManagement.execute({
            ...request,
            command: {
              schemaVersion: 1,
              action: "BEGIN_UPLOAD",
              checksumSha256: command.checksumSha256,
              byteSize: command.byteSize,
              mimeType: command.mimeType,
              rightsReference: `management-attestation:${createHash("sha256").update(command.idempotencyKey).digest("hex")}`,
              expectedVersion: 0,
              reasonCode: "MANAGEMENT_IMAGE_UPLOAD",
              idempotencyKey: command.idempotencyKey,
            },
          }),
        );
      } catch {
        return failure("MANAGEMENT_UNAVAILABLE");
      }
    },
  });
}

export type ManagementCenterWorkerResult =
  "EMPTY" | "PENDING" | "PUBLISHED" | "FAILED" | "UNAVAILABLE";

async function recordRolledBackPublicationFailure(
  error: unknown,
  transactions: ManagementCenterTransactionManager,
  fence: ManagementCenterFence,
): Promise<ManagementCenterWorkerResult> {
  // The transaction port maps ambiguous COMMIT failures to RECONCILE_REQUIRED,
  // including otherwise unexpected adapter errors. Untyped exceptions prove nothing.
  if (
    !(error instanceof PersistenceTransactionFailureError) ||
    error.recovery === "RECONCILE_REQUIRED" ||
    ![
      "INTEGRITY_VIOLATION",
      "TRANSACTION_ABORTED",
      "UNEXPECTED_ADAPTER_FAILURE",
    ].includes(error.code)
  )
    return "UNAVAILABLE";
  try {
    const response = managementCenterResponseSchema.parse(
      await transactions.runInManagementCenterTransaction(({ operations }) =>
        operations.fail({
          ...fence,
          code: "PUBLICATION_FAILED",
          retryable: true,
        }),
      ),
    );
    return response.outcome === "SUCCESS" &&
      response.kind === "OPERATION" &&
      response.operation.operationId === fence.operationId &&
      response.operation.status === "FAILED" &&
      response.operation.failure?.code === "PUBLICATION_FAILED" &&
      response.operation.failure.retryable
      ? "FAILED"
      : "UNAVAILABLE";
  } catch {
    return "UNAVAILABLE";
  }
}
export function createManagementCenterWorker(
  dependencies: Readonly<{
    transactions: ManagementCenterTransactionManager;
    media: ManagementCenterMediaPreparationPort;
    createLeaseToken(): string;
    leaseSeconds: number;
  }>,
): Readonly<{ processNext(): Promise<ManagementCenterWorkerResult> }> {
  if (
    !Number.isInteger(dependencies.leaseSeconds) ||
    dependencies.leaseSeconds < 10 ||
    dependencies.leaseSeconds > 900
  )
    throw new TypeError("Invalid management lease duration");
  return Object.freeze({
    async processNext(): Promise<ManagementCenterWorkerResult> {
      try {
        const token = dependencies.createLeaseToken();
        if (!/^[a-f0-9]{64}$/u.test(token)) return "UNAVAILABLE";
        const leaseTokenDigest = createHash("sha256")
          .update(`management-lease:v1:${token}`)
          .digest("hex");
        const value =
          await dependencies.transactions.runInManagementCenterTransaction(
            ({ operations }) =>
              operations.claim({
                leaseTokenDigest,
                leaseSeconds: dependencies.leaseSeconds,
              }),
          );
        if (value === null) return "EMPTY";
        const parsed = managementCenterClaimSchema.safeParse(value);
        if (
          !parsed.success ||
          parsed.data.leaseTokenDigest !== leaseTokenDigest
        )
          return "UNAVAILABLE";
        const claim = parsed.data,
          fence = {
            operationId: claim.operation.operationId,
            leaseTokenDigest,
          };
        const prepared = await dependencies.media.prepare(claim);
        if (prepared.outcome === "PENDING") {
          const deferred =
            await dependencies.transactions.runInManagementCenterTransaction(
              ({ operations }) => operations.defer(fence),
            );
          return managementCenterResponseSchema.parse(deferred).outcome ===
            "SUCCESS"
            ? "PENDING"
            : "UNAVAILABLE";
        }
        if (prepared.outcome === "FAILURE") {
          const rejected = managementCenterFailureSchema.parse(prepared);
          const result =
            await dependencies.transactions.runInManagementCenterTransaction(
              ({ operations }) =>
                operations.fail({
                  ...fence,
                  code: rejected.code,
                  retryable: canRetry(rejected.code),
                }),
            );
          return managementCenterResponseSchema.parse(result).outcome ===
            "SUCCESS"
            ? "FAILED"
            : "UNAVAILABLE";
        }
        const preparedMedia =
          prepared.preparedMedia === null
            ? null
            : managementCenterPreparedMediaSchema.parse(prepared.preparedMedia);
        return await dependencies.transactions
          .runInManagementCenterTransaction(
            async ({ operations, publication }) => {
              const current = managementCenterClaimSchema.safeParse(
                await operations.loadClaim(fence),
              );
              if (
                !current.success ||
                current.data.intentHash !== claim.intentHash ||
                current.data.leaseTokenDigest !== fence.leaseTokenDigest ||
                current.data.operation.operationId !== fence.operationId
              )
                return "UNAVAILABLE";
              const published = await publication.publish({
                schemaVersion: 1,
                ...fence,
                preparedMedia,
              });
              if (published.outcome === "FAILURE") {
                const result = await operations.fail({
                  ...fence,
                  code: managementCenterFailureSchema.parse(published).code,
                  retryable: canRetry(published.code),
                });
                return managementCenterResponseSchema.parse(result).outcome ===
                  "SUCCESS"
                  ? "FAILED"
                  : "UNAVAILABLE";
              }
              const expectedKind =
                claim.intent.kind === "SAVE_ARTIST"
                  ? "IDOL"
                  : claim.intent.kind === "SAVE_GIFT"
                    ? "GIFT"
                    : "HOMEPAGE";
              if (
                published.target.kind !== expectedKind ||
                (expectedKind !== "HOMEPAGE" &&
                  published.target.id !== claim.operation.targetId)
              )
                throw new Error(
                  "Publication target did not match its authorized operation",
                );
              const result = managementCenterOperationSchema.shape.result
                .unwrap()
                .parse({
                  targetId: published.target.id,
                  handle: published.target.handle ?? null,
                  revisionId: published.revisionId,
                  publicationId: published.publicationId,
                  version: published.targetVersion,
                });
              const completed = managementCenterResponseSchema.parse(
                await operations.complete({ ...fence, result }),
              );
              if (
                completed.outcome !== "SUCCESS" ||
                completed.kind !== "OPERATION" ||
                completed.operation.status !== "PUBLISHED" ||
                JSON.stringify(completed.operation.result) !==
                  JSON.stringify(result)
              )
                throw new Error(
                  "Publication receipt did not commit with the head",
                );
              managementCenterOperationSchema.parse(completed.operation);
              return "PUBLISHED";
            },
          )
          .catch((error: unknown) =>
            recordRolledBackPublicationFailure(
              error,
              dependencies.transactions,
              fence,
            ),
          );
      } catch {
        // Do not mark a lease failed after an uncertain commit. The next claim reconciles its durable receipt.
        return "UNAVAILABLE";
      }
    },
  });
}

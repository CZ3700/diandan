import type { MediaStoragePort } from "@fan-support/media-port";
import { createHash } from "node:crypto";
import {
  managementCenterAuthorizationSchema,
  managementImageSourceSchema,
  mediaPortResponseSchema,
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
import { retryManagementTransaction } from "./management-transaction-retry.js";

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
    storage?: Pick<MediaStoragePort, "createDownloadGrant">;
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
                    : command.action === "ARCHIVE_POSTER"
                      ? { sourceLocale: command.sourceLocale }
                      : {}),
                }),
              );
              if (authorized.outcome === "FAILURE") return authorized;
              const principal = authorized.principal;
              switch (command.action) {
                case "READ_IMAGE_SOURCE": {
                  const resolved = await operations.readImageSource({
                    principal,
                    target: command.target,
                  });
                  if (resolved.outcome === "FAILURE") return resolved;
                  const source = managementImageSourceSchema.parse(resolved);
                  if (
                    source.target.kind !== command.target.kind ||
                    source.target.id.toLowerCase() !==
                      command.target.id.toLowerCase() ||
                    source.target.expectedVersion !==
                      command.target.expectedVersion
                  )
                    return failure("TARGET_CONFLICT");
                  const expiresAt = new Date(
                    Math.min(
                      Date.parse(principal.authorizedAt) + 120_000,
                      Date.parse(principal.expiresAt),
                    ),
                  ).toISOString();
                  if (
                    Date.parse(expiresAt) - Date.parse(principal.authorizedAt) <
                    60_000
                  )
                    return failure("NEEDS_AUTHORIZATION");
                  return {
                    outcome: "IMAGE_SOURCE_AUTHORIZED" as const,
                    source,
                    expiresAt,
                    principal,
                  };
                }
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
                case "ARCHIVE_POSTER":
                  return managementCenterResponseSchema.parse(
                    await operations.archivePoster({
                      principal,
                      requestId: request.requestId,
                      revisionId: command.revisionId,
                      expectedVersion: command.expectedVersion,
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
        if (response.outcome === "IMAGE_SOURCE_AUTHORIZED") {
          if (!dependencies.storage) return failure("MANAGEMENT_UNAVAILABLE");
          const { source: resolved, expiresAt } = response;
          const grant = mediaPortResponseSchema.parse(
            await dependencies.storage.createDownloadGrant({
              schemaVersion: 1,
              operation: "CREATE_DOWNLOAD_GRANT",
              storageClass: "SOURCE",
              objectKey: resolved.source.objectKey,
              expiresAt,
            }),
          );
          if (
            grant.outcome !== "SUCCESS" ||
            grant.operation !== "CREATE_DOWNLOAD_GRANT" ||
            grant.value.storageClass !== "SOURCE" ||
            grant.value.objectKey !== resolved.source.objectKey ||
            grant.value.expiresAt !== expiresAt
          )
            return failure("MANAGEMENT_UNAVAILABLE");
          const checked =
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
                  }),
                );
                if (authorized.outcome === "FAILURE") return authorized;
                const principal = authorized.principal;
                if (
                  principal.actorId !== response.principal.actorId ||
                  principal.sessionId !== response.principal.sessionId ||
                  Date.parse(principal.authorizedAt) >= Date.parse(expiresAt) ||
                  Date.parse(principal.expiresAt) < Date.parse(expiresAt)
                )
                  return failure("NEEDS_AUTHORIZATION");
                const latest = await operations.readImageSource({
                  principal,
                  target: resolved.target,
                });
                if (latest.outcome === "FAILURE") return latest;
                if (
                  JSON.stringify(
                    canonical(managementImageSourceSchema.parse(latest)),
                  ) !== JSON.stringify(canonical(resolved))
                )
                  return failure("TARGET_CONFLICT");
                return { outcome: "SUCCESS" as const };
              },
            );
          if (checked.outcome === "FAILURE") return checked;
          return managementCenterResponseSchema.parse({
            schemaVersion: 1,
            outcome: "SUCCESS",
            kind: "ORIGINAL_IMAGE",
            target: resolved.target,
            currentImage: resolved.currentImage,
            focalPoint: resolved.focalPoint,
            sourceWidth:
              resolved.orientation >= 5
                ? resolved.source.height
                : resolved.source.width,
            sourceHeight:
              resolved.orientation >= 5
                ? resolved.source.width
                : resolved.source.height,
            download: {
              method: grant.value.method,
              url: grant.value.url,
              headers: grant.value.headers,
              expiresAt: grant.value.expiresAt,
            },
          });
        }
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
        return await retryManagementTransaction(() =>
          dependencies.transactions.runInManagementCenterTransaction(
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
          ),
        ).catch((error: unknown) =>
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

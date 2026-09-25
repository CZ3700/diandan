import {
  SUPPORTED_LOCALES,
  adminAuthorizationResponseSchema,
  publicationAuthorizationCommandSchema,
  publicationRuntimeRequestSchema,
  publicationRuntimeResponseSchema,
  publicationStatusResponseSchema,
  publicationRuntimeContextResponseSchema,
  publicationRuntimeWriteCommandSchema,
  type PublicationRuntimeResponse,
  type PublicationRuntimeIssue,
  type PublicationRuntimeContext,
  type PublicationRevisionCommand,
  type AdminPrincipal,
} from "@fan-support/contracts";
import {
  evaluatePublicationPreflight,
  sameBaseContentTarget,
  buildPublicationManifest,
  computePublicationManifestHash,
  verifyPublicationManifest,
} from "@fan-support/content";
import type {
  JsonValue,
  PublicationRuntimeTransactionManager,
} from "@fan-support/persistence-port";
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
import { compareBaseContentTime } from "./base-content-time.js";
import {
  assertPublicationReceipt,
  beginPublicationIdempotency,
  completePublicationIdempotency,
} from "./publication-runtime-idempotency.js";

export type PublicationRuntimeDependencies = Readonly<{
  transactions: PublicationRuntimeTransactionManager;
  tokenPepper: string;
}>;
export type PublicationRuntimeUseCases = Readonly<{
  execute(input: unknown): Promise<PublicationRuntimeResponse>;
}>;
class PublicationBlocked extends Error {
  constructor(readonly issues: PublicationRuntimeIssue[]) {
    super("publication blocked by current evidence");
  }
}
function preparePublicationManifest(
  context: PublicationRuntimeContext,
  command: PublicationRevisionCommand,
  principal: AdminPrincipal,
) {
  const action = command.action === "ROLLBACK" ? "ROLLBACK" : "PUBLISH";
  const canonical = context.preflight;
  if (
    canonical.action !== action ||
    !sameBaseContentTarget(
      { ...canonical.target, locale: "en" },
      { ...command.target, locale: "en" },
    ) ||
    compareBaseContentTime(canonical.evaluatedAt, principal.authorizedAt) < 0
  )
    rejectAdminContent("CONTENT_UNAVAILABLE");
  if (compareBaseContentTime(canonical.evaluatedAt, principal.expiresAt) >= 0)
    rejectAdminContent("UNAUTHENTICATED");
  if (canonical.headVersion !== command.expectedVersion)
    rejectAdminContent("STALE_VERSION");
  if (canonical.snapshot.contentHash !== command.expectedContentHash)
    rejectAdminContent("STALE_CONTENT");
  if (
    command.action === "VALIDATE" &&
    canonical.snapshot.lifecycle.status !== "DRAFT"
  )
    rejectAdminContent("REVISION_NOT_DRAFT");
  const issues: PublicationRuntimeIssue[] = [];
  if (
    (command.action === "PUBLISH" &&
      canonical.snapshot.lifecycle.status !== "VALIDATED") ||
    (command.action === "ROLLBACK" &&
      canonical.snapshot.lifecycle.status !== "SUPERSEDED")
  )
    issues.push({
      code: "REVISION_LIFECYCLE_TIME_INVALID",
      severity: "BLOCKER",
      path: ["snapshot", "lifecycle"],
    });
  const report = requireAdminSuccess(evaluatePublicationPreflight(canonical));
  issues.push(...report.issues.filter((issue) => issue.severity === "BLOCKER"));
  // A lifecycle flag alone is not an independently published media dependency.
  for (const [index, media] of canonical.mediaSnapshots.entries()) {
    const target = media.target;
    const published =
      target.kind === "MEDIA_METADATA" &&
      context.mediaPublications.some(
        (row) =>
          row.mediaAssetId.toLowerCase() ===
            target.mediaAssetId.toLowerCase() &&
          row.revisionId.toLowerCase() === media.revisionId.toLowerCase(),
      );
    if (!published)
      issues.push({
        code: "MEDIA_METADATA_PUBLICATION_REQUIRED",
        severity: "BLOCKER",
        path: ["mediaSnapshots", index],
      });
  }
  if (issues.length) throw new PublicationBlocked(issues);
  let manifest = buildPublicationManifest(canonical);
  if (command.action === "ROLLBACK" && context.previousManifest !== null) {
    if (!verifyPublicationManifest(context.previousManifest, canonical))
      throw new PublicationBlocked([
        {
          code: "MANIFEST_MISMATCH",
          severity: "BLOCKER",
          path: ["previousManifest"],
        },
      ]);
    manifest = context.previousManifest;
  }
  return manifest;
}

/** Current authorization, canonical validation, immutable receipt and head/outbox writes share one transaction. */
export function createPublicationRuntimeUseCases(
  dependencies: PublicationRuntimeDependencies,
): PublicationRuntimeUseCases {
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  return Object.freeze({
    async execute(input: unknown): Promise<PublicationRuntimeResponse> {
      const parsed = publicationRuntimeRequestSchema.safeParse(input);
      if (!parsed.success) return adminContentFailure("INVALID_COMMAND");
      const request = parsed.data,
        command = request.command;
      try {
        const authorization = publicationAuthorizationCommandSchema.parse({
          schemaVersion: 1,
          permission:
            command.action === "STATUS" ? "content.read" : "content.publish",
          locales: [...SUPPORTED_LOCALES],
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
        });
        const output =
          await dependencies.transactions.runInPublicationRuntimeTransaction(
            async (repositories) => {
              const { principal } = requireAdminSuccess(
                adminAuthorizationResponseSchema.parse(
                  await repositories.authorization.authorize(authorization),
                ),
              );
              if (
                compareBaseContentTime(
                  principal.expiresAt,
                  principal.authorizedAt,
                ) <= 0
              )
                rejectAdminContent("UNAUTHENTICATED");
              if (command.action === "STATUS") {
                const status = publicationStatusResponseSchema.parse(
                  await repositories.publicationRuntime.status(command),
                );
                if (
                  status.outcome === "SUCCESS" &&
                  status.publicationId.toLowerCase() !==
                    command.publicationId.toLowerCase()
                )
                  rejectAdminContent("CONTENT_UNAVAILABLE");
                return JSON.parse(JSON.stringify(status)) as JsonValue;
              }
              const reservation = await beginPublicationIdempotency(
                repositories,
                command,
                principal,
              );
              if (reservation.replay)
                return JSON.parse(
                  JSON.stringify(reservation.replay),
                ) as JsonValue;
              let result: PublicationRuntimeResponse;
              if (command.action === "RETRY_PURGE")
                result = publicationRuntimeResponseSchema.parse(
                  await repositories.publicationRuntime.retry({
                    schemaVersion: 1,
                    requestId: request.requestId,
                    principal,
                    command,
                  }),
                );
              else {
                const action =
                  command.action === "ROLLBACK" ? "ROLLBACK" : "PUBLISH";
                const { context } = requireAdminSuccess(
                  publicationRuntimeContextResponseSchema.parse(
                    await repositories.publicationRuntime.load({
                      schemaVersion: 1,
                      target: command.target,
                      action,
                    }),
                  ),
                );
                const manifest = preparePublicationManifest(
                  context,
                  command,
                  principal,
                );
                const manifestHash = computePublicationManifestHash(manifest);
                result = publicationRuntimeResponseSchema.parse(
                  await repositories.publicationRuntime.write(
                    publicationRuntimeWriteCommandSchema.parse({
                      schemaVersion: 1,
                      requestId: request.requestId,
                      principal,
                      command,
                      manifest,
                      manifestHash,
                    }),
                  ),
                );
                if (
                  command.action !== "VALIDATE" &&
                  result.outcome === "SUCCESS" &&
                  (result.kind !== "PUBLICATION_MUTATION" ||
                    result.manifestHash !== manifestHash)
                )
                  rejectAdminContent("CONTENT_UNAVAILABLE");
              }
              if (result.outcome === "FAILURE") {
                if (result.code === "PUBLICATION_BLOCKED")
                  throw new PublicationBlocked(result.issues);
                rejectAdminContent(result.code);
              }
              assertPublicationReceipt(command, result);
              if (result.replayed) rejectAdminContent("CONTENT_UNAVAILABLE");
              await completePublicationIdempotency(
                repositories,
                reservation.identity,
                result.resultId,
              );
              return JSON.parse(JSON.stringify(result)) as JsonValue;
            },
          );
        return publicationRuntimeResponseSchema.parse(output);
      } catch (error: unknown) {
        if (error instanceof PublicationBlocked)
          return {
            schemaVersion: 1,
            outcome: "FAILURE",
            code: "PUBLICATION_BLOCKED",
            issues: error.issues,
          };
        return adminContentErrorResult(error);
      }
    },
  });
}

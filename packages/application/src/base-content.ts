/// <reference types="node" />
import { randomBytes } from "node:crypto";
import {
  adminAuthorizationCommandSchema,
  adminAuthorizationResponseSchema,
  adminMutationResponseSchema,
  appendBaseContentReviewCommandSchema,
  baseContentPreviewGrantResponseSchema,
  baseContentPreviewRequestSchema,
  baseContentPreviewResponseSchema,
  baseContentRequestSchema,
  baseContentResponseSchema,
  baseContentReviewResponseSchema,
  sourceHashSchema,
  type AdminAuthorizationCommand,
  type BaseContentCommand,
  type BaseContentPreviewResponse,
  type BaseContentRequest,
  type BaseContentResponse,
} from "@fan-support/contracts";
import {
  sameBaseContentTarget,
  validateBaseContentReviewAction,
  validateBaseContentReviewResponse,
} from "@fan-support/content";
import type {
  BaseContentRepositories,
  BaseContentTransactionManager,
  JsonValue,
} from "@fan-support/persistence-port";
import {
  beginBaseContentIdempotency,
  completeBaseContentIdempotency,
} from "./base-content-idempotency.js";
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
import {
  compareBaseContentTime,
  addBaseContentSeconds,
} from "./base-content-time.js";

export type BaseContentDependencies = Readonly<{
  transactions: BaseContentTransactionManager;
  tokenPepper: string;
}>;
export type BaseContentUseCases = Readonly<{
  execute(input: unknown): Promise<BaseContentResponse>;
  readPreview(input: unknown): Promise<BaseContentPreviewResponse>;
}>;
type Authorization = Omit<AdminAuthorizationCommand, "permission" | "locales">;
function permission(
  command: BaseContentCommand,
): AdminAuthorizationCommand["permission"] {
  switch (command.action) {
    case "READ_REVIEW":
      return "content.read";
    case "SUBMIT_REVIEW":
      return "content.edit";
    case "APPROVE_REVIEW":
      return "content.translation.review";
    case "ISSUE_PREVIEW":
    case "REVOKE_PREVIEW":
      return "content.preview";
  }
}
async function runCommand(
  repositories: BaseContentRepositories,
  request: BaseContentRequest,
  authorization: Authorization,
  tokenPepper: string,
): Promise<BaseContentResponse> {
  const { command } = request;
  const { principal } = requireAdminSuccess(
    adminAuthorizationResponseSchema.parse(
      await repositories.authorization.authorize({
        ...authorization,
        permission: permission(command),
        // Reducing one's own grant requires current basic permission, even after locale withdrawal.
        locales:
          command.action === "REVOKE_PREVIEW" ? [] : [command.target.locale],
      }),
    ),
  );
  if (compareBaseContentTime(principal.expiresAt, principal.authorizedAt) <= 0)
    rejectAdminContent("UNAUTHENTICATED");
  if (command.action === "ISSUE_PREVIEW") {
    const token = randomBytes(32).toString("base64url");
    const grant = requireAdminSuccess(
      baseContentPreviewGrantResponseSchema.parse(
        await repositories.baseContentPreviews.issue({
          schemaVersion: 1,
          target: command.target,
          actorId: principal.actorId,
          sessionId: principal.sessionId,
          ttlSeconds: command.ttlSeconds,
          reasonCode: command.reasonCode,
          requestId: request.requestId,
          tokenDigest: sourceHashSchema.parse(
            digestAdminContentToken({
              tokenPepper,
              purpose: "base-content-preview",
              token,
            }),
          ),
        }),
      ),
    );
    // Use actual issuance time, independently of authorization wall-clock ordering.
    if (
      compareBaseContentTime(grant.expiresAt, grant.createdAt) <= 0 ||
      compareBaseContentTime(
        grant.expiresAt,
        addBaseContentSeconds(grant.createdAt, command.ttlSeconds),
      ) > 0 ||
      compareBaseContentTime(grant.expiresAt, principal.expiresAt) > 0
    )
      rejectAdminContent("CONTENT_UNAVAILABLE");
    return {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "PREVIEW_GRANT",
      grantId: grant.grantId,
      token,
      expiresAt: grant.expiresAt,
    };
  }
  if (command.action === "REVOKE_PREVIEW") {
    const reservation = await beginBaseContentIdempotency(
      repositories.idempotency,
      command,
      principal,
    );
    if (reservation.replay !== undefined) return reservation.replay;
    const revoked = requireAdminSuccess(
      adminMutationResponseSchema.parse(
        await repositories.baseContentPreviews.revoke({
          schemaVersion: 1,
          grantId: command.grantId,
          actorId: principal.actorId,
          reasonCode: command.reasonCode,
          requestId: request.requestId,
        }),
      ),
    );
    if (revoked.resultId.toLowerCase() !== command.grantId.toLowerCase())
      rejectAdminContent("CONTENT_UNAVAILABLE");
    return completeBaseContentIdempotency(
      repositories.idempotency,
      reservation,
      revoked.resultId,
    );
  }
  const review = requireAdminSuccess(
    baseContentReviewResponseSchema.parse(
      await repositories.baseContentReviews.read({
        schemaVersion: 1,
        target: command.target,
      }),
    ),
  );
  const invalid = validateBaseContentReviewResponse(review, command.target);
  if (invalid !== null) rejectAdminContent(invalid.code);
  if (command.action === "READ_REVIEW") return review;
  // Canonical target and current locale grants are checked before replay. Review
  // state may have advanced since the original successful command.
  const reservation = await beginBaseContentIdempotency(
    repositories.idempotency,
    command,
    principal,
  );
  if (reservation.replay !== undefined) return reservation.replay;
  const append = appendBaseContentReviewCommandSchema.parse({
    schemaVersion: 1,
    action: command.action === "SUBMIT_REVIEW" ? "SUBMIT" : "APPROVE",
    target: review.context.target,
    expectedVersion: command.expectedVersion,
    expectedContentHash: command.expectedContentHash,
    expectedSourceHash: command.expectedSourceHash,
    reasonCode: command.reasonCode,
    actorId: principal.actorId,
    requestId: request.requestId,
  });
  const rejected = validateBaseContentReviewAction(
    append,
    review.context,
    review,
  );
  if (rejected !== null) rejectAdminContent(rejected.code);
  const appended = requireAdminSuccess(
    adminMutationResponseSchema.parse(
      await repositories.baseContentReviews.append(append),
    ),
  );
  return completeBaseContentIdempotency(
    repositories.idempotency,
    reservation,
    appended.resultId,
  );
}
function json(
  value: BaseContentResponse | BaseContentPreviewResponse,
): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export function createBaseContentUseCases(
  dependencies: BaseContentDependencies,
): BaseContentUseCases {
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  return Object.freeze({
    async execute(input: unknown): Promise<BaseContentResponse> {
      const parsed = baseContentRequestSchema.safeParse(input);
      if (!parsed.success) return adminContentFailure("INVALID_COMMAND");
      const request = parsed.data;
      try {
        const authorization = adminAuthorizationCommandSchema
          .omit({ permission: true, locales: true })
          .parse({
            schemaVersion: 1,
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
        const response =
          await dependencies.transactions.runInBaseContentTransaction(
            async (repositories) =>
              json(
                baseContentResponseSchema.parse(
                  await runCommand(
                    repositories,
                    request,
                    authorization,
                    dependencies.tokenPepper,
                  ),
                ),
              ),
          );
        return baseContentResponseSchema.parse(response);
      } catch (error: unknown) {
        return adminContentErrorResult(error);
      }
    },
    async readPreview(input: unknown): Promise<BaseContentPreviewResponse> {
      const parsed = baseContentPreviewRequestSchema.safeParse(input);
      if (!parsed.success) return adminContentFailure("INVALID_COMMAND");
      const request = parsed.data;
      try {
        const response =
          await dependencies.transactions.runInBaseContentTransaction(
            async (repositories) => {
              const result = requireAdminSuccess(
                baseContentPreviewResponseSchema.parse(
                  await repositories.baseContentPreviews.read({
                    schemaVersion: 1,
                    target: request.target,
                    tokenDigest: sourceHashSchema.parse(
                      digestAdminContentToken({
                        tokenPepper: dependencies.tokenPepper,
                        purpose: "base-content-preview",
                        token: request.token,
                      }),
                    ),
                  }),
                ),
              );
              if (!sameBaseContentTarget(result.target, request.target))
                rejectAdminContent("PREVIEW_UNAVAILABLE");
              return json(result);
            },
          );
        return baseContentPreviewResponseSchema.parse(response);
      } catch {
        return adminContentFailure("PREVIEW_UNAVAILABLE");
      }
    },
  });
}

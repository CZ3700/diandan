/// <reference types="node" />
import { randomBytes } from "node:crypto";
import {
  adminAuthorizationCommandSchema,
  adminAuthorizationResponseSchema,
  adminContentRequestSchema,
  adminContentResponseSchema,
  adminMutationResponseSchema,
  contentDraftResponseSchema,
  contentDraftReadCommandSchema,
  contentPreviewGrantResponseSchema,
  contentPreviewRequestSchema,
  contentPreviewResponseSchema,
  contentReviewContextResponseSchema,
  createIdolAliasDraftCommandSchema,
  createGiftDetailDraftCommandSchema,
  giftDetailDraftResponseSchema,
  idolAliasDraftResponseSchema,
  sourceHashSchema,
  type AdminAuthorizationCommand,
  type AdminContentCommand,
  type AdminContentRequest,
  type AdminContentResponse,
  type AdminPrincipal,
  type ContentPreviewResponse,
  type ContentReviewContext,
  type ContentReviewTarget,
  type SupportedLocale,
} from "@fan-support/contracts";
import type {
  AdminContentRepositories,
  AdminContentTransactionManager,
  JsonValue,
} from "@fan-support/persistence-port";
import {
  beginAdminContentIdempotency,
  completeAdminContentIdempotency,
} from "./admin-content-idempotency.js";
import {
  adminContentErrorResult,
  adminContentFailure,
  rejectAdminContent,
  requireAdminSuccess,
} from "./admin-content-results.js";
import {
  aliasContentLocales,
  orderedContentLocales,
  sameContentReviewTarget,
  validateContentReviewAction,
} from "./admin-content-review-validation.js";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";
import { projectContentForReview } from "./admin-content-review-read.js";

export { digestAdminContentToken } from "./admin-content-tokens.js";
export type { AdminContentTokenPurpose } from "./admin-content-tokens.js";

export type AdminContentDependencies = Readonly<{
  transactions: AdminContentTransactionManager;
  tokenPepper: string;
}>;
export type AdminContentUseCases = Readonly<{
  execute(input: unknown): Promise<AdminContentResponse>;
  readPreview(input: unknown): Promise<ContentPreviewResponse>;
}>;
type Authorization = Omit<AdminAuthorizationCommand, "permission" | "locales">;

function commandPermission(
  command: AdminContentCommand,
): AdminAuthorizationCommand["permission"] {
  switch (command.action) {
    case "READ_DRAFT":
    case "READ_REVIEW":
      return "content.read";
    case "CREATE_IDOL_ALIASES":
    case "CREATE_GIFT_DETAILS":
    case "SUBMIT_REVIEW":
      return "content.edit";
    case "APPROVE_REVIEW":
      return "content.translation.review";
    case "ISSUE_PREVIEW":
    case "REVOKE_PREVIEW":
      return "content.preview";
  }
}

function initialLocales(command: AdminContentCommand): SupportedLocale[] {
  switch (command.action) {
    case "CREATE_IDOL_ALIASES":
      return aliasContentLocales(command.draft.aliases);
    case "CREATE_GIFT_DETAILS":
      return orderedContentLocales(
        command.draft.translations.map((row) => row.locale),
      );
    case "ISSUE_PREVIEW":
      return [command.target.locale];
    default:
      return [];
  }
}

async function authorize(
  repositories: AdminContentRepositories,
  authorization: Authorization,
  permission: AdminAuthorizationCommand["permission"],
  locales: SupportedLocale[],
  prior?: AdminPrincipal,
): Promise<AdminPrincipal> {
  const response = requireAdminSuccess(
    adminAuthorizationResponseSchema.parse(
      await repositories.authorization.authorize(
        adminAuthorizationCommandSchema.parse({
          ...authorization,
          permission,
          locales: orderedContentLocales(locales),
        }),
      ),
    ),
  );
  const principal = response.principal;
  // Wall-clock timestamps can move backward; identity remains stable and each
  // canonical authorization must independently precede the session expiry.
  if (
    prior !== undefined &&
    (prior.actorId.toLowerCase() !== principal.actorId.toLowerCase() ||
      prior.sessionId.toLowerCase() !== principal.sessionId.toLowerCase() ||
      prior.expiresAt !== principal.expiresAt)
  )
    rejectAdminContent("CONTENT_UNAVAILABLE");
  if (Date.parse(principal.expiresAt) <= Date.parse(principal.authorizedAt))
    rejectAdminContent("UNAUTHENTICATED");
  return principal;
}

async function loadReviewContext(
  repositories: AdminContentRepositories,
  target: ContentReviewTarget,
): Promise<ContentReviewContext> {
  const response = requireAdminSuccess(
    contentReviewContextResponseSchema.parse(
      await repositories.contentReviews.loadTarget({
        schemaVersion: 1,
        target,
      }),
    ),
  );
  if (
    !sameContentReviewTarget(response.context.target, target) ||
    response.context.locales.length === 0
  ) {
    rejectAdminContent("CONTENT_UNAVAILABLE");
  }
  if (
    target.kind === "GIFT_DETAILS" &&
    (response.context.locales.length !== 1 ||
      response.context.locales[0] !== target.locale)
  )
    rejectAdminContent("CONTENT_UNAVAILABLE");
  return response.context;
}

async function readDraft(
  repositories: AdminContentRepositories,
  authorization: Authorization,
  principal: AdminPrincipal,
  command: Extract<AdminContentCommand, { action: "READ_DRAFT" }>,
): Promise<AdminContentResponse> {
  const content = requireAdminSuccess(
    contentDraftResponseSchema.parse(
      await repositories.contentDrafts.read(command.target),
    ),
  );
  const reviews: ContentReviewContext[] = [];
  let locales: SupportedLocale[];
  if (command.target.kind === "IDOL_ALIASES") {
    if (
      !("aliasSet" in content) ||
      content.aliasSet.idolRevisionId.toLowerCase() !==
        command.target.idolRevisionId.toLowerCase()
    )
      rejectAdminContent("CONTENT_UNAVAILABLE");
    const context = await loadReviewContext(repositories, {
      kind: "IDOL_ALIASES",
      revisionId: command.target.idolRevisionId,
    });
    if (
      context.subjectId.toLowerCase() !== content.aliasSet.id.toLowerCase() ||
      context.contentHash !== content.aliasSet.contentHash
    )
      rejectAdminContent("CONTENT_UNAVAILABLE");
    reviews.push(context);
    locales = aliasContentLocales(content.aliasSet.aliases);
    if (
      JSON.stringify(orderedContentLocales(context.locales)) !==
      JSON.stringify(locales)
    )
      rejectAdminContent("CONTENT_UNAVAILABLE");
  } else {
    if (
      !("document" in content) ||
      content.document.giftRevisionId.toLowerCase() !==
        command.target.giftRevisionId.toLowerCase()
    )
      rejectAdminContent("CONTENT_UNAVAILABLE");
    for (const translation of content.translations) {
      const context = await loadReviewContext(repositories, {
        kind: "GIFT_DETAILS",
        revisionId: command.target.giftRevisionId,
        locale: translation.locale,
      });
      if (
        context.subjectId.toLowerCase() !== translation.id.toLowerCase() ||
        context.contentHash !== translation.sourceHash ||
        context.sourceHash !== translation.translatedFromSourceHash
      )
        rejectAdminContent("CONTENT_UNAVAILABLE");
      reviews.push(context);
    }
    locales = orderedContentLocales(
      content.translations.map((row) => row.locale),
    );
  }
  await authorize(
    repositories,
    authorization,
    "content.read",
    locales,
    principal,
  );
  return {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "DRAFT",
    content,
    reviews,
  };
}

async function runCommand(
  repositories: AdminContentRepositories,
  request: AdminContentRequest,
  authorization: Authorization,
  tokenPepper: string,
): Promise<AdminContentResponse> {
  const { command } = request;
  const permission = commandPermission(command);
  const principal = await authorize(
    repositories,
    authorization,
    permission,
    initialLocales(command),
  );
  if (command.action === "READ_DRAFT")
    return readDraft(repositories, authorization, principal, command);
  if (command.action === "READ_REVIEW") {
    const context = await loadReviewContext(repositories, command.target);
    const readCommand = contentDraftReadCommandSchema.parse(
      command.target.kind === "IDOL_ALIASES"
        ? {
            schemaVersion: 1,
            kind: "IDOL_ALIASES",
            idolRevisionId: command.target.revisionId,
          }
        : {
            schemaVersion: 1,
            kind: "GIFT_DETAILS",
            giftRevisionId: command.target.revisionId,
          },
    );
    const content = requireAdminSuccess(
      contentDraftResponseSchema.parse(
        await repositories.contentDrafts.read(readCommand),
      ),
    );
    await authorize(
      repositories,
      authorization,
      "content.read",
      context.locales,
      principal,
    );
    return projectContentForReview(context, content);
  }
  if (command.action === "ISSUE_PREVIEW") {
    const token = randomBytes(32).toString("base64url");
    const grant = requireAdminSuccess(
      contentPreviewGrantResponseSchema.parse(
        await repositories.contentPreviews.issue({
          schemaVersion: 1,
          target: command.target,
          tokenDigest: sourceHashSchema.parse(
            digestAdminContentToken({
              tokenPepper,
              purpose: "content-preview",
              token,
            }),
          ),
          actorId: principal.actorId,
          sessionId: principal.sessionId,
          ttlSeconds: command.ttlSeconds,
          reasonCode: command.reasonCode,
          requestId: request.requestId,
        }),
      ),
    );
    // Bound the capability from its actual issuance instant, even when the
    // database wall clock has moved backward since the authorization query.
    if (
      Date.parse(grant.expiresAt) <= Date.parse(grant.createdAt) ||
      Date.parse(grant.expiresAt) >
        Date.parse(grant.createdAt) + command.ttlSeconds * 1000 ||
      Date.parse(grant.expiresAt) > Date.parse(principal.expiresAt)
    )
      rejectAdminContent("CONTENT_UNAVAILABLE");
    return {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "PREVIEW_GRANT",
      grantId: grant.grantId,
      expiresAt: grant.expiresAt,
      token,
    };
  }

  let review: ContentReviewContext | undefined;
  if (
    command.action === "SUBMIT_REVIEW" ||
    command.action === "APPROVE_REVIEW"
  ) {
    review = await loadReviewContext(repositories, command.target);
    await authorize(
      repositories,
      authorization,
      permission,
      review.locales,
      principal,
    );
  }
  // Revoking one's own grant intentionally requires only basic preview permission;
  // removing access remains possible after a locale assignment is withdrawn.
  const reservation = await beginAdminContentIdempotency(
    repositories.idempotency,
    command,
    principal,
  );
  if (reservation.replay !== undefined) return reservation.replay;
  let resultId: string;
  switch (command.action) {
    case "CREATE_IDOL_ALIASES": {
      const created = requireAdminSuccess(
        idolAliasDraftResponseSchema.parse(
          await repositories.contentDrafts.createIdolAliases(
            createIdolAliasDraftCommandSchema.parse({
              ...command.draft,
              actorId: principal.actorId,
              requestId: request.requestId,
            }),
          ),
        ),
      );
      if (
        created.aliasSet.id.toLowerCase() !== command.draft.id.toLowerCase() ||
        created.aliasSet.idolRevisionId.toLowerCase() !==
          command.draft.idolRevisionId.toLowerCase()
      )
        rejectAdminContent("CONTENT_UNAVAILABLE");
      resultId = created.aliasSet.id;
      break;
    }
    case "CREATE_GIFT_DETAILS": {
      const created = requireAdminSuccess(
        giftDetailDraftResponseSchema.parse(
          await repositories.contentDrafts.createGiftDetails(
            createGiftDetailDraftCommandSchema.parse({
              ...command.draft,
              actorId: principal.actorId,
              requestId: request.requestId,
            }),
          ),
        ),
      );
      if (
        created.document.id.toLowerCase() !==
          command.draft.document.id.toLowerCase() ||
        created.document.giftRevisionId.toLowerCase() !==
          command.draft.document.giftRevisionId.toLowerCase()
      )
        rejectAdminContent("CONTENT_UNAVAILABLE");
      resultId = created.document.id;
      break;
    }
    case "SUBMIT_REVIEW":
    case "APPROVE_REVIEW": {
      if (review === undefined) rejectAdminContent("CONTENT_UNAVAILABLE");
      validateContentReviewAction(command, review, principal.actorId);
      const appended = requireAdminSuccess(
        adminMutationResponseSchema.parse(
          await repositories.contentReviews.append({
            schemaVersion: 1,
            action: command.action === "SUBMIT_REVIEW" ? "SUBMIT" : "APPROVE",
            target: review.target,
            expectedVersion: review.sequence,
            expectedContentHash: review.contentHash,
            expectedSourceHash: review.sourceHash,
            actorId: principal.actorId,
            requestId: request.requestId,
            reasonCode: command.reasonCode,
          }),
        ),
      );
      resultId = appended.resultId;
      break;
    }
    case "REVOKE_PREVIEW": {
      const revoked = requireAdminSuccess(
        adminMutationResponseSchema.parse(
          await repositories.contentPreviews.revoke({
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
      resultId = revoked.resultId;
      break;
    }
  }
  return completeAdminContentIdempotency(
    repositories.idempotency,
    reservation,
    resultId,
  );
}

function json(value: AdminContentResponse | ContentPreviewResponse): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export function createAdminContentUseCases(
  dependencies: AdminContentDependencies,
): AdminContentUseCases {
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  return Object.freeze({
    async execute(input: unknown): Promise<AdminContentResponse> {
      const parsed = adminContentRequestSchema.safeParse(input);
      if (!parsed.success) return adminContentFailure("INVALID_COMMAND");
      const request = parsed.data;
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
      try {
        const result =
          await dependencies.transactions.runInAdminContentTransaction(
            async (repositories) =>
              json(
                adminContentResponseSchema.parse(
                  await runCommand(
                    repositories,
                    request,
                    authorization,
                    dependencies.tokenPepper,
                  ),
                ),
              ),
          );
        return adminContentResponseSchema.parse(result);
      } catch (error: unknown) {
        return adminContentErrorResult(error);
      }
    },
    async readPreview(input: unknown): Promise<ContentPreviewResponse> {
      const parsed = contentPreviewRequestSchema.safeParse(input);
      if (!parsed.success) return adminContentFailure("INVALID_COMMAND");
      const request = parsed.data;
      try {
        const result =
          await dependencies.transactions.runInAdminContentTransaction(
            async (repositories) => {
              const response = contentPreviewResponseSchema.parse(
                await repositories.contentPreviews.read({
                  schemaVersion: 1,
                  target: request.target,
                  tokenDigest: sourceHashSchema.parse(
                    digestAdminContentToken({
                      tokenPepper: dependencies.tokenPepper,
                      purpose: "content-preview",
                      token: request.token,
                    }),
                  ),
                }),
              );
              if (response.outcome === "FAILURE") return response;
              if (
                response.target.kind !== request.target.kind ||
                response.target.revisionId.toLowerCase() !==
                  request.target.revisionId.toLowerCase() ||
                response.target.locale !== request.target.locale ||
                response.content.kind !== request.target.kind
              )
                rejectAdminContent("PREVIEW_UNAVAILABLE");
              if (
                response.content.kind === "IDOL_ALIASES" &&
                response.content.aliases.some(
                  (alias) =>
                    alias.locale !== null &&
                    alias.locale !== request.target.locale,
                )
              )
                rejectAdminContent("PREVIEW_UNAVAILABLE");
              if (
                response.content.kind === "GIFT_DETAILS" &&
                response.content.document.giftRevisionId.toLowerCase() !==
                  request.target.revisionId.toLowerCase()
              )
                rejectAdminContent("PREVIEW_UNAVAILABLE");
              return json(response);
            },
          );
        return contentPreviewResponseSchema.parse(result);
      } catch {
        return adminContentFailure("PREVIEW_UNAVAILABLE");
      }
    },
  });
}

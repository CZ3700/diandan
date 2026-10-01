import { compareBaseContentTime } from "./base-content-time.js";
import { createHash } from "node:crypto";
import {
  storefrontBrandRequestSchema,
  storefrontBrandResponseSchema,
  publicStorefrontBrandResponseSchema,
  storefrontBrandAuthorizationCommandSchema,
  adminAuthorizationResponseSchema,
  mediaUploadTicketResponseSchema,
  storefrontLogoProcessingResultSchema,
  type StorefrontBrandResponse,
  type PublicStorefrontBrandResponse,
  type StorefrontBrandRequest,
  type AdminPrincipal,
} from "@fan-support/contracts";
import type {
  StorefrontBrandRepositories,
  StorefrontBrandTransactionManager,
} from "@fan-support/persistence-port";
import type { StorefrontLogoProcessingPort } from "@fan-support/media-port";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";
import {
  adminContentErrorResult,
  adminContentFailure,
  rejectAdminContent,
  requireAdminSuccess,
} from "./admin-content-results.js";
export function createStorefrontBrandUseCases(
  dependencies: Readonly<{
    transactions: StorefrontBrandTransactionManager;
    tokenPepper: string;
    processor: StorefrontLogoProcessingPort;
  }>,
) {
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  async function authorize(
    repositories: StorefrontBrandRepositories,
    request: StorefrontBrandRequest,
  ) {
    const action = request.command.action;
    let permissions: readonly string[];
    switch (action) {
      case "PREPARE_LOGO":
        permissions = [
          "content.edit",
          "content.media.upload",
          "content.media.rights",
        ];
        break;
      case "READ":
      case "HISTORY":
        permissions = ["content.read"];
        break;
      case "SAVE_DRAFT":
        permissions = ["content.edit"];
        break;
      case "PUBLISH":
      case "RESTORE":
        permissions = ["content.publish"];
        break;
    }
    let principal: AdminPrincipal | undefined;
    for (const permission of permissions) {
      const next = requireAdminSuccess(
        adminAuthorizationResponseSchema.parse(
          await repositories.authorization.authorize(
            storefrontBrandAuthorizationCommandSchema.parse({
              schemaVersion: 1,
              permission,
              locales: [],
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
          ),
        ),
      ).principal;
      if (
        principal &&
        (next.actorId.toLowerCase() !== principal.actorId.toLowerCase() ||
          next.sessionId.toLowerCase() !== principal.sessionId.toLowerCase() ||
          compareBaseContentTime(next.expiresAt, principal.expiresAt) !== 0)
      )
        rejectAdminContent("CONTENT_UNAVAILABLE");
      if (compareBaseContentTime(next.expiresAt, next.authorizedAt) <= 0)
        rejectAdminContent("UNAUTHENTICATED");
      principal = next;
    }
    if (!principal) rejectAdminContent("FORBIDDEN");
    return principal;
  }
  return Object.freeze({
    async execute(input: unknown): Promise<StorefrontBrandResponse> {
      const parsed = storefrontBrandRequestSchema.safeParse(input);
      if (!parsed.success) return adminContentFailure("INVALID_COMMAND");
      const request = parsed.data,
        requestHash = createHash("sha256")
          .update(JSON.stringify(request.command))
          .digest("hex");
      try {
        if (request.command.action !== "PREPARE_LOGO")
          return storefrontBrandResponseSchema.parse(
            await dependencies.transactions.runInStorefrontBrandTransaction(
              async (repositories) =>
                repositories.storefrontBrand.execute({
                  command: request.command,
                  principal: await authorize(repositories, request),
                  requestId: request.requestId,
                  requestHash,
                }),
            ),
          );
        const command = request.command;
        const load = async (repositories: StorefrontBrandRepositories) => {
          const principal = await authorize(repositories, request),
            values = {
              command,
              principal,
              requestId: request.requestId,
              requestHash,
            };
          const replay =
            await repositories.storefrontBrand.readPrepared(values);
          if (replay) return { replay };
          const ticket = requireAdminSuccess(
            mediaUploadTicketResponseSchema.parse(
              await repositories.resources.readUpload({
                schemaVersion: 1,
                uploadId: command.uploadId,
                actorId: principal.actorId,
                sessionId: principal.sessionId,
              }),
            ),
          ).value;
          if (
            ticket.actorId.toLowerCase() !== principal.actorId.toLowerCase() ||
            ticket.sessionId.toLowerCase() !==
              principal.sessionId.toLowerCase() ||
            ticket.uploadId.toLowerCase() !== command.uploadId.toLowerCase() ||
            ticket.status !== "PENDING" ||
            ticket.version !== 1 ||
            ticket.assetId !== null ||
            compareBaseContentTime(ticket.expiresAt, ticket.createdAt) <= 0 ||
            compareBaseContentTime(ticket.expiresAt, principal.authorizedAt) <=
              0
          )
            rejectAdminContent("INVALID_CONTENT");
          return { values, ticket };
        };
        const before =
          await dependencies.transactions.runInStorefrontBrandTransaction(load);
        if ("replay" in before)
          return storefrontBrandResponseSchema.parse(before.replay);
        const processed = storefrontLogoProcessingResultSchema.parse(
          await dependencies.processor.process({
            schemaVersion: 1,
            profileVersion: 1,
            uploadId: command.uploadId,
            source: before.ticket.source,
          }),
        );
        if (processed.outcome === "FAILURE")
          return adminContentFailure(
            processed.error.retryable
              ? "CONTENT_UNAVAILABLE"
              : "INVALID_CONTENT",
          );
        if (
          processed.uploadId.toLowerCase() !== command.uploadId.toLowerCase() ||
          processed.sourceChecksumSha256 !== before.ticket.source.checksumSha256
        )
          return adminContentFailure("INVALID_CONTENT");
        return storefrontBrandResponseSchema.parse(
          await dependencies.transactions.runInStorefrontBrandTransaction(
            async (repositories) => {
              const current = await load(repositories);
              if ("replay" in current) return current.replay;
              if (
                current.values.principal.actorId !==
                  before.values.principal.actorId ||
                current.values.principal.sessionId !==
                  before.values.principal.sessionId ||
                current.ticket.source.objectKey !==
                  before.ticket.source.objectKey ||
                current.ticket.source.checksumSha256 !==
                  before.ticket.source.checksumSha256 ||
                current.ticket.source.byteSize !==
                  before.ticket.source.byteSize ||
                current.ticket.source.mimeType !==
                  before.ticket.source.mimeType ||
                current.ticket.rightsReference !== before.ticket.rightsReference
              )
                rejectAdminContent("STALE_CONTENT");
              return repositories.storefrontBrand.saveLogo({
                ...current.values,
                processed,
              });
            },
          ),
        );
      } catch (error) {
        return adminContentErrorResult(error);
      }
    },
  });
}
export function createPublicStorefrontBrandUseCases(
  dependencies: Readonly<{ transactions: StorefrontBrandTransactionManager }>,
) {
  return Object.freeze({
    async execute(): Promise<PublicStorefrontBrandResponse> {
      try {
        return publicStorefrontBrandResponseSchema.parse(
          await dependencies.transactions.runInStorefrontBrandTransaction(
            ({ storefrontBrand }) => storefrontBrand.readPublished(),
          ),
        );
      } catch {
        return {
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "CONTENT_UNAVAILABLE",
        };
      }
    },
  });
}

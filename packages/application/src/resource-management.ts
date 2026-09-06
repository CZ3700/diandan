/// <reference types="node" />
import { randomUUID } from "node:crypto";
import {
  adminResourceRequestSchema,
  adminResourceResponseSchema,
  adminResourceAuthorizationCommandSchema,
  resourcePolicyResponseSchema,
  resourceMediaResponseSchema,
  resourceMediaJobResponseSchema,
  resourcePolicyRegisterCommandSchema,
  mediaRightsSetCommandSchema,
  resourceMediaEnqueueCommandSchema,
  resourceMediaRetryCommandSchema,
  type AdminResourceRequest,
  type AdminResourceResponse,
} from "@fan-support/contracts";
import type {
  ResourceManagementTransactionManager,
  ResourceManagementRepositories,
} from "@fan-support/persistence-port";
import type {
  MediaStoragePort,
  MediaSourceInspectionPort,
} from "@fan-support/media-port";
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
  beginResourceIdempotency,
  completeResourceIdempotency,
} from "./resource-management-idempotency.js";
import {
  authorize,
  permissions,
  readTicket,
  requirePending,
  equalId,
  mutationValues,
  mutationResult,
  type Authorization,
} from "./resource-management-shared.js";
import { beginUpload, completeUpload } from "./resource-management-upload.js";
export type ResourceManagementDependencies = Readonly<{
  transactions: ResourceManagementTransactionManager;
  storage: MediaStoragePort;
  inspector: MediaSourceInspectionPort;
  tokenPepper: string;
}>;
export type ResourceManagementUseCases = Readonly<{
  execute(input: unknown): Promise<AdminResourceResponse>;
}>;
async function runCommand(
  repositories: ResourceManagementRepositories,
  request: AdminResourceRequest,
  authorization: Authorization,
): Promise<AdminResourceResponse> {
  const { command } = request;
  const principal = await authorize(
    repositories,
    authorization,
    permissions[command.action],
  );
  switch (command.action) {
    case "READ_UPLOAD": {
      const ticket = await readTicket(
        repositories,
        command.uploadId,
        principal,
      );
      if (ticket.status === "PENDING") requirePending(ticket, principal);
      return {
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "UPLOAD",
        upload: {
          schemaVersion: 1,
          uploadId: ticket.uploadId,
          version: ticket.version,
          status: ticket.status,
          assetId: ticket.assetId,
          expiresAt: ticket.expiresAt,
        },
      };
    }
    case "READ_POLICY": {
      const response = requireAdminSuccess(
        resourcePolicyResponseSchema.parse(
          await repositories.resources.readPolicy({
            schemaVersion: 1,
            policyKey: command.policyKey,
          }),
        ),
      );
      if (response.policy.policyKey !== command.policyKey)
        rejectAdminContent("CONTENT_UNAVAILABLE");
      return response;
    }
    case "READ_MEDIA": {
      const response = requireAdminSuccess(
        resourceMediaResponseSchema.parse(
          await repositories.resources.readMedia({
            schemaVersion: 1,
            assetId: command.assetId,
          }),
        ),
      );
      if (!equalId(response.media.assetId, command.assetId))
        rejectAdminContent("CONTENT_UNAVAILABLE");
      return response;
    }
    case "READ_MEDIA_JOB": {
      const response = requireAdminSuccess(
        resourceMediaJobResponseSchema.parse(
          await repositories.resources.readMediaJob({
            schemaVersion: 1,
            jobId: command.jobId,
          }),
        ),
      );
      if (!equalId(response.job.snapshot.jobId, command.jobId))
        rejectAdminContent("CONTENT_UNAVAILABLE");
      return response;
    }
    case "BEGIN_UPLOAD":
    case "COMPLETE_UPLOAD":
      return rejectAdminContent("INVALID_COMMAND");
  }
  const reservation = await beginResourceIdempotency(
    repositories.idempotency,
    command,
    principal,
  );
  if (reservation.replay !== undefined) return reservation.replay;
  const values = mutationValues(command);
  const audit = {
    actorId: principal.actorId,
    sessionId: principal.sessionId,
    requestId: request.requestId,
  };
  let written;
  switch (command.action) {
    case "REGISTER_POLICY": {
      const receiptId = randomUUID();
      written = mutationResult(
        await repositories.resources.registerPolicy(
          resourcePolicyRegisterCommandSchema.parse({
            ...values,
            ...audit,
            receiptId,
          }),
        ),
      );
      if (!equalId(written.resultId, receiptId))
        rejectAdminContent("CONTENT_UNAVAILABLE");
      break;
    }
    case "SET_MEDIA_RIGHTS": {
      const eventId = randomUUID();
      written = mutationResult(
        await repositories.resources.setRights(
          mediaRightsSetCommandSchema.parse({ ...values, ...audit, eventId }),
        ),
      );
      if (!equalId(written.resultId, eventId))
        rejectAdminContent("CONTENT_UNAVAILABLE");
      break;
    }
    case "ENQUEUE_MEDIA":
      written = mutationResult(
        await repositories.resources.enqueueMedia(
          resourceMediaEnqueueCommandSchema.parse({
            ...values,
            ...audit,
            jobId: randomUUID(),
            receiptId: randomUUID(),
          }),
        ),
      );
      break;
    case "RETRY_MEDIA_JOB":
      written = mutationResult(
        await repositories.resources.retryMediaJob(
          resourceMediaRetryCommandSchema.parse({
            ...values,
            ...audit,
            newJobId: randomUUID(),
            receiptId: randomUUID(),
          }),
        ),
      );
      break;
  }
  return completeResourceIdempotency(
    repositories.idempotency,
    reservation,
    written.resultId,
  );
}
export function createResourceManagementUseCases(
  dependencies: ResourceManagementDependencies,
): ResourceManagementUseCases {
  if (
    dependencies === null ||
    typeof dependencies !== "object" ||
    typeof dependencies.transactions?.runInResourceManagementTransaction !==
      "function" ||
    typeof dependencies.storage?.createUploadGrant !== "function" ||
    typeof dependencies.inspector?.inspect !== "function"
  )
    throw new TypeError("invalid resource management configuration");
  try {
    validateAdminContentTokenPepper(dependencies.tokenPepper);
  } catch {
    throw new TypeError("invalid admin token configuration");
  }
  return Object.freeze({
    async execute(input: unknown): Promise<AdminResourceResponse> {
      const parsed = adminResourceRequestSchema.safeParse(input);
      if (!parsed.success) return adminContentFailure("INVALID_COMMAND");
      try {
        const request = parsed.data;
        const authorization = adminResourceAuthorizationCommandSchema
          .omit({ permission: true })
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
        let response: AdminResourceResponse;
        if (request.command.action === "BEGIN_UPLOAD")
          response = await beginUpload(
            dependencies,
            request,
            request.command,
            authorization,
          );
        else if (request.command.action === "COMPLETE_UPLOAD")
          response = await completeUpload(
            dependencies,
            request,
            request.command,
            authorization,
          );
        else
          response =
            await dependencies.transactions.runInResourceManagementTransaction(
              (repositories) =>
                runCommand(repositories, request, authorization),
            );
        return adminResourceResponseSchema.parse(response);
      } catch (error) {
        return adminContentErrorResult(error);
      }
    },
  });
}

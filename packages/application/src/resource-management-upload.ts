/// <reference types="node" />
import { randomUUID } from "node:crypto";
import {
  mediaUploadTicketResponseSchema,
  mediaUploadGrantResponseSchema,
  mediaPortResponseSchema,
  mediaSourceInspectionResponseSchema,
  mediaObjectKeySchema,
  mediaUploadReserveCommandSchema,
  mediaUploadRegisterCommandSchema,
  type AdminResourceRequest,
  type AdminResourceResponse,
  type MediaSourceInspectionReceipt,
  type MediaUploadTicket,
} from "@fan-support/contracts";
import type { ResourceManagementDependencies } from "./resource-management.js";
import {
  rejectAdminContent,
  requireAdminSuccess,
} from "./admin-content-results.js";
import {
  addBaseContentSeconds,
  compareBaseContentTime,
} from "./base-content-time.js";
import {
  beginResourceIdempotency,
  completeResourceIdempotency,
} from "./resource-management-idempotency.js";
import {
  authorize,
  permissions,
  readTicket,
  validateTicket,
  mutationValues,
  requirePending,
  equalId,
  mutationResult,
  type Authorization,
  type Command,
} from "./resource-management-shared.js";
const earlier = (a: string, b: string) =>
  compareBaseContentTime(a, b) <= 0 ? a : b;
function sameSource(
  a: MediaUploadTicket["source"],
  b: MediaUploadTicket["source"],
): boolean {
  return (
    a.objectKey === b.objectKey &&
    a.checksumSha256 === b.checksumSha256 &&
    a.byteSize === b.byteSize &&
    a.mimeType === b.mimeType
  );
}
export async function beginUpload(
  dependencies: ResourceManagementDependencies,
  request: AdminResourceRequest,
  command: Command<"BEGIN_UPLOAD">,
  authorization: Authorization,
): Promise<AdminResourceResponse> {
  const reserved =
    await dependencies.transactions.runInResourceManagementTransaction(
      async (repositories) => {
        const principal = await authorize(
          repositories,
          authorization,
          permissions.BEGIN_UPLOAD,
        );
        const reservation = await beginResourceIdempotency(
          repositories.idempotency,
          command,
          principal,
        );
        let ticket: MediaUploadTicket;
        if (reservation.replay !== undefined) {
          ticket = await readTicket(
            repositories,
            reservation.replay.resultId,
            principal,
          );
        } else {
          const uploadId = randomUUID();
          const objectKey = mediaObjectKeySchema.parse(
            `uploads/v1/${uploadId}`,
          );
          const expiresAt = earlier(
            addBaseContentSeconds(principal.authorizedAt, 900),
            principal.expiresAt,
          );
          const response = requireAdminSuccess(
            mediaUploadTicketResponseSchema.parse(
              await repositories.resources.reserveUpload(
                mediaUploadReserveCommandSchema.parse({
                  ...mutationValues(command),
                  actorId: principal.actorId,
                  sessionId: principal.sessionId,
                  requestId: request.requestId,
                  uploadId,
                  objectKey,
                  createdAt: principal.authorizedAt,
                  expiresAt,
                }),
              ),
            ),
          );
          ticket = validateTicket(response.value, uploadId, principal);
          if (
            ticket.source.objectKey !== objectKey ||
            compareBaseContentTime(ticket.createdAt, principal.authorizedAt) !==
              0 ||
            compareBaseContentTime(ticket.expiresAt, expiresAt) > 0
          )
            rejectAdminContent("CONTENT_UNAVAILABLE");
        }
        if (
          ticket.source.checksumSha256 !== command.checksumSha256 ||
          ticket.source.byteSize !== command.byteSize ||
          ticket.source.mimeType !== command.mimeType ||
          ticket.rightsReference !== command.rightsReference
        )
          rejectAdminContent("CONTENT_UNAVAILABLE");
        requirePending(ticket, principal);
        if (reservation.replay === undefined)
          await completeResourceIdempotency(
            repositories.idempotency,
            reservation,
            ticket.uploadId,
          );
        return {
          ticket,
          principal,
          replayed: reservation.replay !== undefined,
        };
      },
    );
  // Credential resolution and signing can perform network I/O, so they follow commit.
  const expiresAt = earlier(
    earlier(
      addBaseContentSeconds(reserved.principal.authorizedAt, 300),
      reserved.principal.expiresAt,
    ),
    reserved.ticket.expiresAt,
  );
  const response = mediaPortResponseSchema.parse(
    await dependencies.storage.createUploadGrant({
      schemaVersion: 1,
      operation: "CREATE_UPLOAD_GRANT",
      storageClass: "SOURCE",
      ...reserved.ticket.source,
      expiresAt,
    }),
  );
  if (
    response.outcome !== "SUCCESS" ||
    response.operation !== "CREATE_UPLOAD_GRANT"
  )
    rejectAdminContent("CONTENT_UNAVAILABLE");
  const grant = response.value;
  if (
    grant.storageClass !== "SOURCE" ||
    !sameSource(grant, reserved.ticket.source) ||
    compareBaseContentTime(grant.expiresAt, expiresAt) > 0 ||
    compareBaseContentTime(grant.expiresAt, reserved.principal.authorizedAt) <=
      0
  )
    rejectAdminContent("CONTENT_UNAVAILABLE");
  return mediaUploadGrantResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "UPLOAD_GRANT",
    uploadId: reserved.ticket.uploadId,
    replayed: reserved.replayed,
    grant: {
      method: grant.method,
      url: grant.url,
      headers: grant.headers,
      expiresAt: grant.expiresAt,
    },
  });
}
export async function completeUpload(
  dependencies: ResourceManagementDependencies,
  request: AdminResourceRequest,
  command: Command<"COMPLETE_UPLOAD">,
  authorization: Authorization,
): Promise<AdminResourceResponse> {
  const before =
    await dependencies.transactions.runInResourceManagementTransaction(
      async (repositories) => {
        const principal = await authorize(
          repositories,
          authorization,
          permissions.COMPLETE_UPLOAD,
        );
        const ticket = await readTicket(
          repositories,
          command.uploadId,
          principal,
        );
        if (ticket.status === "PENDING") requirePending(ticket, principal);
        return { principal, ticket };
      },
    );
  let receipt: MediaSourceInspectionReceipt | null = null;
  if (before.ticket.status === "PENDING") {
    const response = mediaSourceInspectionResponseSchema.parse(
      await dependencies.inspector.inspect({
        schemaVersion: 1,
        profileVersion: 1,
        source: before.ticket.source,
      }),
    );
    if (response.outcome === "FAILURE") {
      if (response.error.code === "SOURCE_NOT_FOUND")
        rejectAdminContent("NOT_FOUND");
      if (response.error.code === "SOURCE_CHANGED")
        rejectAdminContent("STALE_CONTENT");
      if (response.error.retryable) rejectAdminContent("CONTENT_UNAVAILABLE");
      rejectAdminContent("INVALID_CONTENT");
    }
    receipt = response.receipt;
    if (!sameSource(receipt.source, before.ticket.source))
      rejectAdminContent("CONTENT_UNAVAILABLE");
  }
  return dependencies.transactions.runInResourceManagementTransaction(
    async (repositories) => {
      const principal = await authorize(
        repositories,
        authorization,
        permissions.COMPLETE_UPLOAD,
        before.principal,
      );
      const ticket = await readTicket(
        repositories,
        command.uploadId,
        principal,
      );
      if (
        !sameSource(ticket.source, before.ticket.source) ||
        ticket.rightsReference !== before.ticket.rightsReference ||
        compareBaseContentTime(ticket.createdAt, before.ticket.createdAt) !==
          0 ||
        compareBaseContentTime(ticket.expiresAt, before.ticket.expiresAt) !== 0
      )
        rejectAdminContent("CONTENT_UNAVAILABLE");
      const reservation = await beginResourceIdempotency(
        repositories.idempotency,
        command,
        principal,
      );
      if (reservation.replay !== undefined) {
        if (
          ticket.status !== "REGISTERED" ||
          ticket.assetId === null ||
          !equalId(ticket.assetId, reservation.replay.resultId)
        )
          rejectAdminContent("CONTENT_UNAVAILABLE");
        return reservation.replay;
      }
      requirePending(ticket, principal);
      if (receipt === null) rejectAdminContent("STALE_VERSION");
      const written = mutationResult(
        await repositories.resources.registerUpload(
          mediaUploadRegisterCommandSchema.parse({
            ...mutationValues(command),
            actorId: principal.actorId,
            sessionId: principal.sessionId,
            requestId: request.requestId,
            assetId: randomUUID(),
            receipt,
          }),
        ),
      );
      return completeResourceIdempotency(
        repositories.idempotency,
        reservation,
        written.resultId,
      );
    },
  );
}

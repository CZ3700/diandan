import {
  adminAuthorizationResponseSchema,
  adminMutationResponseSchema,
  mediaUploadTicketResponseSchema,
  type AdminResourceAuthorizationCommand,
  type AdminResourceCommand,
  type AdminResourcePermission,
  type AdminPrincipal,
  type MediaUploadTicket,
} from "@fan-support/contracts";
import type { ResourceManagementRepositories } from "@fan-support/persistence-port";
import {
  rejectAdminContent,
  requireAdminSuccess,
} from "./admin-content-results.js";
import { compareBaseContentTime } from "./base-content-time.js";
export type Authorization = Omit<
  AdminResourceAuthorizationCommand,
  "permission"
>;
export type Command<Action extends AdminResourceCommand["action"]> = Extract<
  AdminResourceCommand,
  { action: Action }
>;
export const permissions: Record<
  AdminResourceCommand["action"],
  AdminResourcePermission
> = {
  READ_POLICY: "content.policy.manage",
  REGISTER_POLICY: "content.policy.manage",
  BEGIN_UPLOAD: "content.media.upload",
  READ_UPLOAD: "content.media.upload",
  COMPLETE_UPLOAD: "content.media.upload",
  READ_MEDIA: "content.media.read",
  READ_MEDIA_JOB: "content.media.read",
  SET_MEDIA_RIGHTS: "content.media.rights",
  ENQUEUE_MEDIA: "content.media.process",
  RETRY_MEDIA_JOB: "content.media.process",
};
export const equalId = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();
export function mutationValues(
  command: AdminResourceCommand,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(command).filter(
      ([key]) => key !== "action" && key !== "idempotencyKey",
    ),
  );
}
export async function authorize(
  repositories: ResourceManagementRepositories,
  authorization: Authorization,
  permission: AdminResourcePermission,
  prior?: AdminPrincipal,
): Promise<AdminPrincipal> {
  const { principal } = requireAdminSuccess(
    adminAuthorizationResponseSchema.parse(
      await repositories.authorization.authorize({
        ...authorization,
        permission,
      }),
    ),
  );
  if (
    prior !== undefined &&
    (!equalId(principal.actorId, prior.actorId) ||
      !equalId(principal.sessionId, prior.sessionId) ||
      compareBaseContentTime(principal.expiresAt, prior.expiresAt) !== 0)
  )
    rejectAdminContent("CONTENT_UNAVAILABLE");
  if (compareBaseContentTime(principal.expiresAt, principal.authorizedAt) <= 0)
    rejectAdminContent("UNAUTHENTICATED");
  return principal;
}
export function validateTicket(
  ticket: MediaUploadTicket,
  uploadId: string,
  principal: AdminPrincipal,
): MediaUploadTicket {
  if (
    !equalId(ticket.uploadId, uploadId) ||
    !equalId(ticket.actorId, principal.actorId) ||
    !equalId(ticket.sessionId, principal.sessionId) ||
    compareBaseContentTime(ticket.expiresAt, ticket.createdAt) <= 0
  )
    rejectAdminContent("CONTENT_UNAVAILABLE");
  return ticket;
}
export async function readTicket(
  repositories: ResourceManagementRepositories,
  uploadId: string,
  principal: AdminPrincipal,
): Promise<MediaUploadTicket> {
  const response = requireAdminSuccess(
    mediaUploadTicketResponseSchema.parse(
      await repositories.resources.readUpload({
        schemaVersion: 1,
        uploadId,
        actorId: principal.actorId,
        sessionId: principal.sessionId,
      }),
    ),
  );
  return validateTicket(response.value, uploadId, principal);
}
export function requirePending(
  ticket: MediaUploadTicket,
  principal: AdminPrincipal,
): void {
  if (
    ticket.status !== "PENDING" ||
    ticket.version !== 1 ||
    compareBaseContentTime(ticket.expiresAt, principal.authorizedAt) <= 0
  )
    rejectAdminContent("STALE_VERSION");
}
export function mutationResult(input: unknown) {
  const response = requireAdminSuccess(
    adminMutationResponseSchema.parse(input),
  );
  if (response.replayed) rejectAdminContent("CONTENT_UNAVAILABLE");
  return response;
}

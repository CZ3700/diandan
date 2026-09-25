import { randomUUID } from "node:crypto";
import {
  adminMutationResponseSchema,
  managementCenterClaimSchema,
  managementCenterPreparedMediaSchema,
  mediaUploadTicketResponseSchema,
  mediaSourceInspectionResponseSchema,
  mediaUploadRegisterCommandSchema,
  mediaRightsSetCommandSchema,
  resourceMediaResponseSchema,
  resourceMediaEnqueueCommandSchema,
  resourceMediaJobResponseSchema,
  resourceMediaRetryCommandSchema,
  type ManagementCenterClaim,
  type ManagementCenterFailure,
  type MediaUploadTicket,
} from "@fan-support/contracts";
import type { MediaSourceInspectionPort } from "@fan-support/media-port";
import type {
  ManagementCenterMediaPreparationPort,
  ManagementMediaTransactionManager,
  ManagementMediaRepositories,
} from "@fan-support/persistence-port";
import { retryManagementTransaction } from "./management-transaction-retry.js";

class PreparationFailure extends Error {
  constructor(readonly code: ManagementCenterFailure["code"]) {
    super(code);
  }
}
function requireSuccess<
  T extends
    | { outcome: "SUCCESS" }
    | { outcome: "FAILURE"; code: ManagementCenterFailure["code"] },
>(value: T): Extract<T, { outcome: "SUCCESS" }> {
  if (value.outcome === "FAILURE") throw new PreparationFailure(value.code);
  return value as Extract<T, { outcome: "SUCCESS" }>;
}
const fence = (claim: ManagementCenterClaim) => ({
  operationId: claim.operation.operationId,
  leaseTokenDigest: claim.leaseTokenDigest,
});
async function reload(
  repositories: ManagementMediaRepositories,
  prior: ManagementCenterClaim,
) {
  const result = await repositories.operations.loadClaim(fence(prior));
  if ("outcome" in result) throw new PreparationFailure(result.code);
  const current = managementCenterClaimSchema.parse(result);
  if (
    current.intentHash !== prior.intentHash ||
    current.operation.operationId !== prior.operation.operationId ||
    current.leaseTokenDigest !== prior.leaseTokenDigest
  )
    throw new PreparationFailure("TARGET_CONFLICT");
  return current;
}
function image(claim: ManagementCenterClaim) {
  return claim.intent.kind === "RESTORE_POSTER" ? null : claim.intent.image;
}
function roles(
  claim: ManagementCenterClaim,
): readonly ("PORTRAIT" | "HERO_DESKTOP" | "HERO_MOBILE" | "GIFT_PRIMARY")[] {
  return claim.intent.kind === "SAVE_ARTIST"
    ? ["PORTRAIT", "HERO_DESKTOP", "HERO_MOBILE"]
    : claim.intent.kind === "SAVE_GIFT"
      ? ["GIFT_PRIMARY"]
      : ["HERO_DESKTOP", "HERO_MOBILE"];
}
function audit(claim: ManagementCenterClaim) {
  return {
    schemaVersion: 1 as const,
    actorId: claim.actorId,
    sessionId: claim.sessionId,
    requestId: claim.requestId,
    reasonCode: "MANAGEMENT_IMAGE",
  };
}
async function readUpload(
  repositories: ManagementMediaRepositories,
  claim: ManagementCenterClaim,
): Promise<MediaUploadTicket> {
  const uploaded = image(claim);
  if (!uploaded) throw new PreparationFailure("INVALID_COMMAND");
  return requireSuccess(
    mediaUploadTicketResponseSchema.parse(
      await repositories.resources.readUpload({
        schemaVersion: 1,
        uploadId: uploaded.uploadId,
        actorId: claim.actorId,
        sessionId: claim.sessionId,
      }),
    ),
  ).value;
}
function sameSource(
  left: MediaUploadTicket["source"],
  right: MediaUploadTicket["source"],
) {
  return (
    left.objectKey === right.objectKey &&
    left.checksumSha256 === right.checksumSha256 &&
    left.byteSize === right.byteSize &&
    left.mimeType === right.mimeType
  );
}
async function saveCheckpoint(
  repositories: ManagementMediaRepositories,
  claim: ManagementCenterClaim,
) {
  const saved = await repositories.operations.checkpoint({
    ...fence(claim),
    checkpoint: claim.checkpoint,
  });
  if ("outcome" in saved) throw new PreparationFailure(saved.code);
  return managementCenterClaimSchema.parse(saved);
}

/** Inspect outside locks, then register and checkpoint actual persistent resource jobs atomically. */
export function createManagementMediaPreparation(
  dependencies: Readonly<{
    transactions: ManagementMediaTransactionManager;
    inspector: MediaSourceInspectionPort;
  }>,
): ManagementCenterMediaPreparationPort {
  const transact: ManagementMediaTransactionManager["runInManagementMediaTransaction"] =
    (work) =>
      retryManagementTransaction(() =>
        dependencies.transactions.runInManagementMediaTransaction(work),
      );
  return Object.freeze({
    async prepare(
      input: ManagementCenterClaim,
    ): ReturnType<ManagementCenterMediaPreparationPort["prepare"]> {
      try {
        const before = await transact(async (repositories) => {
          const claim = await reload(
            repositories,
            managementCenterClaimSchema.parse(input),
          );
          const ticket =
            image(claim) && claim.checkpoint.sourceAssetId === null
              ? await readUpload(repositories, claim)
              : null;
          return { claim, ticket };
        });
        if (!image(before.claim))
          return { outcome: "READY", preparedMedia: null };
        let inspection = null;
        if (before.ticket?.status === "PENDING") {
          const inspected = mediaSourceInspectionResponseSchema.parse(
            await dependencies.inspector.inspect({
              schemaVersion: 1,
              profileVersion: 1,
              source: before.ticket.source,
            }),
          );
          if (inspected.outcome === "FAILURE")
            throw new PreparationFailure(
              inspected.error.retryable
                ? "UPLOAD_NOT_READY"
                : "INVALID_CONTENT",
            );
          if (!sameSource(inspected.receipt.source, before.ticket.source))
            throw new PreparationFailure("INVALID_CONTENT");
          inspection = inspected.receipt;
        }
        const preparedSource = await transact(async (repositories) => {
          const claim = await reload(repositories, before.claim);
          if (claim.checkpoint.preparedMedia) return claim;
          if (claim.checkpoint.sourceAssetId === null) {
            const ticket = await readUpload(repositories, claim);
            let sourceAssetId = ticket.assetId;
            if (ticket.status === "PENDING") {
              if (
                !inspection ||
                !before.ticket ||
                !sameSource(ticket.source, before.ticket.source)
              )
                throw new PreparationFailure("UPLOAD_NOT_READY");
              const registered = requireSuccess(
                adminMutationResponseSchema.parse(
                  await repositories.resources.registerUpload(
                    mediaUploadRegisterCommandSchema.parse({
                      ...audit(claim),
                      uploadId: ticket.uploadId,
                      expectedVersion: 1,
                      assetId: randomUUID(),
                      receipt: inspection,
                    }),
                  ),
                ),
              );
              sourceAssetId = registered.resultId;
            }
            if (!sourceAssetId)
              throw new PreparationFailure("UPLOAD_NOT_READY");
            const source = requireSuccess(
              resourceMediaResponseSchema.parse(
                await repositories.resources.readMedia({
                  schemaVersion: 1,
                  assetId: sourceAssetId,
                }),
              ),
            ).media;
            if (source.rightsStatus === "PENDING")
              requireSuccess(
                adminMutationResponseSchema.parse(
                  await repositories.resources.setRights(
                    mediaRightsSetCommandSchema.parse({
                      ...audit(claim),
                      assetId: sourceAssetId,
                      expectedVersion: source.rightsVersion,
                      rightsStatus: "APPROVED",
                      evidenceReference: `management-upload:${claim.operation.operationId}`,
                      eventId: randomUUID(),
                    }),
                  ),
                ),
              );
            else if (source.rightsStatus !== "APPROVED")
              throw new PreparationFailure("MEDIA_FAILED");
            claim.checkpoint.sourceAssetId = sourceAssetId;
          }
          if (claim.checkpoint.jobs.length === 0) {
            const metadata = requireSuccess(
              await repositories.publication.prepareMediaMetadata({
                schemaVersion: 1,
                ...fence(claim),
                assetId: claim.checkpoint.sourceAssetId,
                processingJobId: null,
              }),
            );
            for (const role of roles(claim)) {
              const job = requireSuccess(
                adminMutationResponseSchema.parse(
                  await repositories.resources.enqueueMedia(
                    resourceMediaEnqueueCommandSchema.parse({
                      ...audit(claim),
                      sourceAssetId: claim.checkpoint.sourceAssetId,
                      metadataRevisionId: metadata.metadataRevisionId,
                      role,
                      fit: "CONTAIN",
                      expectedVersion: 0,
                      jobId: randomUUID(),
                      receiptId: randomUUID(),
                    }),
                  ),
                ),
              );
              claim.checkpoint.jobs.push({
                role,
                metadataRevisionId: metadata.metadataRevisionId,
                jobId: job.resultId,
              });
            }
          }
          return saveCheckpoint(repositories, claim);
        });
        return await transact(async (repositories) => {
          const claim = await reload(repositories, preparedSource);
          if (claim.checkpoint.preparedMedia)
            return {
              outcome: "READY" as const,
              preparedMedia: claim.checkpoint.preparedMedia,
            };
          const assets = [];
          let pending = false;
          for (const job of claim.checkpoint.jobs) {
            const current = requireSuccess(
              resourceMediaJobResponseSchema.parse(
                await repositories.resources.readMediaJob({
                  schemaVersion: 1,
                  jobId: job.jobId,
                }),
              ),
            ).job;
            if (current.snapshot.status === "FAILED") {
              if (!claim.checkpoint.retryRequested)
                throw new PreparationFailure("MEDIA_FAILED");
              const retry = requireSuccess(
                adminMutationResponseSchema.parse(
                  await repositories.resources.retryMediaJob(
                    resourceMediaRetryCommandSchema.parse({
                      ...audit(claim),
                      jobId: job.jobId,
                      expectedVersion: current.snapshot.attemptCount,
                      newJobId: randomUUID(),
                      receiptId: randomUUID(),
                    }),
                  ),
                ),
              );
              job.jobId = retry.resultId;
              pending = true;
            } else if (current.snapshot.status !== "SUCCEEDED") pending = true;
            else {
              const assetId = current.snapshot.outputAssetId;
              if (!assetId) throw new PreparationFailure("MEDIA_FAILED");
              const derivative = requireSuccess(
                resourceMediaResponseSchema.parse(
                  await repositories.resources.readMedia({
                    schemaVersion: 1,
                    assetId,
                  }),
                ),
              ).media;
              if (
                derivative.identityKind !== "PROCESSED_MASTER" ||
                derivative.processingStatus !== "READY"
              )
                throw new PreparationFailure("MEDIA_FAILED");
              if (derivative.rightsStatus === "PENDING")
                requireSuccess(
                  adminMutationResponseSchema.parse(
                    await repositories.resources.setRights(
                      mediaRightsSetCommandSchema.parse({
                        ...audit(claim),
                        assetId,
                        expectedVersion: derivative.rightsVersion,
                        rightsStatus: "APPROVED",
                        evidenceReference: `management-upload:${claim.operation.operationId}`,
                        eventId: randomUUID(),
                      }),
                    ),
                  ),
                );
              else if (derivative.rightsStatus !== "APPROVED")
                throw new PreparationFailure("MEDIA_FAILED");
              const metadata = requireSuccess(
                await repositories.publication.prepareMediaMetadata({
                  schemaVersion: 1,
                  ...fence(claim),
                  assetId,
                  processingJobId: job.jobId,
                }),
              );
              assets.push({
                role: job.role,
                assetId,
                metadataRevisionId: metadata.metadataRevisionId,
                processingJobId: job.jobId,
              });
            }
          }
          claim.checkpoint.retryRequested = false;
          if (!pending)
            claim.checkpoint.preparedMedia =
              managementCenterPreparedMediaSchema.parse({
                sourceAssetId: claim.checkpoint.sourceAssetId,
                assets,
              });
          await saveCheckpoint(repositories, claim);
          return pending
            ? { outcome: "PENDING" as const }
            : {
                outcome: "READY" as const,
                preparedMedia: claim.checkpoint.preparedMedia,
              };
        });
      } catch (error) {
        return {
          schemaVersion: 1,
          outcome: "FAILURE",
          code:
            error instanceof PreparationFailure
              ? error.code
              : "MANAGEMENT_UNAVAILABLE",
        };
      }
    },
  });
}

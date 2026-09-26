import {
  adminOrdersFailureSchema,
  adminOrdersProofRenditionLocationSchema,
  adminOrdersProofReservationSchema,
  adminOrdersProofUploadStateSchema,
  adminOrdersResponseSchema,
  deliveryProofProcessingResultSchema,
  mediaPortResponseSchema,
  type AdminOrdersFailure,
  type AdminOrdersResponse,
  type AdminOrdersStoreRequest,
} from "@fan-support/contracts";
import type {
  DeliveryProofProcessingPort,
  MediaStoragePort,
} from "@fan-support/media-port";
import type {
  AdminOrdersTransactionManager,
  JsonValue,
} from "@fan-support/persistence-port";
import {
  addBaseContentSeconds,
  compareBaseContentTime,
} from "./base-content-time.js";

export type AdminOrderProofDependencies = Readonly<{
  storage: MediaStoragePort;
  processor: DeliveryProofProcessingPort;
}>;
type Transactions = AdminOrdersTransactionManager;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as JsonValue;
const failure = (code: AdminOrdersFailure["code"]): AdminOrdersFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});
const earlier = (a: string, b: string) =>
  compareBaseContentTime(a, b) <= 0 ? a : b;
// Provider GET grants need at least 60 seconds; admin grants never exceed five minutes.
const GRANT_SECONDS = 300;
const MINIMUM_DOWNLOAD_SECONDS = 60;

/** Commit the reservation first; credential resolution and signing can perform network I/O. */
export async function beginProofUpload(
  transactions: Transactions,
  proofs: AdminOrderProofDependencies,
  stored: AdminOrdersStoreRequest,
): Promise<AdminOrdersResponse> {
  const command = stored.command;
  if (command.action !== "BEGIN_PROOF_UPLOAD")
    return failure("INVALID_COMMAND");
  const raw = await transactions.runInAdminOrdersTransaction(
    async ({ adminOrders }) =>
      json(await adminOrders.reserveProofUpload(stored)),
  );
  const denied = adminOrdersFailureSchema.safeParse(raw);
  if (denied.success) return denied.data;
  const reservation = adminOrdersProofReservationSchema.parse(raw);
  if (
    reservation.orderId !== command.orderId ||
    reservation.fulfillmentId !== command.fulfillmentId ||
    reservation.source.checksumSha256 !== command.checksumSha256 ||
    reservation.source.byteSize !== command.byteSize ||
    reservation.source.mimeType !== command.mimeType
  )
    return failure("TEMPORARY_UNAVAILABLE");
  const expiresAt = earlier(
    earlier(
      addBaseContentSeconds(reservation.authorizedAt, GRANT_SECONDS),
      reservation.sessionExpiresAt,
    ),
    reservation.expiresAt,
  );
  const response = mediaPortResponseSchema.parse(
    await proofs.storage.createUploadGrant({
      schemaVersion: 1,
      operation: "CREATE_UPLOAD_GRANT",
      storageClass: "SOURCE",
      ...reservation.source,
      expiresAt,
    }),
  );
  if (
    response.outcome !== "SUCCESS" ||
    response.operation !== "CREATE_UPLOAD_GRANT"
  )
    return failure("TEMPORARY_UNAVAILABLE");
  const grant = response.value;
  if (
    grant.storageClass !== "SOURCE" ||
    grant.objectKey !== reservation.source.objectKey ||
    grant.checksumSha256 !== reservation.source.checksumSha256 ||
    grant.byteSize !== reservation.source.byteSize ||
    grant.mimeType !== reservation.source.mimeType ||
    compareBaseContentTime(grant.expiresAt, expiresAt) > 0 ||
    compareBaseContentTime(grant.expiresAt, reservation.authorizedAt) <= 0
  )
    return failure("TEMPORARY_UNAVAILABLE");
  return adminOrdersResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PROOF_UPLOAD_GRANT",
    orderId: reservation.orderId,
    uploadId: reservation.uploadId,
    replayed: reservation.replayed,
    grant: {
      method: grant.method,
      url: grant.url,
      headers: grant.headers,
      expiresAt: grant.expiresAt,
    },
  });
}

/** Verify and re-encode outside any transaction, then record the renditions under fresh authority. */
export async function completeProofUpload(
  transactions: Transactions,
  proofs: AdminOrderProofDependencies,
  stored: AdminOrdersStoreRequest,
): Promise<AdminOrdersResponse> {
  const command = stored.command;
  if (command.action !== "COMPLETE_PROOF_UPLOAD")
    return failure("INVALID_COMMAND");
  const raw = await transactions.runInAdminOrdersTransaction(
    async ({ adminOrders }) => json(await adminOrders.readProofUpload(stored)),
  );
  const denied = adminOrdersFailureSchema.safeParse(raw);
  if (denied.success) return denied.data;
  const state = adminOrdersProofUploadStateSchema.parse(raw);
  if (state.uploadId !== command.uploadId || state.orderId !== command.orderId)
    return failure("TEMPORARY_UNAVAILABLE");
  const done = (width: number, height: number) =>
    adminOrdersResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "PROOF_UPLOAD",
      orderId: state.orderId,
      uploadId: state.uploadId,
      width,
      height,
    });
  if (state.status === "READY" && state.display)
    return done(state.display.width, state.display.height);
  const result = deliveryProofProcessingResultSchema.parse(
    await proofs.processor.process({
      schemaVersion: 1,
      profileVersion: 1,
      uploadId: state.uploadId,
      source: state.source,
    }),
  );
  if (result.outcome === "FAILURE")
    return failure(
      result.error.code === "SOURCE_NOT_FOUND"
        ? "NOT_FOUND"
        : result.error.retryable
          ? "TEMPORARY_UNAVAILABLE"
          : "PROOF_INVALID",
    );
  if (result.uploadId !== state.uploadId)
    return failure("TEMPORARY_UNAVAILABLE");
  const completed = adminOrdersResponseSchema.parse(
    await transactions.runInAdminOrdersTransaction(async ({ adminOrders }) =>
      json(
        await adminOrders.completeProofUpload({
          schemaVersion: 1,
          access: stored.access,
          orderId: state.orderId,
          uploadId: state.uploadId,
          source: state.source,
          result,
        }),
      ),
    ),
  );
  if (completed.outcome === "FAILURE") return completed;
  return completed.kind === "PROOF_UPLOAD" &&
    completed.uploadId === state.uploadId &&
    completed.orderId === state.orderId
    ? completed
    : failure("TEMPORARY_UNAVAILABLE");
}

/** A private GET for one rendition, signed only after the committed authorization. */
export async function viewProof(
  transactions: Transactions,
  proofs: AdminOrderProofDependencies,
  stored: AdminOrdersStoreRequest,
): Promise<AdminOrdersResponse> {
  const command = stored.command;
  if (command.action !== "VIEW_PROOF") return failure("INVALID_COMMAND");
  const raw = await transactions.runInAdminOrdersTransaction(
    async ({ adminOrders }) =>
      json(await adminOrders.readProofRendition(stored)),
  );
  const denied = adminOrdersFailureSchema.safeParse(raw);
  if (denied.success) return denied.data;
  const location = adminOrdersProofRenditionLocationSchema.parse(raw);
  if (
    location.orderId !== command.orderId ||
    location.proofId !== command.proofId ||
    location.rendition !== command.rendition
  )
    return failure("TEMPORARY_UNAVAILABLE");
  const expiresAt = earlier(
    addBaseContentSeconds(location.authorizedAt, GRANT_SECONDS),
    location.sessionExpiresAt,
  );
  if (
    compareBaseContentTime(
      expiresAt,
      addBaseContentSeconds(location.authorizedAt, MINIMUM_DOWNLOAD_SECONDS),
    ) < 0
  )
    return failure("UNAUTHENTICATED");
  const response = mediaPortResponseSchema.parse(
    await proofs.storage.createDownloadGrant({
      schemaVersion: 1,
      operation: "CREATE_DOWNLOAD_GRANT",
      storageClass: "SOURCE",
      objectKey: location.identity.objectKey,
      expiresAt,
    }),
  );
  if (
    response.outcome !== "SUCCESS" ||
    response.operation !== "CREATE_DOWNLOAD_GRANT"
  )
    return failure(
      response.outcome === "FAILURE" &&
        response.error.code === "OBJECT_NOT_FOUND"
        ? "NOT_FOUND"
        : "TEMPORARY_UNAVAILABLE",
    );
  const grant = response.value;
  if (
    grant.storageClass !== "SOURCE" ||
    grant.objectKey !== location.identity.objectKey ||
    compareBaseContentTime(grant.expiresAt, expiresAt) > 0 ||
    compareBaseContentTime(grant.expiresAt, location.authorizedAt) <= 0
  )
    return failure("TEMPORARY_UNAVAILABLE");
  return adminOrdersResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PROOF_DOWNLOAD",
    orderId: location.orderId,
    proofId: location.proofId,
    rendition: location.rendition,
    width: location.identity.width,
    height: location.identity.height,
    download: {
      method: grant.method,
      url: grant.url,
      headers: grant.headers,
      expiresAt: grant.expiresAt,
    },
  });
}

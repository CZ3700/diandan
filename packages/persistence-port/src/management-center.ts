import type {
  ManagementCenterAuthorization,
  ManagementCenterCheckpoint,
  ManagementCenterClaim,
  ManagementCenterCommand,
  ManagementCenterFailure,
  ManagementCenterIntent,
  ManagementCenterOperation,
  ManagementCenterPreparedMedia,
  ManagementCenterResponse,
  AdminPrincipal,
  ManagementImageSource,
  ManagementImageTarget,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";

export type ManagementCenterFence = Readonly<{
  operationId: string;
  leaseTokenDigest: string;
}>;
export interface ManagementCenterOperationRepository {
  authorize(
    input: Readonly<{
      sessionTokenDigest: string;
      csrfTokenDigest: string;
      sourceLocale?: string;
    }>,
  ): Promise<ManagementCenterAuthorization>;
  readImageSource(
    input: Readonly<{
      principal: AdminPrincipal;
      target: ManagementImageTarget;
    }>,
  ): Promise<ManagementImageSource | ManagementCenterFailure>;
  context(principal: AdminPrincipal): Promise<ManagementCenterResponse>;
  list(
    input: Readonly<{
      principal: AdminPrincipal;
      command: Extract<ManagementCenterCommand, { action: "LIST" }>;
    }>,
  ): Promise<ManagementCenterResponse>;
  submit(
    input: Readonly<{
      principal: AdminPrincipal;
      requestId: string;
      intent: ManagementCenterIntent;
      intentHash: string;
      idempotencyKey: string;
    }>,
  ): Promise<ManagementCenterResponse>;
  read(
    input: Readonly<{ actorId: string; operationId: string }>,
  ): Promise<ManagementCenterResponse>;
  /** L2-09: archive an old poster; the homepage's current poster is never archived. */
  archivePoster(
    input: Readonly<{
      principal: AdminPrincipal;
      requestId: string;
      revisionId: string;
      expectedVersion: number;
    }>,
  ): Promise<ManagementCenterResponse>;
  /** L3-11: set or change the broker an artist belongs to; `idols.assign` only. */
  assignArtist(
    input: Readonly<{
      principal: AdminPrincipal;
      requestId: string;
      artistId: string;
      brokerId: string | null;
      expectedBrokerId: string | null;
    }>,
  ): Promise<ManagementCenterResponse>;
  retry(
    input: Readonly<{
      principal: AdminPrincipal;
      requestId: string;
      operationId: string;
      expectedVersion: number;
      idempotencyKey: string;
    }>,
  ): Promise<ManagementCenterResponse>;
  claim(
    input: Readonly<{ leaseTokenDigest: string; leaseSeconds: number }>,
  ): Promise<ManagementCenterClaim | ManagementCenterFailure | null>;
  loadClaim(
    input: ManagementCenterFence,
  ): Promise<ManagementCenterClaim | ManagementCenterFailure>;
  checkpoint(
    input: ManagementCenterFence &
      Readonly<{ checkpoint: ManagementCenterCheckpoint }>,
  ): Promise<ManagementCenterClaim | ManagementCenterFailure>;
  defer(input: ManagementCenterFence): Promise<ManagementCenterResponse>;
  fail(
    input: ManagementCenterFence &
      Readonly<{ code: ManagementCenterFailure["code"]; retryable: boolean }>,
  ): Promise<ManagementCenterResponse>;
  complete(
    input: ManagementCenterFence &
      Readonly<{ result: NonNullable<ManagementCenterOperation["result"]> }>,
  ): Promise<ManagementCenterResponse>;
}
/** Implemented by the publication adapter using the very same transaction client. */
export interface ManagementCenterPublicationRepository {
  resolveImageSource(
    input: ManagementCenterFence,
  ): Promise<ManagementImageSource | ManagementCenterFailure>;
  prepareMediaMetadata(
    input: ManagementCenterFence &
      Readonly<{
        schemaVersion: 1;
        assetId: string;
        processingJobId: string | null;
        /** Structural focus every derivative of this revision is framed around. */
        focalPoint: Readonly<{ x: number; y: number }>;
      }>,
  ): Promise<
    | ManagementCenterFailure
    | Readonly<{
        schemaVersion: 1;
        outcome: "SUCCESS";
        metadataRevisionId: string;
      }>
  >;
  publish(
    input: ManagementCenterFence &
      Readonly<{
        schemaVersion: 1;
        preparedMedia: ManagementCenterPreparedMedia | null;
      }>,
  ): Promise<
    | ManagementCenterFailure
    | Readonly<{
        schemaVersion: 1;
        outcome: "SUCCESS";
        target: {
          kind: "IDOL" | "GIFT" | "HOMEPAGE";
          id: string;
          handle?: string;
        };
        publicationId: string;
        revisionId: string;
        headVersion: number;
        targetVersion: number;
        publishedAt: string;
        pricePublicationId?: string;
      }>
  >;
}
export type ManagementCenterRepositories = Readonly<{
  operations: ManagementCenterOperationRepository;
  publication: ManagementCenterPublicationRepository;
}>;
export interface ManagementCenterTransactionManager {
  runInManagementCenterTransaction<Result extends JsonValue>(
    work: (repositories: ManagementCenterRepositories) => Promise<Result>,
  ): Promise<Result>;
}
/** Handles actual inspection and durable media jobs; never stores a browser credential. */
export interface ManagementCenterMediaPreparationPort {
  prepare(claim: ManagementCenterClaim): Promise<
    | ManagementCenterFailure
    | Readonly<{ outcome: "PENDING" }>
    | Readonly<{
        outcome: "READY";
        preparedMedia: ManagementCenterPreparedMedia | null;
      }>
  >;
}

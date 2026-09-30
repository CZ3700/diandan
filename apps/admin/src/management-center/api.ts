import {
  adminCatalogResponseSchema,
  managementCenterResponseSchema,
  type ManagementCenterCommand,
  type ManagementCenterIntent,
  type ManagementCenterListItem,
  type ManagementCenterResponse,
  type SupportedLocale,
} from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "../workspace/client";
import { callCommerce } from "../workspace/gift-commerce-client";

export type DeletableItem = Extract<
  ManagementCenterListItem,
  { kind: "ARTIST" | "GIFT" }
>;
const DELETE_REASON = "DAILY_CENTER_DELETE";

export type PosterItem = Extract<ManagementCenterListItem, { kind: "POSTER" }>;
export type ManagementContext = Extract<
  ManagementCenterResponse,
  { kind: "CONTEXT" }
>;
export type ManagementList = Extract<
  ManagementCenterResponse,
  { kind: "LIST" }
>;
export type ManagementSection = ManagementList["section"];
export type ManagementBroker = ManagementContext["artists"]["brokers"][number];
/** Narrows the artist list for accounts that manage every artist. */
export type AssignmentFilter = NonNullable<
  Extract<ManagementCenterCommand, { action: "LIST" }>["assignment"]
>;
export type PreparedUpload = Extract<
  ManagementCenterResponse,
  { kind: "UPLOAD_GRANT" }
>;
export type ImageSourceTarget = Extract<
  ManagementCenterCommand,
  { action: "READ_IMAGE_SOURCE" }
>["target"];
export type OriginalImage = Extract<
  ManagementCenterResponse,
  { kind: "ORIGINAL_IMAGE" }
>;
type PrepareCommand = Omit<
  Extract<ManagementCenterCommand, { action: "PREPARE_UPLOAD" }>,
  "action" | "idempotencyKey"
>;

export function createManagementApi(client: AdminClient) {
  const call = (
    key: string,
    command: Record<string, unknown> = {},
    mutation = false,
  ) =>
    client.call(
      `management-${key}`,
      { schemaVersion: 1, ...command },
      managementCenterResponseSchema,
      mutation,
    );
  const invalid = () => new AdminClientError("INVALID_RESPONSE");
  return {
    async wishArtists(locale: SupportedLocale, page: number, query = "") {
      const result = await client.call(
        "catalog-list",
        {
          schemaVersion: 1,
          kind: "IDOL",
          locale,
          status: "active",
          page,
          pageSize: 10,
          ...(query.trim() ? { q: query.trim() } : {}),
        },
        adminCatalogResponseSchema,
      );
      if (
        result.kind !== "OWNERS" ||
        result.page !== page ||
        result.pageSize !== 10 ||
        result.items.some(
          (item) => item.target.kind !== "IDOL" || item.locale !== locale,
        )
      )
        throw invalid();
      return result;
    },
    async readImageSource(target: ImageSourceTarget): Promise<OriginalImage> {
      const result = await call("read-image-source", { target });
      if (
        result.kind !== "ORIGINAL_IMAGE" ||
        result.target.kind !== target.kind ||
        result.target.id.toLowerCase() !== target.id.toLowerCase() ||
        result.target.expectedVersion !== target.expectedVersion
      )
        throw invalid();
      return result;
    },
    async context(): Promise<ManagementContext> {
      const result = await call("context");
      if (result.kind !== "CONTEXT") throw invalid();
      return result;
    },
    async list(
      section: ManagementSection,
      page: number,
      assignment?: AssignmentFilter | null,
    ): Promise<ManagementList> {
      const result = await call("list", {
        section,
        page,
        pageSize: 12,
        ...(assignment ? { assignment } : {}),
      });
      if (
        result.kind !== "LIST" ||
        result.section !== section ||
        result.page !== page ||
        result.pageSize !== 12
      )
        throw invalid();
      return result;
    },
    async prepare(command: PrepareCommand): Promise<PreparedUpload> {
      const result = await call("prepare-upload", command, true);
      if (result.kind !== "UPLOAD_GRANT") throw invalid();
      return result;
    },
    async submit(intent: ManagementCenterIntent) {
      const result = await call("submit", { intent }, true);
      if (
        result.kind !== "OPERATION" ||
        result.operation.kind !== intent.kind ||
        result.operation.sourceLocale !== intent.sourceLocale ||
        ((intent.kind === "SAVE_ARTIST" || intent.kind === "SAVE_GIFT") &&
          intent.id !== null &&
          result.operation.targetId !== intent.id)
      )
        throw invalid();
      return result.operation;
    },
    async read(operationId: string) {
      const result = await call("read-operation", { operationId });
      if (
        result.kind !== "OPERATION" ||
        result.operation.operationId !== operationId
      )
        throw invalid();
      return result.operation;
    },
    /** The daily session carries content permissions only; gift deletion needs gift.manage. */
    async canDeleteGifts(): Promise<boolean> {
      try {
        const result = await callCommerce(client, {
          schemaVersion: 1,
          action: "CONTEXT",
        });
        return (
          result.kind === "COMMERCE_CONTEXT" &&
          result.permissions.includes("gift.manage")
        );
      } catch {
        return false;
      }
    },
    /**
     * Delete = permanent archive through the audited identity status write, not a daily
     * operation: it has no image work, the database keeps archived final and orders keep
     * their own snapshots.
     */
    async remove(item: DeletableItem): Promise<void> {
      if (item.kind === "ARTIST") {
        const result = await client.call(
          "idol-status",
          {
            schemaVersion: 1,
            idolId: item.id,
            status: "archived",
            acceptingGifts: false,
            expectedBaseVersion: item.version,
            reasonCode: DELETE_REASON,
          },
          adminCatalogResponseSchema,
          true,
        );
        if (
          result.kind !== "MUTATION" ||
          result.idolId.toLowerCase() !== item.id.toLowerCase() ||
          result.status !== "archived"
        )
          throw invalid();
        return;
      }
      const result = await callCommerce(client, {
        schemaVersion: 1,
        action: "SET_GIFT_STATUS",
        giftId: item.id,
        expectedBaseVersion: item.version,
        status: "archived",
        reasonCode: DELETE_REASON,
      });
      if (!("action" in result) || result.action !== "SET_GIFT_STATUS")
        throw invalid();
      if (result.giftId.toLowerCase() !== item.id.toLowerCase())
        throw invalid();
    },
    /** L3-11: `idols.assign` only. A null broker returns the artist to the studio. */
    async assignArtist(
      artistId: string,
      brokerId: string | null,
      expectedBrokerId: string | null,
    ): Promise<ManagementBroker | null> {
      const result = await call(
        "assign-artist",
        { artistId, brokerId, expectedBrokerId },
        true,
      );
      if (
        result.kind !== "ARTIST_ASSIGNED" ||
        result.artistId.toLowerCase() !== artistId.toLowerCase() ||
        (result.assignment?.brokerId.toLowerCase() ?? null) !==
          (brokerId?.toLowerCase() ?? null)
      )
        throw invalid();
      return result.assignment;
    },
    /** L2-09: an old poster leaves the history; the current one is refused by the server. */
    async archivePoster(item: PosterItem) {
      const result = await call(
        "archive-poster",
        {
          revisionId: item.id,
          expectedVersion: item.version,
          sourceLocale: item.sourceLocale,
        },
        true,
      );
      if (
        result.kind !== "POSTER_ARCHIVED" ||
        result.revisionId.toLowerCase() !== item.id.toLowerCase()
      )
        throw invalid();
    },
    async retry(operationId: string, expectedVersion: number) {
      const result = await call(
        "retry-operation",
        { operationId, expectedVersion },
        true,
      );
      if (
        result.kind !== "OPERATION" ||
        result.operation.operationId !== operationId
      )
        throw invalid();
      return result.operation;
    },
  };
}
export type ManagementApi = ReturnType<typeof createManagementApi>;

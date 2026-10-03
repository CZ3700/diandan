import {
  adminLedgerMessageResponseSchema,
  adminLedgerResponseSchema,
  type AdminLedgerBrokerFilter,
  type AdminLedgerExportScope,
  type AdminLedgerMessageResponse,
  type AdminLedgerPeriod,
  type AdminLedgerResponse,
  type SupportedLocale,
} from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "../workspace/client";

// ADR-022 / L3-12: the artist ledger. Scope, figures and audits are decided by the API; this is transport only.
export type LedgerContext = Extract<AdminLedgerResponse, { kind: "CONTEXT" }>;
export type LedgerOverview = Extract<AdminLedgerResponse, { kind: "OVERVIEW" }>;
export type LedgerArtistView = Extract<AdminLedgerResponse, { kind: "ARTIST" }>;
export type LedgerExport = Extract<AdminLedgerResponse, { kind: "EXPORT" }>;
export type LedgerMessage = Extract<
  AdminLedgerMessageResponse,
  { kind: "MESSAGE" }
>;

const invalid = () => new AdminClientError("INVALID_RESPONSE");

export function createLedgerApi(client: AdminClient) {
  const call = async <
    Kind extends Exclude<AdminLedgerResponse, { outcome: "FAILURE" }>["kind"],
  >(
    operation: string,
    kind: Kind,
    command: Record<string, unknown>,
  ) => {
    const result = await client.call(
      `ledger-${operation}`,
      { schemaVersion: 1, ...command },
      adminLedgerResponseSchema,
    );
    if (result.kind !== kind) throw invalid();
    return result as Extract<AdminLedgerResponse, { kind: Kind }>;
  };
  return Object.freeze({
    context: () => call("context", "CONTEXT", {}),
    overview: (period: AdminLedgerPeriod, broker: AdminLedgerBrokerFilter) =>
      call("overview", "OVERVIEW", { period, broker }),
    artist: async (artistId: string, period: AdminLedgerPeriod) => {
      const result = await call("artist", "ARTIST", { artistId, period });
      if (result.artist.artistId !== artistId) throw invalid();
      return result;
    },
    /** Writes an audit and a receipt on the server; call only when the reader asked for a file. */
    export: (scope: AdminLedgerExportScope, period: AdminLedgerPeriod) =>
      call("export", "EXPORT", { scope, period }),
    async readMessage(line: {
      orderId: string;
      itemId: string;
      expectedIntentVersion: number;
      reviewLocale: SupportedLocale;
    }): Promise<LedgerMessage> {
      const result = await client.call(
        "ledger-message-read",
        { schemaVersion: 1, ...line },
        adminLedgerMessageResponseSchema,
      );
      if (
        result.kind !== "MESSAGE" ||
        result.orderId !== line.orderId ||
        result.itemId !== line.itemId ||
        result.intentVersion !== line.expectedIntentVersion
      )
        throw invalid();
      return result;
    },
  });
}
export type LedgerApi = ReturnType<typeof createLedgerApi>;

import { randomUUID } from "node:crypto";
import {
  ADMIN_ARTIST_NOTE_MAX_VERSIONS,
  adminArtistNoteResponseSchema,
  adminArtistNoteSnapshotSchema,
  adminArtistNoteStoreRequestSchema,
  adminArtistNoteVersionSchema,
  adminOrdersConfirmPrivateSchema,
  adminOrdersPrivateConfirmationSchema,
  type AdminArtistNoteFailure,
  type AdminArtistNoteResponse,
  type AdminArtistNoteSnapshot,
  type AdminArtistNoteStoreRequest,
  type AdminArtistNoteVersion,
  type AdminOrdersConfirmPrivate,
  type AdminOrdersPrivateConfirmation,
} from "@fan-support/contracts";
import type { AdminArtistNoteRepository } from "@fan-support/persistence-port";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { confirmAdminOrdersAuthority } from "./admin-orders-authorization.js";
import {
  adminOrdersBytes,
  adminOrdersEncrypted,
  adminOrdersTimestamp,
} from "./admin-orders-data.js";
import {
  artistNoteFailure,
  artistNoteFailureFromOrders,
  readArtistNotePrincipal,
  type ArtistNotePrincipal,
} from "./admin-artist-notes-authorization.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

// ADR-022 / L3-13: private artist notes. Every save is a new version; every read commits its audit and
// access receipt before the caller decrypts and is confirmed afterwards. 0062 repeats each rule.

const success = { schemaVersion: 1, outcome: "SUCCESS" } as const;
/** An author without a built-in account shows by its short id, as brokers do. */
const VERSION_COLUMNS = `n.id note_id,n.version,${adminOrdersTimestamp("n.created_at")} saved_at,coalesce(a.display_name,left(n.actor_id::text,8)) saved_by`;
const NOTES =
  "public.artist_private_notes n LEFT JOIN public.admin_local_accounts a ON a.admin_identity_id=n.actor_id";
const version = (row: DraftRow): AdminArtistNoteVersion =>
  adminArtistNoteVersionSchema.parse({
    noteId: row["note_id"],
    version: Number(row["version"]),
    savedAt: row["saved_at"],
    savedBy: row["saved_by"],
  });

type Authorized =
  | { outcome: "SUCCESS"; principal: ArtistNotePrincipal }
  | AdminArtistNoteFailure;
/** idols.private, then the artist; a missing artist is only revealed to accounts that hold the key. */
async function authorize(
  client: TransactionClient,
  request: Pick<AdminArtistNoteStoreRequest, "access">,
  artistId: string,
  needsGate: boolean,
): Promise<Authorized> {
  const auth = await readArtistNotePrincipal(client, request.access);
  if (auth.outcome === "FAILURE") return auth;
  const [artist] = await draftRows(
    client,
    "SELECT id FROM public.idols WHERE id=$1",
    [artistId],
  );
  if (!artist) return artistNoteFailure("NOT_FOUND");
  if (needsGate && auth.principal.gate !== "READY")
    return artistNoteFailure("SECOND_FACTOR_REQUIRED");
  return auth;
}

async function audit(
  client: TransactionClient,
  request: AdminArtistNoteStoreRequest,
  p: ArtistNotePrincipal,
  action: "ARTIST_PRIVATE_NOTE_SAVED" | "ARTIST_PRIVATE_READ",
  artistId: string,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category)
    VALUES($1,'ADMIN',$2,$3,'IDOL',$4,NULL,$5,$6,'SUCCEEDED','ARTIST_PRIVATE')`,
    [
      id,
      p.orders.actorId,
      action,
      artistId,
      request.access.requestId,
      request.access.correlationId,
    ],
  );
  return id;
}

async function readVersion(
  client: TransactionClient,
  artistId: string,
  noteId: string,
): Promise<AdminArtistNoteVersion | null> {
  const [row] = await draftRows(
    client,
    `SELECT ${VERSION_COLUMNS} FROM ${NOTES} WHERE n.id=$1 AND n.idol_id=$2`,
    [noteId, artistId],
  );
  return row ? version(row) : null;
}

async function save(
  client: TransactionClient,
  request: AdminArtistNoteStoreRequest,
): Promise<AdminArtistNoteResponse> {
  const c = request.command;
  if (c.action !== "SAVE") return artistNoteFailure("INVALID_COMMAND");
  const auth = await authorize(client, request, c.artistId, true);
  if (auth.outcome === "FAILURE") return auth;
  const p = auth.principal;
  // The same lock the 0062 guard takes, so the version read here is the one the insert continues.
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('fan-support:artist-private-note:'||$1::text,0))",
    [c.artistId],
  );
  const [replay] = await draftRows(
    client,
    "SELECT idol_id=$2::uuid AND actor_id=$3::uuid own FROM public.artist_private_notes WHERE id=$1",
    [c.noteId, c.artistId, p.orders.actorId],
  );
  if (replay) {
    // A resent save is answered with the version it made; an id taken by anything else is refused.
    if (replay["own"] !== true) return artistNoteFailure("INVALID_COMMAND");
    const saved = await readVersion(client, c.artistId, c.noteId);
    return saved
      ? adminArtistNoteResponseSchema.parse({
          ...success,
          kind: "SAVED",
          artistId: c.artistId,
          note: saved,
        })
      : artistNoteFailure("TEMPORARY_UNAVAILABLE");
  }
  const [latest] = await draftRows(
    client,
    "SELECT coalesce(max(version),0) version FROM public.artist_private_notes WHERE idol_id=$1",
    [c.artistId],
  );
  if (Number(latest?.["version"]) !== c.expectedVersion)
    return artistNoteFailure("STALE_VERSION");
  const expired = await confirmAdminOrdersAuthority(client, p.orders);
  if (expired) return artistNoteFailureFromOrders(expired);
  const auditId = await audit(
    client,
    request,
    p,
    "ARTIST_PRIVATE_NOTE_SAVED",
    c.artistId,
  );
  await client.query(
    `INSERT INTO public.artist_private_notes(id,idol_id,version,actor_id,session_id,ciphertext,encrypted_data_key,key_version,audit_log_id,request_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      c.noteId,
      c.artistId,
      c.expectedVersion + 1,
      p.orders.actorId,
      p.orders.sessionId,
      adminOrdersBytes(c.envelope.ciphertext),
      adminOrdersBytes(c.envelope.encryptedDataKey),
      c.envelope.keyVersion,
      auditId,
      request.access.requestId,
    ],
  );
  const saved = await readVersion(client, c.artistId, c.noteId);
  if (!saved) return artistNoteFailure("TEMPORARY_UNAVAILABLE");
  return adminArtistNoteResponseSchema.parse({
    ...success,
    kind: "SAVED",
    artistId: c.artistId,
    note: saved,
  });
}

async function execute(
  client: TransactionClient,
  request: AdminArtistNoteStoreRequest,
): Promise<AdminArtistNoteResponse> {
  const c = request.command;
  if (c.action === "SAVE") return save(client, request);
  if (c.action !== "CONTEXT") return artistNoteFailure("INVALID_COMMAND");
  const auth = await authorize(client, request, c.artistId, false);
  if (auth.outcome === "FAILURE") return auth;
  const gate = auth.principal.gate;
  const rows =
    gate === "READY"
      ? await draftRows(
          client,
          `SELECT ${VERSION_COLUMNS} FROM ${NOTES} WHERE n.idol_id=$1 ORDER BY n.version DESC LIMIT ${ADMIN_ARTIST_NOTE_MAX_VERSIONS}`,
          [c.artistId],
        )
      : [];
  return adminArtistNoteResponseSchema.parse({
    ...success,
    kind: "CONTEXT",
    artistId: c.artistId,
    gate,
    versions: rows.map(version),
  });
}

async function prepareRead(
  client: TransactionClient,
  request: AdminArtistNoteStoreRequest,
): Promise<AdminArtistNoteSnapshot | AdminArtistNoteFailure> {
  const c = request.command;
  if (c.action !== "READ") return artistNoteFailure("INVALID_COMMAND");
  const auth = await authorize(client, request, c.artistId, true);
  if (auth.outcome === "FAILURE") return auth;
  const p = auth.principal;
  const [note] = await draftRows(
    client,
    `SELECT ${VERSION_COLUMNS},n.ciphertext,n.encrypted_data_key,n.key_version FROM ${NOTES} WHERE n.id=$1 AND n.idol_id=$2`,
    [c.noteId, c.artistId],
  );
  if (!note) return artistNoteFailure("NOT_FOUND");
  const expired = await confirmAdminOrdersAuthority(client, p.orders);
  if (expired) return artistNoteFailureFromOrders(expired);
  const auditId = await audit(
    client,
    request,
    p,
    "ARTIST_PRIVATE_READ",
    c.artistId,
  );
  const accessId = randomUUID();
  const [receipt] = await draftRows(
    client,
    `INSERT INTO public.artist_private_note_accesses(id,actor_id,session_id,idol_id,note_id,audit_log_id,request_id,correlation_id,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,LEAST($9::timestamptz,transaction_timestamp()+interval '300 seconds'))
    RETURNING ${adminOrdersTimestamp("expires_at")} expires_at`,
    [
      accessId,
      p.orders.actorId,
      p.orders.sessionId,
      c.artistId,
      c.noteId,
      auditId,
      request.access.requestId,
      request.access.correlationId,
      p.orders.sessionExpiresAt,
    ],
  );
  return adminArtistNoteSnapshotSchema.parse({
    schemaVersion: 1,
    kind: "NOTE_SNAPSHOT",
    accessId,
    artistId: c.artistId,
    expiresAt: receipt?.["expires_at"],
    note: version(note),
    envelope: {
      ciphertext: adminOrdersEncrypted(note["ciphertext"]),
      encryptedDataKey: adminOrdersEncrypted(note["encrypted_data_key"]),
      keyVersion: note["key_version"],
      algorithm: "AES_256_GCM",
    },
  });
}

async function confirmRead(
  client: TransactionClient,
  c: AdminOrdersConfirmPrivate,
): Promise<AdminOrdersPrivateConfirmation | AdminArtistNoteFailure> {
  const auth = await readArtistNotePrincipal(client, c.access);
  if (auth.outcome === "FAILURE") return auth;
  const p = auth.principal;
  if (p.gate !== "READY") return artistNoteFailure("SECOND_FACTOR_REQUIRED");
  const [access] = await draftRows(
    client,
    `SELECT a.expires_at>clock_timestamp() live FROM public.artist_private_note_accesses a
    WHERE a.id=$1 AND a.actor_id=$2 AND a.session_id=$3 FOR SHARE`,
    [c.accessId, p.orders.actorId, p.orders.sessionId],
  );
  if (!access || access["live"] !== true)
    return artistNoteFailure("PRIVATE_ACCESS_EXPIRED");
  const expired = await confirmAdminOrdersAuthority(client, p.orders);
  if (expired) return artistNoteFailureFromOrders(expired);
  await client.query(
    "INSERT INTO public.artist_private_note_confirmations(access_id) VALUES($1) ON CONFLICT DO NOTHING",
    [c.accessId],
  );
  return adminOrdersPrivateConfirmationSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "PRIVATE_CONFIRMED",
    accessId: c.accessId,
  });
}

/** Ciphertext in, ciphertext out; plaintext never reaches this layer. */
export function createAdminArtistNoteRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): AdminArtistNoteRepository {
  const tracked = <T>(work: () => Promise<T>) =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  return {
    execute: (input) =>
      tracked(async () => {
        const parsed = adminArtistNoteStoreRequestSchema.safeParse(input);
        return parsed.success
          ? execute(client, parsed.data)
          : artistNoteFailure("INVALID_COMMAND");
      }),
    prepareRead: (input) =>
      tracked(async () => {
        const parsed = adminArtistNoteStoreRequestSchema.safeParse(input);
        return parsed.success
          ? prepareRead(client, parsed.data)
          : artistNoteFailure("INVALID_COMMAND");
      }),
    confirmRead: (input) =>
      tracked(async () => {
        const parsed = adminOrdersConfirmPrivateSchema.safeParse(input);
        return parsed.success
          ? confirmRead(client, parsed.data)
          : artistNoteFailure("INVALID_COMMAND");
      }),
  };
}

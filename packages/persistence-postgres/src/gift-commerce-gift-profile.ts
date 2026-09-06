import { createHash } from "node:crypto";
import {
  giftRevisionProfileSchema,
  giftPublicationProfileSchema,
  giftKindSchema,
  type GiftKind,
  type GiftRevisionProfile,
  type GiftPublicationProfile,
  type GiftRevisionProfileState,
  type ContentAuthoringWriteCommand,
} from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import { utcTimestampSql } from "./resource-management-data.js";
import type { TransactionClient } from "./transaction-runner.js";

function invalid(): never {
  throw new Error("Invalid gift profile evidence");
}
function canonicalTime(value: string): string {
  const fraction = (/\.(\d+)/u.exec(value)?.[1] ?? "").padEnd(6, "0");
  if (fraction.length !== 6) invalid();
  return new Date(value).toISOString().slice(0, 19) + "." + fraction + "Z";
}
/** Matches canonical_publication_json; the old content/manifest hashes are untouched. */
export function computeGiftRevisionProfileHash(
  input: Omit<GiftRevisionProfile, "profileHash">,
): string {
  const profile = giftRevisionProfileSchema
    .omit({ profileHash: true })
    .parse(input);
  return createHash("sha256")
    .update(
      JSON.stringify({
        profile: {
          createdAt: canonicalTime(profile.createdAt),
          createdBy: profile.createdBy.toLowerCase(),
          giftId: profile.giftId.toLowerCase(),
          giftKind: profile.giftKind,
          giftRevisionId: profile.giftRevisionId.toLowerCase(),
          schemaVersion: 1,
        },
        purpose: "gift-revision-profile-v1",
      }),
      "utf8",
    )
    .digest("hex");
}
/** Explicit history is used only when an older pinned integration schema predates 0020. */
async function assertPreProfileMigration(client: TransactionClient) {
  const [row] = await draftRows(
    client,
    "SELECT max(version) AS version FROM public.schema_migrations",
  );
  if (typeof row?.["version"] !== "string" || row["version"] >= "0020")
    invalid();
}
export async function readGiftRevisionProfile(
  client: TransactionClient,
  giftId: string,
  revisionId: string,
): Promise<GiftRevisionProfileState> {
  const [revision] = await draftRows(
    client,
    "SELECT id,gift_id,(to_jsonb(r)->>'profile_version')::integer AS profile_version FROM public.gift_revisions r WHERE id=$1 AND gift_id=$2",
    [revisionId, giftId],
  );
  if (!revision) invalid();
  const marker = revision["profile_version"];
  if (marker === null || marker === undefined) {
    await assertPreProfileMigration(client);
    return { kind: "LEGACY", giftRevisionId: String(revision["id"]) };
  }
  if (Number(marker) === 1)
    return { kind: "LEGACY", giftRevisionId: String(revision["id"]) };
  if (Number(marker) !== 2) invalid();
  const [row] = await draftRows(
    client,
    `SELECT p.*,${utcTimestampSql("p.created_at")} AS canonical_created_at FROM public.gift_revision_profiles p JOIN public.gift_revisions r ON r.id=p.gift_revision_id AND r.gift_id=p.gift_id AND r.created_by=p.created_by AND r.created_at=p.created_at WHERE p.gift_revision_id=$1 AND p.gift_id=$2`,
    [revisionId, giftId],
  );
  if (!row) invalid();
  const parsed = giftRevisionProfileSchema.safeParse({
    schemaVersion: 1,
    giftId: row["gift_id"],
    giftRevisionId: row["gift_revision_id"],
    giftKind: row["gift_kind"],
    createdBy: row["created_by"],
    createdAt: row["canonical_created_at"],
    profileHash: row["profile_hash"],
  });
  if (!parsed.success) invalid();
  const profile = parsed.data;
  const { profileHash, ...fields } = profile;
  if (computeGiftRevisionProfileHash(fields) !== profileHash) invalid();
  return { kind: "PROFILE", profile };
}
export async function persistGiftRevisionProfile(
  client: TransactionClient,
  input: ContentAuthoringWriteCommand,
  revisionId: string,
  time: string,
  requestedKind?: GiftKind,
): Promise<void> {
  if (input.command.target.kind !== "GIFT") return;
  const giftId = input.command.target.giftId;
  const [row] = await draftRows(
    client,
    "SELECT (to_jsonb(r)->>'profile_version')::integer AS profile_version FROM public.gift_revisions r WHERE id=$1 AND gift_id=$2",
    [revisionId, giftId],
  );
  if (!row) invalid();
  if (row["profile_version"] === null || row["profile_version"] === undefined) {
    await assertPreProfileMigration(client);
    if (requestedKind !== undefined) invalid();
    return;
  }
  if (Number(row["profile_version"]) !== 2) invalid();
  const source =
    input.command.action === "COPY"
      ? await readGiftRevisionProfile(
          client,
          giftId,
          input.command.sourceRevisionId,
        )
      : null;
  const giftKind = giftKindSchema.parse(
    requestedKind ??
      (source?.kind === "PROFILE" ? source.profile.giftKind : "OTHER"),
  );
  const profile = {
    schemaVersion: 1 as const,
    giftId,
    giftRevisionId: revisionId,
    giftKind,
    createdBy: input.actorId,
    createdAt: canonicalTime(time),
  };
  await client.query(
    "INSERT INTO public.gift_revision_profiles(gift_revision_id,gift_id,gift_kind,created_by,created_at,profile_hash) VALUES($1,$2,$3,$4,$5,$6)",
    [
      revisionId,
      giftId,
      giftKind,
      input.actorId,
      profile.createdAt,
      computeGiftRevisionProfileHash(profile),
    ],
  );
}
export async function persistGiftPublicationProfile(
  client: TransactionClient,
  input: {
    publicationId: string;
    giftId: string;
    giftRevisionId: string;
    manifestHash: string;
  },
): Promise<void> {
  const state = await readGiftRevisionProfile(
    client,
    input.giftId,
    input.giftRevisionId,
  );
  if (state.kind === "LEGACY") return;
  await client.query(
    "INSERT INTO public.gift_publication_profiles(publication_id,gift_id,gift_revision_id,manifest_hash,profile_hash) VALUES($1,$2,$3,$4,$5)",
    [
      input.publicationId,
      input.giftId,
      input.giftRevisionId,
      input.manifestHash,
      state.profile.profileHash,
    ],
  );
}
/** Public consumers must first verify their ordinary publication/manifest; this adds the exact profile proof. */
export async function readGiftPublicationProfile(
  client: TransactionClient,
  input: {
    publicationId: string;
    giftId: string;
    giftRevisionId: string;
    manifestHash: string;
  },
): Promise<GiftPublicationProfile | null> {
  const state = await readGiftRevisionProfile(
    client,
    input.giftId,
    input.giftRevisionId,
  );
  if (state.kind === "LEGACY") return null;
  const [row] = await draftRows(
    client,
    `SELECT p.* FROM public.gift_publication_profiles p JOIN public.content_publications c ON c.id=p.publication_id AND c.gift_id=p.gift_id AND c.gift_revision_id=p.gift_revision_id JOIN public.content_publication_manifests m ON m.publication_id=c.id AND m.gift_revision_id=p.gift_revision_id AND m.manifest_hash=p.manifest_hash WHERE p.publication_id=$1 AND p.gift_id=$2 AND p.gift_revision_id=$3 AND p.manifest_hash=$4 AND p.profile_hash=$5`,
    [
      input.publicationId,
      input.giftId,
      input.giftRevisionId,
      input.manifestHash,
      state.profile.profileHash,
    ],
  );
  if (!row) invalid();
  return giftPublicationProfileSchema.parse({
    schemaVersion: 1,
    ...input,
    profile: state.profile,
  });
}

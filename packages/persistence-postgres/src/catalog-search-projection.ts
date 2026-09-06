import { normalizeArtistSearchName } from "@fan-support/catalog";
import {
  publicationManifestSchema,
  type PublicationManifest,
} from "@fan-support/contracts";
import {
  computeIdolAliasContentHash,
  computeIdolTranslationContentHash,
} from "@fan-support/content";
import type { TransactionClient } from "./transaction-runner.js";

const batchSize = 256;
/** Called inside publication/head/outbox transaction; also rebuilds one persisted manifest projection. */
export async function writePublishedIdolSearchProjections(
  client: Pick<TransactionClient, "query">,
  input: PublicationManifest,
): Promise<void> {
  const manifest = publicationManifestSchema.parse(input),
    revision = manifest.revision;
  if (revision.content.kind !== "IDOL") return;
  const names = revision.content.translations.map((row) => {
    const audit = revision.translationAudits.find(
      (entry) => entry.locale === row.locale,
    )!;
    if (
      computeIdolTranslationContentHash(row.fields) !== audit.sourceHash ||
      audit.review.status !== "APPROVED"
    )
      throw new Error("Invalid published search source");
    return {
      id: audit.id,
      hash: audit.sourceHash,
      name: normalizeArtistSearchName(row.fields.displayName.trim()),
    };
  });
  const aliases = revision.extensions.aliases;
  if (aliases) {
    const proofs = manifest.extensionApprovals.filter(
      (row) =>
        row.kind === "IDOL_ALIASES" &&
        row.subjectId.toLowerCase() === aliases.id.toLowerCase(),
    );
    if (
      aliases.review.status !== "APPROVED" ||
      computeIdolAliasContentHash(aliases.aliases) !== aliases.contentHash ||
      proofs.length !== 1 ||
      proofs[0]!.contentHash !== aliases.contentHash
    )
      throw new Error("Invalid published alias evidence");
  }
  await client.query(
    `INSERT INTO public.idol_translation_search_projections (idol_translation_id,source_hash,algorithm_version,normalized_name)
    SELECT id,hash::public.sha256_hex,1,name FROM unnest($1::uuid[],$2::text[],$3::text[]) AS input(id,hash,name)
    ON CONFLICT(idol_translation_id) DO UPDATE SET source_hash=EXCLUDED.source_hash,algorithm_version=EXCLUDED.algorithm_version,normalized_name=EXCLUDED.normalized_name`,
    [
      names.map((row) => row.id),
      names.map((row) => row.hash),
      names.map((row) => row.name),
    ],
  );
  if (aliases && aliases.aliases.length > 0)
    await client.query(
      `INSERT INTO public.idol_alias_search_projections (alias_set_id,alias_id,content_hash,algorithm_version,normalized_name)
    SELECT set_id,alias_id,hash::public.sha256_hex,1,name FROM unnest($1::uuid[],$2::text[],$3::text[],$4::text[]) AS input(set_id,alias_id,hash,name)
    ON CONFLICT(alias_set_id,alias_id) DO UPDATE SET content_hash=EXCLUDED.content_hash,algorithm_version=EXCLUDED.algorithm_version,normalized_name=EXCLUDED.normalized_name`,
      [
        aliases.aliases.map(() => aliases.id),
        aliases.aliases.map((row) => row.id),
        aliases.aliases.map(() => aliases.contentHash),
        aliases.aliases.map((row) =>
          normalizeArtistSearchName(row.text.trim()),
        ),
      ],
    );
}
/** Maintenance utility; the caller owns the transaction. Originals are never modified. */
export async function rebuildIdolSearchProjections(
  client: Pick<TransactionClient, "query">,
): Promise<Readonly<{ schemaVersion: 1; processed: number }>> {
  let afterId: string | null = null;
  let processed = 0;
  for (;;) {
    const result: unknown = await client.query(
      `SELECT id, source_hash, display_name FROM public.idol_revision_translations
       WHERE ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT $2`,
      [afterId, batchSize],
    );
    if (
      typeof result !== "object" ||
      result === null ||
      !("rows" in result) ||
      !Array.isArray(result.rows)
    )
      throw new Error("invalid search projection source");
    if (result.rows.length === 0) return { schemaVersion: 1, processed };
    const ids: string[] = [],
      hashes: string[] = [],
      names: string[] = [];
    for (const raw of result.rows as unknown[]) {
      if (
        typeof raw !== "object" ||
        raw === null ||
        !("id" in raw) ||
        typeof raw.id !== "string" ||
        !("source_hash" in raw) ||
        typeof raw.source_hash !== "string" ||
        !("display_name" in raw) ||
        typeof raw.display_name !== "string"
      )
        throw new Error("invalid search projection source");
      ids.push(raw.id);
      hashes.push(raw.source_hash);
      names.push(normalizeArtistSearchName(raw.display_name.trim()));
    }
    await client.query(
      `INSERT INTO public.idol_translation_search_projections
         (idol_translation_id, source_hash, algorithm_version, normalized_name)
       SELECT id, hash::public.sha256_hex, 1, name FROM unnest($1::uuid[], $2::text[], $3::text[]) AS input(id,hash,name)
       ON CONFLICT (idol_translation_id) DO UPDATE SET source_hash=EXCLUDED.source_hash,
         algorithm_version=EXCLUDED.algorithm_version, normalized_name=EXCLUDED.normalized_name`,
      [ids, hashes, names],
    );
    processed += ids.length;
    afterId = ids.at(-1)!;
  }
}

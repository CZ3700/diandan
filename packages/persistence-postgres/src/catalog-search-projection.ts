import { normalizeArtistSearchName } from "@fan-support/catalog";
import type { TransactionClient } from "./transaction-runner.js";

const batchSize = 256;
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

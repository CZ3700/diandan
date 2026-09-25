import { normalizeArtistSearchName } from "@fan-support/catalog";
import {
  publicationManifestSchema,
  dailyPublicationDocumentSchema,
  dailyPublicationManifestSchema,
  type DailyPublicationManifest,
  type PublicationManifest,
} from "@fan-support/contracts";
import {
  computeIdolAliasContentHash,
  computeIdolTranslationContentHash,
  computeDailySourceHash,
  computeDailyDocumentHash,
} from "@fan-support/content";
import type { TransactionClient } from "./transaction-runner.js";

const batchSize = 256;

async function writeDailyDocumentProjection(
  client: Pick<TransactionClient, "query">,
  input: unknown,
  expectedHash?: unknown,
): Promise<void> {
  const document = dailyPublicationDocumentSchema.parse(input);
  const documentHash = computeDailyDocumentHash(document);
  if (
    document.kind !== "IDOL" ||
    (expectedHash !== undefined && expectedHash !== documentHash) ||
    document.source.sourceHash !==
      computeDailySourceHash(
        document.kind,
        document.source.locale,
        document.source.fields,
      )
  )
    throw new Error("Invalid daily search source");
  await client.query(
    `INSERT INTO public.idol_daily_search_projections(revision_id,source_translation_id,source_hash,document_hash,algorithm_version,normalized_name)
     VALUES($1,$2,$3,$4,1,$5) ON CONFLICT(revision_id) DO UPDATE SET source_translation_id=EXCLUDED.source_translation_id,source_hash=EXCLUDED.source_hash,document_hash=EXCLUDED.document_hash,algorithm_version=EXCLUDED.algorithm_version,normalized_name=EXCLUDED.normalized_name`,
    [
      document.revisionId,
      document.source.id,
      document.source.sourceHash,
      documentHash,
      normalizeArtistSearchName(document.source.fields.displayName.trim()),
    ],
  );
}

/** The caller owns the real publication transaction; one original is never expanded into translated rows. */
export async function writePublishedDailyIdolSearchProjection(
  client: Pick<TransactionClient, "query">,
  input: DailyPublicationManifest,
): Promise<void> {
  const manifest = dailyPublicationManifestSchema.parse(input);
  if (manifest.document.kind !== "IDOL") return;
  await writeDailyDocumentProjection(client, manifest.document);
}
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
    if (result.rows.length === 0) break;
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
  afterId = null;
  for (;;) {
    const result: unknown = await client.query(
      `SELECT revision_id,document,document_hash FROM public.daily_publication_revisions
       WHERE object_kind='IDOL' AND ($1::uuid IS NULL OR revision_id>$1::uuid) ORDER BY revision_id LIMIT $2`,
      [afterId, batchSize],
    );
    if (
      typeof result !== "object" ||
      result === null ||
      !("rows" in result) ||
      !Array.isArray(result.rows)
    )
      throw new Error("Invalid daily search source");
    if (result.rows.length === 0) return { schemaVersion: 1, processed };
    for (const row of result.rows as unknown[]) {
      if (
        typeof row !== "object" ||
        row === null ||
        !("revision_id" in row) ||
        typeof row.revision_id !== "string" ||
        !("document" in row) ||
        !("document_hash" in row) ||
        typeof row.document_hash !== "string"
      )
        throw new Error("Invalid daily search source");
      const document = dailyPublicationDocumentSchema.parse(row.document);
      if (document.revisionId !== row.revision_id)
        throw new Error("Invalid daily search source");
      await writeDailyDocumentProjection(client, document, row.document_hash);
      afterId = document.revisionId;
      processed++;
    }
  }
}

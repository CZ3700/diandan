import { randomUUID } from "node:crypto";
import {
  createDefaultStorefrontBrandView,
  storefrontBrandSchema,
  storefrontBrandCommandSchema,
  storefrontBrandResponseSchema,
  storefrontBrandPublicationSchema,
  storefrontBrandStateSchema,
  publicStorefrontBrandResponseSchema,
  type StorefrontBrandState,
  type StorefrontBrandResponse,
} from "@fan-support/contracts";
import type { StorefrontBrandRepository } from "@fan-support/persistence-port";
import {
  draftRows,
  draftTimestamp,
  type DraftRow,
} from "./content-draft-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";
const failure = (
  code:
    | "STALE_VERSION"
    | "NOT_FOUND"
    | "IDEMPOTENCY_CONFLICT"
    | "REVISION_NOT_DRAFT",
): StorefrontBrandResponse => ({ schemaVersion: 1, outcome: "FAILURE", code });
import { brandView, preparedLogo, saveLogo } from "./storefront-brand-logo.js";
const publicationSql = `SELECT p.*,r.brand FROM public.storefront_brand_publications p JOIN public.storefront_brand_revisions r ON r.id=p.revision_id`;
async function publication(
  client: TransactionClient,
  publicBaseUrl: string | undefined,
  row: DraftRow,
) {
  return storefrontBrandPublicationSchema.parse({
    publicationId: row["id"],
    revisionId: row["revision_id"],
    version: Number(row["version"]),
    brand: row["brand"],
    view: await brandView(client, publicBaseUrl, row["brand"]),
    publishedAt: draftTimestamp(row["created_at"]),
    action: row["action"],
    restoredFromPublicationId: row["restored_from_publication_id"],
  });
}
async function state(
  client: TransactionClient,
  publicBaseUrl: string | undefined,
): Promise<StorefrontBrandState> {
  const [head] = await draftRows(
    client,
    "SELECT * FROM public.storefront_brand_heads WHERE singleton FOR SHARE",
  );
  if (!head) throw new Error("Brand head unavailable");
  const [draft] =
    head["draft_revision_id"] === null
      ? []
      : await draftRows(
          client,
          "SELECT * FROM public.storefront_brand_revisions WHERE id=$1",
          [head["draft_revision_id"]],
        );
  const [published] =
    head["published_publication_id"] === null
      ? []
      : await draftRows(client, `${publicationSql} WHERE p.id=$1`, [
          head["published_publication_id"],
        ]);
  if (
    (head["draft_revision_id"] !== null && !draft) ||
    (head["published_publication_id"] !== null && !published)
  )
    throw new Error("Brand reference unavailable");
  return storefrontBrandStateSchema.parse({
    schemaVersion: 1,
    version: Number(head["version"]),
    draft: draft
      ? {
          revisionId: draft["id"],
          brand: draft["brand"],
          view: await brandView(client, publicBaseUrl, draft["brand"]),
          createdAt: draftTimestamp(draft["created_at"]),
        }
      : null,
    published: published
      ? await publication(client, publicBaseUrl, published)
      : null,
  });
}
const response = async (
  client: TransactionClient,
  publicBaseUrl: string | undefined,
): Promise<StorefrontBrandResponse> => ({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "STATE",
  state: await state(client, publicBaseUrl),
  replayed: false,
});
/** Brand revisions do not rewrite content, theme, media, or commerce history. */
export function createStorefrontBrandRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  publicBaseUrl?: string,
): StorefrontBrandRepository {
  const run = <T>(work: () => Promise<T>) =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  return {
    readPrepared: (input) => run(() => preparedLogo(client, input)),
    saveLogo: (input) => run(() => saveLogo(client, publicBaseUrl, input)),
    readPublished: () =>
      run(async () => {
        // Public reads deliberately do not load drafts or administrative identities.
        const [head] = await draftRows(
          client,
          "SELECT published_publication_id FROM public.storefront_brand_heads WHERE singleton FOR SHARE",
        );
        if (!head) throw new Error("Brand head unavailable");
        if (head["published_publication_id"] === null)
          return publicStorefrontBrandResponseSchema.parse({
            schemaVersion: 1,
            outcome: "SUCCESS",
            kind: "STOREFRONT_BRAND",
            source: "DEFAULT",
            brand: createDefaultStorefrontBrandView(),
            version: 0,
            publicationId: null,
          });
        const [row] = await draftRows(
          client,
          `${publicationSql} WHERE p.id=$1`,
          [head["published_publication_id"]],
        );
        if (!row) throw new Error("Brand publication unavailable");
        const value = await publication(client, publicBaseUrl, row);
        return publicStorefrontBrandResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "STOREFRONT_BRAND",
          source: "PUBLISHED",
          brand: value.view,
          version: value.version,
          publicationId: value.publicationId,
        });
      }),
    execute: (input) =>
      run(async () => {
        const command = storefrontBrandCommandSchema.parse(input.command);
        if (command.action === "READ") return response(client, publicBaseUrl);
        if (command.action === "HISTORY") {
          const rows = await draftRows(
            client,
            `${publicationSql} ORDER BY p.version DESC LIMIT $1 OFFSET $2`,
            [command.pageSize + 1, (command.page - 1) * command.pageSize],
          );
          return storefrontBrandResponseSchema.parse({
            schemaVersion: 1,
            outcome: "SUCCESS",
            kind: "HISTORY",
            entries: await Promise.all(
              rows
                .slice(0, command.pageSize)
                .map((row) => publication(client, publicBaseUrl, row)),
            ),
            page: command.page,
            pageSize: command.pageSize,
            hasMore: rows.length > command.pageSize,
          });
        }
        if (command.action === "PREPARE_LOGO")
          throw new Error("Logo processing needs its dedicated boundary");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [
            `storefront-brand:${input.principal.actorId}:${command.action}:${command.idempotencyKey}`,
          ],
        );
        const [prior] = await draftRows(
          client,
          "SELECT request_hash,response FROM public.storefront_brand_receipts WHERE actor_id=$1 AND action=$2 AND idempotency_key=$3",
          [input.principal.actorId, command.action, command.idempotencyKey],
        );
        if (prior) {
          if (prior["request_hash"] !== input.requestHash)
            return failure("IDEMPOTENCY_CONFLICT");
          const replay = storefrontBrandResponseSchema.parse(prior["response"]);
          if (replay.outcome !== "SUCCESS" || replay.kind !== "STATE")
            throw new Error("Invalid brand receipt");
          return { ...replay, replayed: true };
        }
        const [head] = await draftRows(
          client,
          "SELECT * FROM public.storefront_brand_heads WHERE singleton FOR UPDATE",
        );
        if (!head) throw new Error("Brand head unavailable");
        if (Number(head["version"]) !== command.expectedVersion)
          return failure("STALE_VERSION");
        let revisionId: string, brand;
        if (command.action === "SAVE_DRAFT") {
          revisionId = randomUUID();
          brand = command.brand;
        } else if (command.action === "PUBLISH") {
          if (
            String(head["draft_revision_id"]).toLowerCase() !==
            command.draftRevisionId.toLowerCase()
          )
            return failure("REVISION_NOT_DRAFT");
          revisionId = command.draftRevisionId;
        } else {
          const [old] = await draftRows(
            client,
            `${publicationSql} WHERE p.id=$1`,
            [command.publicationId],
          );
          if (!old) return failure("NOT_FOUND");
          brand = storefrontBrandSchema.parse(old["brand"]);
          revisionId = randomUUID();
        }
        if (brand) await brandView(client, publicBaseUrl, brand);
        const auditId = randomUUID(),
          publicationId = command.action === "SAVE_DRAFT" ? null : randomUUID();
        const [instant] = await draftRows(
          client,
          "SELECT GREATEST(clock_timestamp(),$1::timestamptz) AS now",
          [head["updated_at"]],
        );
        const at = draftTimestamp(instant?.["now"]);
        await client.query(
          "INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,request_id,correlation_id,outcome,created_at) VALUES($1,'ADMIN',$2,$3,'STOREFRONT_BRAND',$4,$5,$5,'SUCCEEDED',$6)",
          [
            auditId,
            input.principal.actorId,
            `STOREFRONT_BRAND_${command.action}`,
            publicationId ?? revisionId,
            input.requestId,
            at,
          ],
        );
        if (brand)
          await client.query(
            "INSERT INTO public.storefront_brand_revisions(id,brand,actor_id,session_id,request_id,audit_log_id,created_at) VALUES($1,$2::jsonb,$3,$4,$5,$6,$7)",
            [
              revisionId,
              JSON.stringify(brand),
              input.principal.actorId,
              input.principal.sessionId,
              input.requestId,
              auditId,
              at,
            ],
          );
        const version = command.expectedVersion + 1;
        if (publicationId)
          await client.query(
            "INSERT INTO public.storefront_brand_publications(id,revision_id,version,action,restored_from_publication_id,actor_id,session_id,request_id,audit_log_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            [
              publicationId,
              revisionId,
              version,
              command.action,
              command.action === "RESTORE" ? command.publicationId : null,
              input.principal.actorId,
              input.principal.sessionId,
              input.requestId,
              auditId,
              at,
            ],
          );
        await client.query(
          "UPDATE public.storefront_brand_heads SET version=$1,draft_revision_id=$2,published_publication_id=$3,updated_at=$4 WHERE singleton",
          [
            version,
            publicationId ? null : revisionId,
            publicationId ?? head["published_publication_id"],
            at,
          ],
        );
        const result = await response(client, publicBaseUrl);
        await client.query(
          "INSERT INTO public.storefront_brand_receipts(id,actor_id,session_id,action,idempotency_key,request_hash,response,audit_log_id,request_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)",
          [
            randomUUID(),
            input.principal.actorId,
            input.principal.sessionId,
            command.action,
            command.idempotencyKey,
            input.requestHash,
            JSON.stringify(result),
            auditId,
            input.requestId,
            at,
          ],
        );
        return result;
      }),
  };
}

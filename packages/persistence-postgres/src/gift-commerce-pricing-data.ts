import { createHash } from "node:crypto";
import {
  contentTimestampSchema,
  sourceHashSchema,
  giftCommercePriceBookSchema,
  giftCommercePriceHeadSchema,
  giftCommerceMutationSchema,
  type GiftCommerceFailure,
  type GiftCommercePermission,
  type GiftCommerceWriteCommand,
} from "@fan-support/contracts";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { utcTimestampSql } from "./resource-management-data.js";
import type { TransactionClient } from "./transaction-runner.js";
export const commerceFailure = (
  code: GiftCommerceFailure["code"],
): GiftCommerceFailure => ({ schemaVersion: 1, outcome: "FAILURE", code });
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`,
    )
    .join(",")}}`;
}
export const commerceCommandHash = (command: unknown) =>
  sourceHashSchema.parse(
    createHash("sha256")
      .update(`fan-support.gift-commerce-command.v1\n${canonical(command)}`)
      .digest("hex"),
  );
export const computeGiftCommercePriceHash = (payload: unknown) =>
  sourceHashSchema.parse(
    createHash("sha256")
      .update(`fan-support.gift-price-book.v1\n${canonical(payload)}`)
      .digest("hex"),
  );
export async function commerceTime(
  client: TransactionClient,
  principal: GiftCommerceWriteCommand["principal"],
  permission: GiftCommercePermission,
  bounds: readonly string[] = [],
) {
  const [row] = await draftRows(
    client,
    `SELECT gen_random_uuid() AS id,gen_random_uuid() AS audit_id,
 ${utcTimestampSql("GREATEST(transaction_timestamp(),$2::timestamptz,(SELECT max(v) FROM unnest($3::timestamptz[]) v),s.created_at)")} AS at
 FROM public.admin_sessions s WHERE s.id=$1 AND s.admin_identity_id=$4 AND s.revoked_at IS NULL AND s.authenticated_with_mfa AND s.expires_at>clock_timestamp()
 AND EXISTS(SELECT 1 FROM public.admin_identity_roles ar JOIN public.role_permissions rp ON rp.role_id=ar.role_id JOIN public.permissions p ON p.id=rp.permission_id WHERE ar.admin_identity_id=s.admin_identity_id AND p.permission_key=$5 AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp()) FOR SHARE OF s`,
    [
      principal.sessionId,
      principal.authorizedAt,
      bounds,
      principal.actorId,
      permission,
    ],
  );
  if (!row) throw new Error("gift commerce authority changed");
  return {
    id: String(row["id"]),
    auditId: String(row["audit_id"]),
    at: contentTimestampSchema.parse(row["at"]),
  };
}
export async function commerceAudit(
  client: TransactionClient,
  input: GiftCommerceWriteCommand,
  event: { id: string; auditId: string; at: string },
  action: string,
  subjectType: string,
  subjectId: string,
) {
  await client.query(
    `INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at)
 VALUES($1,'ADMIN',$2,$3,$4,$5,$6,$7,$7,'SUCCEEDED','GIFT_COMMERCE',$8)`,
    [
      event.auditId,
      input.principal.actorId,
      action,
      subjectType,
      subjectId,
      input.command.reasonCode,
      input.requestId,
      event.at,
    ],
  );
}
export async function priceContext(
  client: TransactionClient,
  market: string,
  currency: string,
  lock = false,
) {
  const [owner] = await draftRows(
    client,
    `SELECT m.id,m.status FROM public.markets m WHERE m.market=$1 AND (m.default_currency=$2 OR EXISTS(SELECT 1 FROM public.price_books b WHERE b.market_id=m.id AND b.currency=$2)) ${lock ? "FOR UPDATE OF m" : ""}`,
    [market, currency],
  );
  if (!owner) return null;
  const [head] = await draftRows(
    client,
    `SELECT * FROM public.price_book_publication_heads WHERE market=$1 AND currency=$2 ${lock ? "FOR UPDATE" : ""}`,
    [market, currency],
  );
  const [maximum] = await draftRows(
    client,
    "SELECT COALESCE(max(revision),0) AS revision FROM public.price_books WHERE market=$1 AND currency=$2",
    [market, currency],
  );
  return {
    owner,
    head,
    authoringVersion: Number(maximum?.["revision"] ?? 0),
    headVersion: Number(head?.["version"] ?? 0),
    publicHead: head
      ? giftCommercePriceHeadSchema.parse({
          priceBookId: head["price_book_id"],
          revision: Number(head["price_book_revision"]),
          publicationId: head["publication_id"],
          version: Number(head["version"]),
        })
      : null,
  };
}
export async function loadCommerceBook(
  client: TransactionClient,
  bookId: string,
  revision: number,
  lock = false,
) {
  const [row] = await draftRows(
    client,
    `SELECT to_jsonb(b.*) AS value,public.gift_commerce_price_payload(b.id,b.revision) AS payload FROM public.price_books b WHERE id=$1 AND revision=$2 ${lock ? "FOR UPDATE OF b" : ""}`,
    [bookId, revision],
  );
  if (!row) return null;
  const raw = row["value"] as DraftRow,
    payload = row["payload"] as DraftRow;
  const prices = payload["prices"] as DraftRow[];
  const lifecycle: DraftRow = { status: raw["lifecycle"] };
  for (const [key, column] of Object.entries({
    validatedAt: "validated_at",
    publishedAt: "published_at",
    supersededAt: "superseded_at",
    archivedAt: "archived_at",
  }))
    if (raw[column] !== null) lifecycle[key] = raw[column];
  const singleWindow =
    prices.every(
      (p) =>
        p["validFrom"] === payload["validFrom"] &&
        p["validUntil"] === payload["validUntil"],
    ) && new Set(prices.map((p) => p["giftVariantId"])).size === prices.length;
  const book = giftCommercePriceBookSchema.parse({
    schemaVersion: 1,
    priceBookId: raw["id"],
    revision: Number(raw["revision"]),
    market: raw["market"],
    currency: raw["currency"],
    lifecycle,
    validFrom: payload["validFrom"],
    validUntil: payload["validUntil"],
    contentHash: computeGiftCommercePriceHash(payload),
    priceCount: prices.length,
    singleWindow,
  });
  return { raw, payload, prices, book };
}
export async function readPriceReceipt(
  client: TransactionClient,
  id: string,
  actorId: string,
) {
  const [created] = await draftRows(
    client,
    `SELECT r.*,b.market,b.currency FROM public.gift_price_revision_receipts r JOIN public.price_books b ON b.id=r.price_book_id AND b.revision=r.revision WHERE r.id=$1 AND r.actor_id=$2`,
    [id, actorId],
  );
  if (created)
    return giftCommerceMutationSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      action: "CREATE_PRICE_REVISION",
      resultId: created["id"],
      market: created["market"],
      currency: created["currency"],
      priceBookId: created["price_book_id"],
      revision: Number(created["revision"]),
      headVersion: Number(created["expected_head_version"]),
      contentHash: created["content_hash"],
      replayed: false,
    });
  const [published] = await draftRows(
    client,
    `SELECT r.*,b.market,b.currency FROM public.gift_price_publication_receipts r JOIN public.price_books b ON b.id=r.price_book_id AND b.revision=r.revision WHERE r.id=$1 AND r.actor_id=$2`,
    [id, actorId],
  );
  if (!published) return commerceFailure("NOT_FOUND");
  return giftCommerceMutationSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MUTATION",
    action: published["action"],
    resultId: published["id"],
    market: published["market"],
    currency: published["currency"],
    priceBookId: published["price_book_id"],
    revision: Number(published["revision"]),
    headVersion: Number(published["result_head_version"]),
    contentHash: published["content_hash"],
    publicationId: published["publication_id"],
    replayed: false,
  });
}

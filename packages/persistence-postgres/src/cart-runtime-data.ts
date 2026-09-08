import {
  cartRuntimeHeaderSchema,
  cartRuntimeItemRecordSchema,
  cartRuntimeReceiptSchema,
  type CartRuntimeAccesses,
} from "@fan-support/contracts";
import { CartRuntimeRepositoryError } from "@fan-support/persistence-port";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";

const timestamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
export const cartHeaderColumns = `c.id,c.version::text,c.status,c.presentation_locale,c.market,c.currency,
  ${timestamp("c.expires_at")} expires_at,${timestamp("c.created_at")} created_at,
  ${timestamp("c.updated_at")} updated_at,c.expires_at<=clock_timestamp() expired`;

export function cartHeader(row: DraftRow) {
  return cartRuntimeHeaderSchema.parse({
    schemaVersion: 1,
    id: row["id"],
    version: Number(row["version"]),
    status: row["status"],
    expired: row["expired"],
    presentationLocale: row["presentation_locale"],
    market: row["market"],
    currency: row["currency"],
    expiresAt: row["expires_at"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  });
}

export async function findCartForUpdate(
  client: TransactionClient,
  accesses: CartRuntimeAccesses,
) {
  const rows = await draftRows(
    client,
    `SELECT ${cartHeaderColumns} FROM public.carts c
     WHERE EXISTS (SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS access(digest text,version text)
       WHERE c.token_digest=decode(access.digest,'hex') AND c.token_pepper_version=access.version)
     ORDER BY c.id FOR UPDATE`,
    [
      JSON.stringify(
        accesses.map((access) => ({
          digest: access.tokenDigest,
          version: access.pepperVersion,
        })),
      ),
    ],
  );
  if (rows.length > 1) throw new CartRuntimeRepositoryError("INVALID_ACCESS");
  return rows[0] ? cartHeader(rows[0]) : null;
}

export function cartItemRecord(row: DraftRow) {
  return cartRuntimeItemRecordSchema.parse({
    schemaVersion: 1,
    id: row["id"],
    cartId: row["cart_id"],
    giftId: row["gift_id"],
    giftVariantId: row["gift_variant_id"],
    idolId: row["idol_id"],
    version: Number(row["version"]),
    quantity: row["quantity"],
    observedPriceId: row["observed_price_id"],
    displayMode: row["display_mode"],
    nicknameProvided: row["display_mode"] === "nickname",
    hasFanMessage: row["has_fan_message"],
  });
}

export function cartReceipt(row: DraftRow) {
  return cartRuntimeReceiptSchema.parse({
    schemaVersion: 1,
    cartId: row["cart_id"],
    cartItemId: row["cart_item_id"],
    supportIntentId: row["support_intent_id"],
    cartVersion: Number(row["cart_version"]),
    itemVersion: Number(row["item_version"]),
    occurredAt: row["occurred_at"],
  });
}

export const cartTimestamp = timestamp;

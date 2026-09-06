import { randomUUID } from "node:crypto";
import { createGiftCommerceAuthorizationRepository } from "../dist/gift-commerce-authorization-repository.js";
import { createGiftCommerceInventoryRepository } from "../dist/gift-commerce-inventory-repository.js";
/** An existing microsecond timestamp is a causal bound; no system or expiry clock is changed. */
export async function verifyGiftCommerceInventoryTime({
  client,
  scope,
  credentials,
  command,
  check,
}) {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  let accepted = false;
  try {
    await client.query(
      "UPDATE public.inventory_balances SET updated_at=transaction_timestamp()+interval '5 seconds 789 microseconds' WHERE inventory_item_id=(SELECT id FROM public.inventory_items WHERE gift_variant_id=$1) AND location_id=$2",
      [command.giftVariantId, command.inventoryLocationId],
    );
    const authority = await createGiftCommerceAuthorizationRepository(
      client,
      scope,
    ).authorize({
      schemaVersion: 1,
      sessionTokenDigest: credentials.sessionTokenDigest,
      csrfTokenDigest: credentials.csrfTokenDigest,
      permission: "inventory.manage",
      locales: [],
    });
    if (authority.outcome !== "SUCCESS")
      throw new Error("time fixture authority");
    const result = await createGiftCommerceInventoryRepository(
      client,
      scope,
    ).write({
      schemaVersion: 1,
      requestId: randomUUID(),
      principal: authority.principal,
      command: {
        schemaVersion: 1,
        ...command,
        reasonCode: "CAUSAL_INVENTORY",
        idempotencyKey: randomUUID(),
      },
    });
    if (result.outcome !== "SUCCESS") throw new Error("time fixture mutation");
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    const {
      rows: [proof],
    } = await client.query(
      "SELECT r.created_at>=r.previous_balance_updated_at AS causal,to_char(r.created_at AT TIME ZONE 'UTC','US')=to_char(r.previous_balance_updated_at AT TIME ZONE 'UTC','US') AS exact FROM public.gift_inventory_adjustment_receipts r WHERE r.id=$1",
      [result.resultId],
    );
    accepted = proof.causal && proof.exact;
  } catch (error) {
    if (
      !["23514", "42703"].includes(error.code) &&
      error.failure?.error?.code !== "INTEGRITY_VIOLATION"
    )
      throw error;
  } finally {
    await client.query("ROLLBACK");
  }
  check(
    accepted,
    true,
    "inventory adjustment preserves exact locked future microsecond history",
  );
}

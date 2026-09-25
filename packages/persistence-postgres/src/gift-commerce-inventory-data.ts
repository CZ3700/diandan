import {
  giftCommerceMutationSchema,
  giftCommerceReadResponseSchema,
  type GiftCommerceReadCommand,
  type GiftCommerceWriteCommand,
} from "@fan-support/contracts";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { utcTimestampSql } from "./resource-management-data.js";
import {
  commerceFailure,
  commerceTime,
  commerceAudit,
  commerceCommandHash,
} from "./gift-commerce-pricing-data.js";
import type { TransactionClient } from "./transaction-runner.js";
export async function readInventoryReceipt(
  client: TransactionClient,
  id: string,
  actorId: string,
) {
  const [location] = await draftRows(
    client,
    "SELECT * FROM public.gift_inventory_location_receipts WHERE id=$1 AND actor_id=$2",
    [id, actorId],
  );
  if (location)
    return giftCommerceMutationSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      action: "CREATE_INVENTORY_LOCATION",
      resultId: location["id"],
      inventoryLocationId: location["inventory_location_id"],
      replayed: false,
    });
  const [adjustment] = await draftRows(
    client,
    "SELECT * FROM public.gift_inventory_adjustment_receipts WHERE id=$1 AND actor_id=$2",
    [id, actorId],
  );
  if (!adjustment) return commerceFailure("NOT_FOUND");
  return giftCommerceMutationSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MUTATION",
    action: "ADJUST_INVENTORY",
    resultId: adjustment["id"],
    giftVariantId: adjustment["gift_variant_id"],
    inventoryItemId: adjustment["inventory_item_id"],
    inventoryLocationId: adjustment["inventory_location_id"],
    balanceVersion: Number(adjustment["result_balance_version"]),
    replayed: false,
  });
}
function inventoryItem(row: DraftRow | undefined) {
  return row
    ? {
        schemaVersion: 1,
        id: row["id"],
        giftVariantId: row["gift_variant_id"],
        sku: row["sku"],
        policy: row["policy"],
        status: row["status"],
      }
    : null;
}
function inventoryLedgerActor(row: DraftRow) {
  if (row["actor_kind"] === "ADMIN")
    return { kind: "ADMIN", adminIdentityId: row["admin_identity_id"] };
  if (row["actor_kind"] === "SYSTEM")
    return { kind: "SYSTEM", taskName: row["task_name"] };
  return { kind: "IMPORT", importBatchId: row["import_batch_id"] };
}
function inventoryBalance(row: DraftRow) {
  return {
    schemaVersion: 1,
    inventoryItemId: row["inventory_item_id"],
    inventoryLocationId: row["location_id"],
    onHand: Number(row["on_hand"]),
    reserved: Number(row["reserved"]),
    version: Number(row["version"]),
  };
}
function inventoryLedgerEntry(row: DraftRow) {
  return {
    schemaVersion: 1,
    id: row["id"],
    inventoryItemId: row["inventory_item_id"],
    inventoryLocationId: row["location_id"],
    deltaOnHand: Number(row["delta_on_hand"]),
    deltaReserved: Number(row["delta_reserved"]),
    reasonCode: row["reason_code"],
    actor: inventoryLedgerActor(row),
    occurredAt: row["at"],
  };
}
export async function readCommerceInventory(
  client: TransactionClient,
  c: GiftCommerceReadCommand,
) {
  if (c.action !== "READ_INVENTORY") return commerceFailure("INVALID_COMMAND");
  const [variant] = await draftRows(
    client,
    "SELECT id FROM public.gift_variants WHERE id=$1",
    [c.giftVariantId],
  );
  if (!variant) return commerceFailure("NOT_FOUND");
  const [item] = await draftRows(
    client,
    "SELECT * FROM public.inventory_items WHERE gift_variant_id=$1",
    [c.giftVariantId],
  );
  const common = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    giftVariantId: c.giftVariantId,
    inventoryLocationId: c.inventoryLocationId,
    item: inventoryItem(item),
    page: c.page,
    pageSize: c.pageSize,
  };
  if (!item)
    return giftCommerceReadResponseSchema.parse({
      ...common,
      kind: c.view === "BALANCES" ? "INVENTORY_BALANCES" : "INVENTORY_LEDGER",
      totalItems: 0,
      items: [],
    });
  const table =
    c.view === "BALANCES" ? "inventory_balances" : "inventory_ledger";
  const [total] = await draftRows(
    client,
    `SELECT count(*) AS total FROM public.${table} WHERE inventory_item_id=$1 AND ($2::uuid IS NULL OR location_id=$2)`,
    [item["id"], c.inventoryLocationId],
  );
  const rows = await draftRows(
    client,
    `SELECT *,${c.view === "LEDGER" ? utcTimestampSql("occurred_at") : "NULL::text"} AS at FROM public.${table} WHERE inventory_item_id=$1 AND ($2::uuid IS NULL OR location_id=$2)
 ORDER BY ${c.view === "BALANCES" ? "location_id" : "balance_version_after DESC,location_id"} LIMIT $3 OFFSET $4`,
    [item["id"], c.inventoryLocationId, c.pageSize, (c.page - 1) * c.pageSize],
  );
  return giftCommerceReadResponseSchema.parse({
    ...common,
    kind: c.view === "BALANCES" ? "INVENTORY_BALANCES" : "INVENTORY_LEDGER",
    totalItems: Number(total?.["total"] ?? 0),
    items:
      c.view === "BALANCES"
        ? rows.map(inventoryBalance)
        : rows.map(inventoryLedgerEntry),
  });
}
export async function writeCommerceInventory(
  client: TransactionClient,
  input: GiftCommerceWriteCommand,
) {
  const c = input.command;
  if (
    c.action !== "CREATE_INVENTORY_LOCATION" &&
    c.action !== "ADJUST_INVENTORY"
  )
    return commerceFailure("INVALID_COMMAND");
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  if (c.action === "CREATE_INVENTORY_LOCATION") {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `fan-support:inventory-location:${c.code}`,
    ]);
    const [existing] = await draftRows(
      client,
      "SELECT id FROM public.inventory_locations WHERE location_key=$1",
      [c.code],
    );
    if (existing) return commerceFailure("CONFLICT");
    const event = await commerceTime(
      client,
      input.principal,
      "inventory.manage",
    );
    const [id] = await draftRows(client, "SELECT gen_random_uuid() AS id");
    const locationId = String(id?.["id"]);
    await client.query(
      "INSERT INTO public.inventory_locations(id,location_key,status,created_at) VALUES($1,$2,'ACTIVE',$3)",
      [locationId, c.code, event.at],
    );
    await commerceAudit(
      client,
      input,
      event,
      "CREATE_INVENTORY_LOCATION",
      "INVENTORY_LOCATION",
      locationId,
    );
    await client.query(
      `INSERT INTO public.gift_inventory_location_receipts(id,inventory_location_id,actor_id,session_id,audit_log_id,request_id,reason_code,command_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        event.id,
        locationId,
        input.principal.actorId,
        input.principal.sessionId,
        event.auditId,
        input.requestId,
        c.reasonCode,
        commerceCommandHash(c),
        event.at,
      ],
    );
    return readInventoryReceipt(client, event.id, input.principal.actorId);
  }
  const [variant] = await draftRows(
    client,
    "SELECT * FROM public.gift_variants WHERE id=$1 FOR UPDATE",
    [c.giftVariantId],
  );
  if (!variant) return commerceFailure("NOT_FOUND");
  if (Number(variant["version"]) !== c.expectedVariantVersion)
    return commerceFailure("STALE_VERSION");
  if (variant["inventory_policy"] !== "TRACKED")
    return commerceFailure("INVENTORY_NOT_TRACKED");
  const [location] = await draftRows(
    client,
    "SELECT id FROM public.inventory_locations WHERE id=$1 AND status='ACTIVE' FOR SHARE",
    [c.inventoryLocationId],
  );
  if (!location) return commerceFailure("NOT_FOUND");
  let [item] = await draftRows(
    client,
    "SELECT * FROM public.inventory_items WHERE gift_variant_id=$1 FOR UPDATE",
    [c.giftVariantId],
  );
  if (item && (item["status"] !== "ACTIVE" || item["policy"] !== "TRACKED"))
    return commerceFailure("INVENTORY_NOT_TRACKED");
  const [balance] = item
    ? await draftRows(
        client,
        "SELECT *,updated_at::text AS at FROM public.inventory_balances WHERE inventory_item_id=$1 AND location_id=$2 FOR UPDATE",
        [item["id"], c.inventoryLocationId],
      )
    : [];
  if (Number(balance?.["version"] ?? 0) !== c.expectedBalanceVersion)
    return commerceFailure("STALE_VERSION");
  const onHand = Number(balance?.["on_hand"] ?? 0),
    reserved = Number(balance?.["reserved"] ?? 0);
  const next = BigInt(onHand) + BigInt(c.deltaOnHand);
  if (next < BigInt(reserved) || next > BigInt(Number.MAX_SAFE_INTEGER))
    return commerceFailure("INSUFFICIENT_INVENTORY");
  const [variantTime] = await draftRows(
    client,
    `SELECT ${utcTimestampSql("updated_at")} AS at FROM public.gift_variants WHERE id=$1`,
    [c.giftVariantId],
  );
  const event = await commerceTime(
    client,
    input.principal,
    "inventory.manage",
    [String(variantTime?.["at"]), ...(balance ? [String(balance["at"])] : [])],
  );
  if (!item) {
    [item] = await draftRows(
      client,
      "INSERT INTO public.inventory_items(id,gift_variant_id,sku,policy,status,created_at) VALUES(gen_random_uuid(),$1,$2,'TRACKED','ACTIVE',$3) RETURNING *",
      [c.giftVariantId, variant["sku"], event.at],
    );
  }
  if (!item) return commerceFailure("COMMERCE_UNAVAILABLE");
  const [ledger] = await draftRows(client, "SELECT gen_random_uuid() AS id");
  await commerceAudit(
    client,
    input,
    event,
    "ADJUST_INVENTORY",
    "INVENTORY_ADJUSTMENT",
    event.id,
  );
  await client.query(
    `INSERT INTO public.gift_inventory_adjustment_receipts(id,gift_variant_id,inventory_item_id,inventory_location_id,ledger_id,expected_variant_version,expected_balance_version,result_balance_version,previous_on_hand,previous_reserved,delta_on_hand,actor_id,session_id,audit_log_id,request_id,reason_code,command_hash,created_at,previous_balance_updated_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      event.id,
      c.giftVariantId,
      item["id"],
      c.inventoryLocationId,
      ledger?.["id"],
      c.expectedVariantVersion,
      c.expectedBalanceVersion,
      c.expectedBalanceVersion + 1,
      onHand,
      reserved,
      c.deltaOnHand,
      input.principal.actorId,
      input.principal.sessionId,
      event.auditId,
      input.requestId,
      c.reasonCode,
      commerceCommandHash(c),
      event.at,
      balance?.["at"] ?? null,
    ],
  );
  if (balance)
    await client.query(
      "UPDATE public.inventory_balances SET on_hand=$3,version=version+1,updated_at=$4 WHERE inventory_item_id=$1 AND location_id=$2",
      [item["id"], c.inventoryLocationId, Number(next), event.at],
    );
  else
    await client.query(
      "INSERT INTO public.inventory_balances(inventory_item_id,location_id,on_hand,reserved,version,updated_at) VALUES($1,$2,$3,0,1,$4)",
      [item["id"], c.inventoryLocationId, Number(next), event.at],
    );
  await client.query(
    `INSERT INTO public.inventory_ledger(id,inventory_item_id,location_id,balance_version_before,balance_version_after,delta_on_hand,delta_reserved,reason_code,source_type,source_id,idempotency_key,actor_kind,admin_identity_id,occurred_at)
 VALUES($1,$2,$3,$4,$5,$6,0,$7,'ADJUSTMENT',$8,$9,'ADMIN',$10,$11)`,
    [
      ledger?.["id"],
      item["id"],
      c.inventoryLocationId,
      c.expectedBalanceVersion,
      c.expectedBalanceVersion + 1,
      c.deltaOnHand,
      c.reasonCode,
      event.id,
      `gift-inventory:${event.id}`,
      input.principal.actorId,
      event.at,
    ],
  );
  return readInventoryReceipt(client, event.id, input.principal.actorId);
}

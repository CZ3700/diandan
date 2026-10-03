import { URL } from "node:url";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readWishGiftSummary } from "../dist/wish-binding.js";

/** Run after a normal daily publication; all rejected probes roll back their transaction. */
export async function verifyWishBindingGuards({ client, wish, otherArtistId }) {
  let checks = 0;
  const check = (value, label) => {
    assert.ok(value, label);
    checks++;
  };
  async function rejects(sql, values, pattern) {
    await client.query("BEGIN");
    try {
      await assert.rejects(async () => {
        await client.query(sql, values);
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      }, pattern);
      checks++;
    } finally {
      await client.query("ROLLBACK");
    }
  }
  const summary = await readWishGiftSummary(client, wish.gift_id, "en");
  check(
    summary?.status === "AVAILABLE" && summary.artistId === wish.idol_id,
    "new wish has one available real recipient",
  );
  const allowed = (
    await client.query(
      "SELECT public.wish_recipient_allowed($1,$2) own,public.wish_recipient_allowed($1,$3) other,public.wish_recipient_allowed($1,NULL) missing",
      [wish.gift_variant_id, wish.idol_id, otherArtistId ?? randomUUID()],
    )
  ).rows[0];
  assert.deepEqual(allowed, { own: true, other: false, missing: false });
  checks++;
  await rejects(
    "UPDATE wish_bindings SET idol_id=$2 WHERE wish_id=$1",
    [wish.wish_id, otherArtistId ?? randomUUID()],
    /append.only|immutable/iu,
  );
  await rejects(
    "DELETE FROM wish_bindings WHERE wish_id=$1",
    [wish.wish_id],
    /append.only|immutable/iu,
  );
  await rejects(
    "INSERT INTO gift_variants(id,gift_id,sku,status,inventory_policy) VALUES($1,$2,$3,'active','TRACKED')",
    [randomUUID(), wish.gift_id, `WISH-${randomUUID()}`],
    /wish gift cannot change its bound variant or stock policy/u,
  );
  await rejects(
    `INSERT INTO inventory_ledger SELECT (jsonb_populate_record(NULL::inventory_ledger, to_jsonb(l) || jsonb_build_object(
    'id',$2::uuid,'source_id',$3::uuid,'idempotency_key',$3::text,'balance_version_before',l.balance_version_after,
    'balance_version_after',l.balance_version_after+1,'delta_on_hand',1,'delta_reserved',0))).*
    FROM inventory_ledger l JOIN inventory_items i ON i.id=l.inventory_item_id WHERE i.gift_variant_id=$1 AND l.delta_on_hand>0 ORDER BY l.balance_version_after DESC LIMIT 1`,
    [wish.gift_variant_id, randomUUID(), randomUUID()],
    /wish cannot be replenished or reopened/u,
  );
  await rejects(
    await readFile(
      new URL(
        "../../../database/migrations/0060_wish-bindings.down.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    [],
    /wish purchase history cannot be downgraded/u,
  );
  check(
    (
      await client.query(
        "SELECT count(*)::int n FROM wish_bindings WHERE wish_id=$1",
        [wish.wish_id],
      )
    ).rows[0].n === 1,
    "rejected writes retain the original binding",
  );
  return {
    result: "PASS",
    checks,
    scope:
      "normal published binding, recipient restriction, immutable identity, no extra variant/restock, downgrade history guard",
  };
}

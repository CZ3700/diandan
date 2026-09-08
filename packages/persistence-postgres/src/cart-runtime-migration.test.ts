import { readFile, readdir } from "node:fs/promises";
import { expect, test } from "vitest";

const migrations = new URL("../../../database/migrations/", import.meta.url);
const functionName = "assert_cart_support_intent_consistency";
const functionPattern = new RegExp(
  `CREATE(?: OR REPLACE)? FUNCTION (?:public\\.)?${functionName}\\(\\)[\\s\\S]*?\\$\\$;`,
  "u",
);
const moderationPattern =
  /CREATE(?: OR REPLACE)? FUNCTION (?:public\.)?validate_support_intent_moderation_evidence\(\)[\s\S]*?\$\$;/u;
const read = (name: string) => readFile(new URL(name, migrations), "utf8");

async function effectiveGuard() {
  let definition: string | undefined;
  for (const name of (await readdir(migrations))
    .filter((name) => /^\d{4}_.+\.up\.sql$/u.test(name))
    .sort()) {
    const found = (await read(name)).match(functionPattern)?.[0];
    if (found) definition = found;
  }
  expect(definition).toBeDefined();
  return definition!;
}

test("cart ownership accepts the actual immutable daily recipient rule without inventing an explicit relationship", async () => {
  const sql = await effectiveGuard();
  expect(sql).toContain("gift_variant_idol_eligibility");
  expect(sql).toContain("gift_variant_recipient_rules");
  expect(sql).toContain("eligibility.rule = 'ALL_ACTIVE_ARTISTS'");
  expect(sql).toMatch(/OR EXISTS\s*\(/u);
});

test("cart history consistency does not require a recipient to keep accepting gifts forever", async () => {
  const sql = await effectiveGuard();
  expect(sql).not.toMatch(
    /accepting_gifts|published_revision_id|status\s*=\s*'active'/u,
  );
  expect(sql).toContain("fan_message_ciphertext IS NOT NULL");
  expect(sql).toContain("item_mode <> intent_mode");
  expect(sql).toContain(
    "(intent_privacy_state <> 'PURGED' AND item_has_message <> intent_has_message)",
  );
  expect(sql).toContain("OR NOT is_eligible");
});

test("0023 preserves the entire historical privacy and state guard outside the recipient relation", async () => {
  const original = (
    await read("0003_inventory-cart-private-data.up.sql")
  ).match(functionPattern)![0];
  const latest = await effectiveGuard();
  const relation = / {2}SELECT EXISTS \([\s\S]*? {2}\) INTO is_eligible;/u;
  expect(
    latest
      .replace("CREATE OR REPLACE FUNCTION public.", "CREATE FUNCTION ")
      .replace(relation, original.match(relation)![0]),
  ).toBe(original);
  const migration = await read("0023_cart-runtime-recipient-rules.up.sql");
  expect(migration).not.toMatch(/(?:ALTER|DROP|CREATE)\s+(?:TABLE|TRIGGER)/iu);
});

test("rollback restores the exact old guard only when all accepted ownership remains valid", async () => {
  const original = (
    await read("0003_inventory-cart-private-data.up.sql")
  ).match(functionPattern)![0];
  const sql = await read("0023_cart-runtime-recipient-rules.down.sql");
  expect(
    sql
      .match(functionPattern)![0]
      .replace("CREATE OR REPLACE FUNCTION public.", "CREATE FUNCTION "),
  ).toBe(original);
  expect(sql).toContain(
    "JOIN public.support_intents intent ON intent.cart_item_id = item.id",
  );
  expect(sql).toContain("WHERE NOT EXISTS (");
  expect(sql).toContain("eligibility.idol_id = intent.idol_id");
  expect(sql).toContain("USING ERRCODE = '55000'");
  expect(
    sql.replace(functionPattern, "").replace(moderationPattern, ""),
  ).not.toMatch(/\b(?:DELETE|TRUNCATE|INSERT|EXECUTE)\b/iu);
});

test("pending moderation bypasses only the automated evidence gate and rollback preserves the historical function", async () => {
  const original = (
    await read("0003_inventory-cart-private-data.up.sql")
  ).match(moderationPattern)![0];
  const up = (await read("0023_cart-runtime-recipient-rules.up.sql")).match(
    moderationPattern,
  )![0];
  const down = await read("0023_cart-runtime-recipient-rules.down.sql");
  expect(
    up
      .replace("CREATE OR REPLACE FUNCTION public.", "CREATE FUNCTION ")
      .replace("IS DISTINCT FROM 'AUTOMATED'", "<> 'AUTOMATED'"),
  ).toBe(original);
  expect(
    down
      .match(moderationPattern)![0]
      .replace("CREATE OR REPLACE FUNCTION public.", "CREATE FUNCTION "),
  ).toBe(original);
  expect(down).toContain(
    "FROM public.support_intents WHERE moderation_status = 'PENDING'",
  );
  expect(down).toContain(
    "pending support intents require null-safe moderation validation",
  );
});

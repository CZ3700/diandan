import assert from "node:assert/strict";
import { test } from "node:test";
import { configureCartDailyGiftFixture } from "./cart-daily-gift-fixture.mjs";

test("repeated daily publishing reuses the same published fixture defaults", async () => {
  const scope = { market: "TEST", currency: "USD" };
  const presentation = { themeAccent: "NEUTRAL", heroTextTone: "LIGHT" };
  let stored;
  let inserts = 0;
  const input = {
    identity: { identities: { identities: { manager: "actor" } } },
    fixtures: { markets: [scope], artists: [{ acceptingGifts: true }] },
    content: {
      request: async () => ({
        snapshot: { content: { structure: presentation } },
      }),
    },
    client: {
      query: async (sql) => {
        if (sql.startsWith("SELECT") && sql.includes("management_defaults"))
          return { rows: stored ? [stored] : [] };
        if (sql.startsWith("INSERT INTO public.config_versions")) {
          assert.equal(
            inserts++,
            0,
            "configuration version must not be inserted twice",
          );
        }
        if (sql.includes("SET lifecycle='PUBLISHED'"))
          stored = {
            lifecycle: "PUBLISHED",
            ...scope,
            inventory_policy: "PROCURE_ON_DEMAND",
            inventory_location_id: null,
            eligibility_rule: "ALL_ACTIVE_ARTISTS",
            artist_presentation: presentation,
          };
        return { rows: [{ id: "permission" }] };
      },
    },
  };
  assert.deepEqual(await configureCartDailyGiftFixture(input), scope);
  assert.deepEqual(await configureCartDailyGiftFixture(input), scope);
  assert.equal(inserts, 1);
  stored.currency = "JPY";
  await assert.rejects(
    configureCartDailyGiftFixture(input),
    /published fixture defaults/u,
  );
  assert.equal(inserts, 1);
});

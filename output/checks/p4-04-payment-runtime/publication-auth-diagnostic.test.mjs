import assert from "node:assert/strict";
import test from "node:test";
const load = () =>
  import("./publication-auth-diagnostic.mjs").catch(() => null);
test("diagnostic projection emits only fixed counts and boolean facts", async () => {
  const module = await load();
  assert.equal(typeof module?.safeFacts, "function");
  assert.deepEqual(
    module.safeFacts({
      exact_join_count: 2,
      eligible_count: 1,
      future_count: 1,
      wall_before_transaction: true,
      sessionId: "private",
      token: "private",
      now: "private",
      message: "private",
    }),
    {
      exact_join_count: 2,
      eligible_count: 1,
      future_count: 1,
      wall_before_transaction: true,
    },
  );
  assert.deepEqual(
    module.safeFacts({
      exact_join_count: "secret",
      eligible_count: -1,
      future_count: Infinity,
      wall_before_transaction: "secret",
    }),
    {},
  );
});
test("recognizes only actual authorization query shapes without exposing SQL or values", async () => {
  const module = await load();
  assert.equal(typeof module?.authorizationStage, "function");
  assert.equal(
    module.authorizationStage(
      "SELECT ar.role_id FROM public.admin_identity_roles ar WHERE ar.granted_at <= clock_timestamp() AND rp.granted_at <= clock_timestamp()",
    ),
    "PERMISSION",
  );
  assert.equal(
    module.authorizationStage(
      "SELECT locale FROM public.admin_content_locale_grants WHERE admin_identity_id = $1 AND locale = ANY($2::text[]) AND revoked_at IS NULL AND granted_at <= clock_timestamp() FOR SHARE",
    ),
    "LOCALE",
  );
  assert.equal(
    module.authorizationStage("SELECT private_content FROM support_intents"),
    null,
  );
});

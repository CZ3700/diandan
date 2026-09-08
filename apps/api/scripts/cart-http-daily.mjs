import { writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { cartRuntimeResponseSchema } from "@fan-support/contracts";
import { diagnoseCartDailyGift } from "./cart-http-daily-diagnostics.mjs";
import { observeImmediateDailyCartTrial } from "./cart-http-daily-order.mjs";
import { createCartDailyGiftFixture } from "./cart-daily-gift-fixture.mjs";
import { verifyCartRuntimeRollbackProtection } from "../../../packages/persistence-postgres/scripts/cart-runtime-rollback-proof.mjs";

export async function verifyCartHttpDaily(input) {
  const { base, origin, client, fixtures, check, database, workspaceRoot } =
    input;
  const initial = {
    schemaVersion: 1,
    presentationLocale: "en",
    market: fixtures.markets[0].market,
    currency: fixtures.markets[0].currency,
  };
  const trials = [];
  const gifts = new Set();
  const sessions = new Set();
  let successful = null;
  const headers = (session) => ({
    origin,
    "content-type": "application/json",
    cookie: session.cookie,
    "x-csrf-token": session.csrf,
    "idempotency-key": randomUUID(),
  });
  const bodyFor = (gift) => ({
    ...initial,
    giftId: gift.giftId,
    giftVariantId: gift.giftVariantId,
    observedPriceId: gift.priceId,
    idolId: fixtures.artists[0].id,
    quantity: 2,
    displayMode: "anonymous",
    fanMessageLocale: "und",
  });
  const report = { schemaVersion: 1, status: "RUNNING", trials };
  const record = () =>
    writeFile(
      path.join(input.output, "daily-immediate-results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  await record();
  for (let index = 0; index < 3; index++) {
    const observed = await observeImmediateDailyCartTrial({
      initialize: async () => {
        const response = await globalThis.fetch(base + "/api/v1/carts", {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify(initial),
        });
        check(
          response.status === 200,
          "daily cart initializes before publication",
        );
        const cookie = response.headers.get("set-cookie")?.split(";")[0];
        const csrf = response.headers.get("x-csrf-token");
        check(
          Boolean(cookie && csrf),
          "daily cart receives stable session and CSRF header",
        );
        check(
          !sessions.has(cookie),
          "each immediate trial has an independent empty cart",
        );
        sessions.add(cookie);
        await response.body?.cancel();
        return { cookie, csrf };
      },
      publish: () => createCartDailyGiftFixture(input),
      add: async (gift, session) => {
        const response = await globalThis.fetch(base + "/api/v1/cart/items", {
          method: "POST",
          headers: headers(session),
          body: JSON.stringify(bodyFor(gift)),
        });
        const data = cartRuntimeResponseSchema.parse(await response.json());
        return { status: response.status, data };
      },
      diagnose: (gift) =>
        diagnoseCartDailyGift({
          base,
          persistence: input.persistence,
          gift,
          idolId: fixtures.artists[0].id,
          database,
          publicMediaBaseUrl: input.gateway.origin,
        }),
    });
    const { result, gift, error, diagnostics } = observed;
    check(
      !gifts.has(gift.giftId),
      "each immediate trial publishes a different actual gift",
    );
    gifts.add(gift.giftId);
    const passed =
      !error &&
      result.status === 200 &&
      result.data.outcome === "SUCCESS" &&
      result.data.action === "ADDED" &&
      result.data.cart.items.length === 1 &&
      result.data.cart.items[0].gift?.handle === gift.handle &&
      result.data.cart.items[0].availability.status === "AVAILABLE";
    const trial = {
      index: index + 1,
      status: passed ? "PASS" : "FAIL",
      responseStatus: result?.status ?? null,
      outcome: result?.data.outcome ?? "THREW",
      code: result?.data.outcome === "FAILURE" ? result.data.code : null,
      errorKind: error
        ? error.name === "ZodError"
          ? "INVALID_SCHEMA"
          : "REQUEST_FAILURE"
        : null,
      publishToAddMs: observed.publishToAddMs,
      publicPreReads: 0,
      diagnostics,
    };
    trials.push(trial);
    await record();
    console.log(`Cart daily immediate trial ${JSON.stringify(trial)}`);
    if (passed) {
      const counts = (
        await client.query(
          "SELECT count(*)::int AS count FROM public.support_intents s JOIN public.cart_items i ON i.id=s.cart_item_id WHERE i.id=$1 AND s.idol_id=$2",
          [result.data.cartItemId, fixtures.artists[0].id],
        )
      ).rows[0];
      check(
        counts.count === 1,
        "daily rule produces one real persisted support intent",
      );
      successful = observed;
    }
  }
  report.status = trials.every((trial) => trial.status === "PASS")
    ? "PASS"
    : "FAIL";
  await record();
  check(
    report.status === "PASS",
    "all three freshly published daily gifts add immediately without pre-read or retry",
  );
  const rejected = await globalThis.fetch(base + "/api/v1/cart/items", {
    method: "POST",
    headers: headers(successful.session),
    body: JSON.stringify({
      ...bodyFor(successful.gift),
      idolId: fixtures.artists[2].id,
    }),
  });
  const failure = cartRuntimeResponseSchema.parse(await rejected.json());
  check(
    rejected.status === 409 &&
      failure.outcome === "FAILURE" &&
      failure.code === "IDOL_UNAVAILABLE",
    "daily all-active rule still rejects a paused recipient",
  );
  const rollback = await verifyCartRuntimeRollbackProtection({
    clientConfig: database,
    workspaceRoot,
  });
  return {
    status: "PASS",
    normalDailyPublisher: true,
    immediateTrials: trials,
    actualDynamicOnlyIntents: 3,
    pausedRejected: true,
    rollback,
  };
}

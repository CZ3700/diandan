import assert from "node:assert/strict";
import { withEphemeralPostgres } from "../../../packages/persistence-postgres/dist/index.js";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";
import { withOrderPaymentFixture } from "../../../apps/api/scripts/order-payment-runtime.mjs";
import { createOrderPaymentProtocolClient } from "../../../apps/api/scripts/order-payment-client.mjs";
import { expireOrderPaymentReservations } from "../../../packages/persistence-postgres/scripts/order-payment-expiry-fixture.mjs";
import { fileURLToPath, URL } from "node:url";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const output = fileURLToPath(new URL("./", import.meta.url));
const debug = (error) => ({
  name: error?.name,
  code: error?.code,
  operator: error?.operator,
  message:
    error?.name === "AssertionError" ? error.message.split("\n")[0] : undefined,
  actual:
    typeof error.actual === "string" && /^[A-Z_]+$/.test(error.actual)
      ? error.actual
      : typeof error.actual === "number"
        ? error.actual
        : undefined,
  expected:
    typeof error.expected === "string" && /^[A-Z_]+$/.test(error.expected)
      ? error.expected
      : typeof error.expected === "number"
        ? error.expected
        : undefined,
  frames: error?.stack
    ?.split("\n")
    .filter((x) => x.includes("scripts/") || x.includes("storage-legacy"))
    .slice(0, 5),
});
try {
  if (process.argv.includes("--run")) {
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    await withEphemeralPostgres(async (database) => {
      try {
        await withOrderPaymentFixture({
          database,
          s3,
          workspaceRoot,
          output,
          check: (x, label) => assert.ok(x, label),
          progress: (label) => console.log(label),
          verify: async (context) => {
            const api = createOrderPaymentProtocolClient(context),
              short = await context.createCheckoutApi(8000);
            try {
              const late = await api.fresh({
                checkoutBase: short.base,
                lost: true,
                lines: [{ gift: context.fixtures.gifts[1] }],
              });
              const action = await context.psp.hostedAction(late.attempt.id);
              assert.equal(action?.type, "REDIRECT");
              const state = await api.state(late);
              console.log(
                "before expiry",
                JSON.stringify({
                  attempt: state.attempt_status,
                  order: state.order_status,
                  active: state.active,
                }),
              );
              console.log(
                "expiry",
                await expireOrderPaymentReservations({
                  clientConfig: database,
                  orderId: state.order_id,
                  timeoutMs: 20000,
                }),
              );
              late.attempt = { ...late.attempt, action };
              await api.settle(late);
              const event = await api.reconcile(late);
              console.log("late apply", await api.apply(event));
            } catch (error) {
              console.log("INNER_FAILURE", JSON.stringify(debug(error)));
              throw error;
            } finally {
              await short.stop();
            }
          },
        });
      } catch (error) {
        console.log("FIXTURE_FAILURE", JSON.stringify(debug(error)));
        throw error;
      }
    });
  } else
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: "--run",
        timeoutMs: 1200000,
      }),
    );
} catch (error) {
  console.error("FAIL", JSON.stringify(debug(error)));
  process.exitCode = 1;
}

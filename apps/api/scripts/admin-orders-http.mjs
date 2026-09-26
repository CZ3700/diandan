#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
import {
  createOrderNotificationUseCases,
  createAdminOrderResendUseCases,
} from "@fan-support/application";
import { createOrderNotificationTemplates } from "../../../packages/i18n/dist/notifications/index.js";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";
import { createNotificationFixtureTransport } from "../../../packages/persistence-postgres/scripts/notification-fixture.mjs";
import { withOrderAccessFixture } from "./order-access-runtime.mjs";
import { createOrderPaymentProtocolClient } from "./order-payment-client.mjs";
import { createAdminOrdersRuntime } from "./admin-orders-runtime.mjs";
import { createPaidAdminOrder } from "./admin-orders-fixtures.mjs";
import { verifyAdminOrdersProtocol } from "./admin-orders-protocol.mjs";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
function safeError(error) {
  return {
    name: /^[A-Za-z]{1,64}$/u.test(error?.name ?? "") ? error.name : null,
    code: /^[A-Z0-9_]{1,64}$/u.test(error?.code ?? "") ? error.code : null,
    frames: String(error?.stack ?? "")
      .split("\n")
      .slice(1, 8)
      .map(
        (line) =>
          /\/(?:apps|packages)\/[A-Za-z0-9_./-]+:\d+:\d+/u.exec(line)?.[0],
      )
      .filter(Boolean),
  };
}
async function run(database, s3, ui) {
  const output = path.join(
    workspaceRoot,
    "output/checks/p5-02-order-operations",
    `integration-${new Date().toISOString().replaceAll(":", "-")}`,
  );
  await mkdir(output, { recursive: true, mode: 0o700 });
  let assertions = 0,
    stage = "seed",
    status = "FAIL";
  const check = (condition, label) => {
    assertions++;
    if (!condition) stage = label;
    assert.ok(condition, label);
  };
  const progress = (value) => {
    stage = value;
    console.log(`Admin orders: ${value}`);
  };
  try {
    await withOrderAccessFixture({
      database,
      s3,
      workspaceRoot,
      output,
      check,
      progress,
      verify: async (original) => {
        const context = { ...original, workspaceRoot, s3 };
        progress("OIDC and admin orders API composition");
        const runtime = await createAdminOrdersRuntime(context),
          payment = createOrderPaymentProtocolClient(context);
        const protocol = await verifyAdminOrdersProtocol(
          context,
          runtime,
          payment,
        );
        progress("durable original notification preparation");
        const transport = createNotificationFixtureTransport(),
          configuration = {
            schemaVersion: 1,
            siteName: "TEST Support",
            publicStorefrontOrigin: context.origin,
            transportKey: transport.transportKey,
            linkPepperVersion: "test-mac",
            linkTtlSeconds: 3600,
            idempotencyRetentionSeconds: 3600,
            leaseSeconds: 30,
            retryDelaySeconds: 1,
            maxAttempts: 6,
          };
        const common = {
          keyManagement: context.kms.adapter,
          templates: createOrderNotificationTemplates({ mode: "TEST_DRAFT" }),
          transportForKey: (key) =>
            key === transport.transportKey ? transport.transport : undefined,
          configuration,
        };
        const notifications = createOrderNotificationUseCases({
            ...common,
            transactions: context.persistence.notificationTransactionManager,
          }),
          resends = createAdminOrderResendUseCases({
            ...common,
            transactions:
              context.persistence
                .adminOrderResendNotificationTransactionManager,
          });
        async function flushNotifications() {
          const sources = (
            await context.client.query(
              "SELECT id FROM outbox_events WHERE event_type IN('ORDER_PAYMENT_CONFIRMED','FULFILLMENT_STATUS_CHANGED') ORDER BY occurred_at,id",
            )
          ).rows;
          for (const source of sources) await notifications.request(source.id);
          for (let i = 0; i < 5; i++) {
            await notifications.runPending(100);
            await resends.runPending(100);
          }
        }
        await flushNotifications();
        if (ui) {
          progress("browser fixture through real checkout");
          const review = await createPaidAdminOrder(context, payment, {
            locale: "ja",
          });
          let count = Number(
            (await context.client.query("SELECT count(*) FROM orders")).rows[0]
              .count,
          );
          while (count < 13) {
            await createPaidAdminOrder(context, payment, { noMessage: true });
            count++;
          }
          await flushNotifications();
          const hold = (
            await context.client.query(
              "SELECT public_order_id FROM orders WHERE id=$1",
              [protocol.holdOrderId],
            )
          ).rows[0];
          const fixture = {
            mediaOrigins: [context.gateway.origin],
            reviewOrderId: review.orderId,
            reviewPublicOrderId: review.checkout.publicOrderId,
            reviewLocale: "ja",
            privateMessage: payment.canaries[0],
            privateDisplayName: payment.canaries[1],
            holdOrderId: protocol.holdOrderId,
            holdPublicOrderId: hold.public_order_id,
            searchPublicOrderId: review.checkout.publicOrderId,
            totalOrders: count,
          };
          progress("seven-language real browser acceptance");
          await runtime.startBrowser();
          const { verifyAdminOrdersBrowser } =
            await import("./admin-orders-browser.mjs");
          const report = await verifyAdminOrdersBrowser({
            ...runtime,
            output,
            check,
            fixture,
            flushNotifications,
            readFacts: async () => ({
              notificationsAccepted: transport.acceptedCount(),
              notes: Number(
                (
                  await context.client.query(
                    "SELECT count(*) FROM admin_order_notes",
                  )
                ).rows[0].count,
              ),
              reviews: Number(
                (
                  await context.client.query(
                    "SELECT count(*) FROM admin_order_message_reviews",
                  )
                ).rows[0].count,
              ),
              fulfilled: Number(
                (
                  await context.client.query(
                    "SELECT count(*) FROM fulfillments WHERE status='DELIVERED'",
                  )
                ).rows[0].count,
              ),
            }),
          });
          await writeFile(
            path.join(output, "browser.json"),
            JSON.stringify(report, null, 2) + "\n",
          );
        }
        progress("privacy and audit assertions");
        await runtime.assertPrivacy();
        check(
          payment.canaries.every(
            (value) => !context.logLines.some((line) => line.includes(value)),
          ),
          "shared API and worker logs exclude message, nickname and email",
        );
        await writeFile(
          path.join(output, "scope.json"),
          JSON.stringify(
            {
              schemaVersion: 1,
              protocol: "REAL_POSTGRES_TLS_OIDC_TEST_PSP",
              browser: ui,
              realMoney: false,
              realMailProvider: false,
              transport:
                "TEST in-process for UI; durable HTTPS resend acceptance is independent",
              sourceRevision: "working candidate",
            },
            null,
            2,
          ) + "\n",
        );
      },
    });
    status = "PASS";
    console.log(`PASS admin orders ${assertions}; ${output}`);
  } catch (error) {
    await writeFile(
      path.join(output, "failure.json"),
      JSON.stringify({ stage, assertions, ...safeError(error) }, null, 2) +
        "\n",
    );
    console.error(
      `Admin orders failure ${JSON.stringify({ stage, ...safeError(error) })}`,
    );
    throw error;
  } finally {
    await writeFile(
      path.join(output, "run-result.json"),
      JSON.stringify(
        { status, assertions, stage, completedAt: new Date().toISOString() },
        null,
        2,
      ) + "\n",
    );
  }
}
try {
  if (process.argv[2]?.startsWith("--run-admin-orders")) {
    // Only this owned UI fixture process resolves its reserved administrative host.
    if (process.argv[2].endsWith("-ui"))
      await import("./admin-access-test-dns.mjs");
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    await withEphemeralPostgres((database) =>
      run(database, s3, process.argv[2].endsWith("-ui")),
    );
  } else
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: process.argv.includes("--ui")
          ? "--run-admin-orders-ui"
          : "--run-admin-orders",
        timeoutMs: 1200000,
      }),
    );
} catch (error) {
  console.error(`FAIL admin orders ${JSON.stringify(safeError(error))}`);
  process.exitCode = 1;
}

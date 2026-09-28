#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";
import { runOrderNotifications } from "../../../packages/persistence-postgres/scripts/notification-integration.mjs";
import { createTestWorkerNotifications } from "../dist/notification-composition.js";
import { createZeptoMailNotificationHarness } from "./notification-zeptomail-harness.mjs";
import { verifyNotificationWorker } from "./notification-worker-fixture.mjs";

export async function verifyZeptoMailWorker(context) {
  const worker = await verifyNotificationWorker(context, {
    createHarness: async (options) => {
      const native = await createZeptoMailNotificationHarness(options);
      return {
        ...native,
        inspect: async () => {
          const proof = await native.inspect();
          context.check(
            proof.requestCount === 1 && proof.acceptedCount === 1,
            "native receiver performs exactly one POST without supplier deduplication",
          );
          context.check(
            proof.singleRecipient && proof.trackingDisabled,
            "native mail has one recipient and disables link and open tracking",
          );
          return proof;
        },
      };
    },
    prepareNotifications:
      ({ gateway, captureEmail }) =>
      (dependencies) =>
        createTestWorkerNotifications({
          environment: "TEST",
          configuration: {
            schemaVersion: 1,
            siteName: "TEST Support",
            publicStorefrontOrigin: context.origin,
            activeProfile: "native",
            profiles: [
              {
                name: "native",
                credentialEnvironmentVariable: "LOCAL_MAIL_TOKEN",
                profile: gateway.profile,
              },
            ],
            linkPepperVersion: "test-mac",
            acceptedPepperVersions: ["test-mac"],
            linkTtlSeconds: 3600,
            leaseSeconds: 30,
            retryDelaySeconds: 1,
            maxAttempts: 6,
            incidentFallbackLocales: [],
          },
          credentials: { LOCAL_MAIL_TOKEN: "local-fixture-credential-only" },
          keyManagement: context.kms.adapter,
          transactions: dependencies.notificationTransactionManager,
          resendTransactions:
            dependencies.adminOrderResendNotificationTransactionManager,
          submissionTransactions:
            dependencies.notificationSubmissionTransactionManager,
          submissionFactory: () => ({
            transportKey: gateway.transportKey,
            submitter: {
              sendEmail: async (command) => {
                captureEmail(command);
                return gateway.submitter.sendEmail(command);
              },
            },
          }),
        }),
  });
  const { rows } = await context.client.query(
    "SELECT count(*)::int count FROM notification_submissions WHERE status='COMPLETE' AND result->>'outcome'='SUCCESS'",
  );
  context.check(
    rows[0].count === 1,
    "native Worker acceptance is committed to the PostgreSQL submission journal",
  );
  return {
    ...worker,
    nativeZeptoMailProtocol: true,
    actualWorkerNotificationComposition: true,
    actualSubmissionJournal: true,
  };
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "--run-zeptomail") {
      const s3 = readEphemeralS3Config();
      await prepareEphemeralS3Buckets(s3);
      await withEphemeralPostgres((database) =>
        runOrderNotifications(database, s3, {
          verifyWorker: verifyZeptoMailWorker,
          outputRoot: "output/checks/l3-zeptomail/integration",
        }),
      );
    } else {
      assert.equal(process.argv.length, 2);
      await withEphemeralS3((context) =>
        runS3IntegrationChild({
          ...context,
          scriptUrl: import.meta.url,
          argument: "--run-zeptomail",
          timeoutMs: 1200000,
        }),
      );
    }
  } catch (error) {
    // Never persist provider bodies, links, addresses or underlying request details.
    console.error(
      `FAIL native mail integration ${JSON.stringify({ name: /^[A-Za-z]{1,64}$/u.test(error?.name ?? "") ? error.name : null })}`,
    );
    process.exitCode = 1;
  }
}

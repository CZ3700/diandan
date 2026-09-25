import { createServer } from "node:http";
import {
  createOrderNotificationUseCases,
  createAdminOrderResendUseCases,
} from "@fan-support/application";
import { createOrderNotificationTemplates } from "@fan-support/i18n/notifications";
import { createStructuredLogger } from "@fan-support/observability";
import { startNodeTelemetry } from "@fan-support/observability/node";
import { createWorkerReliableEventsComposition } from "../../worker/dist/reliable-events-composition.js";
import { createWorkerMediaProcessingComposition } from "../../worker/dist/media-processing-composition.js";
import { createTestManagementCenterComposition } from "../dist/test-management-center-composition.js";
import { createLocalExperienceKms } from "./local-experience-kms.mjs";
import { createLocalExperienceMedia } from "./local-experience-runtime-media.mjs";
import {
  localExperienceEnvironment,
  localSecretHex,
} from "./local-experience-runtime-config.mjs";
import { createLocalTestFulfillmentProvisioner } from "./local-experience-provisioning.mjs";
import { localExperienceConfigSchema } from "./local-experience-config.mjs";
import { parseLocalBusiness } from "./local-experience-bootstrap-state.mjs";

/** Actual persistent queue consumers and image/publication work, with explicitly TEST mail and fulfillment infrastructure. */
export async function startLocalExperienceWorker({
  config: inputConfig,
  database,
  s3,
  business: inputBusiness,
  mail,
  own,
  logger = createStructuredLogger({ service: "worker" }),
}) {
  const config = localExperienceConfigSchema.parse(inputConfig);
  const business = parseLocalBusiness(inputBusiness, config);
  const telemetry = startNodeTelemetry({ service: "worker" });
  own("local worker telemetry", () => telemetry.shutdown());
  const environment = localExperienceEnvironment({ config, database, s3 });
  const kms = createLocalExperienceKms({
    environment: "TEST",
    masterKey: config.secrets.kmsMasterKey,
    macKey: config.secrets.kmsMacKey,
  });
  own("local worker TEST KMS", async () => kms.close());
  const management = createTestManagementCenterComposition({
    environment: "TEST",
    database,
    tokenPepper: localSecretHex(config.secrets.tokenPepper),
    allowedOrigin: config.origins.admin,
    publicMediaBaseUrl: config.origins.media,
    ...createLocalExperienceMedia({ config, s3 }),
    leaseSeconds: 300,
  });
  own("local worker management processing", () =>
    management.managementCenterRuntime.stop(),
  );
  const profile = mail.profile;
  const reliable = createWorkerReliableEventsComposition(environment, {
    logger,
    factories: {
      prepareNotifications: () => (dependencies) => {
        const shared = {
          keyManagement: kms.adapter,
          templates: createOrderNotificationTemplates({ mode: "TEST_DRAFT" }),
          transportForKey: (key) =>
            key === mail.transportKey ? mail.transport : undefined,
          configuration: {
            schemaVersion: 1,
            siteName: "Local TEST",
            publicStorefrontOrigin: config.origins.storefront,
            transportKey: mail.transportKey,
            linkPepperVersion: "test-mac",
            linkTtlSeconds: 86400,
            idempotencyRetentionSeconds: profile.idempotencyRetentionSeconds,
            leaseSeconds: 30,
            retryDelaySeconds: 5,
            maxAttempts: 6,
          },
          onNotice: (code) =>
            logger.warn("local_notification.notice", {
              errorCode: code,
              outcome: "failure",
            }),
        };
        const automatic = createOrderNotificationUseCases({
          ...shared,
          transactions: dependencies.notificationTransactionManager,
        });
        const manual = createAdminOrderResendUseCases({
          ...shared,
          transactions:
            dependencies.adminOrderResendNotificationTransactionManager,
        });
        return {
          ...automatic,
          async runPending(limit) {
            const first = await automatic.runPending(limit),
              second = await manual.runPending(limit);
            return {
              schemaVersion: 1,
              scanned: first.scanned + second.scanned,
              sent: first.sent + second.sent,
              scheduled: first.scheduled + second.scheduled,
              failed: first.failed + second.failed,
              skipped: first.skipped + second.skipped,
            };
          },
        };
      },
    },
  });
  own("local worker reliable events", () => reliable.stop());
  const mediaWorker = await createWorkerMediaProcessingComposition(
    environment,
    { logger },
  );
  own("local worker strict media processing", () => mediaWorker.stop());
  const fulfillment = createLocalTestFulfillmentProvisioner({
    environment: "TEST",
    database,
    operatorId: business.managerId,
    keyManagement: kms.adapter,
    onFailure: (code) =>
      logger.warn("local_fulfillment.notice", {
        errorCode: code,
        outcome: "failure",
      }),
  });
  own("local worker synthetic fulfillment", () => fulfillment.stop());
  await reliable.start();
  await mediaWorker.start();
  await management.managementCenterRuntime.start();
  await fulfillment.start();
  const health = createServer((request, response) => {
    response.setHeader("cache-control", "private, no-store");
    response.setHeader("content-type", "application/json");
    if (request.method !== "GET" || request.url !== "/healthz") {
      response.writeHead(404).end();
      return;
    }
    response.end(
      JSON.stringify({
        schemaVersion: 1,
        service: "worker",
        status: "ok",
        environment: "TEST",
      }),
    );
  });
  await new Promise((resolve, reject) => {
    health.once("error", reject);
    health.listen(config.ports.worker, "127.0.0.1", resolve);
  });
  own("local worker health", async () => {
    health.closeAllConnections();
    await new Promise((resolve, reject) =>
      health.close((error) => (error ? reject(error) : resolve())),
    );
  });
  return { healthUrl: `http://127.0.0.1:${config.ports.worker}/healthz` };
}

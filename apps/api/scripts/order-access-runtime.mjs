import { createStructuredLogger } from "@fan-support/observability";
import { createApiApplication } from "../dist/bootstrap.js";
import { createTestOrderAccessComposition } from "../dist/testing/order-access-composition.js";
import { createOrderAccessCredentials } from "../dist/order-access-credentials.js";
import { preflightEnvironment } from "./publication-preflight-http-fixtures.mjs";
import { publicationMediaEnvironment } from "./publication-runtime-http-media.mjs";
import { createOrderAccessMediaGateway } from "./order-access-media.mjs";
import { withOrderPaymentFixture } from "./order-payment-runtime.mjs";

/** Real order-access API instances share the existing paid-order PG fixture; no business rows are seeded. */
export async function withOrderAccessFixture(options) {
  return withOrderPaymentFixture({
    ...options,
    verify: async (context) => {
      const configuration = {
        schemaVersion: 1,
        publicStorefrontOrigin: context.origin,
        linkTtlSeconds: 3600,
        sessionTtlSeconds: 3600,
        rateLimit: {
          windowSeconds: 2,
          exchangeMax: 10000,
          bootstrapMax: 10000,
          readMax: 10000,
          revokeMax: 10000,
        },
      };
      const credentials = createOrderAccessCredentials({
        activePepperVersion: "test-mac",
        pepperVersions: ["test-mac"],
        keyManagement: context.kms.adapter,
      });
      async function createAccessApi({
        config = configuration,
        publicMediaBaseUrl = context.gateway.origin,
        createPersistence,
        activePepperVersion = "test-mac",
        pepperVersions = ["test-mac"],
      } = {}) {
        const composition = createTestOrderAccessComposition(
          {
            environment: "TEST",
            database: context.database,
            publicMediaBaseUrl,
            keyManagement: context.kms.adapter,
            activePepperVersion,
            pepperVersions,
            configuration: config,
          },
          createPersistence ? { createPersistence } : {},
        );
        let closed = false;
        context.own("order access composition", () =>
          closed ? undefined : composition.orderAccessRuntime.stop(),
        );
        const app = await createApiApplication(
          {
            ...publicationMediaEnvironment(
              preflightEnvironment(context.database),
              options.s3,
            ),
            FAN_SUPPORT_SITE_ORIGIN: context.origin,
            FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN: publicMediaBaseUrl,
          },
          {
            ...composition,
            logger: createStructuredLogger({
              service: "api",
              write: (line) => context.logLines.push(line),
            }),
          },
        );
        const stop = async () => {
          if (!closed) {
            await app.close();
            closed = true;
          }
        };
        context.own("order access API", stop);
        await app.listen(0, "127.0.0.1");
        return { base: await app.getUrl(), stop, composition };
      }
      async function createHistoricalMediaGateway() {
        const gateway = await createOrderAccessMediaGateway({
          s3: options.s3,
          configPath: process.env.FAN_SUPPORT_MEDIA_S3_TEST_CONFIG,
        });
        context.own("historical order replacement media gateway", () =>
          gateway.close(),
        );
        const assets = (
          await context.client.query(
            "SELECT idol_portrait_asset_id AS id FROM order_items UNION SELECT gift_image_asset_id AS id FROM order_items",
          )
        ).rows;
        for (const asset of assets)
          await gateway.allowPublishedAsset(context.client, asset.id);
        return gateway;
      }
      const api = await createAccessApi();
      return options.verify({
        ...context,
        configuration,
        credentials,
        accessBase: api.base,
        createAccessApi,
        createHistoricalMediaGateway,
      });
    },
  });
}

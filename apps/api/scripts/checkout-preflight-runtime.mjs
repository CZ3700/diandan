import { createStructuredLogger } from "@fan-support/observability";
import { createApiApplication } from "../dist/bootstrap.js";
import { createTestCheckoutPreflightComposition } from "../dist/testing/checkout-composition.js";
import { withCartStorefrontFixture } from "./cart-storefront-runtime.mjs";
import { publicationMediaEnvironment } from "./publication-runtime-http-media.mjs";
import { preflightEnvironment } from "./publication-preflight-http-fixtures.mjs";
import { seedCheckoutFulfillmentProfiles } from "./checkout-preflight-fixtures.mjs";

/** Reuses the real normal publication/cart fixture without starting or rebuilding Next. */
export async function withCheckoutPreflightFixture(options) {
  return withCartStorefrontFixture({
    ...options,
    verify: async (context) => {
      const profiles = await seedCheckoutFulfillmentProfiles(context);
      const logger = createStructuredLogger({
        service: "api",
        write: (value) => context.logLines.push(value),
      });
      async function createCheckoutApi(preflightTtlMs) {
        const composition = createTestCheckoutPreflightComposition({
          environment: "TEST",
          database: context.database,
          allowedOrigin: context.origin,
          publicMediaBaseUrl: context.gateway.origin,
          keyManagement: context.kms.adapter,
          activePepperVersion: "test-mac",
          pepperVersions: ["test-mac"],
          ...(preflightTtlMs === undefined ? {} : { preflightTtlMs }),
        });
        let closed = false;
        context.own("checkout composition", () =>
          closed ? undefined : composition.checkoutPreflightRuntime.stop(),
        );
        const app = await createApiApplication(
          {
            ...publicationMediaEnvironment(
              preflightEnvironment(context.database),
              options.s3,
            ),
            FAN_SUPPORT_SITE_ORIGIN: context.origin,
            FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN:
              context.gateway.origin,
          },
          { ...composition, logger },
        );
        context.own("checkout API", async () => {
          await app.close();
          closed = true;
        });
        await app.listen(0, "127.0.0.1");
        return {
          base: await app.getUrl(),
          stop: async () => {
            if (!closed) {
              await app.close();
              closed = true;
            }
          },
        };
      }
      const checkout = await createCheckoutApi();
      return options.verify({
        ...context,
        workspaceRoot: options.workspaceRoot,
        checkoutBase: checkout.base,
        createCheckoutApi,
        profiles,
      });
    },
  });
}

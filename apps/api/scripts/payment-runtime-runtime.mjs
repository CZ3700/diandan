import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createStructuredLogger } from "@fan-support/observability";
import { createPersistentTestPaymentProvider } from "@fan-support/payment-fake/persistent-http";
import { createApiApplication } from "../dist/bootstrap.js";
import { createTestPaymentRuntimeComposition } from "../dist/payment-runtime-composition.js";
import { publicationMediaEnvironment } from "./publication-runtime-http-media.mjs";
import { preflightEnvironment } from "./publication-preflight-http-fixtures.mjs";
import { withCheckoutPreflightFixture } from "./checkout-preflight-runtime.mjs";
import { createPaymentTestTls } from "./payment-runtime-tls.mjs";
import { createPaymentTestDatabase } from "./payment-runtime-psp-database.mjs";
import { startPaymentTestPspProcess } from "./payment-runtime-psp-process.mjs";
import {
  createPaymentStorefrontTlsGateway,
  createPaymentApiGateway,
} from "./payment-runtime-gateway.mjs";
import { seedPaymentRuntimeConfiguration } from "./payment-runtime-config-fixture.mjs";

export async function withPaymentRuntimeFixture(options) {
  const tls = await createPaymentTestTls({
    caDirectory: path.dirname(process.env.FAN_SUPPORT_MEDIA_S3_TEST_CONFIG),
  });
  let storefront;
  try {
    storefront = await createPaymentStorefrontTlsGateway(
      tls.certificates["storefront.example.invalid"],
    );
    return await withCheckoutPreflightFixture({
      ...options,
      storefrontOrigin: storefront.origin,
      verify: async (context) => {
        const ownedDatabase = await createPaymentTestDatabase(context.database);
        context.own("independent TEST PSP PostgreSQL database", () =>
          ownedDatabase.close(),
        );
        const authorizationToken = randomBytes(32).toString("base64url");
        const binding = {
          schemaVersion: 1,
          providerAccountId: randomUUID(),
          providerCode: "fake",
          environment: "TEST",
          localeMapping: Object.fromEntries(
            SUPPORTED_LOCALES.map((locale) => [
              locale,
              { providerLocale: "en", fallbackUsed: locale !== "en" },
            ]),
          ),
          allowedActionOrigins: [],
        };
        const pspOptions = {
          database: ownedDatabase.database,
          binding,
          returnOrigin: context.origin,
          authorizationToken,
          ...tls.certificates["payments.example.invalid"],
        };
        let psp = await startPaymentTestPspProcess(pspOptions);
        context.own("owned persistent TEST PSP process", () => psp.close());
        const configuration = {
          schemaVersion: 1,
          publicStorefrontOrigin: context.origin,
          leaseMs: 2000,
          recoveryDelayMs: 1000,
          actionTtlMs: 60_000,
          returnStateTtlMs: 900_000,
          recoveryBatchSize: 4,
        };
        const registration = {
          configuration: psp.binding,
          provider: createPersistentTestPaymentProvider({
            binding: psp.binding,
            endpointOrigin: psp.origin,
            returnOrigin: context.origin,
            authorizationToken,
            fetcher: tls.fetcher,
            timeoutMs: 5000,
          }),
        };
        const published = await seedPaymentRuntimeConfiguration({
          client: context.client,
          identity: context.identity,
          bindings: [psp.binding],
          configuration,
          scope: { ...context.fixtures.markets[0], country: "US" },
          check: options.check,
        });
        const logger = createStructuredLogger({
          service: "api",
          write: (value) => context.logLines.push(value),
        });
        async function createPaymentApi({
          recovery = true,
          createPersistence,
        } = {}) {
          const composition = createTestPaymentRuntimeComposition(
            {
              environment: "TEST",
              database: context.database,
              publicMediaBaseUrl: context.gateway.origin,
              keyManagement: context.kms.adapter,
              activePepperVersion: "test-mac",
              pepperVersions: ["test-mac"],
              configuration,
              providers: [registration],
            },
            createPersistence ? { createPersistence } : {},
          );
          let closed = false;
          context.own("payment composition", () =>
            closed ? undefined : composition.paymentRuntime.stop(),
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
            {
              paymentRuntimeRoute: composition.paymentRuntimeRoute,
              paymentRuntime: recovery
                ? composition.paymentRuntime
                : {
                    start: async () => undefined,
                    stop: () => composition.paymentRuntime.stop(),
                  },
              logger,
            },
          );
          const stop = async () => {
            if (!closed) {
              await app.close();
              closed = true;
            }
          };
          context.own("owned payment API", stop);
          await app.listen(0, "127.0.0.1");
          return { base: await app.getUrl(), stop };
        }
        const payment = await createPaymentApi({ recovery: false });
        const proxy = await createPaymentApiGateway({
          cartBase: context.base,
          checkoutBase: context.checkoutBase,
          paymentBase: payment.base,
        });
        context.own("owned payment API transport gateway", () => proxy.close());
        return options.verify({
          ...context,
          tls,
          storefront,
          proxy,
          paymentBase: payment.base,
          createPaymentApi,
          configuration,
          published,
          psp: {
            get origin() {
              return psp.origin;
            },
            get pid() {
              return psp.pid;
            },
            arm: (value) => psp.arm(value),
            counts: () => psp.counts(),
            observations: () => psp.observations(),
            async restart() {
              const port = Number(new globalThis.URL(psp.origin).port),
                oldPid = psp.pid;
              await psp.close();
              psp = await startPaymentTestPspProcess({ ...pspOptions, port });
              context.check(
                psp.pid !== oldPid,
                "Owned TEST PSP process restarts with distinct PID and the same persistent database",
              );
            },
          },
        });
      },
    });
  } finally {
    await storefront?.close();
    await tls.close();
  }
}

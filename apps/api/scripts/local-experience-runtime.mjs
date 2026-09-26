import { Buffer } from "node:buffer";
import { createStructuredLogger } from "@fan-support/observability";
import { startNodeTelemetry } from "@fan-support/observability/node";
import { PAYMENT_PROVIDER_OPERATIONS } from "@fan-support/payment-port";
import { createFakePaymentWebhookVerifier } from "@fan-support/payment-fake";
import { createPersistentTestPaymentProvider } from "@fan-support/payment-fake/persistent-http";
import { createApiApplication } from "../dist/bootstrap.js";
import {
  createTestAdminWorkspaceComposition,
  createTestContentAuthoringComposition,
  createTestBaseContentComposition,
  createTestAdminContentComposition,
  createTestResourceManagementComposition,
  createTestPublicationPreflightComposition,
  createTestPublicationRuntimeComposition,
  createTestGiftCommerceComposition,
  createTestManagementCenterComposition,
  createLocalOidcAdminAccessComposition,
  createLocalAdminOrdersComposition,
  createLocalAdminFinanceComposition,
  createLocalAdminPaymentConfigurationComposition,
  createLocalAdminExceptionsComposition,
} from "../dist/testing/index.js";
import { createPublishedContentComposition } from "../dist/published-content-composition.js";
import { createCatalogDirectoryComposition } from "../dist/catalog-directory-composition.js";
import { createTestCartRuntimeComposition } from "../dist/testing/cart-composition.js";
import { createTestCheckoutPreflightComposition } from "../dist/testing/checkout-composition.js";
import { createTestPaymentRuntimeComposition } from "../dist/testing/payment-runtime-composition.js";
import { createTestOrderAccessComposition } from "../dist/testing/order-access-composition.js";
import { createApiReliableEventsComposition } from "../dist/reliable-events-composition.js";
import { createLocalExperienceKms } from "./local-experience-kms.mjs";
import { createLocalExperienceMedia } from "./local-experience-runtime-media.mjs";
import {
  localExperienceEnvironment,
  localSecretHex,
} from "./local-experience-runtime-config.mjs";
import { startLocalExperienceWorkerProcess } from "./local-experience-worker-process.mjs";
import { localExperienceConfigSchema } from "./local-experience-config.mjs";
import { parseLocalBusiness } from "./local-experience-bootstrap-state.mjs";

/** One canonical API shares PostgreSQL and real media with every local application. It never seeds or replaces business rows. */
export async function startLocalExperienceRuntime({
  workspaceRoot,
  stateDirectory,
  config: inputConfig,
  database,
  s3,
  services,
  business: inputBusiness,
  own,
  progress = () => undefined,
  startWorker = true,
}) {
  const config = localExperienceConfigSchema.parse(inputConfig);
  const business = parseLocalBusiness(inputBusiness, config);
  // The canonical HTTP hooks need a valid request span before they can enqueue trusted webhook evidence.
  const telemetry = startNodeTelemetry({ service: "api" });
  own("local API telemetry", () => telemetry.shutdown());
  const environment = localExperienceEnvironment({ config, database, s3 });
  if (!business.endpoint)
    throw new TypeError("Local payment bootstrap is incomplete");
  const logger = createStructuredLogger({ service: "api" });
  const kms = createLocalExperienceKms({
    environment: "TEST",
    masterKey: config.secrets.kmsMasterKey,
    macKey: config.secrets.kmsMacKey,
  });
  own("local API TEST KMS", async () => kms.close());
  const tokenPepper = localSecretHex(config.secrets.tokenPepper);
  const common = {
    environment: "TEST",
    database,
    tokenPepper,
    allowedOrigin: config.origins.admin,
  };
  const localAdmin = { ...common, environment: "LOCAL_OIDC" };
  const commerce = {
    environment: "TEST",
    database,
    allowedOrigin: config.origins.storefront,
    publicMediaBaseUrl: config.origins.media,
    keyManagement: kms.adapter,
    activePepperVersion: "test-mac",
    pepperVersions: ["test-mac"],
  };
  const media = createLocalExperienceMedia({ config, s3 });
  const components = [];
  let appClosed = false;
  function add(component) {
    components.push(component);
    for (const [name, lifecycle] of Object.entries(component)) {
      if (
        (name.endsWith("Runtime") || name.endsWith("Lifecycle")) &&
        typeof lifecycle?.stop === "function"
      )
        own(`local API ${name}`, () =>
          appClosed ? undefined : lifecycle.stop(),
        );
    }
    return component;
  }
  const identity = config.services.oidc;
  const settings = {
    schemaVersion: 1,
    issuer: services.oidc.issuer,
    clientId: identity.clientId,
    redirectUri: `${config.origins.admin}/api/admin/auth/callback`,
    policyVersion: "local-experience-mfa-v1",
    loginTtlSeconds: 300,
    sessionTtlSeconds: 3600,
    maxAuthenticationAgeSeconds: 300,
  };
  add(
    createLocalOidcAdminAccessComposition(
      {
        ...localAdmin,
        settings,
        accessKey: localSecretHex(config.secrets.accessKey),
        subjectPepper: localSecretHex(config.secrets.subjectPepper),
        provider: {
          issuer: settings.issuer,
          clientId: settings.clientId,
          redirectUri: settings.redirectUri,
          clientAuthentication: {
            method: "CLIENT_SECRET_BASIC",
            secret: identity.clientSecret,
          },
          mfa: {
            acceptedAcrValues: [identity.acr],
            requiredAmrValues: identity.amr,
          },
        },
      },
      { identityTransport: { fetch: services.oidc.fetch } },
    ),
  );
  add(createPublishedContentComposition(environment, { logger }));
  add(createCatalogDirectoryComposition(environment, { logger }));
  add(
    createTestAdminWorkspaceComposition({
      ...common,
      publicMediaBaseUrl: config.origins.media,
      storage: media.storage,
    }),
  );
  add(createTestContentAuthoringComposition(common));
  add(createTestBaseContentComposition(common));
  add(createTestAdminContentComposition(common));
  add(createTestResourceManagementComposition({ ...common, ...media }));
  add(createTestPublicationPreflightComposition(common));
  add(
    createTestPublicationRuntimeComposition({
      ...common,
      publicMediaBaseUrl: config.origins.media,
    }),
  );
  add(
    createTestGiftCommerceComposition({
      ...common,
      publicMediaBaseUrl: config.origins.media,
    }),
  );
  const management = createTestManagementCenterComposition({
    ...common,
    ...media,
    publicMediaBaseUrl: config.origins.media,
    leaseSeconds: 300,
  });
  // Only the independent worker starts the processing loop; this process owns the authenticated route and its pool.
  add({
    ...management,
    managementCenterRuntime: {
      start: async () => undefined,
      stop: () => management.managementCenterRuntime.stop(),
    },
  });
  add(createTestCartRuntimeComposition(commerce));
  add(createTestCheckoutPreflightComposition(commerce));
  add(
    createTestOrderAccessComposition({
      ...commerce,
      configuration: {
        schemaVersion: 1,
        publicStorefrontOrigin: config.origins.storefront,
        linkTtlSeconds: 86400,
        sessionTtlSeconds: 3600,
        rateLimit: {
          windowSeconds: 60,
          exchangeMax: 60,
          bootstrapMax: 60,
          readMax: 1000,
          revokeMax: 60,
        },
      },
    }),
  );
  const binding = services.psp.binding;
  const paymentFactory = {
    descriptor: {
      schemaVersion: 1,
      adapterKey: "fake",
      adapterVersion: "1.0.0",
      protocol: "persistent-test-v1",
      supportedOperations: [...PAYMENT_PROVIDER_OPERATIONS],
      supportedInstrumentKinds: ["CARD"],
      idempotency: {
        retention: "DURABLE",
        minimumRetentionSeconds: 0,
        referenceLookup: true,
      },
    },
    create: (connection) => ({
      configuration: connection.binding,
      provider: createPersistentTestPaymentProvider({
        binding: connection.binding,
        endpointOrigin: services.psp.origin,
        returnOrigin: config.origins.storefront,
        authorizationToken: config.services.psp.authorizationToken,
        fetcher: services.psp.fetcher,
        timeoutMs: 5000,
      }),
    }),
  };
  const healthPolicy = {
    schemaVersion: 1,
    providerAccountId: binding.providerAccountId,
    environment: "TEST",
    version: 1,
    failureThreshold: 3,
    failureWindowMs: 60000,
    openDurationMs: 30000,
    probeLeaseMs: 5000,
    probeRetryMs: 1000,
  };
  const configuration = add(
    createLocalAdminPaymentConfigurationComposition({
      ...localAdmin,
      connections: [
        {
          schemaVersion: 1,
          binding,
          adapterVersion: "1.0.0",
          protocol: "persistent-test-v1",
          apiOrigin: services.psp.origin,
          returnOrigin: config.origins.storefront,
          merchantAccount: `local-test-${config.instanceId}`,
          credentialRef: `secret-ref:v1:test:local/${binding.providerAccountId}`,
          timeoutMs: 5000,
          instruments: [
            {
              kind: "CARD",
              paymentMethod: "fake_card",
              brands: ["VISA", "MASTERCARD"],
              authentication: "PSP_MANAGED_3DS",
              capture: "AUTOMATIC",
            },
          ],
        },
      ],
      factories: [paymentFactory],
      healthPolicies: [healthPolicy],
      refreshDelayMs: 1000,
    }),
  );
  add(
    createTestPaymentRuntimeComposition({
      ...commerce,
      configuration: business.paymentConfiguration,
      providers: [],
      providerDirectory: configuration.providerDirectory,
      healthPolicies: [healthPolicy],
      readHealthPolicies: configuration.readHealthPolicies,
    }),
  );
  add(
    createLocalAdminOrdersComposition({
      ...localAdmin,
      keys: kms.adapter,
      publicMediaBaseUrl: config.origins.media,
    }),
  );
  add(
    createLocalAdminFinanceComposition({
      ...localAdmin,
      providers: [],
      providerDirectory: configuration.providerDirectory,
      leaseMs: 5000,
      retryAfterMs: 1000,
    }),
  );
  add(createLocalAdminExceptionsComposition(localAdmin));
  const secret = Buffer.from(config.secrets.webhookSecret, "base64url");
  own("local webhook verifier key", async () => secret.fill(0));
  const verifier = createFakePaymentWebhookVerifier({
    ...business.endpoint,
    environment: "TEST",
    verificationSecret: secret,
  });
  add(
    createApiReliableEventsComposition(environment, {
      logger,
      keyManagement: kms.adapter,
      verifierForEndpoint: (adapterKey, endpointId) =>
        adapterKey === "fake" && endpointId === business.endpoint.endpointId
          ? verifier
          : undefined,
    }),
  );
  progress("Starting canonical local API");
  const app = await createApiApplication(
    environment,
    Object.assign({ logger }, ...components),
  );
  own("local API", async () => {
    await app.close();
    appClosed = true;
  });
  await app.listen(config.ports.api, "127.0.0.1");
  const apiOrigin = `http://127.0.0.1:${config.ports.api}`;
  let worker;
  if (startWorker) {
    progress("Starting persistent local Worker");
    worker = await startLocalExperienceWorkerProcess(
      { workspaceRoot, stateDirectory, config, database, s3, business },
      { onLog: (line) => process.stdout.write(line) },
    );
    own("local Worker process", () => worker.close());
  }
  return {
    apiOrigin,
    healthUrl: `${apiOrigin}/healthz`,
    workerHealthUrl: worker?.healthUrl,
    workerPid: worker?.pid,
    adminOrigin: config.origins.admin,
    storefrontOrigin: config.origins.storefront,
  };
}

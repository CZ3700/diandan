import process from "node:process";
import { Buffer } from "node:buffer";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { digestAdminIdentitySubject } from "@fan-support/application";
import { canonicalPublicationValue } from "@fan-support/content";
import { createLocalAdminPaymentConfigurationComposition } from "../dist/testing/index.js";
import { createAdminOrdersRuntime } from "./admin-orders-runtime.mjs";
import {
  createFinanceBrowserSessionClock,
  createFinanceTokenClock,
} from "./admin-finance-session-clock.mjs";
import { startPaymentTestPspProcess } from "./payment-runtime-psp-process.mjs";
import { createPaymentTestDatabase } from "./payment-runtime-psp-database.mjs";
import {
  createConfigurationTestFactories,
  testPaymentConnection,
  testHealthPolicy,
} from "./admin-payment-config-connectors.mjs";
import { startConfigurationTestApi } from "./admin-payment-config-process.mjs";
const hash = (value) =>
  createHash("sha256").update(canonicalPublicationValue(value)).digest("hex");
async function seedRoles({ client, actors, issuer, subjectPepper }) {
  for (const key of [
    "payments.read",
    "payments.configure",
    "payments.review",
    "payments.publish",
  ])
    await client.query(
      "INSERT INTO permissions(id,permission_key,description) VALUES($1,$2,'Payment configuration acceptance') ON CONFLICT(permission_key) DO NOTHING",
      [randomUUID(), key],
    );
  for (const [role, keys] of [
    [
      "manager",
      [
        "payments.read",
        "payments.configure",
        "payments.review",
        "payments.publish",
      ],
    ],
    ["order", ["payments.read"]],
  ])
    await client.query(
      "INSERT INTO role_permissions(role_id,permission_id,granted_by) SELECT $1,id,$2 FROM permissions WHERE permission_key=ANY($3::text[]) ON CONFLICT DO NOTHING",
      [actors[role].roleId, actors.manager.id, keys],
    );
  for (const locale of SUPPORTED_LOCALES) {
    const actor = {
      id: randomUUID(),
      roleId: randomUUID(),
      subject: randomUUID(),
    };
    actors[`payment-reviewer-${locale}`] = actor;
    await client.query(
      "INSERT INTO admin_identities(id,issuer,external_subject_hash,status) VALUES($1,$2,$3,'ACTIVE')",
      [
        actor.id,
        issuer,
        Buffer.from(
          digestAdminIdentitySubject({
            issuer,
            subjectPepper,
            subject: actor.subject,
          }),
          "hex",
        ),
      ],
    );
    await client.query(
      "INSERT INTO roles(id,role_key,description) VALUES($1,$2,'Independent payment translation reviewer')",
      [actor.roleId, `payment-reviewer:${actor.id}`],
    );
    await client.query(
      "INSERT INTO admin_identity_roles(admin_identity_id,role_id,granted_by) VALUES($1,$2,$3)",
      [actor.id, actor.roleId, actors.manager.id],
    );
    await client.query(
      "INSERT INTO role_permissions(role_id,permission_id,granted_by) SELECT $1,id,$2 FROM permissions WHERE permission_key=ANY($3::text[])",
      [
        actor.roleId,
        actors.manager.id,
        ["payments.read", "payments.review", "content.read"],
      ],
    );
    const auditId = randomUUID(),
      requestId = randomUUID();
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category) VALUES($1,'ADMIN',$2,'CONTENT_LOCALE_GRANT','ADMIN_CONTENT_LOCALE_GRANT',$3,'LOCAL_ACCEPTANCE',$4,$4,'SUCCEEDED','CONTENT_TRANSLATION')",
      [auditId, actors.manager.id, actor.id, requestId],
    );
    await client.query(
      "INSERT INTO admin_content_locale_grants(admin_identity_id,locale,granted_by,audit_log_id) VALUES($1,$2,$3,$4)",
      [actor.id, locale, actors.manager.id, auditId],
    );
    await client.query("COMMIT");
  }
}
export async function createAdminPaymentConfigurationFixture(context) {
  const owned = await createPaymentTestDatabase(context.database);
  context.own("configuration normalized PSP isolated database", () =>
    owned.close(),
  );
  const legacy = context.testPaymentDeployment;
  const normalized = {
    binding: {
      ...legacy.binding,
      providerAccountId: randomUUID(),
      providerCode: "normalized-gateway",
      allowedActionOrigins: [],
    },
    authorizationToken: randomBytes(32).toString("base64url"),
    returnOrigin: context.origin,
    merchantAccount: `test-merchant-${randomUUID()}`,
  };
  const preliminary = testPaymentConnection(
    { ...normalized, endpointOrigin: "https://payments.example.invalid" },
    true,
  );
  const psp = await startPaymentTestPspProcess({
    database: owned.database,
    binding: normalized.binding,
    authorizationToken: normalized.authorizationToken,
    returnOrigin: context.origin,
    normalizedGateway: {
      merchantAccount: normalized.merchantAccount,
      instruments: preliminary.instruments,
    },
    ...context.tls.certificates["payments.example.invalid"],
  });
  context.own("normalized gateway TEST PSP process", () => psp.close());
  normalized.binding = psp.binding;
  normalized.endpointOrigin = psp.origin;
  const connections = [
      testPaymentConnection(legacy),
      testPaymentConnection(normalized, true),
    ],
    healthPolicies = [testHealthPolicy(legacy.binding)];
  const merchantId = randomUUID(),
    requestId = randomUUID();
  await context.client.query("BEGIN");
  try {
    await context.client.query(
      "INSERT INTO merchant_entities(id,entity_key,legal_country,status) VALUES($1,$2,'US','ACTIVE')",
      [merchantId, `test-${merchantId}`],
    );
    await context.client.query(
      "INSERT INTO payment_provider_accounts(id,merchant_entity_id,adapter_key,environment,account_reference_digest,credential_secret_ref,status) VALUES($1,$2,'normalized-gateway','TEST',$3,$4,'ACTIVE')",
      [
        normalized.binding.providerAccountId,
        merchantId,
        randomBytes(32),
        connections[1].credentialRef,
      ],
    );
    await context.client.query(
      "INSERT INTO payment_provider_health_events(id,provider_account_id,sequence,from_status,to_status,observer_kind,task_name,reason_code,request_id,correlation_id) VALUES($1,$2,1,NULL,'HEALTHY','SYSTEM','payment-configuration-test-seed','SYNTHETIC_TEST_HEALTH',$3,$3)",
      [randomUUID(), normalized.binding.providerAccountId, requestId],
    );
    await context.client.query("COMMIT");
  } catch (error) {
    await context.client.query("ROLLBACK");
    throw error;
  }
  let composition, tokenPepper, sessionClock;
  const runtime = await createAdminOrdersRuntime(context, {
    seedAdditionalRoles: seedRoles,
    beforeValidTokenResponse: createFinanceTokenClock({
      client: context.client,
      check: context.check,
    }),
    composeAdditional(options) {
      tokenPepper = options.tokenPepper;
      sessionClock = createFinanceBrowserSessionClock({
        client: context.client,
        tokenPepper,
        check: context.check,
      });
      composition = createLocalAdminPaymentConfigurationComposition({
        environment: "LOCAL_OIDC",
        database: context.database,
        tokenPepper,
        allowedOrigin: options.adminOrigin,
        connections,
        factories: createConfigurationTestFactories({
          legacy,
          normalized,
          fetcher: context.tls.fetcher,
        }),
        initialProviderAccountIds: [legacy.binding.providerAccountId],
        healthPolicies,
        refreshDelayMs: 1000,
      });
      return composition;
    },
  });
  [
    legacy.authorizationToken,
    normalized.authorizationToken,
    normalized.merchantAccount,
    ...connections.map((value) => value.credentialRef),
  ].forEach(runtime.registerSecret);
  const childOptions = {
    database: context.database,
    caPath: context.tls.caPath,
    tokenPepper,
    adminOrigin: runtime.adminOrigin,
    publicMediaBaseUrl: context.gateway.origin,
    deployments: { legacy, normalized },
    connections,
    initialProviderAccountIds: [legacy.binding.providerAccountId],
    healthPolicies,
    refreshDelayMs: 1000,
    paymentConfiguration: {
      schemaVersion: 1,
      publicStorefrontOrigin: context.origin,
      leaseMs: 2000,
      recoveryDelayMs: 1000,
      actionTtlMs: 60000,
      returnStateTtlMs: 900000,
      recoveryBatchSize: 4,
    },
  };
  const nodes = [];
  async function startNode() {
    const node = await startConfigurationTestApi(childOptions, {
      keyManagement: context.kms.adapter,
      onLog: (line) => context.logLines.push(line),
    });
    context.own("independent payment configuration API process", () =>
      node.close(),
    );
    nodes.push(node);
    return node;
  }
  await startNode();
  await startNode();
  context.check(
    nodes[0].pid !== nodes[1].pid &&
      nodes.every((node) => node.pid !== process.pid),
    "two actual independent API processes own separate payment registries and pools",
  );
  const command = (session, path, body, options = {}) =>
    runtime.command(session, path, body, {
      ...options,
      namespace: "payment-configuration",
    });
  async function waitForGeneration(generation) {
    const started = performance.now();
    let observed;
    do {
      observed = await Promise.all(nodes.map((node) => node.observe()));
      if (observed.every((value) => value.generation === generation)) break;
      await delay(50);
    } while (performance.now() - started < 60000);
    const elapsedMs = performance.now() - started;
    context.check(
      observed.every((value) => value.generation === generation) &&
        elapsedMs <= 60000,
      "all independent API processes automatically observe publication within 60 seconds",
    );
    return { generation, elapsedMs, observations: observed };
  }
  function configurationDocument({
    rolloutBasisPoints = 10000,
    threshold = 3,
    label = "TEST card payment",
  } = {}) {
    const sourceHash = hash({
      displayName: label,
      customerHint: "Pay on the hosted TEST payment page.",
    });
    return {
      schemaVersion: 1,
      channels: [
        {
          providerAccountId: normalized.binding.providerAccountId,
          enabled: true,
          displayOrder: 0,
          rolloutBasisPoints,
          healthPolicy: {
            failureThreshold: threshold,
            failureWindowMs: 60000,
            openDurationMs: 30000,
            probeLeaseMs: 5000,
            probeRetryMs: 1000,
          },
          translations: SUPPORTED_LOCALES.map((locale) => ({
            locale,
            displayName: locale === "en" ? label : `${label} (${locale})`,
            customerHint: "Pay on the hosted TEST payment page.",
            translatedFromSourceHash: sourceHash,
          })),
        },
      ],
      routes: [
        {
          ruleKey: "managed.test.card",
          providerAccountId: normalized.binding.providerAccountId,
          paymentMethod: "fake_card",
          enabled: true,
          countries: [context.published.scope.country],
          markets: [context.published.scope.market],
          currencies: [context.published.scope.currency],
          minimumAmountMinor: 0,
          maximumAmountMinor: 100000000,
          requiredDeviceCapabilities: ["REDIRECT"],
          priority: 10,
          rolloutBasisPoints: 10000,
        },
      ],
    };
  }
  return {
    ...runtime,
    nodes,
    normalizedPsp: psp,
    normalizedAccountId: normalized.binding.providerAccountId,
    legacyAccountId: legacy.binding.providerAccountId,
    mediaOrigins: [context.gateway.origin],
    configurationDocument,
    waitForGeneration,
    command,
    startNode,
    async restartSecondNode() {
      await nodes[1].close();
      nodes.splice(1, 1);
      return startNode();
    },
    async authenticate(page, role, locale = "en") {
      const release = await sessionClock.install(page);
      try {
        await runtime.authenticate(
          page,
          role === "PAYMENT_MANAGER"
            ? "manager"
            : role === "PAYMENT_REVIEWER"
              ? `payment-reviewer-${locale}`
              : role === "READONLY"
                ? "order"
                : role,
          locale,
        );
      } finally {
        await release();
      }
    },
  };
}

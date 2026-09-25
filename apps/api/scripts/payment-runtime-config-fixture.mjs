import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  SUPPORTED_LOCALES,
  countrySchema,
  currencySchema,
  marketSchema,
  paymentRuntimeConfigurationSchema,
  paymentRuntimeProviderBindingSchema,
} from "@fan-support/contracts";
import { canonicalPublicationValue } from "@fan-support/content";
import { loadStorefrontCopy } from "@fan-support/i18n";

const hash = (value) =>
  createHash("sha256").update(canonicalPublicationValue(value)).digest("hex");

/** Synthetic TEST prerequisites using ordinary constraints and independent synthetic review identities. No order, attempt or reservation is seeded. */
export async function seedPaymentRuntimeConfiguration({
  client,
  identity,
  bindings: inputBindings,
  configuration: inputConfiguration,
  scope: inputScope,
  rollout = { providerBasisPoints: 10000, ruleBasisPoints: 10000 },
  check,
}) {
  if (
    !rollout ||
    Object.keys(rollout).sort().join(",") !==
      "providerBasisPoints,ruleBasisPoints" ||
    [rollout.providerBasisPoints, rollout.ruleBasisPoints].some(
      (value) => !Number.isInteger(value) || value < 0 || value > 10000,
    )
  )
    throw new TypeError("Invalid TEST payment rollout");
  const bindings = inputBindings.map((binding) =>
    paymentRuntimeProviderBindingSchema.parse(binding),
  );
  if (
    bindings.length < 1 ||
    bindings.length > 20 ||
    bindings.some((binding) => binding.environment !== "TEST") ||
    new Set(bindings.map((binding) => binding.providerAccountId)).size !==
      bindings.length
  )
    throw new TypeError(
      "Payment fixture requires unique TEST provider bindings",
    );
  const configuration =
    paymentRuntimeConfigurationSchema.parse(inputConfiguration);
  const scope = {
    country: countrySchema.parse(inputScope.country),
    market: marketSchema.parse(inputScope.market),
    currency: currencySchema.parse(inputScope.currency),
  };
  const labels = Object.fromEntries(
    await Promise.all(
      SUPPORTED_LOCALES.map(async (locale) => {
        const copy = await loadStorefrontCopy(locale);
        return [locale, [copy.checkoutMethod, copy.checkoutTest]];
      }),
    ),
  );
  const manager = identity.identities.identities.manager;
  const reviewerId = randomUUID(),
    merchantId = randomUUID(),
    configVersionId = randomUUID(),
    publicationId = randomUUID(),
    auditId = randomUUID(),
    requestId = randomUUID(),
    correlationId = randomUUID();
  const routes = bindings.map((binding) => ({
    binding,
    providerConfigId: randomUUID(),
    capabilityId: randomUUID(),
  }));
  const translationHashes = Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [
      locale,
      hash({ displayName: labels[locale][0], customerHint: labels[locale][1] }),
    ]),
  );
  let stage = "start",
    result;
  await client.query("BEGIN");
  try {
    const prior = (
      await client.query(
        "SELECT publication_id FROM payment_config_publication_heads",
      )
    ).rows;
    if (prior.length !== 0)
      throw new Error(
        "TEST payment configuration must start with no published payment head",
      );
    const configVersion = Number(
      (
        await client.query(
          "SELECT COALESCE(max(version),0)+1 AS version FROM config_versions WHERE config_kind='PAYMENT_ROUTING'",
        )
      ).rows[0].version,
    );
    const ruleVersion = configVersion;
    stage = "synthetic identities";
    await client.query(
      "INSERT INTO admin_identities(id,issuer,external_subject_hash,status,mfa_required) VALUES($1,'p4-04-synthetic-payment-review',$2,'ACTIVE',true)",
      [reviewerId, randomBytes(32)],
    );
    await client.query(
      "INSERT INTO merchant_entities(id,entity_key,legal_country,status) VALUES($1,$2,$3,'ACTIVE')",
      [merchantId, `test-${merchantId}`, scope.country],
    );
    await client.query(
      "INSERT INTO config_versions(id,config_kind,version,lifecycle,created_by) VALUES($1,'PAYMENT_ROUTING',$2,'DRAFT',$3)",
      [configVersionId, configVersion, manager],
    );
    for (const [index, route] of routes.entries()) {
      const { binding, providerConfigId, capabilityId } = route;
      stage = "TEST account and health";
      await client.query(
        "INSERT INTO payment_provider_accounts(id,merchant_entity_id,adapter_key,environment,account_reference_digest,credential_secret_ref,status) VALUES($1,$2,$3,'TEST',$4,$5,'ACTIVE')",
        [
          binding.providerAccountId,
          merchantId,
          binding.providerCode,
          randomBytes(32),
          `secret-ref:v1:aws-sm:test/payment/${binding.providerAccountId}`,
        ],
      );
      await client.query(
        "INSERT INTO payment_provider_health_events(id,provider_account_id,sequence,from_status,to_status,observer_kind,task_name,reason_code,request_id,correlation_id) VALUES($1,$2,1,NULL,'HEALTHY','SYSTEM','payment-runtime-test-seed','SYNTHETIC_TEST_HEALTH',$3,$4)",
        [randomUUID(), binding.providerAccountId, requestId, correlationId],
      );
      await client.query(
        "INSERT INTO payment_provider_configs(id,config_version_id,config_version,provider_account_id,enabled,display_order,rollout_basis_points) VALUES($1,$2,$3,$4,true,$5,$6)",
        [
          providerConfigId,
          configVersionId,
          configVersion,
          binding.providerAccountId,
          index,
          rollout.providerBasisPoints,
        ],
      );
      stage = "complete synthetic translation review sequence";
      for (const locale of SUPPORTED_LOCALES) {
        const translationId = randomUUID();
        await client.query(
          "INSERT INTO payment_provider_config_translations(id,config_version_id,provider_config_id,provider_account_id,locale,source_hash,translated_from_source_hash,origin,editor_id,edited_at,display_name,customer_hint) VALUES($1,$2,$3,$4,$5,$6,$7,'MACHINE',$8,transaction_timestamp(),$9,$10)",
          [
            translationId,
            configVersionId,
            providerConfigId,
            binding.providerAccountId,
            locale,
            translationHashes[locale],
            translationHashes.en,
            manager,
            ...labels[locale],
          ],
        );
        await client.query(
          "INSERT INTO payment_provider_config_translation_reviews(id,provider_config_translation_id,sequence,status) VALUES($1,$2,1,'DRAFT')",
          [randomUUID(), translationId],
        );
        await client.query(
          "INSERT INTO payment_provider_config_translation_reviews(id,provider_config_translation_id,sequence,status,submitted_at) VALUES($1,$2,2,'IN_REVIEW',transaction_timestamp())",
          [randomUUID(), translationId],
        );
        await client.query(
          "INSERT INTO payment_provider_config_translation_reviews(id,provider_config_translation_id,sequence,status,reviewer_id,reviewed_at,reviewed_source_hash,reviewed_content_hash) VALUES($1,$2,3,'APPROVED',$3,transaction_timestamp(),$4,$5)",
          [
            randomUUID(),
            translationId,
            reviewerId,
            translationHashes.en,
            translationHashes[locale],
          ],
        );
      }
      stage = "explicit TEST routing scope";
      await client.query(
        "INSERT INTO payment_route_rules(id,config_version_id,provider_config_id,provider_account_id,rule_key,rule_version,payment_method,enabled,minimum_amount_minor,maximum_amount_minor,priority,rollout_basis_points) VALUES($1,$2,$3,$4,$5,$6,'fake_card',true,0,100000000,10,$7)",
        [
          capabilityId,
          configVersionId,
          providerConfigId,
          binding.providerAccountId,
          `test.${capabilityId}`,
          ruleVersion,
          rollout.ruleBasisPoints,
        ],
      );
      await client.query(
        "INSERT INTO payment_route_rule_countries(payment_route_rule_id,country) VALUES($1,$2)",
        [capabilityId, scope.country],
      );
      await client.query(
        "INSERT INTO payment_route_rule_markets(payment_route_rule_id,market) VALUES($1,$2)",
        [capabilityId, scope.market],
      );
      await client.query(
        "INSERT INTO payment_route_rule_currencies(payment_route_rule_id,currency) VALUES($1,$2)",
        [capabilityId, scope.currency],
      );
      await client.query(
        "INSERT INTO payment_route_rule_device_capabilities(payment_route_rule_id,capability) VALUES($1,'REDIRECT')",
        [capabilityId],
      );
    }
    stage = "validated immutable payment publication";
    await client.query(
      "UPDATE config_versions SET lifecycle='VALIDATED' WHERE id=$1",
      [configVersionId],
    );
    await client.query(
      "UPDATE config_versions SET lifecycle='PUBLISHED',published_at=transaction_timestamp() WHERE id=$1",
      [configVersionId],
    );
    const manifest = {
      schemaVersion: 1,
      environment: "TEST",
      syntheticReviewOnly: true,
      configVersionId,
      configVersion,
      ruleVersion,
      scope,
      rollout,
      storefrontOrigin: configuration.publicStorefrontOrigin,
      providers: routes.map(({ binding, providerConfigId, capabilityId }) => ({
        providerAccountId: binding.providerAccountId,
        providerCode: binding.providerCode,
        providerConfigId,
        capabilityId,
      })),
      translationHashes,
    };
    await client.query(
      "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome) VALUES($1,'ADMIN',$2,'PAYMENT_CONFIG_PUBLISH','PAYMENT_CONFIG_PUBLICATION',$3,'SYNTHETIC_TEST_PUBLICATION',$4,$5,'SUCCEEDED')",
      [auditId, manager, publicationId, requestId, correlationId],
    );
    await client.query(
      "INSERT INTO payment_config_publications(id,config_version_id,action,manifest_hash,published_by,audit_log_id) VALUES($1,$2,'PUBLISH',$3,$4,$5)",
      [publicationId, configVersionId, hash(manifest), manager, auditId],
    );
    await client.query(
      "INSERT INTO payment_config_publication_heads(id,publication_id,config_version_id,config_version) VALUES($1,$2,$3,$4)",
      [randomUUID(), publicationId, configVersionId, configVersion],
    );
    await client.query(
      "INSERT INTO outbox_events(id,event_type,aggregate_type,aggregate_id,aggregate_version,primary_subject_id,secondary_subject_id,locale,market,currency,idempotency_key,correlation_id,request_id,occurred_at,available_at) VALUES($1,'PAYMENT_CONFIG_PUBLISHED','PAYMENT_CONFIG',$2,$3,$4,NULL,NULL,NULL,NULL,$5,$6,$7,transaction_timestamp(),transaction_timestamp())",
      [
        randomUUID(),
        configVersionId,
        configVersion,
        publicationId,
        `payment-config-publication:${publicationId}`,
        correlationId,
        requestId,
      ],
    );
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("COMMIT");
    result = {
      schemaVersion: 1,
      testOnly: true,
      syntheticReviewOnly: true,
      configVersionId,
      configVersion,
      ruleVersion,
      publicationId,
      scope,
      routes: routes.map(({ binding, capabilityId }) => ({
        providerAccountId: binding.providerAccountId,
        capabilityId,
        configVersion,
        ruleVersion,
      })),
      manifest,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`TEST payment configuration seed failed at ${stage}`, {
      cause: error,
    });
  }
  check(
    result.routes.length === bindings.length,
    "Only configured TEST payment accounts were published under ordinary constraints",
  );
  return result;
}

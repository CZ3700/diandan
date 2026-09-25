import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { canonicalPublicationValue } from "@fan-support/content";

const hash = (value) =>
  createHash("sha256").update(canonicalPublicationValue(value)).digest("hex");

/** Synthetic TEST publication only; clones a reviewed configuration into a new
 * immutable version without changing any previously published payload row.
 */
export async function publishClosedPaymentRollout({ context, check }) {
  const { client, published } = context;
  if (published.testOnly !== true || published.routes.length !== 1)
    throw new TypeError(
      "Rollout shutdown fixture requires one owned TEST route",
    );
  const previousRoute = published.routes[0];
  const manager = context.identity.identities.identities.manager;
  const reviewerId = randomUUID(),
    configVersionId = randomUUID(),
    providerConfigId = randomUUID(),
    capabilityId = randomUUID(),
    publicationId = randomUUID(),
    auditId = randomUUID(),
    requestId = randomUUID(),
    correlationId = randomUUID();
  const rollout = { providerBasisPoints: 0, ruleBasisPoints: 0 };
  const frozenRows = async () =>
    hash(
      (
        await client.query(
          `SELECT jsonb_build_object(
      'providers',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM payment_provider_configs p WHERE p.config_version_id=$1),
      'rules',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM payment_route_rules r WHERE r.config_version_id=$1),
      'translations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM payment_provider_config_translations t WHERE t.config_version_id=$1),
      'reviews',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM payment_provider_config_translation_reviews v JOIN payment_provider_config_translations t ON t.id=v.provider_config_translation_id WHERE t.config_version_id=$1),
      'countries',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.country) FROM payment_route_rule_countries s WHERE s.payment_route_rule_id=$2),
      'markets',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.market) FROM payment_route_rule_markets s WHERE s.payment_route_rule_id=$2),
      'currencies',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.currency) FROM payment_route_rule_currencies s WHERE s.payment_route_rule_id=$2),
      'devices',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.capability) FROM payment_route_rule_device_capabilities s WHERE s.payment_route_rule_id=$2)
    ) snapshot`,
          [published.configVersionId, previousRoute.capabilityId],
        )
      ).rows[0].snapshot,
    );
  let stage = "lock current TEST publication",
    result;
  await client.query("BEGIN");
  try {
    const prior = (
      await client.query(
        `SELECT head.id,head.publication_id,head.config_version_id,account.environment
       FROM payment_config_publication_heads head JOIN payment_route_rules rule ON rule.config_version_id=head.config_version_id
       JOIN payment_provider_accounts account ON account.id=rule.provider_account_id
       WHERE rule.id=$1 AND account.id=$2 FOR UPDATE OF head`,
        [previousRoute.capabilityId, previousRoute.providerAccountId],
      )
    ).rows[0];
    check(
      prior?.publication_id === published.publicationId &&
        prior.config_version_id === published.configVersionId &&
        prior.environment === "TEST",
      "Zero-rollout publication replaces only the owned current TEST head and retains its account",
    );
    const originalRows = await frozenRows();
    const configVersion = Number(
      (
        await client.query(
          "SELECT COALESCE(max(version),0)+1 version FROM config_versions WHERE config_kind='PAYMENT_ROUTING'",
        )
      ).rows[0].version,
    );
    const ruleVersion = configVersion;
    stage = "new draft and independent synthetic reviewer";
    await client.query(
      "INSERT INTO admin_identities(id,issuer,external_subject_hash,status,mfa_required) VALUES($1,'p5-04-synthetic-rollout-review',$2,'ACTIVE',true)",
      [reviewerId, randomBytes(32)],
    );
    await client.query(
      "INSERT INTO config_versions(id,config_kind,version,lifecycle,created_by) VALUES($1,'PAYMENT_ROUTING',$2,'DRAFT',$3)",
      [configVersionId, configVersion, manager],
    );
    await client.query(
      `INSERT INTO payment_provider_configs(id,config_version_id,config_version,provider_account_id,enabled,display_order,rollout_basis_points)
       SELECT $1,$2,$3,provider_account_id,enabled,display_order,0 FROM payment_provider_configs
       WHERE config_version_id=$4 AND provider_account_id=$5`,
      [
        providerConfigId,
        configVersionId,
        configVersion,
        published.configVersionId,
        previousRoute.providerAccountId,
      ],
    );
    stage = "new translations and complete synthetic review histories";
    const translations = (
      await client.query(
        "SELECT locale,source_hash,display_name,customer_hint FROM payment_provider_config_translations WHERE config_version_id=$1 AND provider_account_id=$2 ORDER BY locale",
        [published.configVersionId, previousRoute.providerAccountId],
      )
    ).rows;
    check(
      translations.length === SUPPORTED_LOCALES.length &&
        SUPPORTED_LOCALES.every((locale) =>
          translations.some((row) => row.locale === locale),
        ),
      "New version copies all seven source payloads into separate translations with fresh review evidence",
    );
    const sourceHash = translations.find(
      (row) => row.locale === "en",
    ).source_hash;
    for (const translation of translations) {
      const translationId = randomUUID();
      await client.query(
        "INSERT INTO payment_provider_config_translations(id,config_version_id,provider_config_id,provider_account_id,locale,source_hash,translated_from_source_hash,origin,editor_id,edited_at,display_name,customer_hint) VALUES($1,$2,$3,$4,$5,$6,$7,'MACHINE',$8,transaction_timestamp(),$9,$10)",
        [
          translationId,
          configVersionId,
          providerConfigId,
          previousRoute.providerAccountId,
          translation.locale,
          translation.source_hash,
          sourceHash,
          manager,
          translation.display_name,
          translation.customer_hint,
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
          sourceHash,
          translation.source_hash,
        ],
      );
    }
    stage = "new rule identity with original business scope";
    await client.query(
      `INSERT INTO payment_route_rules(id,config_version_id,provider_config_id,provider_account_id,rule_key,rule_version,payment_method,enabled,minimum_amount_minor,maximum_amount_minor,priority,rollout_basis_points)
       SELECT $1,$2,$3,provider_account_id,rule_key,$4,payment_method,enabled,minimum_amount_minor,maximum_amount_minor,priority,0
       FROM payment_route_rules WHERE id=$5`,
      [
        capabilityId,
        configVersionId,
        providerConfigId,
        ruleVersion,
        previousRoute.capabilityId,
      ],
    );
    await client.query(
      "INSERT INTO payment_route_rule_countries(payment_route_rule_id,country) SELECT $1,country FROM payment_route_rule_countries WHERE payment_route_rule_id=$2",
      [capabilityId, previousRoute.capabilityId],
    );
    await client.query(
      "INSERT INTO payment_route_rule_markets(payment_route_rule_id,market) SELECT $1,market FROM payment_route_rule_markets WHERE payment_route_rule_id=$2",
      [capabilityId, previousRoute.capabilityId],
    );
    await client.query(
      "INSERT INTO payment_route_rule_currencies(payment_route_rule_id,currency) SELECT $1,currency FROM payment_route_rule_currencies WHERE payment_route_rule_id=$2",
      [capabilityId, previousRoute.capabilityId],
    );
    await client.query(
      "INSERT INTO payment_route_rule_device_capabilities(payment_route_rule_id,capability) SELECT $1,capability FROM payment_route_rule_device_capabilities WHERE payment_route_rule_id=$2",
      [capabilityId, previousRoute.capabilityId],
    );
    stage = "validate new replacement";
    await client.query(
      "UPDATE config_versions SET lifecycle='VALIDATED' WHERE id=$1",
      [configVersionId],
    );
    stage = "supersede previous configuration";
    await client.query(
      "UPDATE config_versions SET lifecycle='SUPERSEDED' WHERE id=$1",
      [published.configVersionId],
    );
    stage = "publish replacement configuration";
    await client.query(
      "UPDATE config_versions SET lifecycle='PUBLISHED',published_at=transaction_timestamp() WHERE id=$1",
      [configVersionId],
    );
    const manifest = {
      ...published.manifest,
      configVersionId,
      configVersion,
      ruleVersion,
      rollout,
      replacesPublicationId: published.publicationId,
      providers: published.manifest.providers.map((provider) => ({
        ...provider,
        providerConfigId,
        capabilityId,
      })),
    };
    stage = "append publication audit";
    await client.query(
      "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome) VALUES($1,'ADMIN',$2,'PAYMENT_CONFIG_PUBLISH','PAYMENT_CONFIG_PUBLICATION',$3,'SYNTHETIC_TEST_ROLLOUT_CLOSED',$4,$5,'SUCCEEDED')",
      [auditId, manager, publicationId, requestId, correlationId],
    );
    stage = "append replacement publication";
    await client.query(
      "INSERT INTO payment_config_publications(id,config_version_id,action,replaces_publication_id,manifest_hash,published_by,audit_log_id) VALUES($1,$2,'PUBLISH',$3,$4,$5,$6)",
      [
        publicationId,
        configVersionId,
        published.publicationId,
        hash(manifest),
        manager,
        auditId,
      ],
    );
    stage = "move publication head";
    await client.query(
      "UPDATE payment_config_publication_heads SET publication_id=$2,config_version_id=$3,config_version=$4,version=version+1,updated_at=transaction_timestamp() WHERE id=$1",
      [prior.id, publicationId, configVersionId, configVersion],
    );
    stage = "append publication outbox";
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
    check(
      (await frozenRows()) === originalRows,
      "Prior published provider, rule, translations, review histories and scopes remain byte-equivalent while only lifecycle and head advance",
    );
    stage = "all ordinary publication constraints and COMMIT";
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
      rollout,
      oldRowsUnchanged: true,
      routes: [
        {
          providerAccountId: previousRoute.providerAccountId,
          capabilityId,
          configVersion,
          ruleVersion,
        },
      ],
    };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(
      JSON.stringify({
        kind: "TEST_ZERO_ROLLOUT_PUBLICATION_FAILURE",
        stage,
        sqlState: /^[A-Z0-9]{5}$/u.test(error?.code ?? "") ? error.code : null,
        constraint: /^[a-z][a-z0-9_]{0,127}$/u.test(error?.constraint ?? "")
          ? error.constraint
          : null,
        functionName:
          /PL\/pgSQL function ([a-z][a-z0-9_]{0,127})\(/u.exec(
            error?.where ?? "",
          )?.[1] ?? null,
      }),
    );
    throw new Error(`TEST zero-rollout publication failed at ${stage}`, {
      cause: error,
    });
  }
  const stored = (
    await client.query(
      `SELECT h.publication_id,r.id,r.rule_version,p.provider_account_id,p.rollout_basis_points AS provider_rollout,r.rollout_basis_points AS rule_rollout,
      current.lifecycle,old.lifecycle AS old_lifecycle,
      (SELECT count(*)::int FROM payment_provider_accounts) AS accounts
     FROM payment_config_publication_heads h JOIN config_versions current ON current.id=h.config_version_id
     JOIN payment_route_rules r ON r.config_version_id=h.config_version_id JOIN payment_provider_configs p ON p.id=r.provider_config_id
     JOIN config_versions old ON old.id=$1 WHERE r.id=$2`,
      [published.configVersionId, capabilityId],
    )
  ).rows[0];
  check(
    stored?.publication_id === publicationId &&
      stored.provider_account_id === previousRoute.providerAccountId &&
      stored.provider_rollout === 0 &&
      stored.rule_rollout === 0 &&
      stored.lifecycle === "PUBLISHED" &&
      stored.old_lifecycle === "SUPERSEDED" &&
      stored.accounts === 1 &&
      stored.id !== previousRoute.capabilityId,
    "Committed zero-rollout head has a new rule UUID, the same sole TEST account, both zero ratios and the superseded original version",
  );
  return result;
}

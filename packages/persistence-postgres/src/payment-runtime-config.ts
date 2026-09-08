import {
  paymentRuntimeRoutingSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import { rejectPayment } from "./payment-runtime-data.js";
import type { TransactionClient } from "./transaction-runner.js";

/** PostgreSQL's immutable published payment package remains the display and routing authority. */
export async function loadPaymentRouting(
  client: TransactionClient,
  locale: SupportedLocale,
) {
  const heads = await draftRows(
    client,
    `SELECT head.publication_id,head.config_version_id,head.config_version::text,publication.manifest_hash
    FROM public.payment_config_publication_heads head
    JOIN public.payment_config_publications publication ON publication.id=head.publication_id AND publication.config_version_id=head.config_version_id
    JOIN public.config_versions config ON config.id=head.config_version_id AND config.version=head.config_version AND config.config_kind='PAYMENT_ROUTING'
    WHERE config.lifecycle IN('PUBLISHED','SUPERSEDED') AND NOT EXISTS(SELECT 1 FROM public.payment_config_publications successor WHERE successor.replaces_publication_id=publication.id)
    FOR SHARE OF head,publication,config`,
  );
  if (heads.length === 0) return null;
  if (heads.length !== 1) return rejectPayment("CONTENT_UNAVAILABLE");
  const head = heads[0]!;
  const rows = await draftRows(
    client,
    `SELECT rule.*,config.enabled provider_enabled,config.id provider_config_id,config.display_order,config.rollout_basis_points provider_rollout_basis_points,
    account.adapter_key,account.environment,account.status account_status,account.health_status,merchant.status merchant_status,
    translation.display_name,translation.customer_hint,translation.locale display_locale,
    ARRAY(SELECT country::text FROM public.payment_route_rule_countries WHERE payment_route_rule_id=rule.id ORDER BY country) countries,
    ARRAY(SELECT market::text FROM public.payment_route_rule_markets WHERE payment_route_rule_id=rule.id ORDER BY market) markets,
    ARRAY(SELECT currency::text FROM public.payment_route_rule_currencies WHERE payment_route_rule_id=rule.id ORDER BY currency) currencies,
    ARRAY(SELECT capability FROM public.payment_route_rule_device_capabilities WHERE payment_route_rule_id=rule.id ORDER BY capability) capabilities
    FROM public.payment_route_rules rule JOIN public.payment_provider_configs config ON config.id=rule.provider_config_id AND config.config_version_id=rule.config_version_id AND config.provider_account_id=rule.provider_account_id
    JOIN public.payment_provider_accounts account ON account.id=rule.provider_account_id
    JOIN public.merchant_entities merchant ON merchant.id=account.merchant_entity_id
    JOIN public.payment_provider_config_translations translation ON translation.provider_config_id=config.id AND translation.locale=$2::public.supported_locale
    JOIN LATERAL(SELECT review.status FROM public.payment_provider_config_translation_reviews review WHERE review.provider_config_translation_id=translation.id ORDER BY review.sequence DESC LIMIT 1) latest ON latest.status='APPROVED'
    WHERE rule.config_version_id=$1::uuid AND rule.enabled AND config.enabled ORDER BY rule.id FOR SHARE OF account,merchant`,
    [head["config_version_id"], locale],
  );
  if (rows.length === 0) return rejectPayment("CONTENT_UNAVAILABLE");
  const ruleVersion = Number(rows[0]!["rule_version"]);
  return paymentRuntimeRoutingSchema.parse({
    schemaVersion: 1,
    publicationId: head["publication_id"],
    manifestHash: head["manifest_hash"],
    configVersionId: head["config_version_id"],
    configVersion: Number(head["config_version"]),
    ruleVersion,
    routes: rows.map((row) => ({
      schemaVersion: 1,
      rule: {
        schemaVersion: 1,
        id: row["id"],
        providerAccountId: row["provider_account_id"],
        paymentMethod: row["payment_method"],
        enabled: row["enabled"],
        countries: row["countries"],
        markets: row["markets"],
        currencies: row["currencies"],
        minimumAmountMinor: Number(row["minimum_amount_minor"]),
        maximumAmountMinor: Number(row["maximum_amount_minor"]),
        requiredDeviceCapabilities: row["capabilities"],
        priority: row["priority"],
      },
      ruleVersion: Number(row["rule_version"]),
      providerConfigId: row["provider_config_id"],
      environment: row["environment"],
      adapterKey: row["adapter_key"],
      providerEnabled: row["provider_enabled"],
      accountStatus: row["account_status"],
      merchantStatus: row["merchant_status"],
      healthStatus: row["health_status"],
      rolloutBasisPoints: row["rollout_basis_points"],
      providerRolloutBasisPoints: row["provider_rollout_basis_points"],
      displayOrder: row["display_order"],
      displayName: row["display_name"],
      customerHint: row["customer_hint"],
      displayLocale: row["display_locale"],
    })),
  });
}

import type { PaymentHealthProbeContext } from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";

/** Validate only persisted public route facts; health itself must not block a safe recovery read. */
export async function healthProbeContextAvailable(
  client: TransactionClient,
  context: PaymentHealthProbeContext,
): Promise<boolean> {
  const c = context.command;
  const [row] = await draftRows(
    client,
    `SELECT EXISTS(SELECT 1 FROM public.payment_config_publication_heads head
    JOIN public.payment_config_publications publication ON publication.id=head.publication_id AND publication.config_version_id=head.config_version_id
    JOIN public.config_versions version ON version.id=head.config_version_id AND version.version=head.config_version AND version.config_kind='PAYMENT_ROUTING'
    JOIN public.payment_route_rules rule ON rule.config_version_id=head.config_version_id AND rule.id=$1::uuid
    JOIN public.payment_provider_configs config ON config.id=rule.provider_config_id AND config.config_version_id=rule.config_version_id AND config.provider_account_id=rule.provider_account_id
    JOIN public.payment_provider_accounts account ON account.id=rule.provider_account_id
    JOIN public.merchant_entities merchant ON merchant.id=account.merchant_entity_id
    WHERE head.config_version=$2::bigint AND rule.rule_version=$3::bigint AND account.id=$4::uuid AND account.environment=$5
      AND version.lifecycle IN('PUBLISHED','SUPERSEDED') AND NOT EXISTS(SELECT 1 FROM public.payment_config_publications successor WHERE successor.replaces_publication_id=publication.id)
      AND account.status IN('INTERNAL','ACTIVE') AND NOT(account.status='INTERNAL' AND account.environment<>'TEST') AND merchant.status='ACTIVE' AND rule.enabled AND config.enabled
      AND rule.rollout_basis_points>0 AND config.rollout_basis_points>0 AND $6::bigint BETWEEN rule.minimum_amount_minor AND rule.maximum_amount_minor
      AND EXISTS(SELECT 1 FROM public.payment_route_rule_countries WHERE payment_route_rule_id=rule.id AND country=$7)
      AND EXISTS(SELECT 1 FROM public.payment_route_rule_markets WHERE payment_route_rule_id=rule.id AND market=$8)
      AND EXISTS(SELECT 1 FROM public.payment_route_rule_currencies WHERE payment_route_rule_id=rule.id AND currency=$9)
      AND NOT EXISTS(SELECT 1 FROM public.payment_route_rule_device_capabilities capability WHERE capability.payment_route_rule_id=rule.id AND NOT $10::jsonb ? capability.capability)
      AND EXISTS(SELECT 1 FROM public.payment_provider_config_translations translation JOIN LATERAL(SELECT review.status FROM public.payment_provider_config_translation_reviews review WHERE review.provider_config_translation_id=translation.id ORDER BY review.sequence DESC LIMIT 1) latest ON latest.status='APPROVED' WHERE translation.provider_config_id=config.id AND translation.locale=$11::public.supported_locale)
    ) available`,
    [
      context.routeId,
      context.configVersion,
      context.ruleVersion,
      c.providerAccountId,
      c.environment,
      c.amountMinor,
      c.country,
      c.market,
      c.currency,
      JSON.stringify(c.supportedActionTypes),
      c.requestedLocale,
    ],
  );
  return row?.["available"] === true;
}

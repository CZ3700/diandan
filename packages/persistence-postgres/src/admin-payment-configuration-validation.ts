import { randomUUID } from "node:crypto";
import {
  validatePaymentConfiguration,
  diffPaymentConfiguration,
} from "@fan-support/domain";
import {
  paymentConfigurationBaselineSchema,
  type AdminPaymentConfigurationStoreRequest,
  type PaymentConfigurationRevision,
} from "@fan-support/contracts";
import {
  configurationRevision,
  configurationAccounts,
} from "./admin-payment-configuration-read.js";
import type { ConfigurationAuthority } from "./admin-payment-configuration-authorization.js";
import {
  draftRows,
  configurationHash,
  configurationFailure,
  configurationTime,
  configurationAudit,
  type TransactionClient,
  type DraftRow,
} from "./admin-payment-configuration-data.js";
async function legacyBaseline(client: TransactionClient, id: string) {
  const [r] = await draftRows(
    client,
    `SELECT jsonb_build_object('schemaVersion',1,'channels',coalesce((SELECT jsonb_agg(jsonb_build_object('providerAccountId',c.provider_account_id,'enabled',c.enabled,'displayOrder',c.display_order,'rolloutBasisPoints',c.rollout_basis_points,'healthPolicy',null,'translations',coalesce((SELECT jsonb_agg(jsonb_build_object('locale',t.locale,'displayName',t.display_name,'customerHint',t.customer_hint,'translatedFromSourceHash',t.translated_from_source_hash) ORDER BY t.locale) FROM public.payment_provider_config_translations t WHERE t.provider_config_id=c.id),'[]'::jsonb)) ORDER BY c.provider_account_id) FROM public.payment_provider_configs c WHERE c.config_version_id=$1),'[]'::jsonb),'routes',coalesce((SELECT jsonb_agg(jsonb_build_object('ruleKey',r.rule_key,'providerAccountId',r.provider_account_id,'paymentMethod',r.payment_method,'enabled',r.enabled,'minimumAmountMinor',r.minimum_amount_minor,'maximumAmountMinor',r.maximum_amount_minor,'priority',r.priority,'rolloutBasisPoints',r.rollout_basis_points,'countries',coalesce((SELECT jsonb_agg(country ORDER BY country) FROM public.payment_route_rule_countries WHERE payment_route_rule_id=r.id),'[]'::jsonb),'markets',coalesce((SELECT jsonb_agg(market ORDER BY market) FROM public.payment_route_rule_markets WHERE payment_route_rule_id=r.id),'[]'::jsonb),'currencies',coalesce((SELECT jsonb_agg(currency ORDER BY currency) FROM public.payment_route_rule_currencies WHERE payment_route_rule_id=r.id),'[]'::jsonb),'requiredDeviceCapabilities',coalesce((SELECT jsonb_agg(capability ORDER BY capability) FROM public.payment_route_rule_device_capabilities WHERE payment_route_rule_id=r.id),'[]'::jsonb)) ORDER BY r.rule_key) FROM public.payment_route_rules r WHERE r.config_version_id=$1),'[]'::jsonb)) document`,
    [id],
  );
  return paymentConfigurationBaselineSchema.parse(r!["document"]);
}
export async function configurationValidation(
  client: TransactionClient,
  request: AdminPaymentConfigurationStoreRequest,
  authority: ConfigurationAuthority,
  head: DraftRow | undefined,
) {
  const c = request.command;
  if (
    !("revisionId" in c) ||
    c.action === "READ" ||
    !("expectedPublicationId" in c)
  )
    throw new Error("Expected validation/publication");
  const revision = await configurationRevision(
    client,
    c.revisionId,
    authority,
    true,
  );
  if (!revision) return configurationFailure("NOT_FOUND");
  const mode = c.action === "VALIDATE" ? c.mode : c.action;
  if (
    (mode === "PUBLISH" &&
      !["DRAFT", "VALIDATED"].includes(revision.lifecycle)) ||
    (mode === "ROLLBACK" && revision.lifecycle !== "SUPERSEDED")
  )
    return configurationFailure("CONFLICT");
  const previouslyPublished =
    (
      await draftRows(
        client,
        "SELECT id FROM public.payment_config_publications WHERE config_version_id=$1 LIMIT 1",
        [c.revisionId],
      )
    ).length > 0;
  const accounts = await configurationAccounts(client, request, true);
  if (accounts.length > 100) return configurationFailure("CONFLICT");
  const reviewFacts = revision.reviews.map((r) => ({
    ...r,
    canApprove: false,
  }));
  const result = validatePaymentConfiguration({
    schemaVersion: 1,
    configuration: revision.configuration,
    accounts,
    reviews: reviewFacts,
    mode,
    previouslyPublished,
  });
  const previous = head
    ? await configurationRevision(
        client,
        String(head["config_version_id"]),
        authority,
      )
    : null;
  const baseline =
    previous?.configuration ??
    (head
      ? await legacyBaseline(client, String(head["config_version_id"]))
      : null);
  const { diff } = diffPaymentConfiguration({
    schemaVersion: 1,
    before: baseline,
    after: revision.configuration,
  });
  const relevant = accounts
    .filter((a) =>
      revision.configuration.channels.some(
        (c) =>
          c.providerAccountId.toLowerCase() ===
          a.providerAccountId.toLowerCase(),
      ),
    )
    .map((a) => ({
      providerAccountId: a.providerAccountId,
      environment: a.environment,
      displayLabel: a.displayLabel,
      adapterKey: a.adapterKey,
      adapterVersion: a.adapterVersion,
      paymentMethods: a.paymentMethods,
      deployed: a.deployed,
      accountStatus: a.accountStatus,
      merchantStatus: a.merchantStatus,
      healthStatus: a.healthStatus,
    }));
  const facts = {
    schemaVersion: 1,
    revisionId: c.revisionId,
    mode,
    expectedPublicationId: c.expectedPublicationId,
    documentHash: configurationHash(revision.configuration),
    accounts: relevant,
    reviews: reviewFacts,
  };
  return {
    revision,
    result,
    diff,
    facts,
    hash: configurationHash(facts),
    mode,
  };
}
export async function materializeConfigurationRoutes(
  client: TransactionClient,
  revision: PaymentConfigurationRevision,
) {
  if (
    (
      await draftRows(
        client,
        "SELECT id FROM public.payment_route_rules WHERE config_version_id=$1 LIMIT 1",
        [revision.revisionId],
      )
    ).length
  )
    return;
  for (const route of revision.configuration.routes) {
    const [channel] = await draftRows(
      client,
      "SELECT id FROM public.payment_provider_configs WHERE config_version_id=$1 AND provider_account_id=$2",
      [revision.revisionId, route.providerAccountId],
    );
    const id = randomUUID();
    await client.query(
      `INSERT INTO public.payment_route_rules(id,config_version_id,provider_config_id,provider_account_id,rule_key,rule_version,payment_method,enabled,minimum_amount_minor,maximum_amount_minor,priority,rollout_basis_points) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        revision.revisionId,
        channel!["id"],
        route.providerAccountId,
        route.ruleKey,
        revision.version,
        route.paymentMethod,
        route.enabled,
        route.minimumAmountMinor,
        route.maximumAmountMinor,
        route.priority,
        route.rolloutBasisPoints,
      ],
    );
    for (const [table, column, values] of [
      ["payment_route_rule_countries", "country", route.countries],
      ["payment_route_rule_markets", "market", route.markets],
      ["payment_route_rule_currencies", "currency", route.currencies],
      [
        "payment_route_rule_device_capabilities",
        "capability",
        route.requiredDeviceCapabilities,
      ],
    ] as const) {
      for (const value of values)
        await client.query(
          `INSERT INTO public.${table}(payment_route_rule_id,${column}) VALUES($1,$2)`,
          [id, value],
        );
    }
  }
}
export async function validateConfiguration(
  client: TransactionClient,
  request: AdminPaymentConfigurationStoreRequest,
  authority: ConfigurationAuthority,
  head: DraftRow | undefined,
) {
  const v = await configurationValidation(client, request, authority, head);
  if ("outcome" in v) return v;
  if (v.result.valid) {
    const id = randomUUID(),
      at = await configurationTime(client),
      auditId = await configurationAudit(
        client,
        request,
        authority.actorId,
        "PAYMENT_CONFIGURATION_VALIDATE",
        v.revision.revisionId,
        at,
      );
    await materializeConfigurationRoutes(client, v.revision);
    await client.query(
      `INSERT INTO public.admin_payment_configuration_validations(id,config_version_id,mode,expected_publication_id,validation_hash,facts,actor_id,session_id,audit_log_id,request_id,correlation_id,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        v.revision.revisionId,
        v.mode,
        head?.["publication_id"] ?? null,
        v.hash,
        JSON.stringify(v.facts),
        authority.actorId,
        authority.sessionId,
        auditId,
        request.access.requestId,
        request.access.correlationId,
        at,
      ],
    );
    if (v.mode === "PUBLISH" && v.revision.lifecycle === "DRAFT")
      await client.query(
        `UPDATE public.config_versions SET lifecycle='VALIDATED' WHERE id=$1`,
        [v.revision.revisionId],
      );
  }
  return {
    schemaVersion: 1 as const,
    outcome: "SUCCESS" as const,
    kind: "VALIDATION" as const,
    revisionId: v.revision.revisionId,
    expectedPublicationId: head?.["publication_id"] ?? null,
    mode: v.mode,
    valid: v.result.valid,
    validationHash: v.result.valid ? v.hash : null,
    issues: v.result.issues,
    diff: v.diff,
  };
}

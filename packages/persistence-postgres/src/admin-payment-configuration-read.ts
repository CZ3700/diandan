import {
  paymentConfigurationAccountSchema,
  paymentConfigurationRevisionSchema,
  paymentConfigurationPublishedProjectionSchema,
  type AdminPaymentConfigurationStoreRequest,
} from "@fan-support/contracts";
import type { ConfigurationAuthority } from "./admin-payment-configuration-authorization.js";
import {
  draftRows,
  healthTimestamp,
  configurationResponse,
  type TransactionClient,
  type DraftRow,
} from "./admin-payment-configuration-data.js";
export async function configurationAccounts(
  client: TransactionClient,
  request: AdminPaymentConfigurationStoreRequest,
  lock = false,
) {
  const rows = await draftRows(
    client,
    `SELECT a.id,a.environment,a.adapter_key,a.status,a.health_status,m.status merchant_status,p.policy FROM public.payment_provider_accounts a JOIN public.merchant_entities m ON m.id=a.merchant_entity_id LEFT JOIN public.payment_provider_health_state s ON s.provider_account_id=a.id LEFT JOIN public.payment_provider_health_policies p ON p.provider_account_id=s.provider_account_id AND p.environment=s.environment AND p.policy_version=s.policy_version WHERE a.id=ANY($1::uuid[]) OR EXISTS(SELECT 1 FROM public.admin_payment_configuration_revisions r CROSS JOIN LATERAL jsonb_array_elements(r.document->'channels') channel WHERE (channel->>'providerAccountId')::uuid=a.id) ORDER BY a.id ${lock ? "FOR UPDATE OF a" : ""}`,
    [request.deployedAccounts.map((a) => a.providerAccountId)],
  );
  if (lock)
    await draftRows(
      client,
      `SELECT m.id FROM public.merchant_entities m WHERE EXISTS(SELECT 1 FROM public.payment_provider_accounts a WHERE a.merchant_entity_id=m.id) ORDER BY m.id FOR SHARE`,
    );
  return rows.map((row) => {
    const deployed = request.deployedAccounts.find(
      (a) =>
        a.providerAccountId === row["id"] &&
        a.environment === row["environment"] &&
        a.adapterKey === row["adapter_key"],
    );
    const p = row["policy"] as Record<string, unknown> | null;
    return paymentConfigurationAccountSchema.parse({
      providerAccountId: row["id"],
      environment: row["environment"],
      adapterKey: row["adapter_key"],
      adapterVersion: deployed?.adapterVersion ?? "0.0.0",
      paymentMethods: deployed?.paymentMethods ?? [],
      deployed: !!deployed,
      displayLabel: `${row["adapter_key"]} · ${row["environment"]} · ${String(row["id"]).slice(0, 8)}`,
      accountStatus: row["status"],
      merchantStatus: row["merchant_status"],
      healthStatus: row["health_status"],
      healthPolicy: p
        ? {
            failureThreshold: p["failureThreshold"],
            failureWindowMs: p["failureWindowMs"],
            openDurationMs: p["openDurationMs"],
            probeLeaseMs: p["probeLeaseMs"],
            probeRetryMs: p["probeRetryMs"],
          }
        : null,
    });
  });
}
export async function configurationRevision(
  client: TransactionClient,
  id: string,
  authority: ConfigurationAuthority,
  lock = false,
) {
  const [row] = await draftRows(
    client,
    `SELECT r.*,v.version,v.lifecycle,v.created_by,${healthTimestamp("v.created_at")} created_text FROM public.admin_payment_configuration_revisions r JOIN public.config_versions v ON v.id=r.config_version_id WHERE r.config_version_id=$1 ${lock ? "FOR UPDATE OF v" : ""}`,
    [id],
  );
  if (!row) return null;
  const reviews = await draftRows(
    client,
    `SELECT t.*,review.status,review.reviewer_id,en.source_hash english_hash FROM public.payment_provider_config_translations t JOIN LATERAL(SELECT * FROM public.payment_provider_config_translation_reviews r WHERE r.provider_config_translation_id=t.id ORDER BY sequence DESC LIMIT 1) review ON true LEFT JOIN public.payment_provider_config_translations en ON en.provider_config_id=t.provider_config_id AND en.locale='en' WHERE t.config_version_id=$1 ORDER BY t.provider_account_id,t.locale`,
    [id],
  );
  return paymentConfigurationRevisionSchema.parse({
    revisionId: id,
    version: Number(row["version"]),
    lifecycle: row["lifecycle"],
    createdAt: row["created_text"],
    createdBy: row["created_by"],
    configuration: row["document"],
    reviews: reviews.map((t) => ({
      providerAccountId: t["provider_account_id"],
      locale: t["locale"],
      status:
        t["english_hash"] !== t["translated_from_source_hash"]
          ? "STALE"
          : t["status"],
      sourceHash: t["source_hash"],
      editorId: t["editor_id"],
      reviewerId: t["reviewer_id"],
      canApprove:
        t["status"] === "IN_REVIEW" &&
        t["english_hash"] === t["translated_from_source_hash"] &&
        t["editor_id"] !== authority.actorId &&
        authority.permissions.includes("payments.review") &&
        authority.reviewLocales.some((l) => l === t["locale"]),
    })),
  });
}
export async function readConfigurationWorkspace(
  client: TransactionClient,
  request: AdminPaymentConfigurationStoreRequest,
  authority: ConfigurationAuthority,
  head: DraftRow | undefined,
) {
  const accounts = await configurationAccounts(client, request);
  if (accounts.length > 100)
    return configurationResponse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "CONFLICT",
    });
  const id =
    request.command.action === "READ" ? request.command.revisionId : null;
  const history = await draftRows(
    client,
    `SELECT r.config_version_id,v.version,v.lifecycle,${healthTimestamp("v.created_at")} created_text,EXISTS(SELECT 1 FROM public.payment_config_publications p WHERE p.config_version_id=v.id) was_published FROM public.admin_payment_configuration_revisions r JOIN public.config_versions v ON v.id=r.config_version_id ORDER BY v.version DESC LIMIT 100`,
  );
  const selectedId =
    id ??
    (history.some((r) => r["config_version_id"] === head?.["config_version_id"])
      ? String(head?.["config_version_id"])
      : history[0]?.["config_version_id"]);
  const selected =
    typeof selectedId === "string"
      ? await configurationRevision(client, selectedId, authority)
      : null;
  if (id && !selected)
    return configurationResponse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "NOT_FOUND",
    });
  return configurationResponse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "WORKSPACE",
    actorId: authority.actorId,
    canEdit: authority.permissions.includes("payments.configure"),
    canPublish: authority.permissions.includes("payments.publish"),
    reviewLocales: authority.permissions.includes("payments.review")
      ? authority.reviewLocales
      : [],
    currentPublicationId: head?.["publication_id"] ?? null,
    currentRevisionId: head?.["config_version_id"] ?? null,
    generation: Number(head?.["version"] ?? 0),
    accounts,
    selected,
    history: history.map((r) => ({
      revisionId: r["config_version_id"],
      version: Number(r["version"]),
      lifecycle: r["lifecycle"],
      createdAt: r["created_text"],
      wasPublished: r["was_published"],
    })),
  });
}
export async function readPublishedConfiguration(client: TransactionClient) {
  const [head] = await draftRows(
    client,
    `SELECT h.* FROM public.payment_config_publication_heads h JOIN public.admin_payment_configuration_revisions r ON r.config_version_id=h.config_version_id FOR SHARE OF h`,
  );
  if (!head) return null;
  const accounts = await draftRows(
    client,
    `SELECT DISTINCT a.id,a.environment,a.adapter_key FROM public.admin_payment_configuration_activations x JOIN public.payment_provider_accounts a ON a.id=x.provider_account_id ORDER BY a.id`,
  );
  const policies = await draftRows(
    client,
    `SELECT p.policy FROM public.payment_provider_health_state s JOIN public.payment_provider_health_policies p ON p.provider_account_id=s.provider_account_id AND p.environment=s.environment AND p.policy_version=s.policy_version WHERE EXISTS(SELECT 1 FROM public.admin_payment_configuration_activations x WHERE x.provider_account_id=s.provider_account_id) ORDER BY s.provider_account_id`,
  );
  return paymentConfigurationPublishedProjectionSchema.parse({
    schemaVersion: 1,
    generation: Number(head["version"]),
    publicationId: head["publication_id"],
    revisionId: head["config_version_id"],
    accounts: accounts.map((a) => ({
      providerAccountId: a["id"],
      environment: a["environment"],
      adapterKey: a["adapter_key"],
    })),
    policies: policies.map((r) => r["policy"]),
  });
}

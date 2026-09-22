import { randomUUID } from "node:crypto";
import {
  paymentHealthPolicySchema,
  type AdminPaymentConfigurationStoreRequest,
} from "@fan-support/contracts";
import type { ConfigurationAuthority } from "./admin-payment-configuration-authorization.js";
import { configurationValidation } from "./admin-payment-configuration-validation.js";
import { recordConfigurationReceipt } from "./admin-payment-configuration-authoring.js";
import {
  draftRows,
  configurationHash,
  configurationFailure,
  configurationTime,
  configurationAudit,
  type TransactionClient,
  type DraftRow,
} from "./admin-payment-configuration-data.js";
export async function publishConfiguration(
  client: TransactionClient,
  request: AdminPaymentConfigurationStoreRequest,
  authority: ConfigurationAuthority,
  head: DraftRow | undefined,
) {
  const c = request.command;
  if (c.action !== "PUBLISH" && c.action !== "ROLLBACK")
    throw new Error("Expected publication");
  const v = await configurationValidation(client, request, authority, head);
  if ("outcome" in v) return v;
  if (!v.result.valid) return configurationFailure("VALIDATION_FAILED");
  const [proof] = await draftRows(
    client,
    `SELECT id FROM public.admin_payment_configuration_validations WHERE config_version_id=$1 AND mode=$2 AND expected_publication_id IS NOT DISTINCT FROM $3::uuid AND validation_hash=$4`,
    [c.revisionId, c.action, c.expectedPublicationId, c.validationHash],
  );
  if (!proof || v.hash !== c.validationHash)
    return configurationFailure("VALIDATION_REQUIRED");
  if (c.action === "PUBLISH" && v.revision.lifecycle !== "VALIDATED")
    return configurationFailure("VALIDATION_REQUIRED");
  const at = await configurationTime(client),
    publicationId = randomUUID(),
    generation = Number(head?.["version"] ?? 0) + 1;
  const auditId = await configurationAudit(
    client,
    request,
    authority.actorId,
    c.action === "PUBLISH"
      ? "PAYMENT_CONFIG_PUBLISH"
      : "PAYMENT_CONFIG_ROLLBACK",
    publicationId,
    at,
    c.reasonCode,
  );
  if (head)
    await client.query(
      `UPDATE public.config_versions SET lifecycle='SUPERSEDED' WHERE id=$1 AND lifecycle='PUBLISHED'`,
      [head["config_version_id"]],
    );
  if (c.action === "PUBLISH")
    await client.query(
      `UPDATE public.config_versions SET lifecycle='PUBLISHED',published_at=$2 WHERE id=$1 AND lifecycle='VALIDATED'`,
      [c.revisionId, at],
    );
  await client.query(
    `INSERT INTO public.payment_config_publications(id,config_version_id,action,replaces_publication_id,manifest_hash,published_by,audit_log_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      publicationId,
      c.revisionId,
      c.action,
      head?.["publication_id"] ?? null,
      c.validationHash,
      authority.actorId,
      auditId,
      at,
    ],
  );
  await client.query(
    `INSERT INTO public.outbox_events(id,event_type,aggregate_type,aggregate_id,aggregate_version,primary_subject_id,idempotency_key,correlation_id,request_id,occurred_at,available_at,created_at) VALUES($1,'PAYMENT_CONFIG_PUBLISHED','PAYMENT_CONFIG',$2,$3,$4,$5,$6,$7,$8::timestamptz,$8::timestamptz,$8::timestamptz)`,
    [
      randomUUID(),
      c.revisionId,
      v.revision.version,
      publicationId,
      `payment-config-publication:${publicationId}`,
      request.access.correlationId,
      request.access.requestId,
      at,
    ],
  );
  if (head)
    await client.query(
      `UPDATE public.payment_config_publication_heads SET publication_id=$2,config_version_id=$3,config_version=$4,version=version+1,updated_at=$5 WHERE id=$1`,
      [head["id"], publicationId, c.revisionId, v.revision.version, at],
    );
  else
    await client.query(
      `INSERT INTO public.payment_config_publication_heads(id,publication_id,config_version_id,config_version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)`,
      [randomUUID(), publicationId, c.revisionId, v.revision.version, at],
    );
  // Account locks were acquired in sorted order during validation. Each activation
  // retains circuit health and historical evidence while fencing the old probe.
  for (const channel of [...v.revision.configuration.channels].sort((a, b) =>
    a.providerAccountId.localeCompare(b.providerAccountId),
  )) {
    const [account] = await draftRows(
      client,
      "SELECT id,environment,health_status FROM public.payment_provider_accounts WHERE id=$1",
      [channel.providerAccountId],
    );
    await draftRows(
      client,
      "SELECT provider_account_id FROM public.payment_provider_health_state WHERE provider_account_id=$1 FOR UPDATE",
      [channel.providerAccountId],
    );
    const [version] = await draftRows(
      client,
      "SELECT coalesce(max(policy_version),0)+1 version FROM public.payment_provider_health_policies WHERE provider_account_id=$1",
      [channel.providerAccountId],
    );
    const policy = paymentHealthPolicySchema.parse({
      schemaVersion: 1,
      providerAccountId: channel.providerAccountId,
      environment: account!["environment"],
      version: Number(version!["version"]),
      ...channel.healthPolicy,
    });
    await client.query(
      `INSERT INTO public.payment_provider_health_policies(provider_account_id,environment,policy_version,policy,policy_hash) VALUES($1,$2,$3,$4::jsonb,$5)`,
      [
        policy.providerAccountId,
        policy.environment,
        policy.version,
        JSON.stringify(policy),
        configurationHash(policy),
      ],
    );
    await client.query(
      `INSERT INTO public.admin_payment_configuration_activations(publication_id,provider_account_id,environment,policy_version,created_at) VALUES($1,$2,$3,$4,$5)`,
      [
        publicationId,
        policy.providerAccountId,
        policy.environment,
        policy.version,
        at,
      ],
    );
    await client.query(
      `INSERT INTO public.payment_provider_health_state(provider_account_id,environment,policy_version,probe_due_at) VALUES($1,$2,$3,CASE WHEN $4='UNAVAILABLE' THEN $5::timestamptz+$6::bigint*interval '1 millisecond' ELSE NULL END) ON CONFLICT(provider_account_id) DO UPDATE SET policy_version=EXCLUDED.policy_version,generation=payment_provider_health_state.generation+1,probe_context=NULL,probe_id=NULL,probe_expires_at=NULL,lease_account_version=NULL,lease_policy_version=NULL,probe_due_at=EXCLUDED.probe_due_at,updated_at=GREATEST(payment_provider_health_state.updated_at,$5::timestamptz)`,
      [
        policy.providerAccountId,
        policy.environment,
        policy.version,
        account!["health_status"],
        at,
        policy.openDurationMs,
      ],
    );
  }
  return recordConfigurationReceipt(client, request, authority, head, {
    revisionId: c.revisionId,
    reviewId: null,
    at,
    publicationId,
    generation,
    auditId,
  });
}

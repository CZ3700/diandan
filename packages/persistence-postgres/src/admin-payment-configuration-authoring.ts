import { randomUUID } from "node:crypto";
import type { AdminPaymentConfigurationStoreRequest } from "@fan-support/contracts";
import type { ConfigurationAuthority } from "./admin-payment-configuration-authorization.js";
import { copyConfigurationTranslation } from "./admin-payment-configuration-copy.js";
import {
  draftRows,
  configurationHash,
  serializeConfiguration,
  configurationFailure,
  configurationTime,
  configurationAudit,
  translationHash,
  UNBOUND_PAYMENT_TRANSLATION,
  type TransactionClient,
  type DraftRow,
} from "./admin-payment-configuration-data.js";
export async function saveConfiguration(
  client: TransactionClient,
  request: AdminPaymentConfigurationStoreRequest,
  authority: ConfigurationAuthority,
) {
  const c = request.command;
  if (c.action !== "SAVE") throw new Error("Expected SAVE");
  if (
    c.sourceRevisionId &&
    !(
      await draftRows(
        client,
        "SELECT config_version_id FROM public.admin_payment_configuration_revisions WHERE config_version_id=$1",
        [c.sourceRevisionId],
      )
    ).length
  )
    return configurationFailure("NOT_FOUND");
  const accounts = await draftRows(
    client,
    "SELECT id,environment,adapter_key FROM public.payment_provider_accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",
    [c.configuration.channels.map((a) => a.providerAccountId)],
  );
  if (accounts.length !== c.configuration.channels.length)
    return configurationFailure("NOT_FOUND");
  if (
    accounts.some(
      (a) =>
        !request.deployedAccounts.some(
          (d) =>
            d.providerAccountId.toLowerCase() ===
              String(a["id"]).toLowerCase() &&
            d.environment === a["environment"] &&
            d.adapterKey === a["adapter_key"],
        ),
    )
  )
    return configurationFailure("ADAPTER_UNAVAILABLE");
  const [capacity] = await draftRows(
    client,
    `SELECT count(*) total FROM (
      SELECT (channel->>'providerAccountId')::uuid id
        FROM public.admin_payment_configuration_revisions r
        CROSS JOIN LATERAL jsonb_array_elements(r.document->'channels') channel
      UNION SELECT unnest($1::uuid[])
      UNION SELECT unnest($2::uuid[])
    ) accounts`,
    [
      c.configuration.channels.map((a) => a.providerAccountId),
      request.deployedAccounts.map((a) => a.providerAccountId),
    ],
  );
  if (Number(capacity!["total"]) > 100) return configurationFailure("CONFLICT");
  const document = {
    ...c.configuration,
    channels: c.configuration.channels.map((channel) => {
      const english = channel.translations.find((t) => t.locale === "en");
      return {
        ...channel,
        translations: channel.translations.map((t) => ({
          ...t,
          translatedFromSourceHash:
            t.locale === "en"
              ? translationHash(t)
              : (t.translatedFromSourceHash ??
                (english ? translationHash(english) : null)),
        })),
      };
    }),
  };
  const id = randomUUID(),
    saveReceiptId = randomUUID(),
    at = await configurationTime(client);
  const [version] = await draftRows(
    client,
    `SELECT coalesce(max(version),0)+1 version FROM public.config_versions WHERE config_kind='PAYMENT_ROUTING'`,
  );
  await client.query(
    `INSERT INTO public.config_versions(id,config_kind,version,lifecycle,created_by,created_at) VALUES($1,'PAYMENT_ROUTING',$2,'DRAFT',$3,$4)`,
    [id, version!["version"], authority.actorId, at],
  );
  for (const channel of document.channels) {
    const providerConfigId = randomUUID();
    await client.query(
      `INSERT INTO public.payment_provider_configs(id,config_version_id,config_version,provider_account_id,enabled,display_order,rollout_basis_points,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        providerConfigId,
        id,
        version!["version"],
        channel.providerAccountId,
        channel.enabled,
        channel.displayOrder,
        channel.rolloutBasisPoints,
        at,
      ],
    );
    const english = channel.translations.find((t) => t.locale === "en");
    for (const t of channel.translations) {
      const tid = randomUUID(),
        hash = translationHash(t),
        source =
          t.locale === "en"
            ? hash
            : (t.translatedFromSourceHash ??
              (english
                ? translationHash(english)
                : UNBOUND_PAYMENT_TRANSLATION));
      if (
        await copyConfigurationTranslation(client, {
          sourceRevisionId: c.sourceRevisionId,
          revisionId: id,
          providerConfigId,
          providerAccountId: channel.providerAccountId,
          translationId: tid,
          translation: t,
          englishHash: english ? translationHash(english) : null,
          saveReceiptId,
          at,
        })
      )
        continue;
      await client.query(
        `INSERT INTO public.payment_provider_config_translations(id,config_version_id,provider_config_id,provider_account_id,locale,source_hash,translated_from_source_hash,origin,editor_id,edited_at,display_name,customer_hint,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'HUMAN',$8,$9,$10,$11,$9)`,
        [
          tid,
          id,
          providerConfigId,
          channel.providerAccountId,
          t.locale,
          hash,
          source,
          authority.actorId,
          at,
          t.displayName,
          t.customerHint,
        ],
      );
      await client.query(
        `INSERT INTO public.payment_provider_config_translation_reviews(id,provider_config_translation_id,sequence,status,created_at) VALUES($1,$2,1,'DRAFT',$3)`,
        [randomUUID(), tid, at],
      );
    }
  }
  await client.query(
    `INSERT INTO public.admin_payment_configuration_revisions(config_version_id,source_revision_id,document,document_hash,created_at) VALUES($1,$2,$3::jsonb,$4,$5)`,
    [
      id,
      c.sourceRevisionId,
      serializeConfiguration(document),
      configurationHash(document),
      at,
    ],
  );
  return { revisionId: id, at, reviewId: null, receiptId: saveReceiptId };
}
export async function reviewConfiguration(
  client: TransactionClient,
  request: AdminPaymentConfigurationStoreRequest,
  authority: ConfigurationAuthority,
) {
  const c = request.command;
  if (c.action !== "SUBMIT" && c.action !== "APPROVE")
    throw new Error("Expected review");
  const [parent] = await draftRows(
    client,
    `SELECT v.lifecycle FROM public.config_versions v JOIN public.admin_payment_configuration_revisions m ON m.config_version_id=v.id WHERE v.id=$1 FOR UPDATE OF v`,
    [c.revisionId],
  );
  if (!parent) return configurationFailure("NOT_FOUND");
  if (parent["lifecycle"] !== "DRAFT") return configurationFailure("CONFLICT");
  const [row] = await draftRows(
    client,
    `SELECT t.*,en.source_hash english_hash,r.sequence,r.status FROM public.payment_provider_config_translations t LEFT JOIN public.payment_provider_config_translations en ON en.provider_config_id=t.provider_config_id AND en.locale='en' JOIN LATERAL(SELECT * FROM public.payment_provider_config_translation_reviews r WHERE r.provider_config_translation_id=t.id ORDER BY sequence DESC LIMIT 1) r ON true WHERE t.config_version_id=$1 AND t.provider_account_id=$2 AND t.locale=$3 FOR UPDATE OF t`,
    [c.revisionId, c.providerAccountId, c.locale],
  );
  if (!row) return configurationFailure("NOT_FOUND");
  if (row["english_hash"] !== row["translated_from_source_hash"])
    return configurationFailure("TRANSLATION_STALE");
  if (
    (c.action === "SUBMIT" && row["status"] !== "DRAFT") ||
    (c.action === "APPROVE" && row["status"] !== "IN_REVIEW")
  )
    return configurationFailure("CONFLICT");
  if (c.action === "APPROVE" && row["editor_id"] === authority.actorId)
    return configurationFailure("SELF_REVIEW");
  const id = randomUUID(),
    at = await configurationTime(client),
    approved = c.action === "APPROVE";
  await client.query(
    `INSERT INTO public.payment_provider_config_translation_reviews(id,provider_config_translation_id,sequence,status,submitted_at,reviewer_id,reviewed_at,reviewed_source_hash,reviewed_content_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      row["id"],
      Number(row["sequence"]) + 1,
      approved ? "APPROVED" : "IN_REVIEW",
      approved ? null : at,
      approved ? authority.actorId : null,
      approved ? at : null,
      approved ? row["translated_from_source_hash"] : null,
      approved ? row["source_hash"] : null,
      at,
    ],
  );
  return { revisionId: c.revisionId, at, reviewId: id };
}
export async function recordConfigurationReceipt(
  client: TransactionClient,
  request: AdminPaymentConfigurationStoreRequest,
  authority: ConfigurationAuthority,
  head: DraftRow | undefined,
  result: {
    revisionId: string;
    at: string;
    reviewId: string | null;
    publicationId?: string;
    generation?: number;
    auditId?: string;
    receiptId?: string;
  },
) {
  const c = request.command;
  if (!("idempotencyKey" in c)) throw new Error("Expected durable command");
  const auditId =
    result.auditId ??
    (await configurationAudit(
      client,
      request,
      authority.actorId,
      `PAYMENT_CONFIGURATION_${c.action}`,
      result.revisionId,
      result.at,
    ));
  await client.query(
    `INSERT INTO public.admin_payment_configuration_receipts(id,actor_id,session_id,action,idempotency_key,request_hash,config_version_id,review_id,publication_id,generation,expected_publication_id,reason_code,confirmed,audit_log_id,request_id,correlation_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      result.receiptId ?? randomUUID(),
      authority.actorId,
      authority.sessionId,
      c.action,
      c.idempotencyKey,
      request.requestHash,
      result.revisionId,
      result.reviewId,
      result.publicationId ?? null,
      result.generation ?? Number(head?.["version"] ?? 0),
      "expectedPublicationId" in c ? c.expectedPublicationId : null,
      "reasonCode" in c ? c.reasonCode : null,
      "confirmed" in c ? c.confirmed : false,
      auditId,
      request.access.requestId,
      request.access.correlationId,
      result.at,
    ],
  );
  return {
    schemaVersion: 1 as const,
    outcome: "SUCCESS" as const,
    kind: "MUTATION" as const,
    action: c.action,
    revisionId: result.revisionId,
    publicationId: result.publicationId ?? null,
    generation: result.generation ?? Number(head?.["version"] ?? 0),
    replayed: false,
  };
}

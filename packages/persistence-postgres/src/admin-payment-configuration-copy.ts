import { randomUUID } from "node:crypto";
import type { PaymentConfigurationTranslation } from "@fan-support/contracts";
import {
  draftRows,
  type TransactionClient,
} from "./admin-payment-configuration-data.js";
/** Copies proven historical facts, never attributes a fresh approval to an absent reviewer. */
export async function copyConfigurationTranslation(
  client: TransactionClient,
  input: {
    sourceRevisionId: string | null;
    revisionId: string;
    providerConfigId: string;
    providerAccountId: string;
    translationId: string;
    translation: PaymentConfigurationTranslation;
    englishHash: string | null;
    saveReceiptId: string;
    at: string;
  },
) {
  if (
    !input.sourceRevisionId ||
    !input.englishHash ||
    input.translation.translatedFromSourceHash !== input.englishHash
  )
    return false;
  const [source] = await draftRows(
    client,
    `SELECT t.id,r.id approval_id FROM public.payment_provider_config_translations t JOIN public.admin_payment_configuration_revisions m ON m.config_version_id=t.config_version_id JOIN public.payment_provider_config_translations en ON en.provider_config_id=t.provider_config_id AND en.locale='en' JOIN LATERAL(SELECT * FROM public.payment_provider_config_translation_reviews r WHERE r.provider_config_translation_id=t.id ORDER BY sequence DESC LIMIT 1) r ON r.status='APPROVED' WHERE t.config_version_id=$1 AND t.provider_account_id=$2 AND t.locale=$3 AND t.display_name=$4 AND t.customer_hint=$5 AND t.translated_from_source_hash=$6 AND en.source_hash=$6 AND EXISTS(SELECT 1 FROM public.payment_config_publications p WHERE p.config_version_id=m.config_version_id)`,
    [
      input.sourceRevisionId,
      input.providerAccountId,
      input.translation.locale,
      input.translation.displayName,
      input.translation.customerHint,
      input.englishHash,
    ],
  );
  if (!source) return false;
  await client.query(
    `INSERT INTO public.payment_provider_config_translations(id,config_version_id,provider_config_id,provider_account_id,locale,source_hash,translated_from_source_hash,origin,import_batch_id,editor_id,edited_at,display_name,customer_hint,created_at) SELECT $1,$2,$3,provider_account_id,locale,source_hash,translated_from_source_hash,origin,import_batch_id,editor_id,edited_at,display_name,customer_hint,$4 FROM public.payment_provider_config_translations WHERE id=$5`,
    [
      input.translationId,
      input.revisionId,
      input.providerConfigId,
      input.at,
      source["id"],
    ],
  );
  // INSERT each historical step in order so the existing review state guard stays active.
  for (const sequence of [1, 2, 3])
    await client.query(
      `INSERT INTO public.payment_provider_config_translation_reviews(id,provider_config_translation_id,sequence,status,submitted_at,reviewer_id,reviewed_at,reviewed_source_hash,reviewed_content_hash,created_at) SELECT $1,$2,sequence,status,submitted_at,reviewer_id,reviewed_at,reviewed_source_hash,reviewed_content_hash,$3 FROM public.payment_provider_config_translation_reviews WHERE provider_config_translation_id=$4 AND sequence=$5`,
      [randomUUID(), input.translationId, input.at, source["id"], sequence],
    );
  await client.query(
    `INSERT INTO public.admin_payment_configuration_translation_copies(target_translation_id,source_translation_id,source_approval_review_id,save_receipt_id,created_at) VALUES($1,$2,$3,$4,$5)`,
    [
      input.translationId,
      source["id"],
      source["approval_id"],
      input.saveReceiptId,
      input.at,
    ],
  );
  return true;
}

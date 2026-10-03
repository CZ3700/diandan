import {
  contentAuthoringWriteCommandSchema,
  publishedContentReadCommandSchema,
  type GiftCommerceWriteCommand,
} from "@fan-support/contracts";
import { projectPublishedContent } from "@fan-support/content";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { createContentAuthoringRepository } from "./content-authoring-repository.js";
import { loadPublishedContentContext } from "./published-content-repository.js";
import {
  readGiftRevisionProfile,
  readGiftPublicationProfile,
} from "./gift-commerce-gift-profile.js";
import {
  giftCommerceFailure,
  giftCommerceTime,
  giftReceiptFields,
  insertGiftRow,
  readGiftCommerceReceipt,
  writeGiftAudit,
} from "./gift-commerce-gift-data.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

async function publishableGift(
  client: TransactionClient,
  scope: TransactionScopeControl,
  prior: DraftRow,
  publicMediaBaseUrl: string,
) {
  const response = await loadPublishedContentContext(
    client,
    scope,
    publishedContentReadCommandSchema.parse({
      schemaVersion: 1,
      locator: { kind: "GIFT", handle: prior["handle"] },
      locale: "en",
    }),
    publicMediaBaseUrl,
  );
  if (
    response.outcome === "FAILURE" ||
    projectPublishedContent(response.context).outcome === "FAILURE"
  )
    return false;
  await readGiftPublicationProfile(client, {
    publicationId: response.context.publication.publicationId,
    giftId: String(prior["id"]),
    giftRevisionId: String(prior["published_revision_id"]),
    manifestHash: response.context.publication.manifestHash,
  });
  return true;
}
async function writeIdentity(
  client: TransactionClient,
  scope: TransactionScopeControl,
  input: GiftCommerceWriteCommand,
  prior: DraftRow | undefined,
  publicMediaBaseUrl: string | undefined,
) {
  const command = input.command;
  if (command.action !== "CREATE_GIFT" && command.action !== "SET_GIFT_STATUS")
    return giftCommerceFailure("INVALID_COMMAND");
  if (command.action === "SET_GIFT_STATUS") {
    if (prior?.["status"] === command.status)
      return giftCommerceFailure("INVALID_COMMAND");
    if (
      (command.status === "active" || command.status === "paused") &&
      !prior?.["published_revision_id"]
    )
      return giftCommerceFailure("GIFT_NOT_READY");
    if (command.status === "active") {
      if (!publicMediaBaseUrl)
        return giftCommerceFailure("COMMERCE_UNAVAILABLE");
      if (
        !prior ||
        !(await publishableGift(client, scope, prior, publicMediaBaseUrl))
      )
        return giftCommerceFailure("GIFT_NOT_READY");
    }
  }
  const handle =
    command.action === "CREATE_GIFT"
      ? command.handle
      : String(prior?.["handle"]);
  if (command.action === "CREATE_GIFT") {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('fan-support:gift-handle:'||$1,0))",
      [handle],
    );
    const [occupied] = await draftRows(
      client,
      "SELECT 1 FROM public.gifts WHERE handle=$1 UNION ALL SELECT 1 FROM public.slug_redirects WHERE entity_type='GIFT' AND old_handle=$1 LIMIT 1",
      [handle],
    );
    if (occupied) return giftCommerceFailure("ALREADY_EXISTS");
  }
  const time = await giftCommerceTime(
    client,
    input,
    prior ? [String(prior["updated_at"])] : [],
  );
  const giftId =
    command.action === "CREATE_GIFT" ? time.subjectId : command.giftId;
  const status = command.action === "CREATE_GIFT" ? "draft" : command.status;
  await writeGiftAudit(client, input, time, "GIFT_IDENTITY", giftId);
  await insertGiftRow(client, "gift_identity_receipts", {
    ...giftReceiptFields(input, time),
    gift_id: giftId,
    action: command.action,
    expected_base_version: command.expectedBaseVersion,
    result_base_version: command.expectedBaseVersion + 1,
    old_status: prior?.["status"] ?? null,
    new_status: status,
    handle,
    previous_updated_at: prior?.["updated_at"] ?? null,
  });
  if (command.action === "CREATE_GIFT")
    await client.query(
      "INSERT INTO public.gifts(id,handle,status,version,created_at,updated_at) VALUES($1,$2,'draft',1,$3,$3)",
      [giftId, handle, time.at],
    );
  else
    await client.query(
      "UPDATE public.gifts SET status=$2,version=version+1,updated_at=$3 WHERE id=$1 AND version=$4",
      [giftId, status, time.at, command.expectedBaseVersion],
    );
  return readGiftCommerceReceipt(client, time.id, input.principal.actorId);
}
async function writeVariant(
  client: TransactionClient,
  input: GiftCommerceWriteCommand,
  gift: DraftRow,
) {
  const command = input.command;
  if (command.action !== "SAVE_VARIANT")
    return giftCommerceFailure("INVALID_COMMAND");
  await client.query(
    "SELECT wish_id FROM public.wish_bindings WHERE gift_id=$1 FOR UPDATE",
    [command.giftId],
  );
  let prior: DraftRow | undefined;
  if (command.giftVariantId !== null) {
    const [row] = await draftRows(
      client,
      "SELECT to_jsonb(v.*) AS variant FROM public.gift_variants v WHERE id=$1 AND gift_id=$2 FOR UPDATE",
      [command.giftVariantId, command.giftId],
    );
    prior = row?.["variant"] as DraftRow | undefined;
    if (!prior) return giftCommerceFailure("NOT_FOUND");
    if (Number(prior["version"]) !== command.expectedVariantVersion)
      return giftCommerceFailure("STALE_VERSION");
    if (prior["status"] === "archived") return giftCommerceFailure("FORBIDDEN");
    if (
      prior["sku"] !== command.sku ||
      prior["inventory_policy"] !== command.inventoryPolicy
    ) {
      const [locked] = await draftRows(
        client,
        "SELECT public.gift_commerce_variant_policy_locked($1) AS locked",
        [command.giftVariantId],
      );
      if (locked?.["locked"] !== false)
        return giftCommerceFailure("INVENTORY_POLICY_LOCKED");
    }
  } else {
    const [count] = await draftRows(
      client,
      "SELECT count(*)::integer AS count FROM public.gift_variants WHERE gift_id=$1",
      [command.giftId],
    );
    if (Number(count?.["count"]) >= 64)
      return giftCommerceFailure("INVALID_CONTENT");
  }
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('fan-support:gift-sku:'||$1,0))",
    [command.sku],
  );
  const [occupied] = await draftRows(
    client,
    "SELECT id FROM public.gift_variants WHERE sku=$1 AND ($2::uuid IS NULL OR id<>$2)",
    [command.sku, command.giftVariantId],
  );
  if (occupied) return giftCommerceFailure("ALREADY_EXISTS");
  const eligible = command.eligibleIdolIds.map((id) => id.toLowerCase()).sort();
  const idols = await draftRows(
    client,
    "SELECT id FROM public.idols WHERE id=ANY($1::uuid[]) AND status<>'archived' ORDER BY id FOR SHARE",
    [eligible],
  );
  if (idols.length !== eligible.length)
    return giftCommerceFailure("INVALID_CONTENT");
  const previousIds =
    command.giftVariantId === null
      ? []
      : (
          await draftRows(
            client,
            "SELECT idol_id FROM public.gift_variant_idol_eligibility WHERE gift_variant_id=$1 ORDER BY idol_id",
            [command.giftVariantId],
          )
        ).map((row) => String(row["idol_id"]));
  if (command.status === "active" && gift["published_revision_id"] !== null) {
    const [labels] = await draftRows(
      client,
      "SELECT count(*)::integer AS count FROM public.gift_variant_labels l JOIN public.gift_revision_translations t ON t.id=l.gift_translation_id WHERE t.gift_revision_id=$1 AND l.gift_variant_id=$2",
      [gift["published_revision_id"], command.giftVariantId],
    );
    if (Number(labels?.["count"]) !== 7)
      return giftCommerceFailure("GIFT_NOT_READY");
  }
  const time = await giftCommerceTime(client, input, [
    String(gift["updated_at"]),
    ...(prior ? [String(prior["updated_at"])] : []),
  ]);
  const variantId = command.giftVariantId ?? time.subjectId;
  await writeGiftAudit(client, input, time, "GIFT_VARIANT", variantId);
  await insertGiftRow(client, "gift_variant_receipts", {
    ...giftReceiptFields(input, time),
    gift_id: command.giftId,
    gift_variant_id: variantId,
    expected_base_version: command.expectedBaseVersion,
    expected_variant_version: command.expectedVariantVersion,
    result_variant_version: command.expectedVariantVersion + 1,
    old_sku: prior?.["sku"] ?? null,
    new_sku: command.sku,
    old_status: prior?.["status"] ?? null,
    new_status: command.status,
    old_inventory_policy: prior?.["inventory_policy"] ?? null,
    new_inventory_policy: command.inventoryPolicy,
    old_eligible_idol_ids: previousIds,
    new_eligible_idol_ids: eligible,
    previous_updated_at: prior?.["updated_at"] ?? null,
    previous_base_updated_at: gift["updated_at"],
  });
  if (prior) {
    await client.query(
      "UPDATE public.gift_variants SET sku=$2,status=$3,inventory_policy=$4,version=version+1,updated_at=$5 WHERE id=$1 AND version=$6",
      [
        variantId,
        command.sku,
        command.status,
        command.inventoryPolicy,
        time.at,
        command.expectedVariantVersion,
      ],
    );
    if (
      prior["sku"] !== command.sku ||
      prior["inventory_policy"] !== command.inventoryPolicy
    )
      await client.query(
        "UPDATE public.inventory_items SET sku=$2,policy=$3 WHERE gift_variant_id=$1",
        [variantId, command.sku, command.inventoryPolicy],
      );
    await client.query(
      "DELETE FROM public.gift_variant_idol_eligibility WHERE gift_variant_id=$1",
      [variantId],
    );
  } else
    await client.query(
      "INSERT INTO public.gift_variants(id,gift_id,sku,status,inventory_policy,version,created_at,updated_at) VALUES($1,$2,$3,'draft',$4,1,$5,$5)",
      [
        variantId,
        command.giftId,
        command.sku,
        command.inventoryPolicy,
        time.at,
      ],
    );
  for (const idolId of eligible)
    await client.query(
      "INSERT INTO public.gift_variant_idol_eligibility(gift_variant_id,idol_id,created_at) VALUES($1,$2,$3)",
      [variantId, idolId, time.at],
    );
  return readGiftCommerceReceipt(client, time.id, input.principal.actorId);
}
async function writeContent(
  client: TransactionClient,
  scope: TransactionScopeControl,
  input: GiftCommerceWriteCommand,
  gift: DraftRow,
) {
  const command = input.command;
  if (command.action !== "SAVE_GIFT_CONTENT")
    return giftCommerceFailure("INVALID_COMMAND");
  const receipt = await giftCommerceTime(client, input, [
    String(gift["updated_at"]),
  ]);
  const authoring = createContentAuthoringRepository(client, scope, {
    giftKind: command.giftKind,
    trustedCommerceTime: receipt.at,
    async onGiftRevisionPrepared(prepared) {
      const profile = await readGiftRevisionProfile(
        client,
        command.authoring.target.giftId,
        prepared.revisionId,
      );
      if (profile.kind !== "PROFILE")
        throw new Error("Missing prepared gift classification");
      const time = { ...receipt, at: prepared.createdAt };
      await writeGiftAudit(
        client,
        input,
        time,
        "GIFT_REVISION_PROFILE",
        prepared.revisionId,
      );
      await insertGiftRow(client, "gift_content_profile_receipts", {
        ...giftReceiptFields(input, time),
        gift_id: command.authoring.target.giftId,
        gift_revision_id: prepared.revisionId,
        authoring_receipt_id: prepared.authoringReceiptId,
        expected_base_version: command.expectedBaseVersion,
        expected_authoring_version: command.authoring.expectedVersion,
        result_authoring_version: command.authoring.expectedVersion + 1,
        profile_hash: profile.profile.profileHash,
        previous_base_updated_at: gift["updated_at"],
      });
    },
  });
  const result = await authoring.write(
    contentAuthoringWriteCommandSchema.parse({
      schemaVersion: 1,
      actorId: input.principal.actorId,
      requestId: input.requestId,
      command: {
        ...command.authoring,
        reasonCode: command.reasonCode,
        idempotencyKey: command.idempotencyKey,
      },
    }),
  );
  if (result.outcome === "FAILURE") return result;
  return readGiftCommerceReceipt(client, receipt.id, input.principal.actorId);
}
export async function writeGiftCommerceGift(
  client: TransactionClient,
  scope: TransactionScopeControl,
  input: GiftCommerceWriteCommand,
  publicMediaBaseUrl: string | undefined,
) {
  const command = input.command;
  if (
    command.action !== "CREATE_GIFT" &&
    command.action !== "SET_GIFT_STATUS" &&
    command.action !== "SAVE_VARIANT" &&
    command.action !== "SAVE_GIFT_CONTENT"
  )
    return giftCommerceFailure("INVALID_COMMAND");
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  let prior: DraftRow | undefined;
  if (command.action !== "CREATE_GIFT") {
    const giftId =
      command.action === "SAVE_GIFT_CONTENT"
        ? command.authoring.target.giftId
        : command.giftId;
    const [row] = await draftRows(
      client,
      "SELECT to_jsonb(g.*) AS gift FROM public.gifts g WHERE id=$1 FOR UPDATE",
      [giftId],
    );
    prior = row?.["gift"] as DraftRow | undefined;
    if (!prior) return giftCommerceFailure("NOT_FOUND");
    if (Number(prior["version"]) !== command.expectedBaseVersion)
      return giftCommerceFailure("STALE_VERSION");
    if (prior["status"] === "archived") return giftCommerceFailure("FORBIDDEN");
  }
  if (command.action === "CREATE_GIFT" || command.action === "SET_GIFT_STATUS")
    return writeIdentity(client, scope, input, prior, publicMediaBaseUrl);
  if (!prior) return giftCommerceFailure("NOT_FOUND");
  return command.action === "SAVE_VARIANT"
    ? writeVariant(client, input, prior)
    : writeContent(client, scope, input, prior);
}

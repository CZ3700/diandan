import { randomUUID } from "node:crypto";
import {
  storefrontBrandSchema,
  storefrontBrandViewSchema,
  storefrontLogoViewSchema,
  storefrontBrandResponseSchema,
  storefrontLogoProcessingResultSchema,
  type StorefrontBrandResponse,
} from "@fan-support/contracts";
import type {
  StorefrontBrandMutationInput,
  StorefrontBrandRepository,
} from "@fan-support/persistence-port";
import {
  draftRows,
  draftTimestamp,
  type DraftRow,
} from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";
function logo(row: DraftRow, publicBaseUrl: string | undefined) {
  if (!publicBaseUrl) throw new Error("Brand media origin unavailable");
  return storefrontLogoViewSchema.parse({
    assetId: row["id"],
    url: new URL(
      String(row["object_key"]),
      publicBaseUrl.endsWith("/") ? publicBaseUrl : `${publicBaseUrl}/`,
    ).href,
    width: Number(row["width"]),
    height: Number(row["height"]),
  });
}
export async function brandView(
  client: TransactionClient,
  publicBaseUrl: string | undefined,
  value: unknown,
) {
  const brand = storefrontBrandSchema.parse(value);
  const find = async (id: string | null) => {
    if (id === null) return null;
    const [row] = await draftRows(
      client,
      "SELECT id,object_key,width,height FROM public.storefront_brand_logo_assets WHERE id=$1",
      [id],
    );
    if (!row) throw new Error("Brand asset unavailable");
    return logo(row, publicBaseUrl);
  };
  return storefrontBrandViewSchema.parse({
    schemaVersion: 1,
    lightLogo: await find(brand.lightLogoAssetId),
    darkLogo: await find(brand.darkLogoAssetId),
  });
}
export async function preparedLogo(
  client: TransactionClient,
  input: StorefrontBrandMutationInput,
): Promise<StorefrontBrandResponse | null> {
  if (input.command.action !== "PREPARE_LOGO")
    throw new Error("Invalid logo action");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `storefront-brand:${input.principal.actorId}:PREPARE_LOGO:${input.command.idempotencyKey}`,
  ]);
  const [row] = await draftRows(
    client,
    "SELECT request_hash,response,session_id FROM public.storefront_brand_receipts WHERE actor_id=$1 AND action='PREPARE_LOGO' AND idempotency_key=$2",
    [input.principal.actorId, input.command.idempotencyKey],
  );
  if (!row) return null;
  if (
    row["request_hash"] !== input.requestHash ||
    row["session_id"] !== input.principal.sessionId.toLowerCase()
  )
    return {
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "IDEMPOTENCY_CONFLICT",
    };
  const response = storefrontBrandResponseSchema.parse(row["response"]);
  if (response.outcome !== "SUCCESS" || response.kind !== "LOGO")
    throw new Error("Invalid brand receipt");
  return { ...response, replayed: true };
}
export async function saveLogo(
  client: TransactionClient,
  publicBaseUrl: string | undefined,
  input: Parameters<StorefrontBrandRepository["saveLogo"]>[0],
): Promise<StorefrontBrandResponse> {
  if (input.command.action !== "PREPARE_LOGO")
    throw new Error("Invalid logo action");
  const replay = await preparedLogo(client, input);
  if (replay) return replay;
  const processed = storefrontLogoProcessingResultSchema.parse(input.processed);
  if (
    processed.outcome !== "SUCCESS" ||
    processed.uploadId.toLowerCase() !== input.command.uploadId.toLowerCase()
  )
    throw new Error("Invalid logo result");
  const [ticket] = await draftRows(
    client,
    "SELECT * FROM public.media_upload_reservations WHERE id=$1 FOR UPDATE",
    [input.command.uploadId],
  );
  const [instant] = await draftRows(client, "SELECT clock_timestamp() AS now");
  const at = draftTimestamp(instant?.["now"]);
  if (
    !ticket ||
    ticket["actor_id"] !== input.principal.actorId.toLowerCase() ||
    ticket["session_id"] !== input.principal.sessionId.toLowerCase() ||
    ticket["status"] !== "PENDING" ||
    Number(ticket["version"]) !== 1 ||
    ticket["registered_asset_id"] !== null ||
    draftTimestamp(ticket["expires_at"]) <= at ||
    ticket["checksum_sha256"] !== processed.sourceChecksumSha256
  )
    return { schemaVersion: 1, outcome: "FAILURE", code: "STALE_VERSION" };
  const [existing] = await draftRows(
    client,
    "SELECT * FROM public.storefront_brand_logo_assets WHERE upload_id=$1",
    [input.command.uploadId],
  );
  if (
    existing &&
    (existing["object_key"] !== processed.image.objectKey ||
      existing["checksum_sha256"] !== processed.image.checksumSha256)
  )
    return {
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "IDEMPOTENCY_CONFLICT",
    };
  const assetId = existing ? String(existing["id"]) : randomUUID(),
    auditId = randomUUID();
  await client.query(
    "INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,request_id,correlation_id,outcome,created_at) VALUES($1,'ADMIN',$2,'STOREFRONT_BRAND_PREPARE_LOGO','STOREFRONT_BRAND',$3,$4,$4,'SUCCEEDED',$5)",
    [auditId, input.principal.actorId, assetId, input.requestId, at],
  );
  if (!existing)
    await client.query(
      "INSERT INTO public.storefront_brand_logo_assets(id,upload_id,actor_id,session_id,request_id,audit_log_id,source_checksum_sha256,checksum_sha256,object_key,mime_type,width,height,byte_size,rights_reference,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'image/webp',$10,$11,$12,$13,$14)",
      [
        assetId,
        input.command.uploadId,
        input.principal.actorId,
        input.principal.sessionId,
        input.requestId,
        auditId,
        processed.sourceChecksumSha256,
        processed.image.checksumSha256,
        processed.image.objectKey,
        processed.image.width,
        processed.image.height,
        processed.image.byteSize,
        ticket["rights_reference"],
        at,
      ],
    );
  const response = storefrontBrandResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "LOGO",
    logo: logo(
      {
        id: assetId,
        object_key: processed.image.objectKey,
        width: processed.image.width,
        height: processed.image.height,
      },
      publicBaseUrl,
    ),
    replayed: false,
  });
  await client.query(
    "INSERT INTO public.storefront_brand_receipts(id,actor_id,session_id,action,idempotency_key,request_hash,response,audit_log_id,request_id,created_at) VALUES($1,$2,$3,'PREPARE_LOGO',$4,$5,$6::jsonb,$7,$8,$9)",
    [
      randomUUID(),
      input.principal.actorId,
      input.principal.sessionId,
      input.command.idempotencyKey,
      input.requestHash,
      JSON.stringify(response),
      auditId,
      input.requestId,
      at,
    ],
  );
  return response;
}

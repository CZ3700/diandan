import {
  wishGalleryReadCommandSchema,
  wishGalleryPageSchema,
  wishGalleryWithdrawCommandSchema,
  wishGalleryWithdrawnSchema,
} from "@fan-support/contracts";
import {
  OrderAccessRepositoryError,
  WishGalleryRepositoryError,
  type WishGalleryRepository,
} from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import { cartTimestamp } from "./cart-runtime-data.js";
import {
  activeAccessSession,
  lockAccessOrder,
  sessionOwner,
} from "./order-access-data.js";
import {
  galleryCursor,
  galleryEntry,
  parseGalleryCursor,
  wishRefundedInFullSql,
} from "./wish-gallery-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

export function createWishGalleryRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  publicMediaBaseUrl: string,
): WishGalleryRepository {
  const run = <T>(work: () => Promise<T>) =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof WishGalleryRepositoryError) throw error;
        if (error instanceof OrderAccessRepositoryError)
          throw new WishGalleryRepositoryError("ACCESS_DENIED");
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  return {
    read(input) {
      return run(async () => {
        const parsed = wishGalleryReadCommandSchema.safeParse(input);
        if (!parsed.success)
          throw new WishGalleryRepositoryError("INVALID_REQUEST");
        const command = parsed.data,
          cursor = parseGalleryCursor(command.cursor),
          limit = command.limit ?? 20;
        const rows = await draftRows(
          client,
          `SELECT e.entry_id,${cartTimestamp("s.supported_at")} supported_at,
        i.idol_handle,i.idol_display_name,i.idol_translation_resolved_locale,i.gift_translation_resolved_locale,i.idol_portrait_alt,portrait.object_key idol_portrait_public_object_key,
        i.gift_title,i.gift_image_alt,i.idol_portrait_alt_resolved_locale,i.gift_image_alt_resolved_locale,gift_image.object_key gift_image_public_object_key,c.visibility,c.public_alias
       FROM public.wish_gallery_entries e JOIN public.wish_gallery_consents c ON c.order_item_id=e.order_item_id
       JOIN public.wish_supports s ON s.order_item_id=e.order_item_id JOIN public.order_items i ON i.id=e.order_item_id
       JOIN public.orders o ON o.id=i.order_id JOIN public.idols idol ON idol.id=i.idol_id
       JOIN public.idol_publication_heads head ON head.idol_id=idol.id AND head.idol_revision_id=idol.published_revision_id
       JOIN public.content_publications publication ON publication.id=head.publication_id AND publication.content_type='IDOL'
         AND publication.idol_id=idol.id AND publication.idol_revision_id=head.idol_revision_id
       JOIN public.idol_revisions revision ON revision.id=head.idol_revision_id AND revision.idol_id=idol.id
         AND revision.lifecycle=CASE publication.action WHEN 'PUBLISH' THEN 'PUBLISHED' ELSE 'SUPERSEDED' END
       JOIN LATERAL(SELECT v.object_key FROM public.media_assets asset JOIN public.media_variants v ON v.media_asset_id=asset.id
         WHERE asset.id=i.idol_portrait_asset_id AND asset.checksum_sha256=i.idol_portrait_checksum_sha256 AND asset.object_key=i.idol_portrait_object_key
         AND asset.rights_status='APPROVED' AND v.status='READY' AND v.width<=asset.width AND v.height<=asset.height
         AND v.width::bigint*asset.height=v.height::bigint*asset.width ORDER BY v.width DESC,v.id LIMIT 1) portrait ON true
       JOIN LATERAL(SELECT v.object_key FROM public.media_assets asset JOIN public.media_variants v ON v.media_asset_id=asset.id
         WHERE asset.id=i.gift_image_asset_id AND asset.checksum_sha256=i.gift_image_checksum_sha256 AND asset.object_key=i.gift_image_object_key
         AND asset.rights_status='APPROVED' AND v.status='READY' AND v.width<=asset.width AND v.height<=asset.height
         AND v.width::bigint*asset.height=v.height::bigint*asset.width ORDER BY v.width DESC,v.id LIMIT 1) gift_image ON true
       WHERE i.gift_kind='WISH' AND c.visibility IN('PUBLIC_ANONYMOUS','PUBLIC_NAMED')
         AND o.payment_status IN('PAID','PARTIALLY_REFUNDED') AND o.dispute_status<>'LOST' AND NOT ${wishRefundedInFullSql}
         AND idol.status IN('active','paused') AND NOT EXISTS(SELECT 1 FROM public.content_publications successor WHERE successor.replaces_publication_id=publication.id)
         AND NOT EXISTS(SELECT 1 FROM public.wish_gallery_withdrawals w WHERE w.entry_id=e.entry_id)
         AND ($1::uuid IS NULL OR i.idol_id=$1::uuid)
         AND ($2::timestamptz IS NULL OR (s.supported_at,e.entry_id)<($2::timestamptz,$3::uuid))
       ORDER BY s.supported_at DESC,e.entry_id DESC LIMIT $4::integer`,
          [
            command.idolId ?? null,
            cursor?.supportedAt ?? null,
            cursor?.entryId ?? null,
            limit + 1,
          ],
        );
        const page = rows.slice(0, limit),
          last = page.at(-1);
        return wishGalleryPageSchema.parse({
          schemaVersion: 1,
          entries: page.map((row) => galleryEntry(row, publicMediaBaseUrl)),
          nextCursor:
            rows.length > limit && last
              ? galleryCursor(
                  String(last["supported_at"]),
                  String(last["entry_id"]),
                )
              : null,
        });
      });
    },
    withdraw(input) {
      return run(async () => {
        const parsed = wishGalleryWithdrawCommandSchema.safeParse(input);
        if (!parsed.success)
          throw new WishGalleryRepositoryError("INVALID_REQUEST");
        const command = parsed.data;
        const owner = await sessionOwner(
          client,
          command.sessionCandidates,
          command.publicOrderId,
        );
        const order = await lockAccessOrder(
          client,
          owner["order_id"],
          owner["cart_id"],
        );
        const session = await activeAccessSession(
          client,
          order["id"],
          command.publicOrderId,
          command.sessionCandidates,
        );
        const [entry] = await draftRows(
          client,
          `SELECT e.entry_id FROM public.wish_gallery_entries e JOIN public.order_items i ON i.id=e.order_item_id
        WHERE e.entry_id=$1::uuid AND i.order_id=$2::uuid AND i.gift_kind='WISH' FOR UPDATE OF e`,
          [command.entryId, order["id"]],
        );
        if (!entry) throw new WishGalleryRepositoryError("ACCESS_DENIED");
        // Recheck the session after waiting for the entry lock. Expired possession cannot withdraw.
        await activeAccessSession(
          client,
          order["id"],
          command.publicOrderId,
          command.sessionCandidates,
        );
        await client.query(
          `INSERT INTO public.wish_gallery_withdrawals(entry_id,session_id,request_id,correlation_id,task_name)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5) ON CONFLICT(entry_id) DO NOTHING`,
          [
            command.entryId,
            session["id"],
            command.requestId,
            command.correlationId,
            command.taskName,
          ],
        );
        return wishGalleryWithdrawnSchema.parse({
          schemaVersion: 1,
          entryId: command.entryId,
          withdrawn: true,
        });
      });
    },
  };
}

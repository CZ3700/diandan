SET search_path = public;
LOCK TABLE public.checkout_preflight_observations,public.checkout_preflight_receipts,public.checkout_outbox_events,public.order_items IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.checkout_preflight_observations)
    OR EXISTS(SELECT 1 FROM public.checkout_preflight_receipts)
    OR EXISTS(SELECT 1 FROM public.checkout_outbox_events)
    OR EXISTS(SELECT 1 FROM public.order_items WHERE schema_version=2) THEN
    RAISE EXCEPTION 'checkout rollback would discard observations or immutable checkout history' USING ERRCODE = '55000';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.validate_order_item_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM orders o
    JOIN checkout_quote_lines q
      ON q.checkout_session_id = o.checkout_session_id
     AND q.checkout_quote_id = o.checkout_quote_id
     AND q.cart_item_id = NEW.cart_item_id
    JOIN support_intents si
      ON si.id = NEW.support_intent_id
     AND si.cart_item_id = NEW.cart_item_id
    WHERE o.id = NEW.order_id
      AND q.gift_variant_id = NEW.gift_variant_id
      AND q.price_id = NEW.price_id
      AND q.price_revision = NEW.price_revision
      AND q.quantity = NEW.quantity
      AND q.unit_amount_minor = NEW.unit_amount_minor
      AND q.line_subtotal_minor = NEW.line_subtotal_minor
      AND q.tax_amount_minor = NEW.tax_amount_minor
      AND q.discount_amount_minor = NEW.discount_amount_minor
      AND q.line_total_minor = NEW.line_total_minor
      AND si.idol_id = NEW.idol_id
      AND si.display_mode = NEW.display_mode
      AND si.status IN ('CHECKOUT_LOCKED', 'CONVERTED', 'CANCELED')
      AND o.currency = NEW.currency
      AND o.presentation_locale = NEW.idol_translation_requested_locale
      AND o.presentation_locale = NEW.idol_portrait_alt_requested_locale
      AND o.presentation_locale = NEW.gift_translation_requested_locale
      AND o.presentation_locale = NEW.gift_image_alt_requested_locale
  ) THEN
    RAISE EXCEPTION 'order item must reproduce its checkout quote and support intent'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM prices p
    JOIN gift_variants gv ON gv.id = p.gift_variant_id
    JOIN orders o ON o.id = NEW.order_id
    WHERE p.id = NEW.price_id
      AND p.revision = NEW.price_revision
      AND p.gift_variant_id = NEW.gift_variant_id
      AND p.market = o.market
      AND p.currency = NEW.currency
      AND p.amount_minor = NEW.unit_amount_minor
      AND p.status IN ('PUBLISHED', 'SUPERSEDED', 'ARCHIVED')
      AND gv.gift_id = NEW.gift_id
      AND EXISTS (
        SELECT 1 FROM gift_variant_idol_eligibility eligibility
        WHERE eligibility.gift_variant_id = NEW.gift_variant_id
          AND eligibility.idol_id = NEW.idol_id
      )
  ) THEN
    RAISE EXCEPTION 'order item price snapshot does not match canonical price revision'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM idol_revision_translations translation
    JOIN idol_revisions revision ON revision.id = translation.idol_revision_id
    JOIN idols idol ON idol.id = revision.idol_id
    JOIN idol_revision_media media
      ON media.idol_revision_id = revision.id AND media.role = 'PORTRAIT'
    JOIN media_assets asset ON asset.id = media.media_asset_id
    JOIN media_metadata_revision_translations alt_translation
      ON alt_translation.id = NEW.idol_portrait_alt_translation_revision_id
     AND alt_translation.media_metadata_revision_id = media.media_metadata_revision_id
    WHERE translation.id = NEW.idol_translation_revision_id
      AND revision.idol_id = NEW.idol_id
      AND revision.lifecycle IN ('PUBLISHED', 'SUPERSEDED', 'ARCHIVED')
      AND idol.handle = NEW.idol_handle
      AND translation.locale = NEW.idol_translation_resolved_locale
      AND translation.display_name = NEW.idol_display_name
      AND media.media_asset_id = NEW.idol_portrait_asset_id
      AND media.media_metadata_revision_id = NEW.idol_portrait_metadata_revision_id
      AND asset.checksum_sha256 = NEW.idol_portrait_checksum_sha256
      AND asset.object_key = NEW.idol_portrait_object_key
      AND alt_translation.locale = NEW.idol_portrait_alt_resolved_locale
      AND alt_translation.alt = NEW.idol_portrait_alt
  ) THEN
    RAISE EXCEPTION 'idol translation and portrait snapshot do not share one canonical revision'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM gift_revision_translations translation
    JOIN gift_revisions revision ON revision.id = translation.gift_revision_id
    JOIN gift_revision_media media
      ON media.gift_revision_id = revision.id AND media.role = 'PRIMARY'
    JOIN media_assets asset ON asset.id = media.media_asset_id
    JOIN media_metadata_revision_translations alt_translation
      ON alt_translation.id = NEW.gift_image_alt_translation_revision_id
     AND alt_translation.media_metadata_revision_id = media.media_metadata_revision_id
    WHERE translation.id = NEW.gift_translation_revision_id
      AND revision.gift_id = NEW.gift_id
      AND revision.lifecycle IN ('PUBLISHED', 'SUPERSEDED', 'ARCHIVED')
      AND translation.locale = NEW.gift_translation_resolved_locale
      AND translation.title = NEW.gift_title
      AND media.media_asset_id = NEW.gift_image_asset_id
      AND media.media_metadata_revision_id = NEW.gift_image_metadata_revision_id
      AND asset.checksum_sha256 = NEW.gift_image_checksum_sha256
      AND asset.object_key = NEW.gift_image_object_key
      AND alt_translation.locale = NEW.gift_image_alt_resolved_locale
      AND alt_translation.alt = NEW.gift_image_alt
  ) THEN
    RAISE EXCEPTION 'gift translation and image snapshot do not share one canonical revision'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;
ALTER TABLE public.order_items DROP CONSTRAINT order_items_idol_translation_locale_check, ADD CONSTRAINT order_items_idol_translation_locale_check CHECK (
    (NOT idol_translation_fallback_used AND idol_translation_requested_locale=idol_translation_resolved_locale)
    OR (idol_translation_fallback_used AND idol_translation_requested_locale<>'en' AND idol_translation_resolved_locale='en')
  );
ALTER TABLE public.order_items DROP CONSTRAINT order_items_gift_translation_locale_check, ADD CONSTRAINT order_items_gift_translation_locale_check CHECK (
    (NOT gift_translation_fallback_used AND gift_translation_requested_locale=gift_translation_resolved_locale)
    OR (gift_translation_fallback_used AND gift_translation_requested_locale<>'en' AND gift_translation_resolved_locale='en')
  );
ALTER TABLE public.order_items DROP CONSTRAINT order_items_idol_alt_translation_locale_check, ADD CONSTRAINT order_items_idol_alt_translation_locale_check CHECK (
    (NOT idol_portrait_alt_fallback_used AND idol_portrait_alt_requested_locale=idol_portrait_alt_resolved_locale)
    OR (idol_portrait_alt_fallback_used AND idol_portrait_alt_requested_locale<>'en' AND idol_portrait_alt_resolved_locale='en')
  );
ALTER TABLE public.order_items DROP CONSTRAINT order_items_gift_alt_translation_locale_check, ADD CONSTRAINT order_items_gift_alt_translation_locale_check CHECK (
    (NOT gift_image_alt_fallback_used AND gift_image_alt_requested_locale=gift_image_alt_resolved_locale)
    OR (gift_image_alt_fallback_used AND gift_image_alt_requested_locale<>'en' AND gift_image_alt_resolved_locale='en')
  );
DROP FUNCTION public.validate_checkout_order_item(public.order_items);
DROP FUNCTION public.checkout_source_document(jsonb,text,uuid);
ALTER TABLE public.order_items DROP CONSTRAINT order_items_checkout_source_shape,
  DROP CONSTRAINT order_items_schema_version_check,
  ADD CONSTRAINT order_items_schema_version_check CHECK(schema_version=1),
  DROP COLUMN checkout_preflight_id,
  DROP COLUMN idol_daily_translation_id,
  DROP COLUMN gift_daily_translation_id,
  DROP COLUMN idol_portrait_alt_daily_translation_id,
  DROP COLUMN gift_image_alt_daily_translation_id,
  ALTER COLUMN idol_translation_revision_id SET NOT NULL,
  ALTER COLUMN gift_translation_revision_id SET NOT NULL,
  ALTER COLUMN idol_portrait_alt_translation_revision_id SET NOT NULL,
  ALTER COLUMN gift_image_alt_translation_revision_id SET NOT NULL;
DROP TABLE public.checkout_outbox_events;
DROP TABLE public.checkout_preflight_receipts;
DROP TABLE public.checkout_preflight_observations;
DROP FUNCTION public.assert_checkout_receipt();
DROP FUNCTION public.assert_checkout_observation();

SET search_path = public;

CREATE TABLE public.checkout_preflight_observations (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
  cart_id uuid NOT NULL REFERENCES public.carts(id) ON DELETE RESTRICT,
  cart_version public.positive_version NOT NULL,
  consent_hash public.sha256_hex NOT NULL,
  observation jsonb NOT NULL,
  created_at public.finite_timestamptz NOT NULL,
  expires_at public.finite_timestamptz NOT NULL,
  UNIQUE(id,cart_id),
  CHECK(expires_at>created_at),
  CHECK(observation->>'schemaVersion'='1' AND (observation->>'id')::uuid=id
    AND (observation#>>'{consent,cartId}')::uuid=cart_id
    AND (observation#>>'{consent,cartVersion}')::bigint=cart_version
    AND observation->>'consentHash'=consent_hash
    AND (observation->>'createdAt')::timestamptz=created_at
    AND (observation->>'expiresAt')::timestamptz=expires_at
    AND (observation#>>'{quote,expiresAt}')::timestamptz=expires_at
    AND jsonb_array_length(observation#>'{consent,lines}') BETWEEN 1 AND 500
    AND jsonb_array_length(observation#>'{consent,policies}') BETWEEN 1 AND 500
    AND observation - ARRAY['schemaVersion','id','consentHash','consent','quote','createdAt','expiresAt'] = '{}'::jsonb),
  CHECK(consent_hash=encode(sha256(convert_to('fan-support.checkout-consent.v1'||chr(10)||public.canonical_publication_json(observation->'consent'),'UTF8')),'hex'))
);
CREATE INDEX checkout_preflight_cart_idx ON public.checkout_preflight_observations(cart_id,created_at,id);

ALTER TABLE public.order_items
  DROP CONSTRAINT order_items_schema_version_check,
  ADD CONSTRAINT order_items_schema_version_check CHECK(schema_version IN(1,2)),
  ADD COLUMN checkout_preflight_id uuid REFERENCES public.checkout_preflight_observations(id) ON DELETE RESTRICT,
  ALTER COLUMN idol_translation_revision_id DROP NOT NULL,
  ALTER COLUMN gift_translation_revision_id DROP NOT NULL,
  ALTER COLUMN idol_portrait_alt_translation_revision_id DROP NOT NULL,
  ALTER COLUMN gift_image_alt_translation_revision_id DROP NOT NULL,
  ADD COLUMN idol_daily_translation_id uuid REFERENCES public.daily_publication_revisions(source_translation_id) ON DELETE RESTRICT,
  ADD COLUMN gift_daily_translation_id uuid REFERENCES public.daily_publication_revisions(source_translation_id) ON DELETE RESTRICT,
  ADD COLUMN idol_portrait_alt_daily_translation_id uuid REFERENCES public.daily_publication_revisions(source_translation_id) ON DELETE RESTRICT,
  ADD COLUMN gift_image_alt_daily_translation_id uuid REFERENCES public.daily_publication_revisions(source_translation_id) ON DELETE RESTRICT,
  ADD CONSTRAINT order_items_checkout_source_shape CHECK (
    num_nonnulls(idol_translation_revision_id,idol_daily_translation_id)=1
    AND num_nonnulls(gift_translation_revision_id,gift_daily_translation_id)=1
    AND num_nonnulls(idol_portrait_alt_translation_revision_id,idol_portrait_alt_daily_translation_id)=1
    AND num_nonnulls(gift_image_alt_translation_revision_id,gift_image_alt_daily_translation_id)=1
    AND ((schema_version=1 AND checkout_preflight_id IS NULL
      AND num_nonnulls(idol_daily_translation_id,gift_daily_translation_id,idol_portrait_alt_daily_translation_id,gift_image_alt_daily_translation_id)=0)
      OR (schema_version=2 AND checkout_preflight_id IS NOT NULL))
  );

CREATE TABLE public.checkout_preflight_receipts (
  preflight_id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
  cart_id uuid NOT NULL REFERENCES public.carts(id) ON DELETE RESTRICT,
  cart_version public.positive_version NOT NULL,
  checkout_session_id uuid NOT NULL UNIQUE REFERENCES public.checkout_sessions(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
  public_order_id uuid NOT NULL,
  event_id uuid NOT NULL UNIQUE,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at public.finite_timestamptz NOT NULL,
  UNIQUE(preflight_id,event_id),
  FOREIGN KEY(preflight_id,cart_id) REFERENCES public.checkout_preflight_observations(id,cart_id) ON DELETE RESTRICT,
  FOREIGN KEY(order_id,public_order_id) REFERENCES public.orders(id,public_order_id) ON DELETE RESTRICT
);
CREATE TABLE public.checkout_outbox_events (
  event_id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
  preflight_id uuid NOT NULL UNIQUE,
  event_type text NOT NULL CHECK(event_type='CHECKOUT_CREATED'),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  checkout_session_id uuid NOT NULL REFERENCES public.checkout_sessions(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at public.finite_timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status='PENDING'),
  FOREIGN KEY(preflight_id,event_id) REFERENCES public.checkout_preflight_receipts(preflight_id,event_id) ON DELETE RESTRICT
);

-- A media translation is proven by the parent publication's immutable dependency,
-- including legacy media which predates standalone publication manifests.
CREATE FUNCTION public.checkout_source_document(ref jsonb,kind text,owner uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p public.content_publications%ROWTYPE; manifest jsonb; digest text; revision jsonb; audit jsonb; fields jsonb; owner_key text;
BEGIN
  SELECT * INTO p FROM public.content_publications WHERE id=(ref->>'publicationId')::uuid;
  owner_key:=CASE kind WHEN 'IDOL' THEN 'idolId' WHEN 'GIFT' THEN 'giftId' WHEN 'MEDIA_METADATA' THEN 'mediaAssetId' END;
  IF owner_key IS NULL OR p.id IS NULL OR ref->>'schemaVersion' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'checkout source requires a typed immutable publication' USING ERRCODE='23514';
  END IF;
  IF ref->>'mode'='APPROVED' AND p.proof_version=2 THEN
    SELECT m.manifest,m.manifest_hash INTO manifest,digest FROM public.content_publication_manifests m WHERE m.publication_id=p.id;
    IF kind='MEDIA_METADATA' THEN
      SELECT value INTO revision FROM jsonb_array_elements(manifest->'mediaRevisions') WHERE value->>'revisionId'=ref->>'revisionId';
    ELSE revision:=manifest->'revision'; END IF;
    SELECT value INTO audit FROM jsonb_array_elements(revision->'translationAudits') WHERE value->>'id'=ref->>'translationRevisionId';
    SELECT value->'fields' INTO fields FROM jsonb_array_elements(revision#>'{content,translations}') WHERE value->>'locale'=ref->>'resolvedLocale';
    IF (digest=ref->>'manifestHash'
      AND digest=encode(sha256(convert_to('fan-support.publication-manifest.v1'||chr(10)||public.canonical_publication_json(manifest),'UTF8')),'hex')
      AND revision->>'revisionId'=ref->>'revisionId' AND revision#>>'{target,kind}'=kind
      AND (revision->'target'->>owner_key)::uuid=owner
      AND audit->>'locale'=ref->>'resolvedLocale' AND audit->>'sourceHash'=ref->>'sourceHash'
      AND audit#>>'{review,status}'='APPROVED' AND fields IS NOT NULL
      AND (((ref->>'fallbackUsed')::boolean=false AND ref->>'requestedLocale'=ref->>'resolvedLocale')
        OR ((ref->>'fallbackUsed')::boolean=true AND ref->>'requestedLocale'<>'en' AND ref->>'resolvedLocale'='en'))
    ) IS NOT TRUE THEN RAISE EXCEPTION 'checkout approved source proof does not match' USING ERRCODE='23514'; END IF;
    RETURN jsonb_build_object('fields',fields,'media',coalesce(revision#>'{content,media}','[]'::jsonb));
  ELSIF ref->>'mode'='DAILY' AND p.proof_version=3 THEN
    SELECT m.manifest,m.manifest_hash INTO manifest,digest FROM public.daily_publication_manifests m WHERE m.publication_id=p.id;
    IF kind='MEDIA_METADATA' THEN
      SELECT value->'metadata' INTO revision FROM jsonb_array_elements(manifest->'media') WHERE value#>>'{metadata,revisionId}'=ref->>'revisionId';
    ELSE revision:=manifest->'document'; END IF;
    IF (digest=ref->>'manifestHash'
      AND digest=encode(sha256(convert_to('fan-support.daily-publication.v1'||chr(10)||public.canonical_publication_json(manifest),'UTF8')),'hex')
      AND ref->>'publicationMode'='DIRECT_OPERATOR_V1' AND revision->>'kind'=kind
      AND revision->>'revisionId'=ref->>'revisionId' AND (revision->>'ownerId')::uuid=owner
      AND revision#>>'{source,id}'=ref->>'translationRevisionId' AND revision#>>'{source,sourceHash}'=ref->>'sourceHash'
      AND revision#>>'{source,locale}'=ref->>'sourceLocale' AND ref->>'resolvedLocale'=ref->>'sourceLocale'
      AND (ref->>'fallbackUsed')::boolean=(ref->>'requestedLocale'<>ref->>'sourceLocale')
      AND EXISTS(SELECT 1 FROM public.daily_publication_revisions d WHERE d.revision_id=(ref->>'revisionId')::uuid AND d.source_translation_id=(ref->>'translationRevisionId')::uuid AND d.document=revision)
    ) IS NOT TRUE THEN RAISE EXCEPTION 'checkout daily source proof does not match' USING ERRCODE='23514'; END IF;
    RETURN jsonb_build_object('fields',revision#>'{source,fields}','media',coalesce(revision->'media','[]'::jsonb));
  END IF;
  RAISE EXCEPTION 'checkout publication mode and actual proof disagree' USING ERRCODE='23514';
END; $$;

CREATE FUNCTION public.validate_checkout_order_item(item public.order_items) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE observation jsonb; line jsonb; idol jsonb; gift jsonb; portrait jsonb; image jsonb; binding record; columns jsonb:=to_jsonb(item);
BEGIN
  SELECT o.observation INTO observation FROM public.checkout_preflight_observations o WHERE o.id=item.checkout_preflight_id;
  SELECT value INTO line FROM jsonb_array_elements(observation#>'{consent,lines}') WHERE (value->>'cartItemId')::uuid=item.cart_item_id;
  IF line IS NULL THEN RAISE EXCEPTION 'checkout order item must bind its observed line' USING ERRCODE='23514'; END IF;
  idol:=public.checkout_source_document(line->'idolTranslation','IDOL',item.idol_id);
  gift:=public.checkout_source_document(line->'giftTranslation','GIFT',item.gift_id);
  portrait:=public.checkout_source_document(line#>'{idolPortrait,altTranslation}','MEDIA_METADATA',item.idol_portrait_asset_id);
  image:=public.checkout_source_document(line#>'{giftImage,altTranslation}','MEDIA_METADATA',item.gift_image_asset_id);
  FOR binding IN SELECT * FROM (VALUES
    ('idol','idol_translation',line->'idolTranslation'),
    ('gift','gift_translation',line->'giftTranslation'),
    ('idol_portrait_alt','idol_portrait_alt',line#>'{idolPortrait,altTranslation}'),
    ('gift_image_alt','gift_image_alt',line#>'{giftImage,altTranslation}')
  ) AS entries(prefix,locale_prefix,ref) LOOP
    IF (coalesce(columns->>(binding.prefix||'_translation_revision_id'),columns->>(binding.prefix||'_daily_translation_id'))=binding.ref->>'translationRevisionId'
      AND (columns->>(binding.prefix||'_daily_translation_id') IS NOT NULL)=(binding.ref->>'mode'='DAILY')
      AND columns->>(binding.locale_prefix||'_requested_locale')=binding.ref->>'requestedLocale'
      AND columns->>(binding.locale_prefix||'_resolved_locale')=binding.ref->>'resolvedLocale'
      AND (columns->>(binding.locale_prefix||'_fallback_used'))::boolean=(binding.ref->>'fallbackUsed')::boolean
    ) IS NOT TRUE THEN RAISE EXCEPTION 'checkout source columns must bind the exact typed provenance' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF (item.idol_display_name=idol#>>'{fields,displayName}' AND item.gift_title=gift#>>'{fields,title}'
    AND item.idol_portrait_alt=portrait#>>'{fields,alt}' AND item.gift_image_alt=image#>>'{fields,alt}'
    AND item.idol_handle=line->>'idolHandle' AND item.idol_id=(line->>'idolId')::uuid
    AND item.gift_id=(line->>'giftId')::uuid AND item.gift_variant_id=(line->>'giftVariantId')::uuid
    AND item.support_intent_id=(line->>'supportIntentId')::uuid AND item.display_mode=line->>'displayMode'
    AND item.price_id=(line->>'priceId')::uuid AND item.price_revision=(line->>'priceRevision')::bigint
    AND item.quantity=(line->>'quantity')::integer AND item.unit_amount_minor=(line->>'unitAmountMinor')::bigint
    AND item.tax_amount_minor=0 AND item.discount_amount_minor=0
    AND item.idol_portrait_metadata_revision_id=(line#>>'{idolPortrait,metadataRevisionId}')::uuid
    AND item.gift_image_metadata_revision_id=(line#>>'{giftImage,metadataRevisionId}')::uuid
    AND item.idol_portrait_metadata_revision_id=(line#>>'{idolPortrait,altTranslation,revisionId}')::uuid
    AND item.gift_image_metadata_revision_id=(line#>>'{giftImage,altTranslation,revisionId}')::uuid
    AND item.idol_portrait_asset_id=(line#>>'{idolPortrait,assetId}')::uuid
    AND item.gift_image_asset_id=(line#>>'{giftImage,assetId}')::uuid
    AND item.idol_portrait_checksum_sha256=line#>>'{idolPortrait,checksum}' AND item.idol_portrait_object_key=line#>>'{idolPortrait,objectKey}'
    AND item.gift_image_checksum_sha256=line#>>'{giftImage,checksum}' AND item.gift_image_object_key=line#>>'{giftImage,objectKey}'
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(idol->'media') media WHERE media->>'role'='PORTRAIT' AND (media->>'mediaAssetId')::uuid=item.idol_portrait_asset_id AND (media->>'mediaMetadataRevisionId')::uuid=item.idol_portrait_metadata_revision_id)
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(gift->'media') media WHERE media->>'role'='PRIMARY' AND (media->>'mediaAssetId')::uuid=item.gift_image_asset_id AND (media->>'mediaMetadataRevisionId')::uuid=item.gift_image_metadata_revision_id)
    AND EXISTS(SELECT 1 FROM public.media_assets a WHERE a.id=item.idol_portrait_asset_id AND a.checksum_sha256=item.idol_portrait_checksum_sha256 AND a.object_key=item.idol_portrait_object_key)
    AND EXISTS(SELECT 1 FROM public.media_assets a WHERE a.id=item.gift_image_asset_id AND a.checksum_sha256=item.gift_image_checksum_sha256 AND a.object_key=item.gift_image_object_key)
    AND EXISTS(SELECT 1 FROM public.idols i WHERE i.id=item.idol_id AND i.handle=item.idol_handle)
  ) IS NOT TRUE THEN RAISE EXCEPTION 'checkout raw snapshot must reproduce the immutable source' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.orders o JOIN public.checkout_quote_lines q ON q.checkout_session_id=o.checkout_session_id AND q.checkout_quote_id=o.checkout_quote_id AND q.cart_item_id=item.cart_item_id
    JOIN public.support_intents s ON s.id=item.support_intent_id AND s.cart_item_id=item.cart_item_id
    JOIN public.prices p ON p.id=q.price_id AND p.revision=q.price_revision AND p.gift_variant_id=q.gift_variant_id
    JOIN public.gift_variants v ON v.id=p.gift_variant_id AND v.gift_id=item.gift_id
    WHERE o.id=item.order_id AND o.cart_id=(observation#>>'{consent,cartId}')::uuid
      AND q.gift_variant_id=item.gift_variant_id AND q.price_id=item.price_id AND q.price_revision=item.price_revision
      AND q.quantity=item.quantity AND q.unit_amount_minor=item.unit_amount_minor AND q.line_subtotal_minor=item.line_subtotal_minor
      AND q.tax_amount_minor=item.tax_amount_minor AND q.discount_amount_minor=item.discount_amount_minor AND q.line_total_minor=item.line_total_minor
      AND s.idol_id=item.idol_id AND s.display_mode=item.display_mode AND s.status IN('CHECKOUT_LOCKED','CONVERTED','CANCELED')
      AND p.market=o.market AND p.currency=o.currency AND p.currency=item.currency AND p.amount_minor=item.unit_amount_minor
      AND p.status IN('PUBLISHED','SUPERSEDED','ARCHIVED')
      AND o.presentation_locale=item.idol_translation_requested_locale AND o.presentation_locale=item.gift_translation_requested_locale
      AND o.presentation_locale=item.idol_portrait_alt_requested_locale AND o.presentation_locale=item.gift_image_alt_requested_locale
      AND (EXISTS(SELECT 1 FROM public.gift_variant_idol_eligibility e WHERE e.gift_variant_id=v.id AND e.idol_id=s.idol_id)
        OR EXISTS(SELECT 1 FROM public.gift_variant_recipient_rules e WHERE e.gift_variant_id=v.id AND e.rule='ALL_ACTIVE_ARTISTS')))
    THEN RAISE EXCEPTION 'checkout quote intent and structural eligibility must agree' USING ERRCODE='23514'; END IF;
END; $$;

CREATE FUNCTION public.assert_checkout_receipt() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE observation public.checkout_preflight_observations%ROWTYPE; c public.carts%ROWTYPE; o public.orders%ROWTYPE; line jsonb; item public.order_items%ROWTYPE; inventory_count bigint; policy jsonb;
BEGIN
  SELECT * INTO observation FROM public.checkout_preflight_observations WHERE id=NEW.preflight_id;
  SELECT * INTO c FROM public.carts WHERE id=NEW.cart_id FOR UPDATE;
  SELECT * INTO o FROM public.orders WHERE id=NEW.order_id;
  IF (c.status='LOCKED' AND c.locked_order_id=o.id AND c.version=NEW.cart_version
    AND NEW.cart_version=observation.cart_version+1 AND c.expires_at>NEW.occurred_at
    AND observation.expires_at>NEW.occurred_at AND observation.cart_id=c.id
    AND o.cart_id=c.id AND o.checkout_session_id=NEW.checkout_session_id AND o.public_order_id=NEW.public_order_id
    AND o.order_status='PENDING_PAYMENT' AND o.payment_status='UNPAID' AND o.version=2 AND o.current_payment_attempt_id IS NULL
    AND o.tax_amount_minor=0 AND o.shipping_amount_minor=0 AND o.fee_amount_minor=0 AND o.discount_amount_minor=0
    AND o.presentation_locale=observation.observation#>>'{consent,presentationLocale}'
    AND o.created_at=NEW.occurred_at AND c.updated_at=NEW.occurred_at
    AND o.checkout_quote_id=(observation.observation#>>'{quote,id}')::uuid
    AND (SELECT count(*) FROM public.order_items WHERE order_id=o.id)=jsonb_array_length(observation.observation#>'{consent,lines}')
    AND (SELECT count(*) FROM public.cart_items i JOIN public.support_intents s ON s.cart_item_id=i.id WHERE i.cart_id=c.id AND s.status<>'CANCELED')=jsonb_array_length(observation.observation#>'{consent,lines}')
    AND (SELECT count(*) FROM public.policy_acceptances WHERE order_id=o.id)=jsonb_array_length(observation.observation#>'{consent,policies}')
    AND EXISTS(SELECT 1 FROM public.checkout_outbox_events e WHERE e.preflight_id=NEW.preflight_id AND e.event_id=NEW.event_id AND e.order_id=o.id AND e.checkout_session_id=NEW.checkout_session_id AND e.request_id=NEW.request_id AND e.correlation_id=NEW.correlation_id AND e.occurred_at=NEW.occurred_at)
  ) IS NOT TRUE THEN RAISE EXCEPTION 'checkout receipt must bind the complete locked order' USING ERRCODE='23514'; END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(observation.observation#>'{consent,lines}') LOOP
    SELECT * INTO item FROM public.order_items WHERE order_id=o.id AND cart_item_id=(line->>'cartItemId')::uuid;
    IF item.checkout_preflight_id IS DISTINCT FROM NEW.preflight_id OR NOT EXISTS(
      SELECT 1 FROM public.cart_items i JOIN public.support_intents s ON s.cart_item_id=i.id
      JOIN public.fulfillments f ON f.order_item_id=item.id AND f.order_id=o.id
      WHERE i.id=item.cart_item_id AND i.cart_id=c.id AND i.version=(line->>'itemVersion')::bigint
        AND s.id=item.support_intent_id AND s.version=(line->>'intentVersion')::bigint+1 AND s.status='CHECKOUT_LOCKED' AND s.privacy_state='ACTIVE'
        AND s.expires_at>NEW.occurred_at AND s.updated_at=NEW.occurred_at
        AND f.fulfillment_profile_id=(line->>'fulfillmentProfileId')::uuid AND f.status='PENDING'
    ) THEN RAISE EXCEPTION 'checkout must lock each exact cart item and intent' USING ERRCODE='23514'; END IF;
    SELECT count(*) INTO inventory_count FROM public.inventory_reservations r WHERE r.checkout_session_id=NEW.checkout_session_id AND r.cart_item_id=item.cart_item_id;
    IF line->>'inventoryPolicy'='TRACKED' THEN
      IF inventory_count<>1 OR NOT EXISTS(SELECT 1 FROM public.inventory_reservations r WHERE r.checkout_session_id=NEW.checkout_session_id AND r.checkout_quote_id=o.checkout_quote_id AND r.cart_item_id=item.cart_item_id AND r.gift_variant_id=item.gift_variant_id AND r.inventory_item_id=(line->>'inventoryItemId')::uuid AND r.locked_order_id=o.id AND r.quantity=item.quantity AND r.status='ACTIVE' AND r.expires_at=observation.expires_at) THEN
        RAISE EXCEPTION 'checkout requires each exact tracked reservation' USING ERRCODE='23514'; END IF;
    ELSIF inventory_count<>0 THEN RAISE EXCEPTION 'nontracked checkout cannot invent inventory reservations' USING ERRCODE='23514'; END IF;
  END LOOP;
  FOR policy IN SELECT value FROM jsonb_array_elements(observation.observation#>'{consent,policies}') LOOP
    IF NOT EXISTS(SELECT 1 FROM public.policy_acceptances a WHERE a.order_id=o.id AND a.policy_key=policy->>'policyKey' AND a.policy_revision_id=(policy->>'policyRevisionId')::uuid AND a.policy_translation_revision_id=(policy->>'policyTranslationRevisionId')::uuid AND a.locale::text=policy->>'locale' AND a.accepted_at=NEW.occurred_at AND a.recorded_at=NEW.occurred_at) THEN
      RAISE EXCEPTION 'checkout requires every exact observed policy acceptance' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER checkout_receipt_validate AFTER INSERT ON public.checkout_preflight_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_checkout_receipt();

CREATE FUNCTION public.assert_checkout_observation() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.carts c WHERE c.id=NEW.cart_id AND c.version=NEW.cart_version AND c.status='ACTIVE' AND c.expires_at>=NEW.expires_at AND c.expires_at>clock_timestamp() AND c.market::text=NEW.observation#>>'{consent,market}' AND c.currency::text=NEW.observation#>>'{consent,currency}') THEN
    RAISE EXCEPTION 'preflight requires a current authorized cart scope' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER checkout_observation_validate BEFORE INSERT ON public.checkout_preflight_observations FOR EACH ROW EXECUTE FUNCTION public.assert_checkout_observation();

CREATE TRIGGER checkout_preflight_observations_append_only BEFORE UPDATE OR DELETE ON public.checkout_preflight_observations FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER checkout_preflight_observations_no_truncate BEFORE TRUNCATE ON public.checkout_preflight_observations FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER checkout_preflight_receipts_append_only BEFORE UPDATE OR DELETE ON public.checkout_preflight_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER checkout_preflight_receipts_no_truncate BEFORE TRUNCATE ON public.checkout_preflight_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER checkout_outbox_events_append_only BEFORE UPDATE OR DELETE ON public.checkout_outbox_events FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER checkout_outbox_events_no_truncate BEFORE TRUNCATE ON public.checkout_outbox_events FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

ALTER TABLE public.order_items DROP CONSTRAINT order_items_idol_translation_locale_check, ADD CONSTRAINT order_items_idol_translation_locale_check CHECK (
      (idol_daily_translation_id IS NULL AND ((NOT idol_translation_fallback_used AND idol_translation_requested_locale=idol_translation_resolved_locale)
        OR (idol_translation_fallback_used AND idol_translation_requested_locale<>'en' AND idol_translation_resolved_locale='en')))
      OR (idol_daily_translation_id IS NOT NULL AND idol_translation_fallback_used=(idol_translation_requested_locale<>idol_translation_resolved_locale))
    );

ALTER TABLE public.order_items DROP CONSTRAINT order_items_gift_translation_locale_check, ADD CONSTRAINT order_items_gift_translation_locale_check CHECK (
      (gift_daily_translation_id IS NULL AND ((NOT gift_translation_fallback_used AND gift_translation_requested_locale=gift_translation_resolved_locale)
        OR (gift_translation_fallback_used AND gift_translation_requested_locale<>'en' AND gift_translation_resolved_locale='en')))
      OR (gift_daily_translation_id IS NOT NULL AND gift_translation_fallback_used=(gift_translation_requested_locale<>gift_translation_resolved_locale))
    );

ALTER TABLE public.order_items DROP CONSTRAINT order_items_idol_alt_translation_locale_check, ADD CONSTRAINT order_items_idol_alt_translation_locale_check CHECK (
      (idol_portrait_alt_daily_translation_id IS NULL AND ((NOT idol_portrait_alt_fallback_used AND idol_portrait_alt_requested_locale=idol_portrait_alt_resolved_locale)
        OR (idol_portrait_alt_fallback_used AND idol_portrait_alt_requested_locale<>'en' AND idol_portrait_alt_resolved_locale='en')))
      OR (idol_portrait_alt_daily_translation_id IS NOT NULL AND idol_portrait_alt_fallback_used=(idol_portrait_alt_requested_locale<>idol_portrait_alt_resolved_locale))
    );

ALTER TABLE public.order_items DROP CONSTRAINT order_items_gift_alt_translation_locale_check, ADD CONSTRAINT order_items_gift_alt_translation_locale_check CHECK (
      (gift_image_alt_daily_translation_id IS NULL AND ((NOT gift_image_alt_fallback_used AND gift_image_alt_requested_locale=gift_image_alt_resolved_locale)
        OR (gift_image_alt_fallback_used AND gift_image_alt_requested_locale<>'en' AND gift_image_alt_resolved_locale='en')))
      OR (gift_image_alt_daily_translation_id IS NOT NULL AND gift_image_alt_fallback_used=(gift_image_alt_requested_locale<>gift_image_alt_resolved_locale))
    );

CREATE OR REPLACE FUNCTION public.validate_order_item_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.schema_version = 2 THEN
    PERFORM public.validate_checkout_order_item(NEW);
    RETURN NULL;
  END IF;
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

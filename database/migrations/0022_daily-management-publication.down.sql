SET search_path=public;
-- Rollback is allowed only before any immutable daily operation/history exists.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.management_operations) OR EXISTS(SELECT 1 FROM public.daily_publication_revisions) OR EXISTS(SELECT 1 FROM public.daily_publication_manifests) OR EXISTS(SELECT 1 FROM public.management_defaults) OR EXISTS(SELECT 1 FROM public.gift_variant_recipient_rules) THEN
 RAISE EXCEPTION 'daily management history prevents destructive downgrade' USING ERRCODE='55000'; END IF;
END; $$;
CREATE OR REPLACE FUNCTION public.assert_publication_outbox_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.event_type = 'CONTENT_PUBLICATION_CHANGED' AND NOT EXISTS (
    SELECT 1
    FROM public.content_publications publication
    JOIN public.audit_logs audit ON audit.id = publication.audit_log_id
    WHERE publication.id = NEW.aggregate_id
      AND NEW.aggregate_type = 'CONTENT_PUBLICATION'
      AND NEW.aggregate_version = 1
      AND NEW.primary_subject_id = publication.id
      AND NEW.secondary_subject_id = COALESCE(
        publication.idol_revision_id,
        publication.gift_revision_id,
        publication.homepage_revision_id,
        publication.policy_revision_id,
        publication.media_metadata_revision_id,
        publication.site_locale_config_revision_id
      )
      AND NEW.locale IS NOT NULL
      AND NEW.market IS NULL
      AND NEW.currency IS NULL
      AND NEW.idempotency_key =
        'content-publication:' || publication.id::text || ':' || NEW.locale::text
      AND NEW.request_id = audit.request_id
      AND NEW.correlation_id = audit.correlation_id
      AND NEW.occurred_at = publication.published_at
      AND (
        (publication.content_type = 'IDOL' AND EXISTS (
          SELECT 1
          FROM public.idol_revision_translations translation
          WHERE translation.idol_revision_id = publication.idol_revision_id
            AND translation.locale = NEW.locale
        ))
        OR (publication.content_type = 'GIFT' AND EXISTS (
          SELECT 1
          FROM public.gift_revision_translations translation
          WHERE translation.gift_revision_id = publication.gift_revision_id
            AND translation.locale = NEW.locale
        ))
        OR (publication.content_type = 'HOMEPAGE' AND EXISTS (
          SELECT 1
          FROM public.homepage_revision_translations translation
          WHERE translation.homepage_revision_id = publication.homepage_revision_id
            AND translation.locale = NEW.locale
        ))
        OR (publication.content_type = 'POLICY' AND EXISTS (
          SELECT 1
          FROM public.policy_revision_translations translation
          WHERE translation.policy_revision_id = publication.policy_revision_id
            AND translation.locale = NEW.locale
        ))
        OR (publication.content_type = 'MEDIA_METADATA' AND EXISTS (
          SELECT 1
          FROM public.media_metadata_revision_translations translation
          WHERE translation.media_metadata_revision_id =
            publication.media_metadata_revision_id
            AND translation.locale = NEW.locale
        ))
        OR (publication.content_type = 'SITE_LOCALE_CONFIG' AND EXISTS (
          SELECT 1
          FROM public.site_locale_config_entries entry
          WHERE entry.site_locale_config_revision_id =
            publication.site_locale_config_revision_id
            AND entry.locale = NEW.locale
            AND entry.enabled
        ))
      )
  ) THEN
    RAISE EXCEPTION 'content publication outbox must reference its authoritative source'
      USING ERRCODE = '23514';
  ELSIF NEW.event_type = 'PAYMENT_CONFIG_PUBLISHED' AND NOT EXISTS (
    SELECT 1
    FROM public.payment_config_publications publication
    JOIN public.config_versions revision ON revision.id = publication.config_version_id
    JOIN public.audit_logs audit ON audit.id = publication.audit_log_id
    WHERE NEW.aggregate_type = 'PAYMENT_CONFIG'
      AND NEW.aggregate_id = publication.config_version_id
      AND NEW.aggregate_version = revision.version
      AND NEW.primary_subject_id = publication.id
      AND NEW.secondary_subject_id IS NULL
      AND NEW.locale IS NULL
      AND NEW.market IS NULL
      AND NEW.currency IS NULL
      AND NEW.idempotency_key = 'payment-config-publication:' || publication.id::text
      AND NEW.request_id = audit.request_id
      AND NEW.correlation_id = audit.correlation_id
      AND NEW.occurred_at = publication.created_at
  ) THEN
    RAISE EXCEPTION 'payment-config outbox must reference its authoritative source'
      USING ERRCODE = '23514';
  ELSIF NEW.event_type = 'PRICE_BOOK_PUBLISHED' AND NOT EXISTS (
    SELECT 1
    FROM public.price_book_publications publication
    JOIN public.audit_logs audit ON audit.id = publication.audit_log_id
    WHERE NEW.aggregate_type = 'PRICE_BOOK'
      AND NEW.aggregate_id = publication.price_book_id
      AND NEW.aggregate_version = publication.price_book_revision
      AND NEW.primary_subject_id = publication.id
      AND NEW.secondary_subject_id = publication.price_book_id
      AND NEW.locale IS NULL
      AND NEW.market = publication.market
      AND NEW.currency = publication.currency
      AND NEW.idempotency_key = 'price-book-publication:' || publication.id::text
      AND NEW.request_id = audit.request_id
      AND NEW.correlation_id = audit.correlation_id
      AND NEW.occurred_at = publication.published_at
  ) THEN
    RAISE EXCEPTION 'price-book outbox must reference its authoritative source'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_new_content_publication_proof() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.proof_version<>2 THEN RAISE EXCEPTION 'new content publications require current proof version' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.assert_current_content_publication_proof() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE proof public.content_publication_manifests%ROWTYPE;
BEGIN
  IF NEW.proof_version=1 THEN RETURN NULL; END IF;
  SELECT * INTO proof FROM public.content_publication_manifests WHERE publication_id=NEW.id;
  IF proof.id IS NULL OR proof.idol_revision_id IS DISTINCT FROM NEW.idol_revision_id OR proof.gift_revision_id IS DISTINCT FROM NEW.gift_revision_id
    OR proof.homepage_revision_id IS DISTINCT FROM NEW.homepage_revision_id OR proof.policy_revision_id IS DISTINCT FROM NEW.policy_revision_id
    OR proof.media_metadata_revision_id IS DISTINCT FROM NEW.media_metadata_revision_id OR proof.created_at<>NEW.published_at
    OR proof.translation_manifest_hash<>NEW.translation_manifest_hash OR proof.approval_manifest_hash<>NEW.approval_manifest_hash
    OR proof.media_manifest_hash IS DISTINCT FROM NEW.media_manifest_hash
    OR NOT EXISTS(SELECT 1 FROM public.content_publication_receipts WHERE publication_id=NEW.id AND manifest_id=proof.id AND action=NEW.action AND actor_id=NEW.published_by AND audit_log_id=NEW.audit_log_id AND created_at=NEW.published_at)
    OR (SELECT count(*) FROM public.content_purge_jobs WHERE publication_id=NEW.id AND generation=1)<>7 THEN
    RAISE EXCEPTION 'current publication requires exact manifest receipt and seven purge jobs' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.guard_revision_publication()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.lifecycle = 'PUBLISHED'
     AND (TG_OP = 'INSERT' OR OLD.lifecycle IS DISTINCT FROM NEW.lifecycle) THEN
    PERFORM assert_translation_package(
      TG_ARGV[0]::regclass,
      TG_ARGV[1],
      NEW.id,
      TG_ARGV[2]::regclass,
      TG_ARGV[3]
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_publication_runtime_lifecycle() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt_id uuid;
BEGIN
  IF NEW.lifecycle=OLD.lifecycle OR NEW.lifecycle NOT IN ('VALIDATED','PUBLISHED') THEN RETURN NEW; END IF;
  SELECT r.id INTO receipt_id FROM public.content_publication_receipts r JOIN public.content_publication_manifests m ON m.id=r.manifest_id
    WHERE coalesce(m.idol_revision_id,m.gift_revision_id,m.homepage_revision_id,m.policy_revision_id,m.media_metadata_revision_id)=NEW.id
      AND r.action=CASE NEW.lifecycle WHEN 'VALIDATED' THEN 'VALIDATE' ELSE 'PUBLISH' END
      AND r.created_at=CASE NEW.lifecycle WHEN 'VALIDATED' THEN NEW.validated_at ELSE NEW.published_at END;
  IF receipt_id IS NULL THEN RAISE EXCEPTION 'new lifecycle transition requires its exact runtime receipt' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.validate_content_publication()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target_lifecycle text;
  previous_type text;
  previous_owner text;
  current_owner text;
  media_revision record;
  required_media_count integer;
  required_row_count integer;
  present_row_count integer;
BEGIN
  IF NEW.id = NEW.replaces_publication_id THEN
    RAISE EXCEPTION 'publication cannot replace itself' USING ERRCODE = '23514';
  END IF;

  IF NEW.content_type = 'IDOL' THEN
    SELECT lifecycle INTO target_lifecycle FROM idol_revisions WHERE id = NEW.idol_revision_id;
    current_owner := NEW.idol_id::text;
    PERFORM assert_translation_package(
      'idol_revision_translations', 'idol_revision_id', NEW.idol_revision_id,
      'idol_translation_reviews', 'idol_translation_id'
    );
    SELECT count(*) INTO required_media_count
      FROM (
        SELECT role FROM idol_revision_media
        WHERE idol_revision_id = NEW.idol_revision_id
          AND role IN ('PORTRAIT', 'HERO_DESKTOP', 'HERO_MOBILE')
        GROUP BY role
      ) required_roles;
    IF required_media_count <> 3 THEN
      RAISE EXCEPTION 'idol publication requires portrait, desktop hero, and mobile hero media'
        USING ERRCODE = '23514';
    END IF;
    FOR media_revision IN
      SELECT DISTINCT m.id, m.lifecycle, asset.processing_status, asset.rights_status,
        EXISTS (
          SELECT 1 FROM media_variants variant
          WHERE variant.media_asset_id = asset.id AND variant.status = 'READY'
        ) AS has_ready_variant
      FROM idol_revision_media irm
      JOIN media_metadata_revisions m ON m.id = irm.media_metadata_revision_id
      JOIN media_assets asset ON asset.id = irm.media_asset_id
      WHERE idol_revision_id = NEW.idol_revision_id
    LOOP
      IF media_revision.lifecycle NOT IN ('PUBLISHED', 'SUPERSEDED')
         OR media_revision.processing_status <> 'READY'
         OR media_revision.rights_status <> 'APPROVED'
         OR NOT media_revision.has_ready_variant THEN
        RAISE EXCEPTION 'publication media metadata must be immutable published evidence'
          USING ERRCODE = '23514';
      END IF;
      PERFORM assert_translation_package(
        'media_metadata_revision_translations', 'media_metadata_revision_id', media_revision.id,
        'media_metadata_translation_reviews', 'media_metadata_translation_id'
      );
    END LOOP;
  ELSIF NEW.content_type = 'GIFT' THEN
    SELECT lifecycle INTO target_lifecycle FROM gift_revisions WHERE id = NEW.gift_revision_id;
    current_owner := NEW.gift_id::text;
    PERFORM assert_translation_package(
      'gift_revision_translations', 'gift_revision_id', NEW.gift_revision_id,
      'gift_translation_reviews', 'gift_translation_id'
    );
    SELECT count(*), count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM gift_variant_idol_eligibility eligibility
      JOIN idols idol ON idol.id = eligibility.idol_id
      WHERE eligibility.gift_variant_id = variant.id
        AND idol.status = 'active' AND idol.accepting_gifts
        AND idol.published_revision_id IS NOT NULL
    ))
      INTO required_row_count, present_row_count
      FROM gift_variants variant
      WHERE variant.gift_id = NEW.gift_id AND variant.status <> 'archived';
    IF required_row_count = 0 OR present_row_count <> required_row_count THEN
      RAISE EXCEPTION 'gift publication requires a published eligible idol for every non-archived variant'
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM gift_variants
      WHERE gift_id = NEW.gift_id AND status IN ('active', 'paused')
    ) OR (
      (SELECT status FROM gifts WHERE id = NEW.gift_id) = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM gift_variants
        WHERE gift_id = NEW.gift_id AND status = 'active'
      )
    ) THEN
      RAISE EXCEPTION 'gift publication requires a usable variant'
        USING ERRCODE = '23514';
    END IF;
    SELECT count(*) * 7 INTO required_row_count
      FROM gift_variants WHERE gift_id = NEW.gift_id;
    SELECT count(*) INTO present_row_count
      FROM gift_variant_labels label
      JOIN gift_revision_translations translation ON translation.id = label.gift_translation_id
      JOIN gift_variants variant ON variant.id = label.gift_variant_id
      WHERE translation.gift_revision_id = NEW.gift_revision_id
        AND variant.gift_id = NEW.gift_id;
    IF present_row_count <> required_row_count THEN
      RAISE EXCEPTION 'gift publication requires every variant label in all seven locales'
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM gift_revisions revision
      JOIN gift_revision_translations translation
        ON translation.gift_revision_id = revision.id
      WHERE revision.id = NEW.gift_revision_id
        AND revision.requires_safety_notice
        AND translation.safety_notice IS NULL
    ) THEN
      RAISE EXCEPTION 'gift publication requires localized safety notices'
        USING ERRCODE = '23514';
    END IF;
    SELECT count(*) INTO required_media_count FROM gift_revision_media
      WHERE gift_revision_id = NEW.gift_revision_id AND role = 'PRIMARY';
    IF required_media_count < 1 THEN
      RAISE EXCEPTION 'gift publication requires primary media' USING ERRCODE = '23514';
    END IF;
    FOR media_revision IN
      SELECT DISTINCT m.id, m.lifecycle, asset.processing_status, asset.rights_status,
        EXISTS (
          SELECT 1 FROM media_variants variant
          WHERE variant.media_asset_id = asset.id AND variant.status = 'READY'
        ) AS has_ready_variant
      FROM gift_revision_media grm
      JOIN media_metadata_revisions m ON m.id = grm.media_metadata_revision_id
      JOIN media_assets asset ON asset.id = grm.media_asset_id
      WHERE gift_revision_id = NEW.gift_revision_id
    LOOP
      IF media_revision.lifecycle NOT IN ('PUBLISHED', 'SUPERSEDED')
         OR media_revision.processing_status <> 'READY'
         OR media_revision.rights_status <> 'APPROVED'
         OR NOT media_revision.has_ready_variant THEN
        RAISE EXCEPTION 'publication media metadata must be immutable published evidence'
          USING ERRCODE = '23514';
      END IF;
      PERFORM assert_translation_package(
        'media_metadata_revision_translations', 'media_metadata_revision_id', media_revision.id,
        'media_metadata_translation_reviews', 'media_metadata_translation_id'
      );
    END LOOP;
  ELSIF NEW.content_type = 'HOMEPAGE' THEN
    SELECT lifecycle INTO target_lifecycle FROM homepage_revisions WHERE id = NEW.homepage_revision_id;
    current_owner := 'homepage';
    PERFORM assert_translation_package(
      'homepage_revision_translations', 'homepage_revision_id', NEW.homepage_revision_id,
      'homepage_translation_reviews', 'homepage_translation_id'
    );
    SELECT count(*) INTO required_media_count FROM homepage_slots
      WHERE homepage_revision_id = NEW.homepage_revision_id AND kind = 'HERO_IDOL';
    IF required_media_count <> 1 THEN
      RAISE EXCEPTION 'homepage publication requires exactly one hero idol slot'
        USING ERRCODE = '23514';
    END IF;
    SELECT count(*) * 7 INTO required_row_count
      FROM homepage_slots WHERE homepage_revision_id = NEW.homepage_revision_id;
    SELECT count(*) INTO present_row_count
      FROM homepage_slot_translations label
      JOIN homepage_revision_translations translation
        ON translation.id = label.homepage_translation_id
      WHERE translation.homepage_revision_id = NEW.homepage_revision_id;
    IF present_row_count <> required_row_count THEN
      RAISE EXCEPTION 'homepage publication requires every slot label in all seven locales'
        USING ERRCODE = '23514';
    END IF;
    FOR media_revision IN
      SELECT DISTINCT m.id, m.lifecycle, asset.processing_status, asset.rights_status,
        EXISTS (
          SELECT 1 FROM media_variants variant
          WHERE variant.media_asset_id = asset.id AND variant.status = 'READY'
        ) AS has_ready_variant
      FROM (
        SELECT desktop_media_metadata_revision_id AS id, desktop_media_asset_id AS asset_id
          FROM homepage_slots WHERE homepage_revision_id = NEW.homepage_revision_id
        UNION
        SELECT mobile_media_metadata_revision_id AS id, mobile_media_asset_id AS asset_id
          FROM homepage_slots WHERE homepage_revision_id = NEW.homepage_revision_id
      ) slot_media
      JOIN media_metadata_revisions m ON m.id = slot_media.id
      JOIN media_assets asset ON asset.id = slot_media.asset_id
      WHERE slot_media.id IS NOT NULL
    LOOP
      IF media_revision.lifecycle NOT IN ('PUBLISHED', 'SUPERSEDED')
         OR media_revision.processing_status <> 'READY'
         OR media_revision.rights_status <> 'APPROVED'
         OR NOT media_revision.has_ready_variant THEN
        RAISE EXCEPTION 'publication media metadata must be immutable published evidence'
          USING ERRCODE = '23514';
      END IF;
      PERFORM assert_translation_package(
        'media_metadata_revision_translations', 'media_metadata_revision_id', media_revision.id,
        'media_metadata_translation_reviews', 'media_metadata_translation_id'
      );
    END LOOP;
  ELSIF NEW.content_type = 'POLICY' THEN
    SELECT lifecycle INTO target_lifecycle FROM policy_revisions WHERE id = NEW.policy_revision_id;
    current_owner := NEW.policy_key;
    PERFORM assert_translation_package(
      'policy_revision_translations', 'policy_revision_id', NEW.policy_revision_id,
      'policy_translation_reviews', 'policy_translation_id'
    );
  ELSIF NEW.content_type = 'MEDIA_METADATA' THEN
    SELECT metadata.lifecycle INTO target_lifecycle
      FROM media_metadata_revisions metadata
      JOIN media_assets asset ON asset.id = metadata.media_asset_id
      WHERE metadata.id = NEW.media_metadata_revision_id
        AND asset.processing_status = 'READY'
        AND asset.rights_status = 'APPROVED'
        AND EXISTS (
          SELECT 1 FROM media_variants variant
          WHERE variant.media_asset_id = asset.id AND variant.status = 'READY'
        );
    current_owner := NEW.media_asset_id::text;
    PERFORM assert_translation_package(
      'media_metadata_revision_translations', 'media_metadata_revision_id', NEW.media_metadata_revision_id,
      'media_metadata_translation_reviews', 'media_metadata_translation_id'
    );
  ELSE
    SELECT lifecycle INTO target_lifecycle FROM site_locale_config_revisions
      WHERE id = NEW.site_locale_config_revision_id;
    current_owner := 'site-locale-config';
  END IF;

  IF target_lifecycle NOT IN ('PUBLISHED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'publication target must be immutable published evidence'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.replaces_publication_id IS NOT NULL THEN
    SELECT content_type,
      CASE content_type
        WHEN 'IDOL' THEN idol_id::text
        WHEN 'GIFT' THEN gift_id::text
        WHEN 'HOMEPAGE' THEN 'homepage'
        WHEN 'POLICY' THEN policy_key
        WHEN 'MEDIA_METADATA' THEN media_asset_id::text
        ELSE 'site-locale-config'
      END
      INTO previous_type, previous_owner
      FROM content_publications WHERE id = NEW.replaces_publication_id;
    IF previous_type IS NULL OR previous_type <> NEW.content_type OR previous_owner <> current_owner THEN
      RAISE EXCEPTION 'publication replacement must stay on the same typed object'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_admin_idol_change() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.handle IS NOT DISTINCT FROM OLD.handle AND NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.accepting_gifts IS NOT DISTINCT FROM OLD.accepting_gifts THEN RETURN NULL; END IF;
 -- Publishing has an existing independently validated proof receipt. Authoring only moves draft pointers and does not change identity fields.
 IF TG_OP='UPDATE' AND NEW.handle=OLD.handle AND NEW.accepting_gifts=OLD.accepting_gifts AND NEW.published_revision_id IS DISTINCT FROM OLD.published_revision_id
  AND EXISTS(SELECT 1 FROM public.content_publication_receipts r JOIN public.content_publications p ON p.id=r.publication_id WHERE p.idol_id=NEW.id AND p.idol_revision_id=NEW.published_revision_id AND r.created_at=NEW.updated_at AND r.action IN('PUBLISH','ROLLBACK')) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.admin_idol_identity_receipts r WHERE r.idol_id=NEW.id AND r.result_base_version=NEW.version AND r.created_at=NEW.updated_at
  AND r.new_handle=NEW.handle AND r.new_status=NEW.status AND r.new_accepting_gifts=NEW.accepting_gifts
  AND ((TG_OP='INSERT' AND r.action='CREATE_IDOL' AND r.created_at=NEW.created_at)
   OR(TG_OP='UPDATE' AND r.expected_base_version=OLD.version AND r.old_handle=OLD.handle AND r.old_status=OLD.status AND r.old_accepting_gifts=OLD.accepting_gifts AND r.previous_updated_at=OLD.updated_at))) THEN RAISE EXCEPTION 'idol identity change requires its exact administrative receipt' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.assert_gift_identity_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' AND NEW.status IN('active','paused') AND NEW.published_revision_id IS DISTINCT FROM OLD.published_revision_id AND EXISTS(
 SELECT 1 FROM public.content_publication_receipts r JOIN public.content_publications p ON p.id=r.publication_id WHERE p.gift_id=NEW.id AND p.gift_revision_id=NEW.published_revision_id AND r.created_at=NEW.updated_at AND r.action IN('PUBLISH','ROLLBACK')) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.gift_identity_receipts r WHERE r.gift_id=NEW.id AND r.result_base_version=NEW.version AND r.new_status=NEW.status AND r.handle=NEW.handle AND r.created_at=NEW.updated_at
 AND ((TG_OP='INSERT' AND r.action='CREATE_GIFT' AND r.created_at=NEW.created_at) OR (TG_OP='UPDATE' AND r.expected_base_version=OLD.version AND r.old_status=OLD.status AND r.previous_updated_at=OLD.updated_at))) THEN
 RAISE EXCEPTION 'gift identity change requires its exact receipt' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.guard_gift_profile_version() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.profile_version<>2 THEN RAISE EXCEPTION 'new gift revisions require current classification evidence' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW.profile_version IS DISTINCT FROM OLD.profile_version THEN RAISE EXCEPTION 'gift profile provenance is immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.assert_gift_revision_profile() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE revision_id uuid; parent public.gift_revisions%ROWTYPE; profile public.gift_revision_profiles%ROWTYPE; authoring public.content_authoring_receipts%ROWTYPE; source_kind text;
BEGIN
 revision_id:=COALESCE((to_jsonb(NEW)->>'gift_revision_id')::uuid,(to_jsonb(NEW)->>'id')::uuid);
 SELECT * INTO parent FROM public.gift_revisions WHERE id=revision_id;
 SELECT * INTO profile FROM public.gift_revision_profiles WHERE gift_revision_id=revision_id;
 IF parent.profile_version=1 THEN
  IF profile.gift_revision_id IS NOT NULL THEN RAISE EXCEPTION 'legacy revision classification cannot be rewritten' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 SELECT * INTO authoring FROM public.content_authoring_receipts WHERE gift_revision_id=revision_id;
 IF parent.id IS NULL OR parent.profile_version IS DISTINCT FROM 2 OR profile.gift_revision_id IS NULL OR authoring.id IS NULL OR profile.gift_id IS DISTINCT FROM parent.gift_id OR profile.created_by IS DISTINCT FROM parent.created_by OR profile.created_at IS DISTINCT FROM parent.created_at OR authoring.actor_id IS DISTINCT FROM profile.created_by OR profile.profile_hash IS DISTINCT FROM public.gift_profile_hash(profile.gift_id,profile.gift_revision_id,profile.gift_kind,profile.created_by,profile.created_at) THEN RAISE EXCEPTION 'gift classification requires exact authored revision and hash' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.gift_content_profile_receipts WHERE gift_revision_id=revision_id AND profile_hash=profile.profile_hash AND authoring_receipt_id=authoring.id) THEN
  SELECT gift_kind INTO source_kind FROM public.gift_revision_profiles WHERE gift_revision_id=authoring.source_gift_revision_id;
  IF profile.gift_kind IS DISTINCT FROM coalesce(source_kind,'OTHER') THEN RAISE EXCEPTION 'classification edits require an explicit commerce receipt' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.assert_gift_publication_profile() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE pub_id uuid; pub public.content_publications%ROWTYPE; parent public.gift_revisions%ROWTYPE; proof public.gift_publication_profiles%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='content_publications' THEN IF NEW.content_type<>'GIFT' THEN RETURN NULL; END IF; pub_id:=NEW.id; ELSE pub_id:=NEW.publication_id; END IF;
 SELECT * INTO pub FROM public.content_publications WHERE id=pub_id;
 SELECT * INTO parent FROM public.gift_revisions WHERE id=pub.gift_revision_id;
 SELECT * INTO proof FROM public.gift_publication_profiles WHERE publication_id=pub_id;
 IF parent.profile_version=1 THEN
  IF proof.publication_id IS NOT NULL THEN RAISE EXCEPTION 'legacy publication cannot acquire unrecorded classification' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 IF pub.id IS NULL OR parent.profile_version IS DISTINCT FROM 2 OR proof.publication_id IS NULL OR proof.gift_id IS DISTINCT FROM pub.gift_id OR proof.gift_revision_id IS DISTINCT FROM pub.gift_revision_id OR NOT EXISTS(SELECT 1 FROM public.content_publication_manifests m JOIN public.content_publication_receipts r ON r.manifest_id=m.id AND r.publication_id=m.publication_id WHERE m.publication_id=pub_id AND m.gift_revision_id=proof.gift_revision_id AND m.manifest_hash=proof.manifest_hash) THEN RAISE EXCEPTION 'gift publication requires exact classification and base manifest evidence' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.assert_gift_variant_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE variant_id uuid; variant public.gift_variants%ROWTYPE; actual_ids uuid[];
BEGIN
 IF TG_TABLE_NAME='gift_variants' THEN variant_id:=NEW.id; ELSE variant_id:=COALESCE(NEW.gift_variant_id,OLD.gift_variant_id); END IF;
 SELECT * INTO variant FROM public.gift_variants WHERE id=variant_id;
 SELECT coalesce(array_agg(idol_id ORDER BY idol_id),'{}'::uuid[]) INTO actual_ids FROM public.gift_variant_idol_eligibility WHERE gift_variant_id=variant_id;
 IF NOT EXISTS(SELECT 1 FROM public.gift_variant_receipts r WHERE r.gift_variant_id=variant_id AND r.gift_id=variant.gift_id AND r.result_variant_version=variant.version AND r.created_at=variant.updated_at AND r.new_sku=variant.sku AND r.new_status=variant.status AND r.new_inventory_policy=variant.inventory_policy AND r.new_eligible_idol_ids=actual_ids) THEN RAISE EXCEPTION 'variant or eligibility mutation requires its exact receipt' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.guard_content_purge_job() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE publication public.content_publications%ROWTYPE; event public.outbox_events%ROWTYPE;
  parent public.content_purge_jobs%ROWTYPE; root text; expected_paths text[]; expanded_paths text[]; actual_now timestamptz:=clock_timestamp();
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT * INTO publication FROM public.content_publications WHERE id=NEW.publication_id;
    SELECT * INTO event FROM public.outbox_events WHERE id=NEW.outbox_event_id;
    root:='/'||NEW.locale::text;
    expected_paths:=CASE publication.content_type
      WHEN 'HOMEPAGE' THEN ARRAY[root,root||'/sitemap.xml']
      WHEN 'POLICY' THEN ARRAY[root||'/policies/'||publication.policy_key||'*',root||'/sitemap.xml']
      WHEN 'MEDIA_METADATA' THEN ARRAY[root,root||'/gifts*',root||'/idols*',root||'/media/'||publication.media_asset_id::text||'*',root||'/sitemap.xml']
      ELSE ARRAY[root,root||'/gifts*',root||'/idols*',root||'/sitemap.xml'] END;
    SELECT array_agg(path ORDER BY path COLLATE "C") INTO expanded_paths
      FROM unnest(expected_paths||ARRAY['/sitemap.xml*',root||'/sitemap.xml*','/api/v1/storefront-seo/*']) AS paths(path);
    IF publication.id IS NULL OR publication.proof_version<>2 OR event.id IS NULL
      OR event.event_type IS DISTINCT FROM 'CONTENT_PUBLICATION_CHANGED'
      OR event.aggregate_type IS DISTINCT FROM 'CONTENT_PUBLICATION'
      OR event.aggregate_id IS DISTINCT FROM NEW.publication_id
      OR event.primary_subject_id IS DISTINCT FROM NEW.publication_id OR event.locale IS DISTINCT FROM NEW.locale
      OR (NEW.paths IS DISTINCT FROM expected_paths AND NEW.paths IS DISTINCT FROM expanded_paths) OR NEW.status<>'PENDING' OR NEW.version<>1 OR NEW.attempt_count<>0 OR NEW.failure_count<>0
      OR NEW.lease_token IS NOT NULL OR NEW.purge_reference IS NOT NULL OR NEW.error_code IS NOT NULL
      OR NEW.completed_at IS NOT NULL OR NEW.updated_at<>NEW.created_at OR NEW.next_attempt_at IS DISTINCT FROM NEW.created_at THEN
      RAISE EXCEPTION 'purge jobs require exact publication locale paths and initial state' USING ERRCODE='23514';
    END IF;
    IF NEW.generation=1 THEN
      IF NEW.created_at<>publication.published_at THEN RAISE EXCEPTION 'root purge job must share publication time' USING ERRCODE='23514'; END IF;
    ELSE
      SELECT * INTO parent FROM public.content_purge_jobs WHERE id=NEW.retry_of FOR UPDATE;
      IF parent.id IS NULL OR parent.status<>'FAILED' OR NEW.generation<>parent.generation+1
        OR NEW.publication_id<>parent.publication_id OR NEW.outbox_event_id<>parent.outbox_event_id
        OR NEW.locale<>parent.locale OR NEW.paths IS DISTINCT FROM parent.paths OR NEW.created_at<parent.updated_at THEN
        RAISE EXCEPTION 'purge retries require an exact failed predecessor' USING ERRCODE='23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['status','version','attempt_count','failure_count','lease_token','lease_expires_at','purge_reference','error_code','updated_at','next_attempt_at','completed_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','attempt_count','failure_count','lease_token','lease_expires_at','purge_reference','error_code','updated_at','next_attempt_at','completed_at'])
    OR OLD.status IN ('COMPLETED','FAILED') OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at
    OR NEW.updated_at>GREATEST(actual_now,transaction_timestamp(),OLD.updated_at) THEN
    RAISE EXCEPTION 'purge identity is immutable and transitions require one causal version' USING ERRCODE='23514';
  END IF;
  IF NEW.lease_token IS NOT NULL THEN
    IF (OLD.lease_expires_at IS NOT NULL AND OLD.lease_expires_at>actual_now) OR OLD.next_attempt_at>actual_now
      OR NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token OR NEW.lease_expires_at<=actual_now
      OR NEW.lease_expires_at>actual_now+interval '300 seconds' OR NEW.lease_expires_at>OLD.created_at+interval '10 minutes'
      OR NEW.attempt_count<>OLD.attempt_count+1 OR NEW.failure_count<>OLD.failure_count OR NEW.status<>OLD.status
      OR NEW.next_attempt_at IS DISTINCT FROM OLD.next_attempt_at OR NEW.purge_reference IS DISTINCT FROM OLD.purge_reference
      OR NEW.error_code IS DISTINCT FROM OLD.error_code OR NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
      RAISE EXCEPTION 'purge claims require a due job and bounded fresh lease' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NEW.attempt_count<>OLD.attempt_count OR NEW.lease_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'purge results cannot change claim count' USING ERRCODE='23514';
    END IF;
    IF NEW.status='FAILED' AND NEW.error_code IS NULL THEN
      RAISE EXCEPTION 'failed purge jobs require a safe failure code' USING ERRCODE='23514';
    END IF;
    IF NEW.error_code='PURGE_TIMEOUT' AND NEW.status<>'FAILED' THEN
      RAISE EXCEPTION 'absolute purge timeout must be terminal' USING ERRCODE='23514';
    END IF;
    IF NEW.status='FAILED' AND NEW.error_code='PURGE_TIMEOUT' THEN
      IF actual_now<OLD.created_at+interval '10 minutes' OR NEW.failure_count<>OLD.failure_count
        OR NEW.purge_reference IS DISTINCT FROM OLD.purge_reference THEN
        RAISE EXCEPTION 'purge timeout requires the absolute deadline' USING ERRCODE='23514';
      END IF;
    ELSIF OLD.lease_token IS NULL OR OLD.lease_expires_at<=actual_now THEN
      RAISE EXCEPTION 'purge results require a current unexpired claim' USING ERRCODE='23514';
    END IF;
    IF NEW.status='COMPLETED' THEN
      IF NEW.completed_at IS DISTINCT FROM NEW.updated_at OR NEW.purge_reference IS NULL OR NEW.error_code IS NOT NULL
        OR NEW.failure_count<>OLD.failure_count OR (OLD.purge_reference IS NOT NULL AND NEW.purge_reference<>OLD.purge_reference) THEN
        RAISE EXCEPTION 'purge completion requires the same provider reference' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.error_code IS NOT NULL AND NEW.error_code<>'PURGE_TIMEOUT' THEN
      IF NEW.failure_count<>OLD.failure_count+1 OR NEW.purge_reference IS DISTINCT FROM OLD.purge_reference
        OR NEW.status NOT IN (OLD.status,'FAILED') OR (NEW.failure_count>=6 AND NEW.status<>'FAILED') THEN
        RAISE EXCEPTION 'purge failure must preserve provider identity and bounded retries' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.status<>'FAILED' THEN
      IF NEW.status<>'SUBMITTED' OR NEW.purge_reference IS NULL OR NEW.failure_count<>OLD.failure_count
        OR (OLD.purge_reference IS NOT NULL AND NEW.purge_reference<>OLD.purge_reference) THEN
        RAISE EXCEPTION 'pending provider work must remain submitted' USING ERRCODE='23514';
      END IF;
    END IF;
    IF NEW.next_attempt_at IS NOT NULL AND NEW.next_attempt_at>OLD.created_at+interval '10 minutes' THEN
      RAISE EXCEPTION 'purge retry schedule cannot extend the absolute deadline' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
ALTER TABLE public.content_publications DROP CONSTRAINT content_publications_proof_version_check;
ALTER TABLE public.content_publications ADD CONSTRAINT content_publications_proof_version_check CHECK(proof_version IN(1,2));
ALTER TABLE public.gift_revisions DROP CONSTRAINT gift_revisions_profile_version_check;
ALTER TABLE public.gift_revisions ADD CONSTRAINT gift_revisions_profile_version_check CHECK(profile_version IN(1,2));
ALTER TABLE public.gift_revisions DROP CONSTRAINT gift_revision_delivery_profile;
ALTER TABLE public.gift_revisions ALTER COLUMN delivery_minimum SET NOT NULL;
ALTER TABLE public.gift_revisions ALTER COLUMN delivery_maximum SET NOT NULL;
ALTER TABLE public.gift_revisions ALTER COLUMN delivery_unit SET NOT NULL;
DROP TABLE public.gift_variant_recipient_rules;
DROP TABLE public.daily_publication_manifests;
DROP TABLE public.idol_daily_search_projections;
DROP FUNCTION public.guard_idol_daily_search_projection();
DROP TABLE public.daily_publication_revisions;
DROP TABLE public.management_defaults;
DROP TABLE public.management_operations;
DROP FUNCTION public.assert_management_completion();
DROP FUNCTION public.validate_daily_publication();
DROP FUNCTION public.assert_daily_publication(uuid);
DROP FUNCTION public.validate_daily_revision();
DROP FUNCTION public.assert_daily_revision(uuid);
DROP FUNCTION public.guard_management_operation();
DROP FUNCTION public.assert_management_authority(uuid);

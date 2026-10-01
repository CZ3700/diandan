SET search_path = public;
-- Brand metadata is independent from all frozen content and commerce revisions.
CREATE FUNCTION valid_storefront_brand(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR value->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR (SELECT count(*) FROM jsonb_object_keys(value))<>3 OR NOT(value ? 'lightLogoAssetId' AND value ? 'darkLogoAssetId') THEN RETURN false; END IF;
 RETURN (value->'lightLogoAssetId'='null'::jsonb OR (jsonb_typeof(value->'lightLogoAssetId')='string' AND (value->>'lightLogoAssetId')::uuid IS NOT NULL)) AND (value->'darkLogoAssetId'='null'::jsonb OR (jsonb_typeof(value->'darkLogoAssetId')='string' AND (value->>'darkLogoAssetId')::uuid IS NOT NULL));
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE TABLE storefront_brand_logo_assets (
 id uuid PRIMARY KEY, upload_id uuid NOT NULL UNIQUE REFERENCES media_upload_reservations(id),
 actor_id uuid NOT NULL REFERENCES admin_identities(id), session_id uuid NOT NULL REFERENCES admin_sessions(id),
 request_id uuid NOT NULL, audit_log_id uuid NOT NULL UNIQUE REFERENCES audit_logs(id),
 source_checksum_sha256 text NOT NULL CHECK(source_checksum_sha256 ~ '^[a-f0-9]{64}$'),
 checksum_sha256 text NOT NULL CHECK(checksum_sha256 ~ '^[a-f0-9]{64}$'), object_key text NOT NULL UNIQUE,
 mime_type text NOT NULL CHECK(mime_type='image/webp'), width integer NOT NULL CHECK(width BETWEEN 1 AND 1024), height integer NOT NULL CHECK(height BETWEEN 1 AND 1024),
 byte_size bigint NOT NULL CHECK(byte_size BETWEEN 1 AND 4194304), rights_reference text NOT NULL CHECK(length(rights_reference) BETWEEN 1 AND 256),
 created_at finite_timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(object_key='processed/v1/'||upload_id::text||'/'||checksum_sha256||'.webp')
);
CREATE TABLE storefront_brand_revisions (
 id uuid PRIMARY KEY, schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
 brand jsonb NOT NULL CHECK(valid_storefront_brand(brand)),
 light_logo_asset_id uuid GENERATED ALWAYS AS ((brand->>'lightLogoAssetId')::uuid) STORED REFERENCES storefront_brand_logo_assets(id),
 dark_logo_asset_id uuid GENERATED ALWAYS AS ((brand->>'darkLogoAssetId')::uuid) STORED REFERENCES storefront_brand_logo_assets(id),
 actor_id uuid NOT NULL REFERENCES admin_identities(id), session_id uuid NOT NULL REFERENCES admin_sessions(id),
 request_id uuid NOT NULL, audit_log_id uuid NOT NULL REFERENCES audit_logs(id),
 created_at finite_timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE storefront_brand_publications (
 id uuid PRIMARY KEY, revision_id uuid NOT NULL REFERENCES storefront_brand_revisions(id),
 version positive_version NOT NULL UNIQUE,
 action text NOT NULL CHECK(action IN ('PUBLISH','RESTORE')),
 restored_from_publication_id uuid REFERENCES storefront_brand_publications(id),
 actor_id uuid NOT NULL REFERENCES admin_identities(id), session_id uuid NOT NULL REFERENCES admin_sessions(id),
 request_id uuid NOT NULL, audit_log_id uuid NOT NULL UNIQUE REFERENCES audit_logs(id),
 created_at finite_timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((action='RESTORE')=(restored_from_publication_id IS NOT NULL))
);
CREATE TABLE storefront_brand_heads (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 version bigint NOT NULL DEFAULT 0 CHECK(version BETWEEN 0 AND 9007199254740991),
 draft_revision_id uuid REFERENCES storefront_brand_revisions(id),
 published_publication_id uuid REFERENCES storefront_brand_publications(id),
 updated_at finite_timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO storefront_brand_heads(singleton) VALUES(true);
CREATE TABLE storefront_brand_receipts (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES admin_identities(id), session_id uuid NOT NULL REFERENCES admin_sessions(id),
 action text NOT NULL CHECK(action IN ('SAVE_DRAFT','PUBLISH','RESTORE','PREPARE_LOGO')),
 idempotency_key idempotency_key_value NOT NULL, request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 response jsonb NOT NULL CHECK(jsonb_typeof(response)='object' AND response->>'outcome'='SUCCESS' AND response->>'kind'=CASE WHEN action='PREPARE_LOGO' THEN 'LOGO' ELSE 'STATE' END),
 audit_log_id uuid NOT NULL UNIQUE REFERENCES audit_logs(id), request_id uuid NOT NULL,
 created_at finite_timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_id,action,idempotency_key)
);
CREATE FUNCTION guard_storefront_brand_head() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'brand head cannot be removed' USING ERRCODE='55000'; END IF;
 IF NEW.singleton<>OLD.singleton OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at OR
    (NEW.draft_revision_id IS NOT DISTINCT FROM OLD.draft_revision_id AND NEW.published_publication_id IS NOT DISTINCT FROM OLD.published_publication_id) THEN
  RAISE EXCEPTION 'brand head requires a new fenced revision' USING ERRCODE='23514'; END IF;
 IF NEW.published_publication_id IS DISTINCT FROM OLD.published_publication_id AND NOT EXISTS(SELECT 1 FROM storefront_brand_publications p WHERE p.id=NEW.published_publication_id AND p.version=NEW.version) THEN
  RAISE EXCEPTION 'brand head publication version mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER storefront_brand_heads_guard BEFORE UPDATE OR DELETE ON storefront_brand_heads FOR EACH ROW EXECUTE FUNCTION guard_storefront_brand_head();
CREATE TRIGGER storefront_brand_heads_no_truncate BEFORE TRUNCATE ON storefront_brand_heads FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER storefront_brand_revisions_immutable BEFORE UPDATE OR DELETE ON storefront_brand_revisions FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER storefront_brand_revisions_no_truncate BEFORE TRUNCATE ON storefront_brand_revisions FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER storefront_brand_publications_immutable BEFORE UPDATE OR DELETE ON storefront_brand_publications FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER storefront_brand_publications_no_truncate BEFORE TRUNCATE ON storefront_brand_publications FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER storefront_brand_receipts_immutable BEFORE UPDATE OR DELETE ON storefront_brand_receipts FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER storefront_brand_receipts_no_truncate BEFORE TRUNCATE ON storefront_brand_receipts FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();

CREATE TRIGGER storefront_brand_logo_assets_immutable BEFORE UPDATE OR DELETE ON storefront_brand_logo_assets FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER storefront_brand_logo_assets_no_truncate BEFORE TRUNCATE ON storefront_brand_logo_assets FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE FUNCTION assert_storefront_brand_authority() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE permission text; expected_action text; expected_subject uuid;
BEGIN
 IF TG_TABLE_NAME='storefront_brand_logo_assets' THEN
  permission:='content.edit'; expected_action:='STOREFRONT_BRAND_PREPARE_LOGO'; expected_subject:=NEW.id;
 ELSIF TG_TABLE_NAME='storefront_brand_revisions' THEN
  SELECT p.id INTO expected_subject FROM storefront_brand_publications p WHERE p.revision_id=NEW.id AND p.action='RESTORE';
  IF expected_subject IS NOT NULL THEN permission:='content.publish'; expected_action:='STOREFRONT_BRAND_RESTORE';
  ELSE permission:='content.edit'; expected_action:='STOREFRONT_BRAND_SAVE_DRAFT'; expected_subject:=NEW.id; END IF;
 ELSIF TG_TABLE_NAME='storefront_brand_publications' THEN
  permission:='content.publish'; expected_action:='STOREFRONT_BRAND_'||NEW.action; expected_subject:=NEW.id;
 ELSE
  permission:=CASE WHEN NEW.action IN ('SAVE_DRAFT','PREPARE_LOGO') THEN 'content.edit' ELSE 'content.publish' END;
  expected_action:='STOREFRONT_BRAND_'||NEW.action;
  IF NEW.action='PREPARE_LOGO' THEN expected_subject:=(NEW.response->'logo'->>'assetId')::uuid;
   IF NOT EXISTS(SELECT 1 FROM storefront_brand_logo_assets a WHERE a.id=expected_subject AND a.actor_id=NEW.actor_id AND a.session_id=NEW.session_id) THEN RAISE EXCEPTION 'logo receipt requires its owned ready asset' USING ERRCODE='23514'; END IF;
  ELSIF NEW.action='SAVE_DRAFT' THEN expected_subject:=(NEW.response->'state'->'draft'->>'revisionId')::uuid;
  ELSE expected_subject:=(NEW.response->'state'->'published'->>'publicationId')::uuid; END IF;
 END IF;
 IF NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,permission,NEW.created_at) THEN RAISE EXCEPTION 'brand write requires current canonical permission' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.id=NEW.audit_log_id AND a.actor_type='ADMIN' AND a.actor_id=NEW.actor_id AND a.request_id=NEW.request_id AND a.created_at=NEW.created_at AND a.outcome='SUCCEEDED' AND a.subject_type='STOREFRONT_BRAND' AND a.action=expected_action AND a.subject_id=expected_subject) THEN RAISE EXCEPTION 'brand write requires exact audit' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='storefront_brand_logo_assets' THEN
  IF NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,'content.media.upload',NEW.created_at) OR NOT public.admin_order_authorized(NEW.session_id,NEW.actor_id,'content.media.rights',NEW.created_at) OR NOT EXISTS(SELECT 1 FROM media_upload_reservations u WHERE u.id=NEW.upload_id AND u.actor_id=NEW.actor_id AND u.session_id=NEW.session_id AND u.status='PENDING' AND u.created_at<=NEW.created_at AND u.expires_at>NEW.created_at AND u.checksum_sha256=NEW.source_checksum_sha256 AND u.rights_reference=NEW.rights_reference AND u.object_key='uploads/v1/'||NEW.upload_id::text) THEN RAISE EXCEPTION 'logo requires its authorized current upload and rights' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER storefront_brand_logo_authority AFTER INSERT ON storefront_brand_logo_assets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_storefront_brand_authority();
CREATE CONSTRAINT TRIGGER storefront_brand_revision_authority AFTER INSERT ON storefront_brand_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_storefront_brand_authority();
CREATE CONSTRAINT TRIGGER storefront_brand_publication_authority AFTER INSERT ON storefront_brand_publications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_storefront_brand_authority();
CREATE CONSTRAINT TRIGGER storefront_brand_receipt_authority AFTER INSERT ON storefront_brand_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_storefront_brand_authority();

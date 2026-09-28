SET search_path = public;
-- Theme metadata is independent from all frozen content and commerce revisions.
CREATE FUNCTION valid_storefront_theme(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR value->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR
    (SELECT count(*) FROM jsonb_object_keys(value))<>5 THEN RETURN false; END IF;
 RETURN coalesce(value->>'palette'=ANY(ARRAY['BLACK_GOLD','GRAPHITE_PEARL','MIDNIGHT_BLUE']) AND
   value->>'typography'=ANY(ARRAY['STANDARD','LARGE']) AND
   value->>'density'=ANY(ARRAY['STANDARD','COMPACT','AIRY']) AND
   value->>'corners'=ANY(ARRAY['SOFT','SHARP','ROUND']),false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE TABLE storefront_theme_revisions (
 id uuid PRIMARY KEY, schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
 theme jsonb NOT NULL CHECK(valid_storefront_theme(theme)),
 actor_id uuid NOT NULL REFERENCES admin_identities(id), session_id uuid NOT NULL REFERENCES admin_sessions(id),
 request_id uuid NOT NULL, audit_log_id uuid NOT NULL REFERENCES audit_logs(id),
 created_at finite_timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE storefront_theme_publications (
 id uuid PRIMARY KEY, revision_id uuid NOT NULL REFERENCES storefront_theme_revisions(id),
 version positive_version NOT NULL UNIQUE,
 action text NOT NULL CHECK(action IN ('PUBLISH','RESTORE')),
 restored_from_publication_id uuid REFERENCES storefront_theme_publications(id),
 actor_id uuid NOT NULL REFERENCES admin_identities(id), session_id uuid NOT NULL REFERENCES admin_sessions(id),
 request_id uuid NOT NULL, audit_log_id uuid NOT NULL UNIQUE REFERENCES audit_logs(id),
 created_at finite_timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((action='RESTORE')=(restored_from_publication_id IS NOT NULL))
);
CREATE TABLE storefront_theme_heads (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 version bigint NOT NULL DEFAULT 0 CHECK(version BETWEEN 0 AND 9007199254740991),
 draft_revision_id uuid REFERENCES storefront_theme_revisions(id),
 published_publication_id uuid REFERENCES storefront_theme_publications(id),
 updated_at finite_timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO storefront_theme_heads(singleton) VALUES(true);
CREATE TABLE storefront_theme_receipts (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES admin_identities(id), session_id uuid NOT NULL REFERENCES admin_sessions(id),
 action text NOT NULL CHECK(action IN ('SAVE_DRAFT','PUBLISH','RESTORE')),
 idempotency_key idempotency_key_value NOT NULL, request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 response jsonb NOT NULL CHECK(jsonb_typeof(response)='object' AND response->>'outcome'='SUCCESS' AND response->>'kind'='STATE'),
 audit_log_id uuid NOT NULL UNIQUE REFERENCES audit_logs(id), request_id uuid NOT NULL,
 created_at finite_timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_id,action,idempotency_key)
);
CREATE FUNCTION guard_storefront_theme_head() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'theme head cannot be removed' USING ERRCODE='55000'; END IF;
 IF NEW.singleton<>OLD.singleton OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at OR
    (NEW.draft_revision_id IS NOT DISTINCT FROM OLD.draft_revision_id AND NEW.published_publication_id IS NOT DISTINCT FROM OLD.published_publication_id) THEN
  RAISE EXCEPTION 'theme head requires a new fenced revision' USING ERRCODE='23514'; END IF;
 IF NEW.published_publication_id IS DISTINCT FROM OLD.published_publication_id AND NOT EXISTS(SELECT 1 FROM storefront_theme_publications p WHERE p.id=NEW.published_publication_id AND p.version=NEW.version) THEN
  RAISE EXCEPTION 'theme head publication version mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER storefront_theme_heads_guard BEFORE UPDATE OR DELETE ON storefront_theme_heads FOR EACH ROW EXECUTE FUNCTION guard_storefront_theme_head();
CREATE TRIGGER storefront_theme_heads_no_truncate BEFORE TRUNCATE ON storefront_theme_heads FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER storefront_theme_revisions_immutable BEFORE UPDATE OR DELETE ON storefront_theme_revisions FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER storefront_theme_revisions_no_truncate BEFORE TRUNCATE ON storefront_theme_revisions FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER storefront_theme_publications_immutable BEFORE UPDATE OR DELETE ON storefront_theme_publications FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER storefront_theme_publications_no_truncate BEFORE TRUNCATE ON storefront_theme_publications FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER storefront_theme_receipts_immutable BEFORE UPDATE OR DELETE ON storefront_theme_receipts FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER storefront_theme_receipts_no_truncate BEFORE TRUNCATE ON storefront_theme_receipts FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();

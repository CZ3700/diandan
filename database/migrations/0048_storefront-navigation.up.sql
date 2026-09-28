SET search_path = public;
-- Navigation is non-linguistic configuration, independent of content, layout and theme histories.
CREATE FUNCTION valid_storefront_navigation(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE item jsonb; header_ids text[] := ARRAY[]::text[]; footer_ids text[] := ARRAY[]::text[]; entry_id text;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR value->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR
    (SELECT count(*) FROM jsonb_object_keys(value))<>3 OR jsonb_typeof(value->'header') IS DISTINCT FROM 'array' OR
    jsonb_array_length(value->'header')<>3 OR jsonb_typeof(value->'footer') IS DISTINCT FROM 'array' OR jsonb_array_length(value->'footer')<>5 THEN RETURN false; END IF;
 FOR item IN SELECT jsonb_array_elements(value->'header') LOOP
  entry_id := item #>> '{}';
  IF jsonb_typeof(item) IS DISTINCT FROM 'string' OR NOT(entry_id=ANY(ARRAY['HOME','ARTISTS','GIFTS'])) OR entry_id=ANY(header_ids) THEN RETURN false; END IF;
  header_ids := array_append(header_ids,entry_id);
 END LOOP;
 FOR item IN SELECT jsonb_array_elements(value->'footer') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>2 OR
     jsonb_typeof(item->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'visible') IS DISTINCT FROM 'boolean' OR
     NOT(item->>'id'=ANY(ARRAY['DESCRIPTION','REGION','ARTISTS','GIFTS','POLICIES'])) OR item->>'id'=ANY(footer_ids) OR
     (item->>'id'='POLICIES' AND item->'visible'<>'true'::jsonb) THEN RETURN false; END IF;
  footer_ids := array_append(footer_ids,item->>'id');
 END LOOP;
 RETURN cardinality(header_ids)=3 AND cardinality(footer_ids)=5 AND array_position(header_ids,NULL) IS NULL AND array_position(footer_ids,NULL) IS NULL;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE TABLE storefront_navigation_revisions (
 id uuid PRIMARY KEY, schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
 navigation jsonb NOT NULL CHECK(valid_storefront_navigation(navigation)),
 actor_id uuid NOT NULL REFERENCES admin_identities(id), session_id uuid NOT NULL REFERENCES admin_sessions(id),
 request_id uuid NOT NULL, audit_log_id uuid NOT NULL REFERENCES audit_logs(id),
 created_at finite_timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE storefront_navigation_publications (
 id uuid PRIMARY KEY, revision_id uuid NOT NULL REFERENCES storefront_navigation_revisions(id),
 version positive_version NOT NULL UNIQUE,
 action text NOT NULL CHECK(action IN ('PUBLISH','RESTORE')),
 restored_from_publication_id uuid REFERENCES storefront_navigation_publications(id),
 actor_id uuid NOT NULL REFERENCES admin_identities(id), session_id uuid NOT NULL REFERENCES admin_sessions(id),
 request_id uuid NOT NULL, audit_log_id uuid NOT NULL UNIQUE REFERENCES audit_logs(id),
 created_at finite_timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((action='RESTORE')=(restored_from_publication_id IS NOT NULL))
);
CREATE TABLE storefront_navigation_heads (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 version bigint NOT NULL DEFAULT 0 CHECK(version BETWEEN 0 AND 9007199254740991),
 draft_revision_id uuid REFERENCES storefront_navigation_revisions(id),
 published_publication_id uuid REFERENCES storefront_navigation_publications(id),
 updated_at finite_timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO storefront_navigation_heads(singleton) VALUES(true);
CREATE TABLE storefront_navigation_receipts (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES admin_identities(id), session_id uuid NOT NULL REFERENCES admin_sessions(id),
 action text NOT NULL CHECK(action IN ('SAVE_DRAFT','PUBLISH','RESTORE')),
 idempotency_key idempotency_key_value NOT NULL, request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 response jsonb NOT NULL CHECK(jsonb_typeof(response)='object' AND response->>'outcome'='SUCCESS' AND response->>'kind'='STATE'),
 audit_log_id uuid NOT NULL UNIQUE REFERENCES audit_logs(id), request_id uuid NOT NULL,
 created_at finite_timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_id,action,idempotency_key)
);
CREATE FUNCTION guard_storefront_navigation_head() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'navigation head cannot be removed' USING ERRCODE='55000'; END IF;
 IF NEW.singleton<>OLD.singleton OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at OR
    (NEW.draft_revision_id IS NOT DISTINCT FROM OLD.draft_revision_id AND NEW.published_publication_id IS NOT DISTINCT FROM OLD.published_publication_id) THEN
  RAISE EXCEPTION 'navigation head requires a new fenced revision' USING ERRCODE='23514'; END IF;
 IF NEW.published_publication_id IS DISTINCT FROM OLD.published_publication_id AND NOT EXISTS(SELECT 1 FROM storefront_navigation_publications p WHERE p.id=NEW.published_publication_id AND p.version=NEW.version) THEN
  RAISE EXCEPTION 'navigation head publication version mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER storefront_navigation_heads_guard BEFORE UPDATE OR DELETE ON storefront_navigation_heads FOR EACH ROW EXECUTE FUNCTION guard_storefront_navigation_head();
CREATE TRIGGER storefront_navigation_heads_no_truncate BEFORE TRUNCATE ON storefront_navigation_heads FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER storefront_navigation_revisions_immutable BEFORE UPDATE OR DELETE ON storefront_navigation_revisions FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER storefront_navigation_revisions_no_truncate BEFORE TRUNCATE ON storefront_navigation_revisions FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER storefront_navigation_publications_immutable BEFORE UPDATE OR DELETE ON storefront_navigation_publications FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER storefront_navigation_publications_no_truncate BEFORE TRUNCATE ON storefront_navigation_publications FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER storefront_navigation_receipts_immutable BEFORE UPDATE OR DELETE ON storefront_navigation_receipts FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER storefront_navigation_receipts_no_truncate BEFORE TRUNCATE ON storefront_navigation_receipts FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();

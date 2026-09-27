SET search_path = public;
-- Layout metadata is independent from all frozen content and commerce revisions.
CREATE FUNCTION valid_homepage_layout(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE item jsonb; ids text[] := ARRAY[]::text[];
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR value->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR
    (SELECT count(*) FROM jsonb_object_keys(value))<>2 OR jsonb_typeof(value->'sections') IS DISTINCT FROM 'array' OR jsonb_array_length(value->'sections')<>8 THEN RETURN false; END IF;
 FOR item IN SELECT jsonb_array_elements(value->'sections') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>2 OR
     jsonb_typeof(item->'visible') IS DISTINCT FROM 'boolean' OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string' OR NOT (item->>'id'=ANY(ARRAY['HERO','KINDS','ARTISTS','GIFTS','POLICIES','HOW_IT_WORKS','STUDIO_PROMISE','FINAL_CTA'])) OR
     item->>'id'=ANY(ids) OR (item->>'id'=ANY(ARRAY['HERO','ARTISTS','GIFTS']) AND item->'visible'<>'true'::jsonb) THEN RETURN false; END IF;
  ids := array_append(ids,item->>'id');
 END LOOP;
 RETURN cardinality(ids)=8 AND array_position(ids,NULL) IS NULL;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE TABLE homepage_layout_revisions (
 id uuid PRIMARY KEY, schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
 layout jsonb NOT NULL CHECK(valid_homepage_layout(layout)),
 actor_id uuid NOT NULL REFERENCES admin_identities(id), session_id uuid NOT NULL REFERENCES admin_sessions(id),
 request_id uuid NOT NULL, audit_log_id uuid NOT NULL REFERENCES audit_logs(id),
 created_at finite_timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE homepage_layout_publications (
 id uuid PRIMARY KEY, revision_id uuid NOT NULL REFERENCES homepage_layout_revisions(id),
 version positive_version NOT NULL UNIQUE,
 action text NOT NULL CHECK(action IN ('PUBLISH','RESTORE')),
 restored_from_publication_id uuid REFERENCES homepage_layout_publications(id),
 actor_id uuid NOT NULL REFERENCES admin_identities(id), session_id uuid NOT NULL REFERENCES admin_sessions(id),
 request_id uuid NOT NULL, audit_log_id uuid NOT NULL UNIQUE REFERENCES audit_logs(id),
 created_at finite_timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((action='RESTORE')=(restored_from_publication_id IS NOT NULL))
);
CREATE TABLE homepage_layout_heads (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 version bigint NOT NULL DEFAULT 0 CHECK(version BETWEEN 0 AND 9007199254740991),
 draft_revision_id uuid REFERENCES homepage_layout_revisions(id),
 published_publication_id uuid REFERENCES homepage_layout_publications(id),
 updated_at finite_timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO homepage_layout_heads(singleton) VALUES(true);
CREATE TABLE homepage_layout_receipts (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES admin_identities(id), session_id uuid NOT NULL REFERENCES admin_sessions(id),
 action text NOT NULL CHECK(action IN ('SAVE_DRAFT','PUBLISH','RESTORE')),
 idempotency_key idempotency_key_value NOT NULL, request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 response jsonb NOT NULL CHECK(jsonb_typeof(response)='object' AND response->>'outcome'='SUCCESS' AND response->>'kind'='STATE'),
 audit_log_id uuid NOT NULL UNIQUE REFERENCES audit_logs(id), request_id uuid NOT NULL,
 created_at finite_timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_id,action,idempotency_key)
);
CREATE FUNCTION guard_homepage_layout_head() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'layout head cannot be removed' USING ERRCODE='55000'; END IF;
 IF NEW.singleton<>OLD.singleton OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at OR
    (NEW.draft_revision_id IS NOT DISTINCT FROM OLD.draft_revision_id AND NEW.published_publication_id IS NOT DISTINCT FROM OLD.published_publication_id) THEN
  RAISE EXCEPTION 'layout head requires a new fenced revision' USING ERRCODE='23514'; END IF;
 IF NEW.published_publication_id IS DISTINCT FROM OLD.published_publication_id AND NOT EXISTS(SELECT 1 FROM homepage_layout_publications p WHERE p.id=NEW.published_publication_id AND p.version=NEW.version) THEN
  RAISE EXCEPTION 'layout head publication version mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER homepage_layout_heads_guard BEFORE UPDATE OR DELETE ON homepage_layout_heads FOR EACH ROW EXECUTE FUNCTION guard_homepage_layout_head();
CREATE TRIGGER homepage_layout_heads_no_truncate BEFORE TRUNCATE ON homepage_layout_heads FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER homepage_layout_revisions_immutable BEFORE UPDATE OR DELETE ON homepage_layout_revisions FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER homepage_layout_revisions_no_truncate BEFORE TRUNCATE ON homepage_layout_revisions FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER homepage_layout_publications_immutable BEFORE UPDATE OR DELETE ON homepage_layout_publications FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER homepage_layout_publications_no_truncate BEFORE TRUNCATE ON homepage_layout_publications FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER homepage_layout_receipts_immutable BEFORE UPDATE OR DELETE ON homepage_layout_receipts FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER homepage_layout_receipts_no_truncate BEFORE TRUNCATE ON homepage_layout_receipts FOR EACH STATEMENT EXECUTE FUNCTION guard_append_only();

-- Legacy review rows remain immutable; new API operations carry exact audit receipts.
CREATE TABLE public.base_content_review_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version=1),
  idol_review_id uuid UNIQUE REFERENCES public.idol_translation_reviews(id) ON DELETE RESTRICT,
  gift_review_id uuid UNIQUE REFERENCES public.gift_translation_reviews(id) ON DELETE RESTRICT,
  homepage_review_id uuid UNIQUE REFERENCES public.homepage_translation_reviews(id) ON DELETE RESTRICT,
  policy_review_id uuid UNIQUE REFERENCES public.policy_translation_reviews(id) ON DELETE RESTRICT,
  media_metadata_review_id uuid UNIQUE REFERENCES public.media_metadata_translation_reviews(id) ON DELETE RESTRICT,
  audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  created_at public.finite_timestamptz NOT NULL,
  field_paths text[] NOT NULL CHECK (array_ndims(field_paths)=1 AND cardinality(field_paths)=1 AND field_paths[1] IS NOT NULL),
  CHECK (num_nonnulls(idol_review_id,gift_review_id,homepage_review_id,policy_review_id,media_metadata_review_id)=1)
);
CREATE TRIGGER base_content_review_receipt_no_mutation BEFORE UPDATE OR DELETE ON public.base_content_review_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER base_content_review_receipt_no_truncate BEFORE TRUNCATE ON public.base_content_review_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

-- This trigger precedes the legacy validator, including after a waited parent lock.
CREATE FUNCTION public.lock_base_content_review_parent() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE parent_id uuid; translation_id uuid;
BEGIN
  translation_id := (to_jsonb(NEW)->>TG_ARGV[1])::uuid;
  EXECUTE format('SELECT %I FROM %s WHERE id=$1',TG_ARGV[3],TG_ARGV[0]::regclass) INTO parent_id USING translation_id;
  EXECUTE format('SELECT id FROM %s WHERE id=$1 FOR UPDATE',TG_ARGV[2]::regclass) USING parent_id;
  EXECUTE format('SELECT id FROM %s WHERE id=$1 FOR UPDATE',TG_ARGV[0]::regclass) USING translation_id;
  RETURN NEW;
END; $$;

CREATE FUNCTION public.assert_base_content_review_boundary() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE translation_id uuid; parent_id uuid; authored boolean; copied boolean; receipted boolean;
BEGIN
  IF NEW.sequence=1 THEN RETURN NULL; END IF;
  translation_id := (to_jsonb(NEW)->>TG_ARGV[1])::uuid;
  EXECUTE format('SELECT %I FROM %s WHERE id=$1',TG_ARGV[3],TG_ARGV[0]::regclass) INTO parent_id USING translation_id;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.content_authoring_receipts WHERE %I=$1)',TG_ARGV[3]) INTO authored USING parent_id;
  IF NOT authored THEN RETURN NULL; END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE target_translation_id=$1)',TG_ARGV[4]::regclass) INTO copied USING translation_id;
  -- 0015 independently proves all three original review events and their exact source FK.
  IF copied THEN RETURN NULL; END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.base_content_review_receipts WHERE %I=$1)',TG_ARGV[5]) INTO receipted USING NEW.id;
  IF NOT receipted THEN RAISE EXCEPTION 'authored translation review requires exact audit receipt' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END; $$;

CREATE FUNCTION public.assert_base_content_review_receipt() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE kind text; parent_column text; translation_column text; review_id uuid; event jsonb; translation jsonb; parent jsonb; previous jsonb; audit public.audit_logs%ROWTYPE; english_hash public.sha256_hex; authored boolean; action text;
BEGIN
  IF NEW.idol_review_id IS NOT NULL THEN kind:='idol'; parent_column:='idol_revision_id'; translation_column:='idol_translation_id'; review_id:=NEW.idol_review_id;
  ELSIF NEW.gift_review_id IS NOT NULL THEN kind:='gift'; parent_column:='gift_revision_id'; translation_column:='gift_translation_id'; review_id:=NEW.gift_review_id;
  ELSIF NEW.homepage_review_id IS NOT NULL THEN kind:='homepage'; parent_column:='homepage_revision_id'; translation_column:='homepage_translation_id'; review_id:=NEW.homepage_review_id;
  ELSIF NEW.policy_review_id IS NOT NULL THEN kind:='policy'; parent_column:='policy_revision_id'; translation_column:='policy_translation_id'; review_id:=NEW.policy_review_id;
  ELSIF NEW.media_metadata_review_id IS NOT NULL THEN kind:='media_metadata'; parent_column:='media_metadata_revision_id'; translation_column:='media_metadata_translation_id'; review_id:=NEW.media_metadata_review_id;
  END IF;
  EXECUTE format('SELECT to_jsonb(r.*),to_jsonb(t.*),to_jsonb(p.*) FROM public.%I r JOIN public.%I t ON t.id=r.%I JOIN public.%I p ON p.id=t.%I WHERE r.id=$1',kind||'_translation_reviews',kind||'_revision_translations',translation_column,kind||'_revisions',parent_column) INTO event,translation,parent USING review_id;
  IF event IS NULL THEN RAISE EXCEPTION 'base review receipt requires its exact event' USING ERRCODE='23503'; END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.content_authoring_receipts WHERE %I=$1)',parent_column) INTO authored USING (parent->>'id')::uuid;
  IF NOT authored OR parent->>'lifecycle'<>'DRAFT' OR event->>'status' NOT IN ('IN_REVIEW','APPROVED') THEN
    RAISE EXCEPTION 'new base review requires an authored draft' USING ERRCODE='23514';
  END IF;
  EXECUTE format('SELECT source_hash FROM public.%I WHERE %I=$1 AND locale=''en''',kind||'_revision_translations',parent_column) INTO english_hash USING (parent->>'id')::uuid;
  IF english_hash IS NULL OR translation->>'translated_from_source_hash'<>english_hash THEN
    RAISE EXCEPTION 'base review requires actual current English source' USING ERRCODE='23514';
  END IF;
  EXECUTE format('SELECT to_jsonb(r.*) FROM public.%I r WHERE %I=$1 AND sequence<$2 ORDER BY sequence DESC LIMIT 1',kind||'_translation_reviews',translation_column) INTO previous USING (translation->>'id')::uuid,(event->>'sequence')::bigint;
  IF NEW.created_at<>(event->>'created_at')::timestamptz OR NEW.created_at<GREATEST((parent->>'created_at')::timestamptz,(translation->>'edited_at')::timestamptz,(previous->>'created_at')::timestamptz,(previous->>'submitted_at')::timestamptz,(previous->>'reviewed_at')::timestamptz)
    OR NEW.field_paths IS DISTINCT FROM ARRAY['translations.'||(translation->>'locale')||'.review'] THEN
    RAISE EXCEPTION 'base review receipt requires exact causal time and field path' USING ERRCODE='23514';
  END IF;
  action:=CASE WHEN event->>'status'='IN_REVIEW' THEN 'BASE_CONTENT_REVIEW_SUBMIT' ELSE 'BASE_CONTENT_REVIEW_APPROVE' END;
  SELECT * INTO audit FROM public.audit_logs WHERE id=NEW.audit_log_id;
  IF audit.id IS NULL OR audit.actor_type<>'ADMIN' OR audit.action<>action OR audit.subject_type<>'BASE_CONTENT_TRANSLATION_REVIEW' OR audit.subject_id<>review_id
    OR audit.outcome<>'SUCCEEDED' OR audit.created_at<>NEW.created_at OR audit.reason_code IS NULL OR audit.request_id IS NULL OR audit.correlation_id IS NULL OR audit.field_category IS DISTINCT FROM 'CONTENT_TRANSLATION'
    OR NOT EXISTS(SELECT 1 FROM public.admin_identities WHERE id=audit.actor_id AND status='ACTIVE') THEN
    RAISE EXCEPTION 'base review receipt requires exact active actor audit' USING ERRCODE='23514';
  END IF;
  IF event->>'status'='IN_REVIEW' THEN
    IF audit.actor_id IS DISTINCT FROM (translation->>'editor_id')::uuid OR (event->>'submitted_at')::timestamptz IS DISTINCT FROM NEW.created_at THEN
      RAISE EXCEPTION 'only original translation editor may submit its draft' USING ERRCODE='23514';
    END IF;
  ELSIF audit.actor_id IS DISTINCT FROM (event->>'reviewer_id')::uuid OR audit.actor_id=(translation->>'editor_id')::uuid OR audit.actor_id=(parent->>'created_by')::uuid
    OR (event->>'reviewed_at')::timestamptz IS DISTINCT FROM NEW.created_at OR event->>'reviewed_source_hash'<>english_hash OR event->>'reviewed_content_hash'<>translation->>'source_hash' THEN
    RAISE EXCEPTION 'base approval must be independent of structure and translation authors' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER base_content_review_receipt_validate AFTER INSERT ON public.base_content_review_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_base_content_review_receipt();
CREATE TRIGGER a_idol_base_review_lock BEFORE INSERT ON public.idol_translation_reviews FOR EACH ROW EXECUTE FUNCTION public.lock_base_content_review_parent('public.idol_revision_translations','idol_translation_id','public.idol_revisions','idol_revision_id');
CREATE CONSTRAINT TRIGGER idol_base_review_receipt_guard AFTER INSERT ON public.idol_translation_reviews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_base_content_review_boundary('public.idol_revision_translations','idol_translation_id','public.idol_revisions','idol_revision_id','public.idol_translation_copy_evidence','idol_review_id');
CREATE TRIGGER a_gift_base_review_lock BEFORE INSERT ON public.gift_translation_reviews FOR EACH ROW EXECUTE FUNCTION public.lock_base_content_review_parent('public.gift_revision_translations','gift_translation_id','public.gift_revisions','gift_revision_id');
CREATE CONSTRAINT TRIGGER gift_base_review_receipt_guard AFTER INSERT ON public.gift_translation_reviews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_base_content_review_boundary('public.gift_revision_translations','gift_translation_id','public.gift_revisions','gift_revision_id','public.gift_translation_copy_evidence','gift_review_id');
CREATE TRIGGER a_homepage_base_review_lock BEFORE INSERT ON public.homepage_translation_reviews FOR EACH ROW EXECUTE FUNCTION public.lock_base_content_review_parent('public.homepage_revision_translations','homepage_translation_id','public.homepage_revisions','homepage_revision_id');
CREATE CONSTRAINT TRIGGER homepage_base_review_receipt_guard AFTER INSERT ON public.homepage_translation_reviews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_base_content_review_boundary('public.homepage_revision_translations','homepage_translation_id','public.homepage_revisions','homepage_revision_id','public.homepage_translation_copy_evidence','homepage_review_id');
CREATE TRIGGER a_policy_base_review_lock BEFORE INSERT ON public.policy_translation_reviews FOR EACH ROW EXECUTE FUNCTION public.lock_base_content_review_parent('public.policy_revision_translations','policy_translation_id','public.policy_revisions','policy_revision_id');
CREATE CONSTRAINT TRIGGER policy_base_review_receipt_guard AFTER INSERT ON public.policy_translation_reviews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_base_content_review_boundary('public.policy_revision_translations','policy_translation_id','public.policy_revisions','policy_revision_id','public.policy_translation_copy_evidence','policy_review_id');
CREATE TRIGGER a_media_metadata_base_review_lock BEFORE INSERT ON public.media_metadata_translation_reviews FOR EACH ROW EXECUTE FUNCTION public.lock_base_content_review_parent('public.media_metadata_revision_translations','media_metadata_translation_id','public.media_metadata_revisions','media_metadata_revision_id');
CREATE CONSTRAINT TRIGGER media_metadata_base_review_receipt_guard AFTER INSERT ON public.media_metadata_translation_reviews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_base_content_review_boundary('public.media_metadata_revision_translations','media_metadata_translation_id','public.media_metadata_revisions','media_metadata_revision_id','public.media_metadata_translation_copy_evidence','media_metadata_review_id');

CREATE TABLE public.base_content_preview_grants (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest) = 32),
  idol_revision_id uuid REFERENCES public.idol_revisions(id) ON DELETE RESTRICT,
  gift_revision_id uuid REFERENCES public.gift_revisions(id) ON DELETE RESTRICT,
  homepage_revision_id uuid REFERENCES public.homepage_revisions(id) ON DELETE RESTRICT,
  policy_revision_id uuid REFERENCES public.policy_revisions(id) ON DELETE RESTRICT,
  media_metadata_revision_id uuid REFERENCES public.media_metadata_revisions(id) ON DELETE RESTRICT,
  locale public.supported_locale NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES public.admin_sessions(id) ON DELETE RESTRICT,
  audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  created_at public.finite_timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at public.finite_timestamptz NOT NULL,
  revoked_at public.finite_timestamptz,
  revoked_audit_log_id uuid UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  CHECK (num_nonnulls(idol_revision_id,gift_revision_id,homepage_revision_id,policy_revision_id,media_metadata_revision_id) = 1),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '900 seconds'),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK ((revoked_at IS NULL) = (revoked_audit_log_id IS NULL))
);
CREATE INDEX base_content_preview_grants_session_active_idx ON public.base_content_preview_grants(session_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE FUNCTION public.guard_base_content_preview_grant() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE session public.admin_sessions%ROWTYPE; identity_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) - ARRAY['revoked_at','revoked_audit_log_id'] IS DISTINCT FROM to_jsonb(OLD) - ARRAY['revoked_at','revoked_audit_log_id']
      OR (OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_audit_log_id IS DISTINCT FROM OLD.revoked_audit_log_id))
      OR NEW.revoked_at IS NULL OR NEW.revoked_at > GREATEST(clock_timestamp(),transaction_timestamp(),OLD.created_at) THEN
      RAISE EXCEPTION 'preview grant only permits one-way revocation' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO session FROM public.admin_sessions WHERE id = NEW.session_id FOR SHARE;
  SELECT status INTO identity_status FROM public.admin_identities WHERE id = NEW.actor_id FOR SHARE;
  IF session.id IS NULL OR session.admin_identity_id <> NEW.actor_id OR identity_status IS DISTINCT FROM 'ACTIVE'
    OR NOT session.authenticated_with_mfa OR session.revoked_at IS NOT NULL OR session.expires_at <= clock_timestamp()
    OR NEW.created_at < session.created_at OR NEW.created_at > GREATEST(clock_timestamp(),transaction_timestamp(),session.created_at)
    OR NEW.expires_at > session.expires_at OR NEW.revoked_at IS NOT NULL OR NEW.revoked_audit_log_id IS NOT NULL THEN
    RAISE EXCEPTION 'preview grant requires its active MFA session and actor' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER base_content_preview_grant_guard BEFORE INSERT OR UPDATE ON public.base_content_preview_grants
  FOR EACH ROW EXECUTE FUNCTION public.guard_base_content_preview_grant();
CREATE TRIGGER base_content_preview_grant_no_delete BEFORE DELETE ON public.base_content_preview_grants
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER base_content_preview_grant_no_truncate BEFORE TRUNCATE ON public.base_content_preview_grants
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE FUNCTION public.assert_base_content_preview_grant_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE audit public.audit_logs%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO audit FROM public.audit_logs WHERE id = NEW.audit_log_id;
    IF audit.id IS NULL OR audit.action <> 'BASE_CONTENT_PREVIEW_ISSUE' OR audit.created_at <> NEW.created_at THEN
      RAISE EXCEPTION 'preview issuance requires exact audit' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.revoked_at IS NOT DISTINCT FROM OLD.revoked_at THEN RETURN NULL; END IF;
    SELECT * INTO audit FROM public.audit_logs WHERE id = NEW.revoked_audit_log_id;
    IF audit.id IS NULL OR audit.action <> 'BASE_CONTENT_PREVIEW_REVOKE' OR audit.created_at <> NEW.revoked_at THEN
      RAISE EXCEPTION 'preview revocation requires exact audit' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF audit.id IS NULL OR audit.actor_type <> 'ADMIN' OR audit.actor_id IS DISTINCT FROM NEW.actor_id
    OR audit.subject_type <> 'BASE_CONTENT_PREVIEW_GRANT' OR audit.subject_id <> NEW.id OR audit.outcome <> 'SUCCEEDED'
    OR audit.reason_code IS NULL OR audit.request_id IS NULL OR audit.correlation_id IS NULL THEN
    RAISE EXCEPTION 'preview grant requires exact actor and subject audit' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER base_content_preview_grant_audit AFTER INSERT OR UPDATE ON public.base_content_preview_grants
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_base_content_preview_grant_audit();

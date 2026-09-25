SET search_path=public;

CREATE TABLE public.admin_idol_identity_receipts (
 id uuid PRIMARY KEY, schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
 idol_id uuid NOT NULL REFERENCES public.idols(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 action text NOT NULL CHECK(action IN('CREATE_IDOL','RENAME_IDOL','SET_IDOL_STATUS')),
 expected_base_version bigint NOT NULL CHECK(expected_base_version BETWEEN 0 AND 9007199254740990),
 result_base_version bigint NOT NULL CHECK(result_base_version=expected_base_version+1),
 authoring_version bigint NOT NULL CHECK(authoring_version>=0), publication_head_version bigint NOT NULL CHECK(publication_head_version>=0),
 old_handle text, new_handle text NOT NULL, old_status text, new_status text NOT NULL,
 old_accepting_gifts boolean, new_accepting_gifts boolean NOT NULL,
 previous_updated_at public.finite_timestamptz,
 draft_revision_id uuid REFERENCES public.idol_revisions(id) ON DELETE RESTRICT,
 published_revision_id uuid REFERENCES public.idol_revisions(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
 session_id uuid NOT NULL REFERENCES public.admin_sessions(id) ON DELETE RESTRICT,
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
 redirect_id uuid UNIQUE REFERENCES public.slug_redirects(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 created_at public.finite_timestamptz NOT NULL,
 UNIQUE(idol_id,result_base_version),
 CHECK(new_handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(new_handle)<=128),
 CHECK(new_status IN('draft','active','paused','archived') AND (NOT new_accepting_gifts OR new_status='active')),
 CHECK((action='CREATE_IDOL' AND expected_base_version=0 AND old_handle IS NULL AND old_status IS NULL AND old_accepting_gifts IS NULL AND new_status='draft' AND NOT new_accepting_gifts AND draft_revision_id IS NULL AND published_revision_id IS NULL AND authoring_version=0 AND publication_head_version=0 AND redirect_id IS NULL)
 OR(action='RENAME_IDOL' AND expected_base_version>0 AND old_handle IS NOT NULL AND old_handle<>new_handle AND old_status=new_status AND old_accepting_gifts=new_accepting_gifts AND redirect_id IS NOT NULL)
 OR(action='SET_IDOL_STATUS' AND expected_base_version>0 AND old_handle=new_handle AND old_status IS NOT NULL AND old_accepting_gifts IS NOT NULL AND (old_status<>new_status OR old_accepting_gifts<>new_accepting_gifts) AND redirect_id IS NULL))
);
CREATE TRIGGER admin_idol_identity_receipts_append_only BEFORE UPDATE OR DELETE ON public.admin_idol_identity_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER admin_idol_identity_receipts_no_truncate BEFORE TRUNCATE ON public.admin_idol_identity_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

-- Capture the exact existing identity before its mutation, then verify the final row with the deferred receipt guard.
CREATE FUNCTION public.assert_admin_idol_prior() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior public.idols%ROWTYPE;
BEGIN
 SELECT * INTO prior FROM public.idols WHERE id=NEW.idol_id FOR UPDATE;
 IF NEW.action='CREATE_IDOL' THEN
  IF prior.id IS NOT NULL THEN RAISE EXCEPTION 'identity creation receipt requires an absent identity' USING ERRCODE='23514'; END IF;
 ELSE
  IF prior.id IS NULL OR prior.version IS DISTINCT FROM NEW.expected_base_version
   OR prior.handle IS DISTINCT FROM NEW.old_handle OR prior.status IS DISTINCT FROM NEW.old_status OR prior.accepting_gifts IS DISTINCT FROM NEW.old_accepting_gifts
   OR prior.updated_at IS DISTINCT FROM NEW.previous_updated_at OR prior.draft_revision_id IS DISTINCT FROM NEW.draft_revision_id OR prior.published_revision_id IS DISTINCT FROM NEW.published_revision_id
   THEN RAISE EXCEPTION 'identity receipt requires the exact locked prior identity before mutation' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER admin_idol_receipt_prior BEFORE INSERT ON public.admin_idol_identity_receipts FOR EACH ROW EXECUTE FUNCTION public.assert_admin_idol_prior();

-- Grants and expiry remain wall-clock checks; persisted events may use only actual locked history as a causal lower bound.
CREATE FUNCTION public.assert_admin_catalog_authority(actor uuid,session_id uuid,event_time timestamptz,causal_bound timestamptz,permission text,locales public.supported_locale[]) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE session public.admin_sessions%ROWTYPE; active_status text; granted integer;
BEGIN
 SELECT * INTO session FROM public.admin_sessions WHERE id=session_id FOR SHARE;
 SELECT status INTO active_status FROM public.admin_identities WHERE id=actor FOR SHARE;
 IF session.id IS NULL OR session.admin_identity_id IS DISTINCT FROM actor OR active_status IS DISTINCT FROM 'ACTIVE' OR NOT session.authenticated_with_mfa OR session.revoked_at IS NOT NULL
 OR session.expires_at<=clock_timestamp() OR session.created_at>clock_timestamp() OR event_time<session.created_at OR event_time>=session.expires_at
 OR event_time>GREATEST(clock_timestamp(),transaction_timestamp(),session.created_at,causal_bound) THEN RAISE EXCEPTION 'management operation requires current active MFA session and causal time' USING ERRCODE='23514'; END IF;
 PERFORM ar.role_id FROM public.admin_identity_roles ar JOIN public.roles r ON r.id=ar.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id
 WHERE ar.admin_identity_id=actor AND p.permission_key=permission AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp() AND ar.granted_at<=event_time AND rp.granted_at<=event_time FOR SHARE OF ar,r,rp,p;
 IF NOT FOUND THEN RAISE EXCEPTION 'management operation requires its current permission' USING ERRCODE='23514'; END IF;
 PERFORM locale FROM public.admin_content_locale_grants WHERE admin_identity_id=actor AND revoked_at IS NULL AND locale=ANY(locales) AND granted_at<=clock_timestamp() AND granted_at<=event_time FOR SHARE;
 GET DIAGNOSTICS granted=ROW_COUNT;
 IF granted<>cardinality(locales) THEN RAISE EXCEPTION 'management operation requires its current locale scopes' USING ERRCODE='23514'; END IF;
END; $$;

CREATE FUNCTION public.guard_admin_idol_identity() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE handle_value text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'idol identity history is retained by archival' USING ERRCODE='55000'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
   OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at THEN RAISE EXCEPTION 'idol identity and optimistic version must be preserved' USING ERRCODE='23514'; END IF;
  IF OLD.status='archived' AND (NEW.handle IS DISTINCT FROM OLD.handle OR NEW.status IS DISTINCT FROM OLD.status OR NEW.accepting_gifts IS DISTINCT FROM OLD.accepting_gifts) THEN RAISE EXCEPTION 'archived idol identity cannot be reactivated or renamed' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='INSERT' OR NEW.handle IS DISTINCT FROM OLD.handle THEN
  -- Both current names and every historical source name remain reserved. Locks serialize competing changes to the same namespace.
  FOR handle_value IN SELECT DISTINCT v FROM unnest(CASE WHEN TG_OP='INSERT' THEN ARRAY[NEW.handle] ELSE ARRAY[OLD.handle,NEW.handle] END) v ORDER BY v LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('fan-support:idol-handle:'||handle_value,0));
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.slug_redirects WHERE entity_type='IDOL' AND old_handle=NEW.handle)
    OR EXISTS(SELECT 1 FROM public.idols WHERE handle=NEW.handle AND id<>NEW.id) THEN RAISE EXCEPTION 'idol handle is reserved by a current or historical identity' USING ERRCODE='23505'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER admin_idol_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON public.idols FOR EACH ROW EXECUTE FUNCTION public.guard_admin_idol_identity();
CREATE TRIGGER admin_idol_identity_no_truncate BEFORE TRUNCATE ON public.idols FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE FUNCTION public.assert_admin_idol_change() RETURNS trigger
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
CREATE CONSTRAINT TRIGGER admin_idol_change_receipt AFTER INSERT OR UPDATE ON public.idols DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_admin_idol_change();

CREATE FUNCTION public.assert_admin_idol_receipt() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE idol public.idols%ROWTYPE; audit public.audit_logs%ROWTYPE; redirect public.slug_redirects%ROWTYPE; actual_authoring bigint; actual_head bigint; proof jsonb; dependency jsonb;
BEGIN
 SELECT * INTO idol FROM public.idols WHERE id=NEW.idol_id FOR UPDATE;
 SELECT * INTO audit FROM public.audit_logs WHERE id=NEW.audit_log_id;
 SELECT coalesce(max(revision),0) INTO actual_authoring FROM public.idol_revisions WHERE idol_id=NEW.idol_id;
 SELECT coalesce(max(version),0) INTO actual_head FROM public.idol_publication_heads WHERE idol_id=NEW.idol_id;
 IF idol.id IS NULL OR idol.version IS DISTINCT FROM NEW.result_base_version OR idol.handle IS DISTINCT FROM NEW.new_handle OR idol.status IS DISTINCT FROM NEW.new_status OR idol.accepting_gifts IS DISTINCT FROM NEW.new_accepting_gifts
 OR idol.draft_revision_id IS DISTINCT FROM NEW.draft_revision_id OR idol.published_revision_id IS DISTINCT FROM NEW.published_revision_id OR idol.updated_at IS DISTINCT FROM NEW.created_at
 OR actual_authoring IS DISTINCT FROM NEW.authoring_version OR actual_head IS DISTINCT FROM NEW.publication_head_version THEN RAISE EXCEPTION 'idol receipt must match the complete canonical identity and versions' USING ERRCODE='23514'; END IF;
 IF audit.id IS NULL OR audit.actor_type IS DISTINCT FROM 'ADMIN' OR audit.actor_id IS DISTINCT FROM NEW.actor_id OR audit.action IS DISTINCT FROM NEW.action OR audit.subject_type IS DISTINCT FROM 'IDOL_IDENTITY' OR audit.subject_id IS DISTINCT FROM NEW.idol_id OR audit.created_at IS DISTINCT FROM NEW.created_at OR audit.outcome IS DISTINCT FROM 'SUCCEEDED' OR audit.field_category IS DISTINCT FROM 'CONTENT_IDENTITY' OR audit.reason_code IS NULL OR audit.request_id IS NULL OR audit.correlation_id IS DISTINCT FROM audit.request_id THEN RAISE EXCEPTION 'idol operation requires exact safe audit evidence' USING ERRCODE='23514'; END IF;
 IF (NEW.action='CREATE_IDOL') IS DISTINCT FROM (NEW.previous_updated_at IS NULL) OR NEW.created_at<NEW.previous_updated_at THEN RAISE EXCEPTION 'identity receipt requires exact prior causal time' USING ERRCODE='23514'; END IF;
 PERFORM public.assert_admin_catalog_authority(NEW.actor_id,NEW.session_id,NEW.created_at,NEW.previous_updated_at,'content.edit',ARRAY['en','zh-CN','th','vi','ja','es','pt']::public.supported_locale[]);
 IF NEW.action='RENAME_IDOL' THEN
  SELECT * INTO redirect FROM public.slug_redirects WHERE id=NEW.redirect_id;
  IF redirect.id IS NULL OR redirect.entity_type IS DISTINCT FROM 'IDOL' OR redirect.idol_id IS DISTINCT FROM NEW.idol_id OR redirect.old_handle IS DISTINCT FROM NEW.old_handle OR redirect.new_handle IS DISTINCT FROM NEW.new_handle OR redirect.created_at IS DISTINCT FROM NEW.created_at THEN RAISE EXCEPTION 'rename requires its immutable same-owner redirect' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.action='SET_IDOL_STATUS' AND NEW.new_status='active' THEN
  SELECT m.manifest INTO proof FROM public.idol_publication_heads h JOIN public.content_publications p ON p.id=h.publication_id AND p.idol_id=h.idol_id AND p.idol_revision_id=h.idol_revision_id JOIN public.content_publication_manifests m ON m.publication_id=p.id JOIN public.content_publication_receipts r ON r.manifest_id=m.id AND r.publication_id=p.id AND r.result_head_version=h.version
   WHERE h.idol_id=NEW.idol_id AND h.idol_revision_id=NEW.published_revision_id AND p.proof_version=2;
  IF proof IS NULL THEN RAISE EXCEPTION 'activation requires a current verified publication' USING ERRCODE='23514'; END IF;
  PERFORM public.assert_publication_manifest_revision(proof->'revision');
  FOR dependency IN SELECT * FROM jsonb_array_elements(proof->'mediaRevisions') LOOP PERFORM public.assert_publication_manifest_revision(dependency); END LOOP;
  PERFORM public.assert_publication_manifest_approvals(proof);
  PERFORM public.assert_publication_manifest_media(proof);
 END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER admin_idol_receipt_validate AFTER INSERT ON public.admin_idol_identity_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_admin_idol_receipt();

CREATE FUNCTION public.assert_admin_idol_redirect() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.entity_type<>'IDOL' THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.admin_idol_identity_receipts WHERE redirect_id=NEW.id AND action='RENAME_IDOL' AND idol_id=NEW.idol_id AND old_handle=NEW.old_handle AND new_handle=NEW.new_handle AND created_at=NEW.created_at)
 OR EXISTS(SELECT 1 FROM public.idols WHERE handle=NEW.old_handle) THEN RAISE EXCEPTION 'idol redirect must represent an exact completed rename' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER admin_idol_redirect_validate AFTER INSERT ON public.slug_redirects DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_admin_idol_redirect();

-- Translation exchange stores references and audit facts; the five revision families remain the only text source.
CREATE TABLE public.translation_export_receipts (
 id uuid PRIMARY KEY, schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
 idol_revision_id uuid REFERENCES public.idol_revisions(id) ON DELETE RESTRICT,
 gift_revision_id uuid REFERENCES public.gift_revisions(id) ON DELETE RESTRICT,
 homepage_revision_id uuid REFERENCES public.homepage_revisions(id) ON DELETE RESTRICT,
 policy_revision_id uuid REFERENCES public.policy_revisions(id) ON DELETE RESTRICT,
 media_metadata_revision_id uuid REFERENCES public.media_metadata_revisions(id) ON DELETE RESTRICT,
 expected_authoring_version bigint NOT NULL CHECK(expected_authoring_version BETWEEN 1 AND 9007199254740990),
 source_snapshot_hash public.sha256_hex NOT NULL, english_source_hash public.sha256_hex NOT NULL,
 locales public.supported_locale[] NOT NULL CHECK(array_ndims(locales)=1 AND cardinality(locales) BETWEEN 1 AND 7 AND array_position(locales,NULL) IS NULL),
 actor_id uuid NOT NULL REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
 session_id uuid NOT NULL REFERENCES public.admin_sessions(id) ON DELETE RESTRICT,
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
 created_at public.finite_timestamptz NOT NULL,
 CHECK(num_nonnulls(idol_revision_id,gift_revision_id,homepage_revision_id,policy_revision_id,media_metadata_revision_id)=1)
);
CREATE TABLE public.translation_import_receipts (
 id uuid PRIMARY KEY, schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
 export_receipt_id uuid NOT NULL REFERENCES public.translation_export_receipts(id) ON DELETE RESTRICT,
 authoring_receipt_id uuid NOT NULL UNIQUE REFERENCES public.content_authoring_receipts(id) ON DELETE RESTRICT,
 imported_locales public.supported_locale[] NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
 session_id uuid NOT NULL REFERENCES public.admin_sessions(id) ON DELETE RESTRICT,
 audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
 created_at public.finite_timestamptz NOT NULL
);
CREATE TRIGGER translation_export_receipts_append_only BEFORE UPDATE OR DELETE ON public.translation_export_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER translation_export_receipts_no_truncate BEFORE TRUNCATE ON public.translation_export_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER translation_import_receipts_append_only BEFORE UPDATE OR DELETE ON public.translation_import_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER translation_import_receipts_no_truncate BEFORE TRUNCATE ON public.translation_import_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE FUNCTION public.assert_translation_export_receipt() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prefix text; parent_column text; owner_column text; source_id uuid; parent jsonb; actual_head bigint; english_hash text; audit public.audit_logs%ROWTYPE; ordered public.supported_locale[];
BEGIN
 prefix:=CASE WHEN NEW.idol_revision_id IS NOT NULL THEN 'idol' WHEN NEW.gift_revision_id IS NOT NULL THEN 'gift' WHEN NEW.homepage_revision_id IS NOT NULL THEN 'homepage' WHEN NEW.policy_revision_id IS NOT NULL THEN 'policy' ELSE 'media_metadata' END;
 parent_column:=prefix||'_revision_id'; owner_column:=CASE prefix WHEN 'homepage' THEN NULL WHEN 'policy' THEN 'policy_key' WHEN 'media_metadata' THEN 'media_asset_id' ELSE prefix||'_id' END;
 source_id:=coalesce(NEW.idol_revision_id,NEW.gift_revision_id,NEW.homepage_revision_id,NEW.policy_revision_id,NEW.media_metadata_revision_id);
 EXECUTE format('SELECT to_jsonb(r.*) FROM public.%I r WHERE id=$1 FOR UPDATE',prefix||'_revisions') INTO parent USING source_id;
 IF parent->>'lifecycle'='DRAFT' AND NOT public.content_authoring_revision_sealed(parent_column,source_id) THEN RAISE EXCEPTION 'mutable legacy draft must be copied before translation export' USING ERRCODE='23514'; END IF;
 IF owner_column IS NULL THEN EXECUTE 'SELECT max(revision) FROM public.homepage_revisions' INTO actual_head;
 ELSE EXECUTE format('SELECT max(revision) FROM public.%I r WHERE to_jsonb(r.*)->>%L=$1',prefix||'_revisions',owner_column) INTO actual_head USING parent->>owner_column; END IF;
 EXECUTE format('SELECT source_hash FROM public.%I WHERE %I=$1 AND locale=''en''',prefix||'_revision_translations',parent_column) INTO english_hash USING source_id;
 SELECT array_agg(locale ORDER BY locale) INTO ordered FROM(SELECT DISTINCT unnest(NEW.locales) locale) q;
 IF parent IS NULL OR actual_head IS DISTINCT FROM NEW.expected_authoring_version OR english_hash IS DISTINCT FROM NEW.english_source_hash OR NEW.locales IS DISTINCT FROM ordered OR NEW.created_at<(parent->>'created_at')::timestamptz THEN RAISE EXCEPTION 'translation export requires exact source revision head English hash and locale set' USING ERRCODE='23514'; END IF;
 SELECT * INTO audit FROM public.audit_logs WHERE id=NEW.audit_log_id;
 IF audit.id IS NULL OR audit.actor_type IS DISTINCT FROM 'ADMIN' OR audit.actor_id IS DISTINCT FROM NEW.actor_id OR audit.action IS DISTINCT FROM 'TRANSLATION_EXPORT' OR audit.subject_type IS DISTINCT FROM 'TRANSLATION_EXPORT_PACKAGE' OR audit.subject_id IS DISTINCT FROM NEW.id OR audit.created_at IS DISTINCT FROM NEW.created_at OR audit.outcome IS DISTINCT FROM 'SUCCEEDED' OR audit.reason_code IS NULL OR audit.request_id IS NULL OR audit.correlation_id IS DISTINCT FROM audit.request_id THEN RAISE EXCEPTION 'translation export requires exact audit evidence' USING ERRCODE='23514'; END IF;
 PERFORM public.assert_admin_catalog_authority(NEW.actor_id,NEW.session_id,NEW.created_at,(parent->>'created_at')::timestamptz,'content.read',NEW.locales);
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER translation_export_receipt_validate AFTER INSERT ON public.translation_export_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_translation_export_receipt();

CREATE FUNCTION public.assert_translation_import_receipt() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE exported public.translation_export_receipts%ROWTYPE; authored public.content_authoring_receipts%ROWTYPE; audit public.audit_logs%ROWTYPE; prefix text; parent_column text; translation_column text; source_id uuid; target_id uuid; imported integer;
BEGIN
 SELECT * INTO exported FROM public.translation_export_receipts WHERE id=NEW.export_receipt_id;
 SELECT * INTO authored FROM public.content_authoring_receipts WHERE id=NEW.authoring_receipt_id;
 SELECT * INTO audit FROM public.audit_logs WHERE id=NEW.audit_log_id;
 prefix:=CASE WHEN exported.idol_revision_id IS NOT NULL THEN 'idol' WHEN exported.gift_revision_id IS NOT NULL THEN 'gift' WHEN exported.homepage_revision_id IS NOT NULL THEN 'homepage' WHEN exported.policy_revision_id IS NOT NULL THEN 'policy' ELSE 'media_metadata' END;
 parent_column:=prefix||'_revision_id'; translation_column:=prefix||'_translation_id'; source_id:=(to_jsonb(exported)->>parent_column)::uuid; target_id:=(to_jsonb(authored)->>parent_column)::uuid;
 IF exported.id IS NULL OR authored.id IS NULL OR authored.action IS DISTINCT FROM 'COPY' OR (to_jsonb(authored)->>('source_'||parent_column))::uuid IS DISTINCT FROM source_id OR target_id IS NULL OR target_id=source_id
 OR authored.expected_version IS DISTINCT FROM exported.expected_authoring_version OR authored.source_snapshot_hash IS DISTINCT FROM exported.source_snapshot_hash OR authored.actor_id IS DISTINCT FROM NEW.actor_id OR authored.audit_log_id IS DISTINCT FROM NEW.audit_log_id OR authored.created_at IS DISTINCT FROM NEW.created_at OR NEW.imported_locales IS DISTINCT FROM exported.locales
 OR audit.action IS DISTINCT FROM 'CONTENT_REVISION_COPY' OR audit.actor_id IS DISTINCT FROM NEW.actor_id OR audit.subject_id IS DISTINCT FROM target_id OR audit.created_at IS DISTINCT FROM NEW.created_at OR audit.outcome IS DISTINCT FROM 'SUCCEEDED' THEN RAISE EXCEPTION 'translation import requires exact exported source and new COPY audit' USING ERRCODE='23514'; END IF;
 EXECUTE format('SELECT count(*) FROM public.%I t JOIN public.%I r ON r.%I=t.id AND r.sequence=1 WHERE t.%I=$1 AND t.locale=ANY($2) AND t.origin=''IMPORT'' AND t.import_batch_id=$3 AND t.editor_id=$4 AND r.status=''DRAFT'' AND NOT EXISTS(SELECT 1 FROM public.%I later WHERE later.%I=t.id AND later.sequence>1)',prefix||'_revision_translations',prefix||'_translation_reviews',translation_column,parent_column,prefix||'_translation_reviews',translation_column) INTO imported USING target_id,NEW.imported_locales,NEW.id,NEW.actor_id;
 IF imported<>cardinality(NEW.imported_locales) THEN RAISE EXCEPTION 'imported translations must remain new actor IMPORT drafts with exact batch' USING ERRCODE='23514'; END IF;
 PERFORM public.assert_admin_catalog_authority(NEW.actor_id,NEW.session_id,NEW.created_at,authored.created_at,'content.edit',NEW.imported_locales);
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER translation_import_receipt_validate AFTER INSERT ON public.translation_import_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_translation_import_receipt();

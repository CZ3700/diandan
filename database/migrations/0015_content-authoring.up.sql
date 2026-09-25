SET search_path = public;

-- Authoring receipts seal a fully inserted revision. They contain references and
-- audit facts only; content remains in the five normalized revision families.
CREATE TABLE public.content_authoring_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  action text NOT NULL CHECK (action IN ('CREATE','COPY')),
  expected_version bigint NOT NULL CHECK (expected_version BETWEEN 0 AND 9007199254740990),
  source_snapshot_hash public.sha256_hex,
  changed_paths text[] NOT NULL CHECK (cardinality(changed_paths) <= 256 AND (array_ndims(changed_paths) IS NULL OR array_ndims(changed_paths)=1) AND array_position(changed_paths,NULL) IS NULL AND length(array_to_string(changed_paths,',')) <= 32768 AND array_to_string(changed_paths,',') ~ '^([A-Za-z][A-Za-z0-9_.-]*(,[A-Za-z][A-Za-z0-9_.-]*)*)?$'),
  actor_id uuid NOT NULL REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
  audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  created_at public.finite_timestamptz NOT NULL,
  idol_revision_id uuid UNIQUE REFERENCES public.idol_revisions(id) ON DELETE RESTRICT,
  source_idol_revision_id uuid REFERENCES public.idol_revisions(id) ON DELETE RESTRICT,
  gift_revision_id uuid UNIQUE REFERENCES public.gift_revisions(id) ON DELETE RESTRICT,
  source_gift_revision_id uuid REFERENCES public.gift_revisions(id) ON DELETE RESTRICT,
  homepage_revision_id uuid UNIQUE REFERENCES public.homepage_revisions(id) ON DELETE RESTRICT,
  source_homepage_revision_id uuid REFERENCES public.homepage_revisions(id) ON DELETE RESTRICT,
  policy_revision_id uuid UNIQUE REFERENCES public.policy_revisions(id) ON DELETE RESTRICT,
  source_policy_revision_id uuid REFERENCES public.policy_revisions(id) ON DELETE RESTRICT,
  media_metadata_revision_id uuid UNIQUE REFERENCES public.media_metadata_revisions(id) ON DELETE RESTRICT,
  source_media_metadata_revision_id uuid REFERENCES public.media_metadata_revisions(id) ON DELETE RESTRICT,
  CHECK (num_nonnulls(idol_revision_id,gift_revision_id,homepage_revision_id,policy_revision_id,media_metadata_revision_id) = 1),
  CHECK ((action = 'CREATE' AND source_snapshot_hash IS NULL AND num_nonnulls(source_idol_revision_id,source_gift_revision_id,source_homepage_revision_id,source_policy_revision_id,source_media_metadata_revision_id) = 0)
    OR (action = 'COPY' AND source_snapshot_hash IS NOT NULL AND num_nonnulls(source_idol_revision_id,source_gift_revision_id,source_homepage_revision_id,source_policy_revision_id,source_media_metadata_revision_id) = 1))
);
CREATE TRIGGER content_authoring_receipts_append_only_trigger BEFORE UPDATE OR DELETE ON public.content_authoring_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER content_authoring_receipts_no_truncate_trigger BEFORE TRUNCATE ON public.content_authoring_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE TABLE public.idol_translation_copy_evidence (
  target_translation_id uuid PRIMARY KEY REFERENCES public.idol_revision_translations(id) ON DELETE RESTRICT,
  source_translation_id uuid NOT NULL REFERENCES public.idol_revision_translations(id) ON DELETE RESTRICT,
  source_approval_review_id uuid NOT NULL REFERENCES public.idol_translation_reviews(id) ON DELETE RESTRICT,
  audit_log_id uuid NOT NULL REFERENCES public.audit_logs(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  copied_at public.finite_timestamptz NOT NULL,
  CHECK (target_translation_id <> source_translation_id)
);
CREATE TRIGGER idol_translation_copy_append_only_trigger BEFORE UPDATE OR DELETE ON public.idol_translation_copy_evidence FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER idol_translation_copy_no_truncate_trigger BEFORE TRUNCATE ON public.idol_translation_copy_evidence FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE TABLE public.gift_translation_copy_evidence (
  target_translation_id uuid PRIMARY KEY REFERENCES public.gift_revision_translations(id) ON DELETE RESTRICT,
  source_translation_id uuid NOT NULL REFERENCES public.gift_revision_translations(id) ON DELETE RESTRICT,
  source_approval_review_id uuid NOT NULL REFERENCES public.gift_translation_reviews(id) ON DELETE RESTRICT,
  audit_log_id uuid NOT NULL REFERENCES public.audit_logs(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  copied_at public.finite_timestamptz NOT NULL,
  CHECK (target_translation_id <> source_translation_id)
);
CREATE TRIGGER gift_translation_copy_append_only_trigger BEFORE UPDATE OR DELETE ON public.gift_translation_copy_evidence FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER gift_translation_copy_no_truncate_trigger BEFORE TRUNCATE ON public.gift_translation_copy_evidence FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE TABLE public.homepage_translation_copy_evidence (
  target_translation_id uuid PRIMARY KEY REFERENCES public.homepage_revision_translations(id) ON DELETE RESTRICT,
  source_translation_id uuid NOT NULL REFERENCES public.homepage_revision_translations(id) ON DELETE RESTRICT,
  source_approval_review_id uuid NOT NULL REFERENCES public.homepage_translation_reviews(id) ON DELETE RESTRICT,
  audit_log_id uuid NOT NULL REFERENCES public.audit_logs(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  copied_at public.finite_timestamptz NOT NULL,
  CHECK (target_translation_id <> source_translation_id)
);
CREATE TRIGGER homepage_translation_copy_append_only_trigger BEFORE UPDATE OR DELETE ON public.homepage_translation_copy_evidence FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER homepage_translation_copy_no_truncate_trigger BEFORE TRUNCATE ON public.homepage_translation_copy_evidence FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE TABLE public.policy_translation_copy_evidence (
  target_translation_id uuid PRIMARY KEY REFERENCES public.policy_revision_translations(id) ON DELETE RESTRICT,
  source_translation_id uuid NOT NULL REFERENCES public.policy_revision_translations(id) ON DELETE RESTRICT,
  source_approval_review_id uuid NOT NULL REFERENCES public.policy_translation_reviews(id) ON DELETE RESTRICT,
  audit_log_id uuid NOT NULL REFERENCES public.audit_logs(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  copied_at public.finite_timestamptz NOT NULL,
  CHECK (target_translation_id <> source_translation_id)
);
CREATE TRIGGER policy_translation_copy_append_only_trigger BEFORE UPDATE OR DELETE ON public.policy_translation_copy_evidence FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER policy_translation_copy_no_truncate_trigger BEFORE TRUNCATE ON public.policy_translation_copy_evidence FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE TABLE public.media_metadata_translation_copy_evidence (
  target_translation_id uuid PRIMARY KEY REFERENCES public.media_metadata_revision_translations(id) ON DELETE RESTRICT,
  source_translation_id uuid NOT NULL REFERENCES public.media_metadata_revision_translations(id) ON DELETE RESTRICT,
  source_approval_review_id uuid NOT NULL REFERENCES public.media_metadata_translation_reviews(id) ON DELETE RESTRICT,
  audit_log_id uuid NOT NULL REFERENCES public.audit_logs(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  copied_at public.finite_timestamptz NOT NULL,
  CHECK (target_translation_id <> source_translation_id)
);
CREATE TRIGGER media_metadata_translation_copy_append_only_trigger BEFORE UPDATE OR DELETE ON public.media_metadata_translation_copy_evidence FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER media_metadata_translation_copy_no_truncate_trigger BEFORE TRUNCATE ON public.media_metadata_translation_copy_evidence FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE FUNCTION public.content_authoring_revision_sealed(parent_column text, revision_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE sealed boolean;
BEGIN
  IF parent_column NOT IN ('idol_revision_id','gift_revision_id','homepage_revision_id','policy_revision_id','media_metadata_revision_id') THEN
    RAISE EXCEPTION 'unsupported authoring parent' USING ERRCODE='55000';
  END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.content_authoring_receipts WHERE %I=$1 OR %I=$1)',parent_column,'source_'||parent_column) INTO sealed USING revision_id;
  RETURN sealed;
END;
$$;

CREATE FUNCTION public.guard_authored_content_payload()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE old_parent uuid; new_parent uuid; item jsonb;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS(SELECT 1 FROM public.content_authoring_receipts) THEN
      RAISE EXCEPTION 'authored content history cannot be truncated' USING ERRCODE='55000';
    END IF;
    RETURN NULL;
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(jsonb_build_array(to_jsonb(OLD),to_jsonb(NEW))) WHERE value IS NOT NULL AND value <> 'null'::jsonb LOOP
    IF TG_NARGS = 2 THEN
      new_parent := (item ->> TG_ARGV[1])::uuid;
    ELSE
      EXECUTE format('SELECT %I FROM %s WHERE id=$1',TG_ARGV[0],TG_ARGV[2]::regclass)
        INTO new_parent USING (item ->> TG_ARGV[1])::uuid;
    END IF;
    EXECUTE format('SELECT id FROM public.%I WHERE id=$1 FOR UPDATE',left(TG_ARGV[0],length(TG_ARGV[0])-3)||'s') USING new_parent;
    IF public.content_authoring_revision_sealed(TG_ARGV[0],new_parent) THEN
      RAISE EXCEPTION 'authored revision payload is sealed; create another revision' USING ERRCODE='55000';
    END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE FUNCTION public.assert_content_translation_copy()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE source_row jsonb; target_row jsonb; source_revision jsonb; target_revision jsonb; source_chain jsonb; target_chain jsonb; receipt public.content_authoring_receipts%ROWTYPE; labels_equal boolean; english_hash public.sha256_hex;
BEGIN
  EXECUTE format('SELECT to_jsonb(t.*) FROM %s t WHERE id=$1',TG_ARGV[0]::regclass) INTO source_row USING NEW.source_translation_id;
  EXECUTE format('SELECT to_jsonb(t.*) FROM %s t WHERE id=$1',TG_ARGV[0]::regclass) INTO target_row USING NEW.target_translation_id;
  IF source_row IS NULL OR target_row IS NULL OR (source_row - 'id' - TG_ARGV[1]) IS DISTINCT FROM (target_row - 'id' - TG_ARGV[1]) THEN
    RAISE EXCEPTION 'copied translation must retain exact text and original audit fields' USING ERRCODE='23514';
  END IF;
  EXECUTE format('SELECT to_jsonb(r.*) FROM %s r WHERE id=$1',TG_ARGV[2]::regclass) INTO source_revision USING (source_row ->> TG_ARGV[1])::uuid;
  EXECUTE format('SELECT to_jsonb(r.*) FROM %s r WHERE id=$1',TG_ARGV[2]::regclass) INTO target_revision USING (target_row ->> TG_ARGV[1])::uuid;
  IF (source_revision ->> 'revision')::bigint >= (target_revision ->> 'revision')::bigint OR (TG_ARGV[5] <> '' AND source_revision ->> TG_ARGV[5] IS DISTINCT FROM target_revision ->> TG_ARGV[5]) THEN
    RAISE EXCEPTION 'copy source must precede target revision with same owner' USING ERRCODE='23514';
  END IF;
  EXECUTE format('SELECT * FROM public.content_authoring_receipts WHERE %I=$1',TG_ARGV[1]) INTO receipt USING (target_row ->> TG_ARGV[1])::uuid;
  IF receipt.id IS NULL OR receipt.action <> 'COPY' OR receipt.audit_log_id <> NEW.audit_log_id OR receipt.created_at <> NEW.copied_at OR (to_jsonb(receipt) ->> ('source_'||TG_ARGV[1]))::uuid IS DISTINCT FROM (source_row ->> TG_ARGV[1])::uuid THEN
    RAISE EXCEPTION 'copy evidence requires its exact authoring receipt' USING ERRCODE='23514';
  END IF;
  EXECUTE format('SELECT source_hash FROM %s WHERE %I=$1 AND locale=''en''',TG_ARGV[0]::regclass,TG_ARGV[1]) INTO english_hash USING (target_row ->> TG_ARGV[1])::uuid;
  IF english_hash IS NULL OR target_row ->> 'translated_from_source_hash' <> english_hash THEN
    RAISE EXCEPTION 'copied approval must bind actual target English source' USING ERRCODE='23514';
  END IF;
  EXECUTE format('SELECT jsonb_agg(to_jsonb(r.*)-''id''-%L ORDER BY sequence) FROM %s r WHERE %I=$1',TG_ARGV[4],TG_ARGV[3]::regclass,TG_ARGV[4]) INTO source_chain USING NEW.source_translation_id;
  EXECUTE format('SELECT jsonb_agg(to_jsonb(r.*)-''id''-%L ORDER BY sequence) FROM %s r WHERE %I=$1',TG_ARGV[4],TG_ARGV[3]::regclass,TG_ARGV[4]) INTO target_chain USING NEW.target_translation_id;
  IF source_chain IS DISTINCT FROM target_chain OR jsonb_array_length(source_chain) <> 3 OR source_chain -> 2 ->> 'status' <> 'APPROVED' THEN
    RAISE EXCEPTION 'copied approval requires exact original three-event review chain' USING ERRCODE='23514';
  END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE id=$1 AND %I=$2 AND sequence=3 AND status=''APPROVED'')',TG_ARGV[3]::regclass,TG_ARGV[4]) INTO labels_equal USING NEW.source_approval_review_id,NEW.source_translation_id;
  IF NOT labels_equal THEN RAISE EXCEPTION 'copy approval reference must bind source translation' USING ERRCODE='23514'; END IF;
  IF TG_ARGV[1]='gift_revision_id' THEN
    SELECT NOT EXISTS((SELECT gift_variant_id,label FROM public.gift_variant_labels WHERE gift_translation_id=NEW.source_translation_id EXCEPT SELECT gift_variant_id,label FROM public.gift_variant_labels WHERE gift_translation_id=NEW.target_translation_id) UNION ALL (SELECT gift_variant_id,label FROM public.gift_variant_labels WHERE gift_translation_id=NEW.target_translation_id EXCEPT SELECT gift_variant_id,label FROM public.gift_variant_labels WHERE gift_translation_id=NEW.source_translation_id)) INTO labels_equal;
  ELSIF TG_ARGV[1]='homepage_revision_id' THEN
    SELECT NOT EXISTS((SELECT slot_key,label FROM public.homepage_slot_translations WHERE homepage_translation_id=NEW.source_translation_id EXCEPT SELECT slot_key,label FROM public.homepage_slot_translations WHERE homepage_translation_id=NEW.target_translation_id) UNION ALL (SELECT slot_key,label FROM public.homepage_slot_translations WHERE homepage_translation_id=NEW.target_translation_id EXCEPT SELECT slot_key,label FROM public.homepage_slot_translations WHERE homepage_translation_id=NEW.source_translation_id)) INTO labels_equal;
  END IF;
  IF NOT labels_equal THEN RAISE EXCEPTION 'copied localized child labels must be identical' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.assert_content_authoring_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE parent_column text; parent_table regclass; translation_table regclass; review_table regclass; translation_column text; proof_table regclass; owner_column text; revision_row jsonb; source_row jsonb; latest bigint; row_data record; target_id uuid; audit public.audit_logs%ROWTYPE; english_hash public.sha256_hex;
BEGIN
  IF NEW.idol_revision_id IS NOT NULL THEN parent_column:='idol_revision_id'; parent_table:='public.idol_revisions'::regclass; translation_table:='public.idol_revision_translations'::regclass; review_table:='public.idol_translation_reviews'::regclass; translation_column:='idol_translation_id'; proof_table:='public.idol_translation_copy_evidence'::regclass; owner_column:='idol_id'; target_id:=NEW.idol_revision_id;
  ELSIF NEW.gift_revision_id IS NOT NULL THEN parent_column:='gift_revision_id'; parent_table:='public.gift_revisions'::regclass; translation_table:='public.gift_revision_translations'::regclass; review_table:='public.gift_translation_reviews'::regclass; translation_column:='gift_translation_id'; proof_table:='public.gift_translation_copy_evidence'::regclass; owner_column:='gift_id'; target_id:=NEW.gift_revision_id;
  ELSIF NEW.homepage_revision_id IS NOT NULL THEN parent_column:='homepage_revision_id'; parent_table:='public.homepage_revisions'::regclass; translation_table:='public.homepage_revision_translations'::regclass; review_table:='public.homepage_translation_reviews'::regclass; translation_column:='homepage_translation_id'; proof_table:='public.homepage_translation_copy_evidence'::regclass; owner_column:=''; target_id:=NEW.homepage_revision_id;
  ELSIF NEW.policy_revision_id IS NOT NULL THEN parent_column:='policy_revision_id'; parent_table:='public.policy_revisions'::regclass; translation_table:='public.policy_revision_translations'::regclass; review_table:='public.policy_translation_reviews'::regclass; translation_column:='policy_translation_id'; proof_table:='public.policy_translation_copy_evidence'::regclass; owner_column:='policy_key'; target_id:=NEW.policy_revision_id;
  ELSIF NEW.media_metadata_revision_id IS NOT NULL THEN parent_column:='media_metadata_revision_id'; parent_table:='public.media_metadata_revisions'::regclass; translation_table:='public.media_metadata_revision_translations'::regclass; review_table:='public.media_metadata_translation_reviews'::regclass; translation_column:='media_metadata_translation_id'; proof_table:='public.media_metadata_translation_copy_evidence'::regclass; owner_column:='media_asset_id'; target_id:=NEW.media_metadata_revision_id;
  END IF;
  EXECUTE format('SELECT to_jsonb(r.*) FROM %s r WHERE id=$1',parent_table) INTO revision_row USING target_id;
  IF revision_row IS NULL OR revision_row->>'lifecycle'<>'DRAFT' OR (revision_row->>'created_by')::uuid<>NEW.actor_id OR (revision_row->>'created_at')::timestamptz<>NEW.created_at OR (revision_row->>'revision')::bigint<>NEW.expected_version+1 THEN
    RAISE EXCEPTION 'authoring receipt must bind the newly created draft revision' USING ERRCODE='23514';
  END IF;
  IF owner_column='' THEN EXECUTE format('SELECT max(revision) FROM %s',parent_table) INTO latest;
  ELSE EXECUTE format('SELECT max(revision) FROM %s WHERE %I::text=$1',parent_table,owner_column) INTO latest USING revision_row->>owner_column; END IF;
  IF latest<>NEW.expected_version+1 THEN RAISE EXCEPTION 'authoring receipt must advance current owner revision' USING ERRCODE='23514'; END IF;
  IF NEW.action='COPY' THEN
    EXECUTE format('SELECT to_jsonb(r.*) FROM %s r WHERE id=$1',parent_table) INTO source_row USING (to_jsonb(NEW)->>('source_'||parent_column))::uuid;
    IF source_row IS NULL OR (source_row->>'revision')::bigint >= (revision_row->>'revision')::bigint OR (owner_column<>'' AND source_row->>owner_column IS DISTINCT FROM revision_row->>owner_column) THEN RAISE EXCEPTION 'copy receipt source must belong to the same owner' USING ERRCODE='23514'; END IF;
  END IF;
  IF cardinality(NEW.changed_paths) <> (SELECT count(DISTINCT path) FROM unnest(NEW.changed_paths) AS path) THEN RAISE EXCEPTION 'changed field paths must be distinct' USING ERRCODE='23514'; END IF;
  SELECT * INTO audit FROM public.audit_logs WHERE id=NEW.audit_log_id;
  IF audit.id IS NULL OR audit.actor_type<>'ADMIN' OR audit.actor_id IS DISTINCT FROM NEW.actor_id OR audit.action<>('CONTENT_REVISION_'||NEW.action) OR audit.subject_type<>'CONTENT_REVISION' OR audit.subject_id<>target_id OR audit.created_at<>NEW.created_at OR audit.outcome<>'SUCCEEDED' OR audit.reason_code IS NULL OR audit.request_id IS NULL OR audit.correlation_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.admin_identities WHERE id=NEW.actor_id AND status='ACTIVE') THEN
    RAISE EXCEPTION 'authoring requires exact successful active-admin audit evidence' USING ERRCODE='23514';
  END IF;
  EXECUTE format('SELECT source_hash FROM %s WHERE %I=$1 AND locale=''en''',translation_table,parent_column) INTO english_hash USING target_id;
  IF english_hash IS NULL THEN RAISE EXCEPTION 'authored revision requires actual English source' USING ERRCODE='23514'; END IF;
  FOR row_data IN EXECUTE format('SELECT t.id,t.editor_id,t.edited_at, e.target_translation_id AS copied, r.status,r.sequence FROM %s t LEFT JOIN %s e ON e.target_translation_id=t.id LEFT JOIN LATERAL(SELECT status,sequence FROM %s WHERE %I=t.id ORDER BY sequence DESC LIMIT 1) r ON true WHERE t.%I=$1',translation_table,proof_table,review_table,translation_column,parent_column) USING target_id LOOP
    IF row_data.copied IS NULL AND (row_data.editor_id<>NEW.actor_id OR row_data.edited_at<>NEW.created_at OR row_data.status IS DISTINCT FROM 'DRAFT' OR row_data.sequence IS DISTINCT FROM 1::bigint) THEN RAISE EXCEPTION 'new translation must bind current author and initial draft review' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER content_authoring_receipt_validate_trigger AFTER INSERT ON public.content_authoring_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_content_authoring_receipt();
CREATE CONSTRAINT TRIGGER idol_translation_copy_validate_trigger AFTER INSERT ON public.idol_translation_copy_evidence DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_content_translation_copy('public.idol_revision_translations','idol_revision_id','public.idol_revisions','public.idol_translation_reviews','idol_translation_id','idol_id');
CREATE TRIGGER idol_authored_revision_delete_guard BEFORE DELETE ON public.idol_revisions FOR EACH ROW EXECUTE FUNCTION public.guard_authored_content_payload('idol_revision_id','id');
CREATE TRIGGER idol_authored_translation_guard BEFORE INSERT ON public.idol_revision_translations FOR EACH ROW EXECUTE FUNCTION public.guard_authored_content_payload('idol_revision_id','idol_revision_id');
CREATE TRIGGER idol_authored_revision_truncate_guard BEFORE TRUNCATE ON public.idol_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.guard_authored_content_payload('idol_revision_id','id');
CREATE CONSTRAINT TRIGGER gift_translation_copy_validate_trigger AFTER INSERT ON public.gift_translation_copy_evidence DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_content_translation_copy('public.gift_revision_translations','gift_revision_id','public.gift_revisions','public.gift_translation_reviews','gift_translation_id','gift_id');
CREATE TRIGGER gift_authored_revision_delete_guard BEFORE DELETE ON public.gift_revisions FOR EACH ROW EXECUTE FUNCTION public.guard_authored_content_payload('gift_revision_id','id');
CREATE TRIGGER gift_authored_translation_guard BEFORE INSERT ON public.gift_revision_translations FOR EACH ROW EXECUTE FUNCTION public.guard_authored_content_payload('gift_revision_id','gift_revision_id');
CREATE TRIGGER gift_authored_revision_truncate_guard BEFORE TRUNCATE ON public.gift_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.guard_authored_content_payload('gift_revision_id','id');
CREATE CONSTRAINT TRIGGER homepage_translation_copy_validate_trigger AFTER INSERT ON public.homepage_translation_copy_evidence DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_content_translation_copy('public.homepage_revision_translations','homepage_revision_id','public.homepage_revisions','public.homepage_translation_reviews','homepage_translation_id','');
CREATE TRIGGER homepage_authored_revision_delete_guard BEFORE DELETE ON public.homepage_revisions FOR EACH ROW EXECUTE FUNCTION public.guard_authored_content_payload('homepage_revision_id','id');
CREATE TRIGGER homepage_authored_translation_guard BEFORE INSERT ON public.homepage_revision_translations FOR EACH ROW EXECUTE FUNCTION public.guard_authored_content_payload('homepage_revision_id','homepage_revision_id');
CREATE TRIGGER homepage_authored_revision_truncate_guard BEFORE TRUNCATE ON public.homepage_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.guard_authored_content_payload('homepage_revision_id','id');
CREATE CONSTRAINT TRIGGER policy_translation_copy_validate_trigger AFTER INSERT ON public.policy_translation_copy_evidence DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_content_translation_copy('public.policy_revision_translations','policy_revision_id','public.policy_revisions','public.policy_translation_reviews','policy_translation_id','policy_key');
CREATE TRIGGER policy_authored_revision_delete_guard BEFORE DELETE ON public.policy_revisions FOR EACH ROW EXECUTE FUNCTION public.guard_authored_content_payload('policy_revision_id','id');
CREATE TRIGGER policy_authored_translation_guard BEFORE INSERT ON public.policy_revision_translations FOR EACH ROW EXECUTE FUNCTION public.guard_authored_content_payload('policy_revision_id','policy_revision_id');
CREATE TRIGGER policy_authored_revision_truncate_guard BEFORE TRUNCATE ON public.policy_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.guard_authored_content_payload('policy_revision_id','id');
CREATE CONSTRAINT TRIGGER media_metadata_translation_copy_validate_trigger AFTER INSERT ON public.media_metadata_translation_copy_evidence DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_content_translation_copy('public.media_metadata_revision_translations','media_metadata_revision_id','public.media_metadata_revisions','public.media_metadata_translation_reviews','media_metadata_translation_id','media_asset_id');
CREATE TRIGGER media_metadata_authored_revision_delete_guard BEFORE DELETE ON public.media_metadata_revisions FOR EACH ROW EXECUTE FUNCTION public.guard_authored_content_payload('media_metadata_revision_id','id');
CREATE TRIGGER media_metadata_authored_translation_guard BEFORE INSERT ON public.media_metadata_revision_translations FOR EACH ROW EXECUTE FUNCTION public.guard_authored_content_payload('media_metadata_revision_id','media_metadata_revision_id');
CREATE TRIGGER media_metadata_authored_revision_truncate_guard BEFORE TRUNCATE ON public.media_metadata_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.guard_authored_content_payload('media_metadata_revision_id','id');
CREATE TRIGGER idol_revision_alias_sets_authored_guard BEFORE INSERT OR UPDATE OR DELETE ON public.idol_revision_alias_sets FOR EACH ROW EXECUTE FUNCTION public.guard_authored_content_payload('idol_revision_id','idol_revision_id');
CREATE TRIGGER idol_revision_alias_sets_authored_truncate_guard BEFORE TRUNCATE ON public.idol_revision_alias_sets FOR EACH STATEMENT EXECUTE FUNCTION public.guard_authored_content_payload('idol_revision_id','idol_revision_id');
CREATE TRIGGER gift_detail_documents_authored_guard BEFORE INSERT OR UPDATE OR DELETE ON public.gift_detail_documents FOR EACH ROW EXECUTE FUNCTION public.guard_authored_content_payload('gift_revision_id','gift_revision_id');
CREATE TRIGGER gift_detail_documents_authored_truncate_guard BEFORE TRUNCATE ON public.gift_detail_documents FOR EACH STATEMENT EXECUTE FUNCTION public.guard_authored_content_payload('gift_revision_id','gift_revision_id');
CREATE TRIGGER idol_revision_media_authored_guard BEFORE INSERT OR UPDATE OR DELETE ON public.idol_revision_media FOR EACH ROW EXECUTE FUNCTION public.guard_authored_content_payload('idol_revision_id','idol_revision_id');
CREATE TRIGGER idol_revision_media_authored_truncate_guard BEFORE TRUNCATE ON public.idol_revision_media FOR EACH STATEMENT EXECUTE FUNCTION public.guard_authored_content_payload('idol_revision_id','idol_revision_id');
CREATE TRIGGER gift_revision_contents_authored_guard BEFORE INSERT OR UPDATE OR DELETE ON public.gift_revision_contents FOR EACH ROW EXECUTE FUNCTION public.guard_authored_content_payload('gift_revision_id','gift_revision_id');
CREATE TRIGGER gift_revision_contents_authored_truncate_guard BEFORE TRUNCATE ON public.gift_revision_contents FOR EACH STATEMENT EXECUTE FUNCTION public.guard_authored_content_payload('gift_revision_id','gift_revision_id');
CREATE TRIGGER gift_revision_media_authored_guard BEFORE INSERT OR UPDATE OR DELETE ON public.gift_revision_media FOR EACH ROW EXECUTE FUNCTION public.guard_authored_content_payload('gift_revision_id','gift_revision_id');
CREATE TRIGGER gift_revision_media_authored_truncate_guard BEFORE TRUNCATE ON public.gift_revision_media FOR EACH STATEMENT EXECUTE FUNCTION public.guard_authored_content_payload('gift_revision_id','gift_revision_id');
CREATE TRIGGER gift_variant_labels_authored_guard BEFORE INSERT OR UPDATE OR DELETE ON public.gift_variant_labels FOR EACH ROW EXECUTE FUNCTION public.guard_authored_content_payload('gift_revision_id','gift_translation_id','public.gift_revision_translations');
CREATE TRIGGER gift_variant_labels_authored_truncate_guard BEFORE TRUNCATE ON public.gift_variant_labels FOR EACH STATEMENT EXECUTE FUNCTION public.guard_authored_content_payload('gift_revision_id','gift_translation_id','public.gift_revision_translations');
CREATE TRIGGER homepage_slots_authored_guard BEFORE INSERT OR UPDATE OR DELETE ON public.homepage_slots FOR EACH ROW EXECUTE FUNCTION public.guard_authored_content_payload('homepage_revision_id','homepage_revision_id');
CREATE TRIGGER homepage_slots_authored_truncate_guard BEFORE TRUNCATE ON public.homepage_slots FOR EACH STATEMENT EXECUTE FUNCTION public.guard_authored_content_payload('homepage_revision_id','homepage_revision_id');
CREATE TRIGGER homepage_slot_translations_authored_guard BEFORE INSERT OR UPDATE OR DELETE ON public.homepage_slot_translations FOR EACH ROW EXECUTE FUNCTION public.guard_authored_content_payload('homepage_revision_id','homepage_translation_id','public.homepage_revision_translations');
CREATE TRIGGER homepage_slot_translations_authored_truncate_guard BEFORE TRUNCATE ON public.homepage_slot_translations FOR EACH STATEMENT EXECUTE FUNCTION public.guard_authored_content_payload('homepage_revision_id','homepage_translation_id','public.homepage_revision_translations');

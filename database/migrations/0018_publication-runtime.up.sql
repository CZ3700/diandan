-- Existing immutable publications retain their legacy proof version. Every new event requires v2 proof.
ALTER TABLE public.content_publications ADD COLUMN proof_version smallint NOT NULL DEFAULT 1 CHECK (proof_version IN (1,2));
ALTER TABLE public.content_publications ALTER COLUMN proof_version SET DEFAULT 2;

CREATE TABLE public.content_publication_manifests (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version=1),
  publication_id uuid UNIQUE REFERENCES public.content_publications(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  idol_revision_id uuid REFERENCES public.idol_revisions(id) ON DELETE RESTRICT,
  gift_revision_id uuid REFERENCES public.gift_revisions(id) ON DELETE RESTRICT,
  homepage_revision_id uuid REFERENCES public.homepage_revisions(id) ON DELETE RESTRICT,
  policy_revision_id uuid REFERENCES public.policy_revisions(id) ON DELETE RESTRICT,
  media_metadata_revision_id uuid REFERENCES public.media_metadata_revisions(id) ON DELETE RESTRICT,
  manifest_text text NOT NULL CHECK (octet_length(manifest_text) BETWEEN 2 AND 8388608),
  manifest jsonb GENERATED ALWAYS AS (manifest_text::jsonb) STORED,
  manifest_hash public.sha256_hex NOT NULL,
  translation_manifest_hash public.sha256_hex NOT NULL,
  approval_manifest_hash public.sha256_hex NOT NULL,
  media_manifest_hash public.sha256_hex,
  created_at public.finite_timestamptz NOT NULL,
  CHECK (num_nonnulls(idol_revision_id,gift_revision_id,homepage_revision_id,policy_revision_id,media_metadata_revision_id)=1)
);

CREATE TABLE public.content_purge_jobs (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version=1),
  publication_id uuid NOT NULL REFERENCES public.content_publications(id) ON DELETE RESTRICT,
  outbox_event_id uuid NOT NULL REFERENCES public.outbox_events(id) ON DELETE RESTRICT,
  locale public.supported_locale NOT NULL,
  generation integer NOT NULL DEFAULT 1 CHECK (generation>0),
  retry_of uuid UNIQUE REFERENCES public.content_purge_jobs(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUBMITTED','COMPLETED','FAILED')),
  version bigint NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count BETWEEN 0 AND 6),
  paths text[] NOT NULL CHECK (array_ndims(paths)=1 AND cardinality(paths) BETWEEN 1 AND 3000 AND array_position(paths,NULL) IS NULL),
  lease_token uuid,
  lease_expires_at public.finite_timestamptz,
  purge_reference text CHECK (length(purge_reference) BETWEEN 1 AND 512),
  error_code text CHECK (error_code IN ('INVALID_COMMAND','PURGE_NOT_FOUND','IDEMPOTENCY_CONFLICT','ACCESS_DENIED','RATE_LIMITED','TEMPORARY_UNAVAILABLE','CONFIGURATION_ERROR','UNEXPECTED_ADAPTER_FAILURE','PURGE_TIMEOUT','INVALID_PROVIDER_RESPONSE')),
  created_at public.finite_timestamptz NOT NULL,
  updated_at public.finite_timestamptz NOT NULL,
  next_attempt_at public.finite_timestamptz,
  completed_at public.finite_timestamptz,
  UNIQUE(outbox_event_id,generation),
  CHECK ((generation=1)=(retry_of IS NULL)),
  CHECK ((lease_token IS NULL)=(lease_expires_at IS NULL)),
  CHECK ((status='COMPLETED')=(completed_at IS NOT NULL)),
  CHECK ((status IN ('COMPLETED','FAILED'))=(next_attempt_at IS NULL)),
  CHECK (status<>'SUBMITTED' OR purge_reference IS NOT NULL),
  CHECK (status<>'PENDING' OR purge_reference IS NULL),
  CHECK (status NOT IN ('COMPLETED','FAILED') OR lease_token IS NULL),
  CHECK (updated_at>=created_at AND (completed_at IS NULL OR completed_at>=created_at))
);
CREATE INDEX content_purge_due_idx ON public.content_purge_jobs(next_attempt_at,id) WHERE status IN ('PENDING','SUBMITTED');

CREATE TABLE public.content_publication_receipts (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version=1),
  action text NOT NULL CHECK (action IN ('VALIDATE','PUBLISH','ROLLBACK','RETRY_PURGE')),
  actor_id uuid NOT NULL REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES public.admin_sessions(id) ON DELETE RESTRICT,
  audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  manifest_id uuid UNIQUE REFERENCES public.content_publication_manifests(id) ON DELETE RESTRICT,
  publication_id uuid REFERENCES public.content_publications(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  purge_job_id uuid UNIQUE REFERENCES public.content_purge_jobs(id) ON DELETE RESTRICT,
  expected_version bigint NOT NULL CHECK (expected_version BETWEEN 0 AND 9007199254740991),
  expected_content_hash public.sha256_hex,
  result_head_version bigint CHECK (result_head_version BETWEEN 0 AND 9007199254740991),
  result_content_hash public.sha256_hex,
  result_generation integer CHECK (result_generation>1),
  result_version bigint CHECK (result_version>0),
  created_at public.finite_timestamptz NOT NULL,
  field_paths text[] NOT NULL,
  CHECK ((action='RETRY_PURGE' AND manifest_id IS NULL AND publication_id IS NOT NULL AND purge_job_id IS NOT NULL
    AND num_nonnulls(expected_content_hash,result_head_version,result_content_hash)=0 AND result_generation IS NOT NULL AND result_version=1 AND field_paths=ARRAY['cachePurge'])
    OR (action<>'RETRY_PURGE' AND manifest_id IS NOT NULL AND purge_job_id IS NULL AND expected_content_hash IS NOT NULL AND result_head_version IS NOT NULL AND result_content_hash IS NOT NULL
      AND result_generation IS NULL AND result_version IS NULL AND ((action='VALIDATE')=(publication_id IS NULL)) AND field_paths=CASE WHEN action='VALIDATE' THEN ARRAY['lifecycle'] ELSE ARRAY['lifecycle','publication','searchProjection','cachePurge'] END))
);
CREATE UNIQUE INDEX content_publication_receipt_event_unique ON public.content_publication_receipts(publication_id) WHERE action IN ('PUBLISH','ROLLBACK');

CREATE TABLE public.content_purge_attempts (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version=1),
  job_id uuid NOT NULL REFERENCES public.content_purge_jobs(id) ON DELETE RESTRICT,
  job_version bigint NOT NULL CHECK (job_version>1),
  lease_token uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('CLAIM','SUBMITTED','PENDING','COMPLETED','FAILURE','TIMEOUT')),
  error_code text,
  created_at public.finite_timestamptz NOT NULL,
  UNIQUE(job_id,job_version)
);

CREATE TABLE public.idol_alias_search_projections (
  alias_set_id uuid NOT NULL,
  alias_id text NOT NULL,
  content_hash public.sha256_hex NOT NULL,
  algorithm_version smallint NOT NULL CHECK (algorithm_version=1),
  normalized_name text NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 240),
  PRIMARY KEY(alias_set_id,alias_id),
  FOREIGN KEY(alias_set_id,alias_id) REFERENCES public.idol_revision_aliases(alias_set_id,alias_id) ON DELETE CASCADE
);

-- Manifest canonicalization preserves raw Unicode. All manifest numbers fit exact JSON integer/focal domains.
CREATE FUNCTION public.canonical_publication_json(value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result text;
BEGIN
  IF jsonb_typeof(value)='object' THEN
    SELECT '{'||coalesce(string_agg(to_json(key)::text||':'||public.canonical_publication_json(child),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(value) AS entry(key,child);
  ELSIF jsonb_typeof(value)='array' THEN
    SELECT '['||coalesce(string_agg(public.canonical_publication_json(child),',' ORDER BY position),'')||']' INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS entry(child,position);
  ELSE result:=value::text;
  END IF;
  RETURN result;
END; $$;

CREATE FUNCTION public.guard_new_content_publication_proof() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.proof_version<>2 THEN RAISE EXCEPTION 'new content publications require current proof version' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER a_content_publication_proof_version BEFORE INSERT ON public.content_publications FOR EACH ROW EXECUTE FUNCTION public.guard_new_content_publication_proof();

CREATE FUNCTION public.assert_current_content_publication_proof() RETURNS trigger
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
CREATE CONSTRAINT TRIGGER content_publication_current_proof AFTER INSERT ON public.content_publications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_current_content_publication_proof();

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['content_publication_manifests','content_publication_receipts','content_purge_attempts'] LOOP
    EXECUTE format('CREATE TRIGGER publication_evidence_append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_append_only()',table_name);
    EXECUTE format('CREATE TRIGGER publication_evidence_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only()',table_name);
  END LOOP;
END $$;
CREATE TRIGGER content_purge_no_delete BEFORE DELETE ON public.content_purge_jobs FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER content_purge_no_truncate BEFORE TRUNCATE ON public.content_purge_jobs FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE FUNCTION public.publication_pick_fields(row_value jsonb, field_names text[]) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb:='{}'; field text; source text; value jsonb;
BEGIN
  FOREACH field IN ARRAY field_names LOOP
    source:=lower(regexp_replace(field,'([A-Z])','_\1','g'));
    value:=row_value->source;
    IF value IS NOT NULL AND value<>'null'::jsonb THEN result:=result||jsonb_build_object(field,value); END IF;
  END LOOP;
  RETURN result;
END; $$;
CREATE FUNCTION public.publication_same_set(left_value jsonb,right_value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT coalesce(jsonb_typeof(left_value)='array' AND jsonb_typeof(right_value)='array'
    AND left_value @> right_value AND right_value @> left_value AND jsonb_array_length(left_value)=jsonb_array_length(right_value),false)
$$;

CREATE FUNCTION public.assert_publication_manifest_revision(value jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE kind text:=value#>>'{target,kind}'; revision_id uuid:=(value->>'revisionId')::uuid; prefix text; parent_column text; translation_column text;
  parent jsonb; translation jsonb; review jsonb; evidence jsonb; source_parent uuid; text_row jsonb; audit_row jsonb; expected jsonb; fields text[]; actual_count integer; locales text[]:='{}'; english_hash text;
BEGIN
  IF kind IS NULL OR kind NOT IN ('IDOL','GIFT','HOMEPAGE','POLICY','MEDIA_METADATA')
    OR jsonb_typeof(value) IS DISTINCT FROM 'object' OR jsonb_typeof(value->'content') IS DISTINCT FROM 'object'
    OR jsonb_typeof(value#>'{content,translations}') IS DISTINCT FROM 'array' OR jsonb_typeof(value->'translationAudits') IS DISTINCT FROM 'array'
    OR jsonb_typeof(value->'extensions') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'manifest revision kind and proof shape must be typed' USING ERRCODE='23514'; END IF;
  prefix:=lower(kind); parent_column:=prefix||'_revision_id'; translation_column:=prefix||'_translation_id';
  EXECUTE format('SELECT to_jsonb(p.*) FROM public.%I p WHERE p.id=$1 FOR UPDATE',prefix||'_revisions') INTO parent USING revision_id;
  IF parent IS NULL OR value->>'schemaVersion' IS DISTINCT FROM '1' OR value#>>'{content,kind}' IS DISTINCT FROM kind OR (value->>'revisionNumber')::bigint IS DISTINCT FROM (parent->>'revision')::bigint
    OR (value->>'createdBy')::uuid IS DISTINCT FROM (parent->>'created_by')::uuid OR (value->>'createdAt')::timestamptz IS DISTINCT FROM (parent->>'created_at')::timestamptz THEN
    RAISE EXCEPTION 'manifest revision requires its exact immutable parent' USING ERRCODE='23514';
  END IF;
  IF (kind='IDOL' AND (value#>>'{target,idolId}')::uuid IS DISTINCT FROM (parent->>'idol_id')::uuid)
    OR (kind='GIFT' AND (value#>>'{target,giftId}')::uuid IS DISTINCT FROM (parent->>'gift_id')::uuid)
    OR (kind='POLICY' AND value#>>'{target,policyKey}' IS DISTINCT FROM parent->>'policy_key')
    OR (kind='MEDIA_METADATA' AND (value#>>'{target,mediaAssetId}')::uuid IS DISTINCT FROM (parent->>'media_asset_id')::uuid) THEN
    RAISE EXCEPTION 'manifest revision requires its exact owner' USING ERRCODE='23514';
  END IF;
  fields:=CASE kind WHEN 'IDOL' THEN ARRAY['displayName','shortBio','fullBio','seoTitle','seoDescription']
    WHEN 'GIFT' THEN ARRAY['title','subtitle','shortDescription','description','fulfillmentDescription','safetyNotice','seoTitle','seoDescription']
    WHEN 'HOMEPAGE' THEN ARRAY['heroTitle','heroSubtitle','ctaLabel','announcement','seoTitle','seoDescription']
    WHEN 'POLICY' THEN ARRAY['title','summary','body'] ELSE ARRAY['alt','title','caption'] END;
  EXECUTE format('SELECT count(*),max(source_hash) FILTER(WHERE locale=''en'') FROM public.%I WHERE %I=$1',prefix||'_revision_translations',parent_column) INTO actual_count,english_hash USING revision_id;
  IF actual_count<>7 OR jsonb_array_length(value#>'{content,translations}') IS DISTINCT FROM 7 OR jsonb_array_length(value->'translationAudits') IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'manifest revision requires seven real translations and approvals' USING ERRCODE='23514';
  END IF;
  FOR text_row IN SELECT * FROM jsonb_array_elements(value#>'{content,translations}') LOOP
    IF text_row->>'locale'=ANY(locales) THEN RAISE EXCEPTION 'manifest locale must occur once' USING ERRCODE='23514'; END IF;
    locales:=array_append(locales,text_row->>'locale');
    EXECUTE format('SELECT to_jsonb(t.*),to_jsonb(r.*),to_jsonb(e.*) FROM public.%I t JOIN LATERAL(SELECT * FROM public.%I WHERE %I=t.id ORDER BY sequence DESC LIMIT 1) r ON true LEFT JOIN public.%I e ON e.target_translation_id=t.id WHERE t.%I=$1 AND t.locale=$2 FOR UPDATE OF t',prefix||'_revision_translations',prefix||'_translation_reviews',translation_column,prefix||'_translation_copy_evidence',parent_column)
      INTO translation,review,evidence USING revision_id,text_row->>'locale';
    SELECT item INTO audit_row FROM jsonb_array_elements(value->'translationAudits') item WHERE item->>'locale'=text_row->>'locale';
    IF translation IS NULL OR audit_row IS NULL OR review->>'status' IS DISTINCT FROM 'APPROVED' OR review->>'sequence' IS DISTINCT FROM '3'
      OR text_row->>'origin' IS DISTINCT FROM translation->>'origin' OR text_row->>'importBatchId' IS DISTINCT FROM translation->>'import_batch_id'
      OR (audit_row->>'id')::uuid IS DISTINCT FROM (translation->>'id')::uuid OR (audit_row->>'reviewId')::uuid IS DISTINCT FROM (review->>'id')::uuid OR audit_row->>'reviewSequence' IS DISTINCT FROM '3'
      OR audit_row->>'sourceHash' IS DISTINCT FROM translation->>'source_hash' OR audit_row->>'translatedFromSourceHash' IS DISTINCT FROM english_hash
      OR translation->>'translated_from_source_hash' IS DISTINCT FROM english_hash OR audit_row->>'origin' IS DISTINCT FROM translation->>'origin'
      OR audit_row->>'importBatchId' IS DISTINCT FROM translation->>'import_batch_id' OR (audit_row->>'editorId')::uuid IS DISTINCT FROM (translation->>'editor_id')::uuid
      OR (audit_row->>'editedAt')::timestamptz IS DISTINCT FROM (translation->>'edited_at')::timestamptz
      OR audit_row#>>'{review,status}' IS DISTINCT FROM 'APPROVED' OR (audit_row#>>'{review,reviewerId}')::uuid IS DISTINCT FROM (review->>'reviewer_id')::uuid
      OR (audit_row#>>'{review,reviewedAt}')::timestamptz IS DISTINCT FROM (review->>'reviewed_at')::timestamptz
      OR audit_row#>>'{review,reviewedSourceHash}' IS DISTINCT FROM review->>'reviewed_source_hash'
      OR audit_row#>>'{review,reviewedContentHash}' IS DISTINCT FROM review->>'reviewed_content_hash'
      OR review->>'reviewed_source_hash' IS DISTINCT FROM english_hash OR review->>'reviewed_content_hash' IS DISTINCT FROM translation->>'source_hash'
      OR (review->>'reviewer_id')::uuid=(translation->>'editor_id')::uuid THEN
      RAISE EXCEPTION 'manifest must bind exact current independent approved translation evidence' USING ERRCODE='23514';
    END IF;
    expected:=public.publication_pick_fields(translation,fields);
    IF (text_row->'fields')-ARRAY['variantLabels','slotLabels'] IS DISTINCT FROM expected THEN RAISE EXCEPTION 'manifest translation fields must equal real raw content' USING ERRCODE='23514'; END IF;
    IF kind='GIFT' THEN
      SELECT coalesce(jsonb_agg(public.publication_pick_fields(to_jsonb(r.*),ARRAY['giftVariantId','label'])),'[]') INTO expected FROM public.gift_variant_labels r WHERE gift_translation_id=(translation->>'id')::uuid;
      IF NOT public.publication_same_set(text_row#>'{fields,variantLabels}',expected) THEN RAISE EXCEPTION 'manifest variant labels require real content' USING ERRCODE='23514'; END IF;
    ELSIF kind='HOMEPAGE' THEN
      SELECT coalesce(jsonb_agg(public.publication_pick_fields(to_jsonb(r.*),ARRAY['slotKey','label'])),'[]') INTO expected FROM public.homepage_slot_translations r WHERE homepage_translation_id=(translation->>'id')::uuid;
      IF NOT public.publication_same_set(text_row#>'{fields,slotLabels}',expected) THEN RAISE EXCEPTION 'manifest slot labels require real content' USING ERRCODE='23514'; END IF;
    END IF;
    IF evidence IS NULL THEN
      IF audit_row ? 'inheritedFrom' OR (review->>'reviewer_id')::uuid=(parent->>'created_by')::uuid THEN RAISE EXCEPTION 'direct approval cannot inherit structure independence' USING ERRCODE='23514'; END IF;
    ELSE
      EXECUTE format('SELECT %I FROM public.%I WHERE id=$1',parent_column,prefix||'_revision_translations') INTO source_parent USING (evidence->>'source_translation_id')::uuid;
      IF (audit_row#>>'{inheritedFrom,revisionId}')::uuid IS DISTINCT FROM source_parent
        OR (audit_row#>>'{inheritedFrom,translationId}')::uuid IS DISTINCT FROM (evidence->>'source_translation_id')::uuid
        OR (audit_row#>>'{inheritedFrom,reviewId}')::uuid IS DISTINCT FROM (evidence->>'source_approval_review_id')::uuid THEN
        RAISE EXCEPTION 'inherited approval requires exact typed source edge' USING ERRCODE='23514';
      END IF;
    END IF;
  END LOOP;
  IF kind='IDOL' THEN
    expected:=public.publication_pick_fields(parent,ARRAY['themeAccent','heroTextTone','displayOrder']);
  ELSIF kind='GIFT' THEN
    SELECT coalesce(jsonb_agg(public.publication_pick_fields(to_jsonb(r.*),ARRAY['componentCode','quantity','unit'])),'[]') INTO expected FROM public.gift_revision_contents r WHERE gift_revision_id=revision_id;
    IF NOT public.publication_same_set(value#>'{content,structure,contents}',expected) THEN RAISE EXCEPTION 'manifest gift contents require exact rows' USING ERRCODE='23514'; END IF;
    expected:=public.publication_pick_fields(parent,ARRAY['category','requiresSafetyNotice','shippingMode'])||jsonb_build_object('deliveryEstimate',jsonb_build_object('minimum',parent->'delivery_minimum','maximum',parent->'delivery_maximum','unit',parent->'delivery_unit'));
    IF (value#>'{content,structure}')-'contents' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'manifest gift structure requires exact parent' USING ERRCODE='23514'; END IF;
  ELSIF kind='HOMEPAGE' THEN
    SELECT coalesce(jsonb_agg(public.publication_pick_fields(to_jsonb(r.*),ARRAY['slotKey','kind','idolId','giftId','policyKey','desktopMediaAssetId','desktopMediaMetadataRevisionId','mobileMediaAssetId','mobileMediaMetadataRevisionId','sortOrder'])),'[]') INTO expected FROM public.homepage_slots r WHERE homepage_revision_id=revision_id;
    IF NOT public.publication_same_set(value#>'{content,structure,slots}',expected) THEN RAISE EXCEPTION 'manifest homepage slots require exact rows' USING ERRCODE='23514'; END IF;
  ELSIF kind='POLICY' THEN
    IF value#>>'{content,structure,kind}' IS DISTINCT FROM parent->>'kind' OR (value#>>'{content,structure,effectiveAt}')::timestamptz IS DISTINCT FROM (parent->>'effective_at')::timestamptz THEN RAISE EXCEPTION 'manifest policy structure requires exact parent' USING ERRCODE='23514'; END IF;
  ELSE expected:=jsonb_build_object('presentationKind',parent->'presentation_kind','focalPoint',jsonb_build_object('x',parent->'focal_x','y',parent->'focal_y'));
  END IF;
  IF kind IN ('IDOL','MEDIA_METADATA') AND value#>'{content,structure}' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'manifest structure requires exact parent values' USING ERRCODE='23514'; END IF;
  PERFORM public.assert_publication_manifest_extensions(value);
  IF kind IN ('IDOL','GIFT') THEN
    EXECUTE format('SELECT coalesce(jsonb_agg(public.publication_pick_fields(to_jsonb(r.*),ARRAY[''role'',''mediaAssetId'',''mediaMetadataRevisionId'',''sortOrder''])),''[]'') FROM public.%I r WHERE %I=$1',prefix||'_revision_media',parent_column) INTO expected USING revision_id;
    IF NOT public.publication_same_set(value#>'{content,media}',expected) THEN RAISE EXCEPTION 'manifest media references require exact typed rows' USING ERRCODE='23514'; END IF;
  END IF;
END; $$;

CREATE FUNCTION public.assert_content_publication_manifest() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE value jsonb:=NEW.manifest; target_id uuid; expected_kind text; media_revision jsonb;
BEGIN
  target_id:=coalesce(NEW.idol_revision_id,NEW.gift_revision_id,NEW.homepage_revision_id,NEW.policy_revision_id,NEW.media_metadata_revision_id);
  expected_kind:=CASE WHEN NEW.idol_revision_id IS NOT NULL THEN 'IDOL' WHEN NEW.gift_revision_id IS NOT NULL THEN 'GIFT' WHEN NEW.homepage_revision_id IS NOT NULL THEN 'HOMEPAGE' WHEN NEW.policy_revision_id IS NOT NULL THEN 'POLICY' ELSE 'MEDIA_METADATA' END;
  IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR jsonb_typeof(value->'revision') IS DISTINCT FROM 'object' OR jsonb_typeof(value->'target') IS DISTINCT FROM 'object'
    OR jsonb_typeof(value->'mediaRevisions') IS DISTINCT FROM 'array' OR jsonb_typeof(value->'approvals') IS DISTINCT FROM 'array'
    OR jsonb_typeof(value->'copies') IS DISTINCT FROM 'array' OR jsonb_typeof(value->'extensionApprovals') IS DISTINCT FROM 'array'
    OR jsonb_typeof(value->'media') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'manifest proof sections must have their exact shape' USING ERRCODE='23514'; END IF;
  IF value->>'schemaVersion' IS DISTINCT FROM '1' OR (value#>>'{target,revisionId}')::uuid IS DISTINCT FROM target_id OR value#>>'{target,owner,kind}' IS DISTINCT FROM expected_kind
    OR value->'target' IS DISTINCT FROM jsonb_build_object('owner',value#>'{revision,target}','revisionId',value#>'{revision,revisionId}')
    OR NEW.manifest_text<>public.canonical_publication_json(value)
    OR NEW.manifest_hash<>encode(sha256(convert_to('fan-support.publication-manifest.v1'||chr(10)||NEW.manifest_text,'UTF8')),'hex')
    OR NEW.translation_manifest_hash<>encode(sha256(convert_to('fan-support.publication-manifest.v1/translations'||chr(10)||public.canonical_publication_json(jsonb_build_object('revision',value->'revision')),'UTF8')),'hex')
    OR NEW.approval_manifest_hash<>encode(sha256(convert_to('fan-support.publication-manifest.v1/approvals'||chr(10)||public.canonical_publication_json(jsonb_build_object('approvals',value->'approvals','copies',value->'copies','extensionApprovals',value->'extensionApprovals')),'UTF8')),'hex')
    OR (expected_kind='POLICY' AND NEW.media_manifest_hash IS NOT NULL)
    OR (expected_kind<>'POLICY' AND NEW.media_manifest_hash IS DISTINCT FROM encode(sha256(convert_to('fan-support.publication-manifest.v1/media'||chr(10)||public.canonical_publication_json(jsonb_build_object('mediaRevisions',value->'mediaRevisions','media',value->'media')),'UTF8')),'hex')) THEN
    RAISE EXCEPTION 'manifest requires exact canonical target bytes and section hashes' USING ERRCODE='23514';
  END IF;
  PERFORM public.assert_publication_manifest_revision(value->'revision');
  FOR media_revision IN SELECT * FROM jsonb_array_elements(value->'mediaRevisions') LOOP
    IF media_revision#>>'{target,kind}' IS DISTINCT FROM 'MEDIA_METADATA' THEN RAISE EXCEPTION 'manifest media dependency must be typed' USING ERRCODE='23514'; END IF;
    PERFORM public.assert_publication_manifest_revision(media_revision);
  END LOOP;
  PERFORM public.assert_publication_manifest_approvals(value);
  PERFORM public.assert_publication_manifest_media(value);
  IF NOT EXISTS(SELECT 1 FROM public.content_publication_receipts WHERE manifest_id=NEW.id AND created_at=NEW.created_at) THEN
    RAISE EXCEPTION 'manifest requires an exact administrative operation receipt' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER content_publication_manifest_validate AFTER INSERT ON public.content_publication_manifests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_content_publication_manifest();

CREATE FUNCTION public.assert_publication_admin_audit(audit_id uuid,actor uuid,session_id uuid,expected_action text,expected_subject text,subject uuid,event_time timestamptz,causal_bound timestamptz)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE evidence public.audit_logs%ROWTYPE; session public.admin_sessions%ROWTYPE; active_status text; locale_count integer;
BEGIN
  SELECT * INTO evidence FROM public.audit_logs WHERE id=audit_id;
  SELECT * INTO session FROM public.admin_sessions WHERE id=session_id FOR SHARE;
  SELECT status INTO active_status FROM public.admin_identities WHERE id=actor FOR SHARE;
  IF evidence.id IS NULL OR evidence.actor_type<>'ADMIN' OR evidence.actor_id IS DISTINCT FROM actor OR evidence.action<>expected_action
    OR evidence.subject_type<>expected_subject OR evidence.subject_id<>subject OR evidence.outcome<>'SUCCEEDED' OR evidence.created_at<>event_time
    OR evidence.reason_code IS NULL OR evidence.request_id IS NULL OR evidence.correlation_id IS NULL OR evidence.field_category IS DISTINCT FROM 'CONTENT_PUBLICATION' THEN
    RAISE EXCEPTION 'publication action requires its exact audit evidence' USING ERRCODE='23514';
  END IF;
  IF session.id IS NULL OR session.admin_identity_id<>actor OR active_status IS DISTINCT FROM 'ACTIVE' OR NOT session.authenticated_with_mfa
    OR session.revoked_at IS NOT NULL OR session.expires_at<=clock_timestamp() OR session.created_at>clock_timestamp()
    OR event_time<session.created_at OR event_time>=session.expires_at OR event_time>GREATEST(clock_timestamp(),transaction_timestamp(),session.created_at,causal_bound) THEN
    RAISE EXCEPTION 'publication action requires its current active MFA session' USING ERRCODE='23514';
  END IF;
  PERFORM ar.role_id FROM public.admin_identity_roles ar JOIN public.roles r ON r.id=ar.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id
    WHERE ar.admin_identity_id=actor AND p.permission_key='content.publish' AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp()
      AND ar.granted_at<=event_time AND rp.granted_at<=event_time FOR SHARE OF ar,r,rp,p;
  IF NOT FOUND THEN RAISE EXCEPTION 'publication action requires current publish permission' USING ERRCODE='23514'; END IF;
  PERFORM locale FROM public.admin_content_locale_grants WHERE admin_identity_id=actor AND revoked_at IS NULL AND granted_at<=clock_timestamp() AND granted_at<=event_time FOR SHARE;
  GET DIAGNOSTICS locale_count=ROW_COUNT;
  IF locale_count<>7 THEN RAISE EXCEPTION 'publication action requires all seven current locale scopes' USING ERRCODE='23514'; END IF;
END; $$;

CREATE FUNCTION public.assert_content_publication_receipt() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE proof public.content_publication_manifests%ROWTYPE; publication public.content_publications%ROWTYPE; job public.content_purge_jobs%ROWTYPE; prior_job public.content_purge_jobs%ROWTYPE;
  kind text; parent jsonb; expected_action text; expected_subject text; subject uuid; causal_bound timestamptz; revision jsonb; audit jsonb; chain_count bigint;
BEGIN
  IF NEW.action='RETRY_PURGE' THEN
    SELECT * INTO job FROM public.content_purge_jobs WHERE id=NEW.purge_job_id FOR UPDATE;
    SELECT * INTO prior_job FROM public.content_purge_jobs WHERE id=job.retry_of FOR UPDATE;
    IF job.id IS NULL OR prior_job.id IS NULL OR prior_job.status<>'FAILED' OR prior_job.version<>NEW.expected_version OR job.publication_id<>NEW.publication_id
      OR job.generation<>NEW.result_generation OR job.created_at<>NEW.created_at THEN RAISE EXCEPTION 'purge retry requires its exact failed predecessor and generation' USING ERRCODE='23514'; END IF;
    expected_action:='CONTENT_PURGE_RETRY'; expected_subject:='CONTENT_PURGE_JOB'; subject:=job.id; causal_bound:=prior_job.updated_at;
  ELSE
    SELECT * INTO proof FROM public.content_publication_manifests WHERE id=NEW.manifest_id;
    IF proof.id IS NULL OR proof.created_at<>NEW.created_at OR proof.publication_id IS DISTINCT FROM NEW.publication_id THEN RAISE EXCEPTION 'publication receipt requires its exact typed manifest' USING ERRCODE='23514'; END IF;
    kind:=proof.manifest#>>'{target,owner,kind}';
    EXECUTE format('SELECT to_jsonb(r.*) FROM public.%I r WHERE id=$1',lower(kind)||'_revisions') INTO parent USING coalesce(proof.idol_revision_id,proof.gift_revision_id,proof.homepage_revision_id,proof.policy_revision_id,proof.media_metadata_revision_id);
    causal_bound:=(proof.manifest#>>'{revision,createdAt}')::timestamptz;
    FOR revision IN SELECT proof.manifest->'revision' UNION ALL SELECT * FROM jsonb_array_elements(proof.manifest->'mediaRevisions') LOOP
      causal_bound:=GREATEST(causal_bound,(revision->>'createdAt')::timestamptz);
      FOR audit IN SELECT * FROM jsonb_array_elements(revision->'translationAudits') LOOP
        causal_bound:=GREATEST(causal_bound,(audit->>'editedAt')::timestamptz,(audit#>>'{review,reviewedAt}')::timestamptz);
      END LOOP;
    END LOOP;
    FOR audit IN SELECT * FROM jsonb_array_elements(proof.manifest->'extensionApprovals') LOOP causal_bound:=GREATEST(causal_bound,(audit->>'editedAt')::timestamptz,(audit->>'reviewedAt')::timestamptz); END LOOP;
    IF NEW.created_at<causal_bound THEN RAISE EXCEPTION 'publication event cannot precede its immutable evidence' USING ERRCODE='23514'; END IF;
    IF NEW.action='VALIDATE' THEN
      IF kind='HOMEPAGE' THEN SELECT coalesce(max(version),0) INTO chain_count FROM public.homepage_publication_heads;
      ELSIF kind='POLICY' THEN SELECT coalesce(max(version),0) INTO chain_count FROM public.policy_publication_heads WHERE policy_key=parent->>'policy_key';
      ELSE EXECUTE format('SELECT coalesce(max(version),0) FROM public.%I WHERE %I=$1',lower(kind)||'_publication_heads',CASE kind WHEN 'MEDIA_METADATA' THEN 'media_asset_id' ELSE lower(kind)||'_id' END) INTO chain_count USING (parent->>CASE kind WHEN 'MEDIA_METADATA' THEN 'media_asset_id' ELSE lower(kind)||'_id' END)::uuid;
      END IF;
      IF chain_count<>NEW.expected_version THEN RAISE EXCEPTION 'validation receipt must bind the actual publication head version' USING ERRCODE='23514'; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.content_authoring_receipts a WHERE coalesce(a.idol_revision_id,a.gift_revision_id,a.homepage_revision_id,a.policy_revision_id,a.media_metadata_revision_id)=(parent->>'id')::uuid) THEN RAISE EXCEPTION 'legacy drafts require authoring copy before runtime validation' USING ERRCODE='23514'; END IF;
      IF parent->>'lifecycle'<>'VALIDATED' OR (parent->>'validated_at')::timestamptz IS DISTINCT FROM NEW.created_at OR NEW.result_head_version<>NEW.expected_version THEN
        RAISE EXCEPTION 'validation receipt requires its exact validated transition' USING ERRCODE='23514';
      END IF;
      expected_action:='CONTENT_VALIDATE'; expected_subject:='CONTENT_VALIDATION'; subject:=NEW.id;
    ELSE
      SELECT * INTO publication FROM public.content_publications WHERE id=NEW.publication_id;
      IF publication.id IS NULL OR publication.action<>NEW.action OR publication.published_at<>NEW.created_at OR publication.published_by<>NEW.actor_id
        OR publication.audit_log_id<>NEW.audit_log_id OR NEW.result_head_version<>NEW.expected_version+1 THEN
        RAISE EXCEPTION 'publication receipt requires its exact event and head version' USING ERRCODE='23514';
      END IF;
      WITH RECURSIVE chain AS (SELECT id,replaces_publication_id FROM public.content_publications WHERE id=NEW.publication_id UNION ALL SELECT p.id,p.replaces_publication_id FROM public.content_publications p JOIN chain c ON p.id=c.replaces_publication_id)
        SELECT count(*) INTO chain_count FROM chain;
      IF chain_count<>NEW.result_head_version THEN RAISE EXCEPTION 'publication receipt head version must match actual chain length' USING ERRCODE='23514'; END IF;
      -- The typed head transition and the immutable predecessor chain independently bind optimistic concurrency.
      IF NEW.action='PUBLISH' AND (parent->>'lifecycle'<>'PUBLISHED' OR (parent->>'published_at')::timestamptz IS DISTINCT FROM NEW.created_at)
        OR NEW.action='ROLLBACK' AND parent->>'lifecycle'<>'SUPERSEDED' THEN RAISE EXCEPTION 'publication lifecycle must match its immutable action' USING ERRCODE='23514'; END IF;
      causal_bound:=GREATEST(causal_bound,(SELECT published_at+interval '1 microsecond' FROM public.content_publications WHERE id=publication.replaces_publication_id));
      causal_bound:=GREATEST(causal_bound,(parent->>'validated_at')::timestamptz);
      expected_action:=CASE NEW.action WHEN 'PUBLISH' THEN 'CONTENT_PUBLISH' ELSE 'CONTENT_ROLLBACK' END; expected_subject:='CONTENT_PUBLICATION'; subject:=NEW.publication_id;
    END IF;
  END IF;
  PERFORM public.assert_publication_admin_audit(NEW.audit_log_id,NEW.actor_id,NEW.session_id,expected_action,expected_subject,subject,NEW.created_at,causal_bound);
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER content_publication_receipt_validate AFTER INSERT ON public.content_publication_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_content_publication_receipt();

CREATE FUNCTION public.guard_publication_runtime_lifecycle() RETURNS trigger
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
DO $$ DECLARE name text; BEGIN FOREACH name IN ARRAY ARRAY['idol_revisions','gift_revisions','homepage_revisions','policy_revisions','media_metadata_revisions'] LOOP
  EXECUTE format('CREATE TRIGGER a_publication_runtime_lifecycle BEFORE UPDATE OF lifecycle ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_publication_runtime_lifecycle()',name);
END LOOP; END $$;

CREATE OR REPLACE FUNCTION public.block_content_extension_publication() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE idol_revision uuid; gift_revision uuid;
BEGIN
  IF TG_TABLE_NAME='idol_revisions' THEN IF NEW.lifecycle='DRAFT' THEN RETURN NEW; END IF; idol_revision:=NEW.id;
  ELSIF TG_TABLE_NAME='gift_revisions' THEN IF NEW.lifecycle='DRAFT' THEN RETURN NEW; END IF; gift_revision:=NEW.id;
  ELSE idol_revision:=NEW.idol_revision_id; gift_revision:=NEW.gift_revision_id; END IF;
  IF (EXISTS(SELECT 1 FROM public.idol_revision_alias_sets WHERE idol_revision_id=idol_revision) OR EXISTS(SELECT 1 FROM public.gift_detail_documents WHERE gift_revision_id=gift_revision))
    AND NOT EXISTS(SELECT 1 FROM public.content_publication_manifests WHERE idol_revision_id=idol_revision OR gift_revision_id=gift_revision) THEN
    RAISE EXCEPTION 'content extension publication requires complete immutable proof' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION public.publication_utc(value timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$ SELECT to_char(value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;
CREATE FUNCTION public.publication_approved_review(value jsonb,is_translation boolean) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('status',value->'status','reviewerId',value->'reviewer_id','reviewedAt',public.publication_utc((value->>'reviewed_at')::timestamptz),'reviewedContentHash',value->'reviewed_content_hash')
 || CASE WHEN is_translation THEN jsonb_build_object('reviewedSourceHash',value->'reviewed_source_hash') ELSE '{}'::jsonb END
$$;

CREATE FUNCTION public.assert_publication_manifest_extensions(value jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE kind text:=value#>>'{target,kind}'; revision uuid:=(value->>'revisionId')::uuid;
 a public.idol_revision_alias_sets%ROWTYPE; d public.gift_detail_documents%ROWTYPE; t public.gift_detail_translations%ROWTYPE;
 r jsonb; expected jsonb; actual jsonb; blocks jsonb; translated_blocks jsonb; translations jsonb:='[]'; text_translations jsonb:='[]'; english_hash text;
BEGIN
 IF kind='IDOL' THEN SELECT * INTO a FROM public.idol_revision_alias_sets WHERE idol_revision_id=revision FOR SHARE; END IF;
 IF a.id IS NULL THEN
   IF value#>'{extensions,aliases}' IS NOT NULL OR value#>'{content,aliases}' IS NOT NULL THEN RAISE EXCEPTION 'manifest cannot invent alias content' USING ERRCODE='23514'; END IF;
 ELSE
   SELECT to_jsonb(review.*) INTO r FROM public.idol_revision_alias_reviews review WHERE alias_set_id=a.id ORDER BY sequence DESC LIMIT 1;
   IF r->>'status' IS DISTINCT FROM 'APPROVED' OR r->>'sequence' IS DISTINCT FROM '3' OR r->>'reviewed_content_hash' IS DISTINCT FROM a.content_hash
     OR (r->>'reviewer_id')::uuid=a.editor_id THEN RAISE EXCEPTION 'manifest aliases require independent terminal approval' USING ERRCODE='23514'; END IF;
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',alias_id,'locale',locale,'text',text) ORDER BY position),'[]') INTO actual FROM public.idol_revision_aliases WHERE alias_set_id=a.id;
   expected:=jsonb_build_object('schemaVersion',1,'id',a.id,'idolRevisionId',revision,'aliases',actual,'contentHash',a.content_hash,'editorId',a.editor_id,'editedAt',public.publication_utc(a.edited_at),'review',public.publication_approved_review(r,false));
   IF (value#>'{extensions,aliases}')-'aliases' IS DISTINCT FROM expected-'aliases' OR NOT public.publication_same_set(value#>'{extensions,aliases,aliases}',actual)
      OR NOT public.publication_same_set(value#>'{content,aliases}',actual) THEN RAISE EXCEPTION 'manifest must retain the complete actual alias set' USING ERRCODE='23514'; END IF;
 END IF;
 IF kind='GIFT' THEN SELECT * INTO d FROM public.gift_detail_documents WHERE gift_revision_id=revision FOR SHARE; END IF;
 IF d.id IS NULL THEN
   IF value#>'{extensions,details}' IS NOT NULL OR value#>'{content,details}' IS NOT NULL THEN RAISE EXCEPTION 'manifest cannot invent detail content' USING ERRCODE='23514'; END IF;
   RETURN;
 END IF;
 SELECT source_hash INTO english_hash FROM public.gift_detail_translations WHERE document_id=d.id AND locale='en';
 IF (SELECT count(*) FROM public.gift_detail_translations WHERE document_id=d.id)<>7 THEN RAISE EXCEPTION 'published detail requires all seven languages' USING ERRCODE='23514'; END IF;
 SELECT jsonb_agg(jsonb_build_object('id',b.block_id,'kind',b.kind)||CASE b.kind
   WHEN 'HEADING' THEN jsonb_build_object('level',b.heading_level)
   WHEN 'LIST' THEN jsonb_build_object('style',b.list_style,'itemIds',(SELECT jsonb_agg(item_id ORDER BY position) FROM public.gift_detail_block_items WHERE document_id=d.id AND block_id=b.block_id))
   WHEN 'SPECIFICATIONS' THEN jsonb_build_object('itemIds',(SELECT jsonb_agg(item_id ORDER BY position) FROM public.gift_detail_block_items WHERE document_id=d.id AND block_id=b.block_id))
   WHEN 'MEDIA' THEN public.publication_pick_fields(to_jsonb(b.*),ARRAY['mediaAssetId','mediaMetadataRevisionId','captionEnabled']) ELSE '{}'::jsonb END ORDER BY b.position)
 INTO blocks FROM public.gift_detail_blocks b WHERE document_id=d.id;
 FOR t IN SELECT * FROM public.gift_detail_translations WHERE document_id=d.id ORDER BY locale FOR SHARE LOOP
   SELECT to_jsonb(review.*) INTO r FROM public.gift_detail_translation_reviews review WHERE gift_detail_translation_id=t.id ORDER BY sequence DESC LIMIT 1;
   IF r->>'status' IS DISTINCT FROM 'APPROVED' OR r->>'sequence' IS DISTINCT FROM '3' OR r->>'reviewed_content_hash' IS DISTINCT FROM t.source_hash
      OR r->>'reviewed_source_hash' IS DISTINCT FROM english_hash OR t.translated_from_source_hash IS DISTINCT FROM english_hash
      OR (r->>'reviewer_id')::uuid IN (t.editor_id,d.editor_id) THEN RAISE EXCEPTION 'manifest details require current independent terminal approval' USING ERRCODE='23514'; END IF;
   SELECT jsonb_agg(jsonb_build_object('blockId',b.block_id,'kind',b.kind)||CASE b.kind
     WHEN 'HEADING' THEN jsonb_build_object('text',b.text) WHEN 'PARAGRAPH' THEN jsonb_build_object('text',b.text)
     WHEN 'LIST' THEN jsonb_build_object('items',(SELECT jsonb_agg(public.publication_pick_fields(to_jsonb(i.*),ARRAY['itemId','text']) ORDER BY i.item_id) FROM public.gift_detail_translation_items i WHERE translation_id=t.id AND block_id=b.block_id))
     WHEN 'SPECIFICATIONS' THEN jsonb_build_object('items',(SELECT jsonb_agg(public.publication_pick_fields(to_jsonb(i.*),ARRAY['itemId','label','value']) ORDER BY i.item_id) FROM public.gift_detail_translation_items i WHERE translation_id=t.id AND block_id=b.block_id))
     ELSE public.publication_pick_fields(to_jsonb(b.*),ARRAY['mediaMetadataRevisionId','caption']) END ORDER BY b.block_id)
   INTO translated_blocks FROM public.gift_detail_translation_blocks b WHERE translation_id=t.id;
   expected:=public.publication_pick_fields(to_jsonb(t.*),ARRAY['schemaVersion','id','documentId','giftRevisionId','locale','sourceHash','translatedFromSourceHash','origin','importBatchId','editorId'])
     ||jsonb_build_object('editedAt',public.publication_utc(t.edited_at),'review',public.publication_approved_review(r,true),'blocks',translated_blocks);
   translations:=translations||jsonb_build_array(expected);
   text_translations:=text_translations||jsonb_build_array(public.publication_pick_fields(to_jsonb(t.*),ARRAY['locale','origin','importBatchId'])||jsonb_build_object('blocks',translated_blocks));
 END LOOP;
 expected:=jsonb_build_object('schemaVersion',1,'outcome','SUCCESS','document',jsonb_build_object('schemaVersion',1,'id',d.id,'giftRevisionId',revision,'blocks',blocks));
 IF (value#>'{extensions,details}')-'translations' IS DISTINCT FROM expected OR NOT public.publication_same_set(value#>'{extensions,details,translations}',translations)
   OR value#>'{content,details,blocks}' IS DISTINCT FROM blocks OR NOT public.publication_same_set(value#>'{content,details,translations}',text_translations) THEN
   RAISE EXCEPTION 'manifest must retain all actual detail structure and raw translations' USING ERRCODE='23514';
 END IF;
END; $$;

CREATE FUNCTION public.publication_approval(kind text,revision_id uuid,audit jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE parent_key text; paths text[];
BEGIN
 parent_key:=CASE kind WHEN 'IDOL' THEN 'idolRevisionId' WHEN 'GIFT' THEN 'giftRevisionId' WHEN 'HOMEPAGE' THEN 'homepageRevisionId' WHEN 'POLICY' THEN 'policyRevisionId' ELSE 'mediaMetadataRevisionId' END;
 paths:=CASE kind WHEN 'IDOL' THEN ARRAY['displayName','shortBio','fullBio','seoTitle','seoDescription']
  WHEN 'GIFT' THEN ARRAY['title','subtitle','shortDescription','description','fulfillmentDescription','variantLabels','safetyNotice','seoTitle','seoDescription']
  WHEN 'HOMEPAGE' THEN ARRAY['heroTitle','heroSubtitle','ctaLabel','announcement','slotLabels','seoTitle','seoDescription']
  WHEN 'POLICY' THEN ARRAY['title','summary','body'] ELSE ARRAY['alt','title','caption'] END;
 RETURN jsonb_strip_nulls(jsonb_build_object('schemaVersion',1,'objectKind',kind,'approvalId',audit->'reviewId','translationRevisionId',audit->'id',parent_key,revision_id,'locale',audit->'locale',
   'approvedSourceHash',audit#>'{review,reviewedSourceHash}','approvedContentHash',audit#>'{review,reviewedContentHash}','origin',audit->'origin','importBatchId',audit->'importBatchId',
   'editorId',audit->'editorId','reviewerId',audit#>'{review,reviewerId}','reviewedAt',audit#>'{review,reviewedAt}','reviewedFieldPaths',to_jsonb(paths)));
END; $$;

CREATE FUNCTION public.assert_publication_manifest_approvals(value jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE revision jsonb; audit jsonb; source_audit jsonb; source_translation jsonb; source_review jsonb; edge jsonb; prior_edge jsonb; text_row jsonb; expected jsonb;
 approvals jsonb:='[]'; copies jsonb:='[]'; extension_approvals jsonb:='[]'; kind text; prefix text; parent_column text; translation_column text; source_revision uuid; prior_revision uuid; receipt_id uuid;
 alias public.idol_revision_alias_sets%ROWTYPE; detail public.gift_detail_documents%ROWTYPE; tr public.gift_detail_translations%ROWTYPE; review_row jsonb;
BEGIN
 FOR revision IN SELECT value->'revision' UNION ALL SELECT * FROM jsonb_array_elements(value->'mediaRevisions') LOOP
  kind:=revision#>>'{target,kind}'; prefix:=lower(kind); parent_column:=prefix||'_revision_id'; translation_column:=prefix||'_translation_id';
  FOR audit IN SELECT * FROM jsonb_array_elements(revision->'translationAudits') LOOP
   approvals:=approvals||jsonb_build_array(public.publication_approval(kind,(revision->>'revisionId')::uuid,audit));
   IF audit ? 'inheritedFrom' THEN
    EXECUTE format('SELECT to_jsonb(e.*),to_jsonb(s.*),to_jsonb(r.*),to_jsonb(old.*),receipt.id FROM public.%I e JOIN public.%I s ON s.id=e.source_translation_id JOIN public.%I r ON r.id=e.source_approval_review_id LEFT JOIN public.%I old ON old.target_translation_id=s.id JOIN public.content_authoring_receipts receipt ON receipt.%I=$2 AND receipt.audit_log_id=e.audit_log_id WHERE e.target_translation_id=$1',prefix||'_translation_copy_evidence',prefix||'_revision_translations',prefix||'_translation_reviews',prefix||'_translation_copy_evidence',parent_column)
      INTO edge,source_translation,source_review,prior_edge,receipt_id USING (audit->>'id')::uuid,(revision->>'revisionId')::uuid;
    IF edge IS NULL OR source_review->>'status' IS DISTINCT FROM 'APPROVED' THEN RAISE EXCEPTION 'manifest copy requires its exact immutable source approval and receipt' USING ERRCODE='23514'; END IF;
    source_revision:=(source_translation->>parent_column)::uuid;
    source_audit:=public.publication_pick_fields(source_translation,ARRAY['id','locale','sourceHash','translatedFromSourceHash','origin','importBatchId','editorId'])
      ||jsonb_build_object('reviewId',source_review->'id','reviewSequence',source_review->'sequence','editedAt',public.publication_utc((source_translation->>'edited_at')::timestamptz),'review',public.publication_approved_review(source_review,true));
    IF prior_edge IS NOT NULL THEN
      EXECUTE format('SELECT %I FROM public.%I WHERE id=$1',parent_column,prefix||'_revision_translations') INTO prior_revision USING (prior_edge->>'source_translation_id')::uuid;
      source_audit:=source_audit||jsonb_build_object('inheritedFrom',jsonb_build_object('revisionId',prior_revision,'translationId',prior_edge->'source_translation_id','reviewId',prior_edge->'source_approval_review_id'));
    END IF;
    -- 0015's immutable typed edge binds original raw fields, editor, origin and hashes to these target fields.
    SELECT item INTO text_row FROM jsonb_array_elements(revision#>'{content,translations}') item WHERE item->>'locale'=audit->>'locale';
    expected:=jsonb_build_object('target',jsonb_build_object('owner',revision->'target','revisionId',revision->'revisionId','locale',audit->'locale'),
      'targetTranslationId',audit->'id','targetReviewId',audit->'reviewId','authoringReceiptId',receipt_id,
      'source',jsonb_build_object('target',jsonb_build_object('owner',revision->'target','revisionId',source_revision,'locale',source_translation->'locale'),'text',jsonb_build_object('kind',kind,'fields',text_row->'fields'),'audit',source_audit),
      'sourceApproval',public.publication_approval(kind,source_revision,source_audit));
    copies:=copies||jsonb_build_array(expected);
   END IF;
  END LOOP;
 END LOOP;
 revision:=value->'revision';
 IF revision#>>'{target,kind}'='IDOL' THEN
  SELECT * INTO alias FROM public.idol_revision_alias_sets WHERE idol_revision_id=(revision->>'revisionId')::uuid;
  IF alias.id IS NOT NULL THEN
   SELECT to_jsonb(r.*) INTO review_row FROM public.idol_revision_alias_reviews r WHERE alias_set_id=alias.id ORDER BY sequence DESC LIMIT 1;
   extension_approvals:=jsonb_build_array(jsonb_build_object('kind','IDOL_ALIASES','revisionId',revision->'revisionId','subjectId',alias.id,'reviewId',review_row->'id','sequence',review_row->'sequence',
     'auditLogId',review_row->'audit_log_id','editorId',alias.editor_id,'structureEditorId',alias.editor_id,'reviewerId',review_row->'reviewer_id','editedAt',public.publication_utc(alias.edited_at),
     'reviewedAt',public.publication_utc((review_row->>'reviewed_at')::timestamptz),'contentHash',review_row->'reviewed_content_hash','sourceHash',NULL));
  END IF;
 ELSIF revision#>>'{target,kind}'='GIFT' THEN
  SELECT * INTO detail FROM public.gift_detail_documents WHERE gift_revision_id=(revision->>'revisionId')::uuid;
  FOR tr IN SELECT * FROM public.gift_detail_translations WHERE document_id=detail.id LOOP
   SELECT to_jsonb(r.*) INTO review_row FROM public.gift_detail_translation_reviews r WHERE gift_detail_translation_id=tr.id ORDER BY sequence DESC LIMIT 1;
   extension_approvals:=extension_approvals||jsonb_build_array(jsonb_build_object('kind','GIFT_DETAILS','revisionId',revision->'revisionId','subjectId',tr.id,'locale',tr.locale,'reviewId',review_row->'id','sequence',review_row->'sequence',
     'auditLogId',review_row->'audit_log_id','editorId',tr.editor_id,'structureEditorId',detail.editor_id,'reviewerId',review_row->'reviewer_id','editedAt',public.publication_utc(tr.edited_at),
     'reviewedAt',public.publication_utc((review_row->>'reviewed_at')::timestamptz),'contentHash',review_row->'reviewed_content_hash','sourceHash',review_row->'reviewed_source_hash'));
  END LOOP;
 END IF;
 IF NOT public.publication_same_set(value->'approvals',approvals) OR NOT public.publication_same_set(value->'copies',copies) OR NOT public.publication_same_set(value->'extensionApprovals',extension_approvals) THEN
  RAISE EXCEPTION 'manifest approval sections must contain exactly the real current reviews and typed copy edges' USING ERRCODE='23514';
 END IF;
END; $$;

CREATE FUNCTION public.publication_media_references(value jsonb) RETURNS TABLE(asset_id uuid,metadata_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE kind text:=value#>>'{target,kind}'; target_revision uuid:=(value->>'revisionId')::uuid;
BEGIN
 IF kind='IDOL' THEN RETURN QUERY SELECT media_asset_id,media_metadata_revision_id FROM public.idol_revision_media WHERE idol_revision_id=target_revision;
 ELSIF kind='GIFT' THEN
  RETURN QUERY SELECT media_asset_id,media_metadata_revision_id FROM public.gift_revision_media WHERE gift_revision_id=target_revision UNION SELECT b.media_asset_id,b.media_metadata_revision_id FROM public.gift_detail_documents d JOIN public.gift_detail_blocks b ON b.document_id=d.id WHERE d.gift_revision_id=target_revision AND b.kind='MEDIA';
 ELSIF kind='HOMEPAGE' THEN
  RETURN QUERY SELECT desktop_media_asset_id,desktop_media_metadata_revision_id FROM public.homepage_slots h WHERE homepage_revision_id=target_revision AND h.kind='HERO_IDOL' UNION SELECT mobile_media_asset_id,mobile_media_metadata_revision_id FROM public.homepage_slots h WHERE homepage_revision_id=target_revision AND h.kind='HERO_IDOL';
 ELSIF kind='MEDIA_METADATA' THEN RETURN QUERY SELECT media_asset_id,id FROM public.media_metadata_revisions WHERE id=target_revision;
 END IF;
END; $$;
CREATE FUNCTION public.publication_asset(value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.publication_pick_fields(value,ARRAY['schemaVersion','id','checksumSha256','mimeType','width','height','byteSize','objectKey'])||jsonb_build_object('createdAt',public.publication_utc((value->>'created_at')::timestamptz))
$$;
CREATE FUNCTION public.assert_publication_manifest_media(value jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE assets uuid[]; metadata uuid[]; declared uuid[]; row_value jsonb; asset public.media_assets%ROWTYPE; variant public.media_variants%ROWTYPE; lineage jsonb; proof jsonb; source public.media_assets%ROWTYPE;
 job public.media_processing_jobs%ROWTYPE; output public.media_processing_outputs%ROWTYPE; expected jsonb; expected_command jsonb; existing_ids uuid[]:='{}'; job_ids uuid[]; metadata_row public.media_metadata_revisions%ROWTYPE; hero_pair record;
BEGIN
 IF jsonb_typeof(value#>'{media,assets}') IS DISTINCT FROM 'array' OR jsonb_typeof(value#>'{media,variants}') IS DISTINCT FROM 'array' OR jsonb_typeof(value#>'{media,lineage}') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'manifest media proof must have typed collections' USING ERRCODE='23514'; END IF;
 SELECT coalesce(array_agg(DISTINCT asset_id ORDER BY asset_id),'{}'),coalesce(array_agg(DISTINCT metadata_id ORDER BY metadata_id) FILTER(WHERE metadata_id<>(value#>>'{revision,revisionId}')::uuid),'{}') INTO assets,metadata FROM public.publication_media_references(value->'revision');
 SELECT coalesce(array_agg((item->>'id')::uuid ORDER BY (item->>'id')::uuid),'{}') INTO declared FROM jsonb_array_elements(value#>'{media,assets}') item;
 IF declared IS DISTINCT FROM assets THEN RAISE EXCEPTION 'manifest must contain all and only referenced binary identities' USING ERRCODE='23514'; END IF;
 SELECT coalesce(array_agg((item->>'revisionId')::uuid ORDER BY (item->>'revisionId')::uuid),'{}') INTO declared FROM jsonb_array_elements(value->'mediaRevisions') item;
 IF declared IS DISTINCT FROM metadata THEN RAISE EXCEPTION 'manifest must contain all and only actual metadata dependencies' USING ERRCODE='23514'; END IF;
 SELECT coalesce(array_agg((item->>'assetId')::uuid ORDER BY (item->>'assetId')::uuid),'{}') INTO declared FROM jsonb_array_elements(value#>'{media,lineage}') item;
 IF declared IS DISTINCT FROM assets THEN RAISE EXCEPTION 'manifest lineage must cover each referenced asset exactly once' USING ERRCODE='23514'; END IF;
 FOR metadata_row IN SELECT * FROM public.media_metadata_revisions WHERE id=ANY(metadata) FOR SHARE LOOP
  IF metadata_row.lifecycle NOT IN ('PUBLISHED','SUPERSEDED') OR NOT EXISTS(SELECT 1 FROM public.content_publications WHERE media_metadata_revision_id=metadata_row.id AND media_asset_id=metadata_row.media_asset_id) THEN RAISE EXCEPTION 'referenced metadata requires a real publication ledger event' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR row_value IN SELECT * FROM jsonb_array_elements(value#>'{media,assets}') LOOP
  SELECT * INTO asset FROM public.media_assets WHERE id=(row_value->>'id')::uuid FOR SHARE;
  IF asset.id IS NULL OR asset.processing_status<>'READY' OR asset.rights_status<>'APPROVED' OR row_value IS DISTINCT FROM public.publication_asset(to_jsonb(asset)) THEN RAISE EXCEPTION 'manifest requires exact currently eligible immutable binary identity' USING ERRCODE='23514'; END IF;
  SELECT item INTO lineage FROM jsonb_array_elements(value#>'{media,lineage}') item WHERE (item->>'assetId')::uuid=asset.id;
  IF lineage->>'identityKind' IS DISTINCT FROM asset.identity_kind OR jsonb_typeof(lineage->'processing') IS DISTINCT FROM 'array'
    OR (asset.identity_kind='SOURCE' AND jsonb_array_length(lineage->'processing')<>0)
    OR (asset.identity_kind='PROCESSED_MASTER' AND jsonb_array_length(lineage->'processing')=0) THEN RAISE EXCEPTION 'manifest processing lineage must match actual binary purpose' USING ERRCODE='23514'; END IF;
  -- Every currently recorded original remains relevant even when reusing an older immutable proof subset.
  FOR job IN SELECT * FROM public.media_processing_jobs WHERE output_asset_id=asset.id ORDER BY id FOR SHARE LOOP
    SELECT * INTO source FROM public.media_assets WHERE id=job.source_asset_id FOR SHARE;
    IF job.status<>'SUCCEEDED' OR source.identity_kind<>'SOURCE' OR source.rights_status<>'APPROVED' OR source.processing_status='ARCHIVED' THEN RAISE EXCEPTION 'all current processing originals must remain eligible' USING ERRCODE='23514'; END IF;
  END LOOP;
  job_ids:='{}';
  FOR proof IN SELECT * FROM jsonb_array_elements(lineage->'processing') LOOP
   IF (proof->>'jobId')::uuid=ANY(job_ids) THEN RAISE EXCEPTION 'processing evidence identities cannot repeat' USING ERRCODE='23514'; END IF;
   job_ids:=array_append(job_ids,(proof->>'jobId')::uuid);
   SELECT * INTO job FROM public.media_processing_jobs WHERE id=(proof->>'jobId')::uuid AND output_asset_id=asset.id FOR SHARE;
   SELECT * INTO source FROM public.media_assets WHERE id=job.source_asset_id FOR SHARE;
   SELECT * INTO output FROM public.media_processing_outputs WHERE job_id=job.id AND kind='MASTER';
   expected_command:=jsonb_build_object('schemaVersion',1,'profileVersion',job.profile_version,'source',jsonb_build_object('assetId',source.id,'metadataRevisionId',job.source_metadata_revision_id,'checksumSha256',job.source_checksum_sha256,'objectKey',source.object_key,'mimeType',source.mime_type,'byteSize',source.byte_size,'width',source.width,'height',source.height),'role',job.role,'fit',job.fit,'focalPoint',jsonb_build_object('x',job.focal_x,'y',job.focal_y));
   expected:=jsonb_build_object('jobId',job.id,'command',expected_command,'commandHash',job.command_hash,'sourceAsset',public.publication_asset(to_jsonb(source)),'sourceIdentityKind',source.identity_kind,'outputAssetId',job.output_asset_id,'output',public.publication_pick_fields(to_jsonb(output),ARRAY['mediaAssetId','checksumSha256','objectKey','width','height','byteSize']));
   IF job.id IS NULL OR job.status<>'SUCCEEDED' OR output.job_id IS NULL OR proof IS DISTINCT FROM expected THEN RAISE EXCEPTION 'manifest processing proof requires exact immutable command and output rows' USING ERRCODE='23514'; END IF;
  END LOOP;
 END LOOP;
 FOR row_value IN SELECT * FROM jsonb_array_elements(value#>'{media,variants}') LOOP
  SELECT * INTO variant FROM public.media_variants WHERE id=(row_value->>'id')::uuid FOR SHARE;
  IF variant.id=ANY(existing_ids) THEN RAISE EXCEPTION 'manifest variants cannot repeat' USING ERRCODE='23514'; END IF;
  existing_ids:=array_append(existing_ids,variant.id);
  IF variant.id IS NULL OR NOT variant.media_asset_id=ANY(assets) OR variant.status<>'READY'
    OR row_value IS DISTINCT FROM public.publication_pick_fields(to_jsonb(variant),ARRAY['schemaVersion','id','mediaAssetId','format','width','height','byteSize','checksumSha256','objectKey']) THEN RAISE EXCEPTION 'manifest variants require exact eligible immutable rows' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR hero_pair IN
   SELECT d.media_asset_id AS desktop,m.media_asset_id AS mobile FROM public.idol_revision_media d JOIN public.idol_revision_media m ON m.idol_revision_id=d.idol_revision_id
     WHERE value#>>'{revision,target,kind}'='IDOL' AND d.idol_revision_id=(value#>>'{revision,revisionId}')::uuid AND d.role='HERO_DESKTOP' AND m.role='HERO_MOBILE'
   UNION ALL SELECT h.desktop_media_asset_id,h.mobile_media_asset_id FROM public.homepage_slots h
     WHERE value#>>'{revision,target,kind}'='HOMEPAGE' AND h.homepage_revision_id=(value#>>'{revision,revisionId}')::uuid AND h.kind='HERO_IDOL'
 LOOP PERFORM public.assert_publication_hero_originals(hero_pair.desktop,hero_pair.mobile); END LOOP;
 IF EXISTS(SELECT 1 FROM unnest(assets) id WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value#>'{media,variants}') item WHERE (item->>'mediaAssetId')::uuid=id)) THEN RAISE EXCEPTION 'each published asset requires a recorded ready variant' USING ERRCODE='23514'; END IF;
END; $$;

-- Durable purge jobs bind immutable locale paths, fenced attempts and terminal retry history.
CREATE FUNCTION public.guard_content_purge_job() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE publication public.content_publications%ROWTYPE; event public.outbox_events%ROWTYPE;
  parent public.content_purge_jobs%ROWTYPE; root text; expected_paths text[]; actual_now timestamptz:=clock_timestamp();
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
    IF publication.id IS NULL OR publication.proof_version<>2 OR event.id IS NULL
      OR event.event_type IS DISTINCT FROM 'CONTENT_PUBLICATION_CHANGED'
      OR event.aggregate_type IS DISTINCT FROM 'CONTENT_PUBLICATION'
      OR event.aggregate_id IS DISTINCT FROM NEW.publication_id
      OR event.primary_subject_id IS DISTINCT FROM NEW.publication_id OR event.locale IS DISTINCT FROM NEW.locale
      OR NEW.paths IS DISTINCT FROM expected_paths OR NEW.status<>'PENDING' OR NEW.version<>1 OR NEW.attempt_count<>0 OR NEW.failure_count<>0
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
CREATE TRIGGER content_purge_job_guard BEFORE INSERT OR UPDATE ON public.content_purge_jobs FOR EACH ROW EXECUTE FUNCTION public.guard_content_purge_job();

CREATE FUNCTION public.assert_content_purge_transition_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE attempt public.content_purge_attempts%ROWTYPE; expected_kind text; expected_token uuid;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.generation>1 AND NOT EXISTS(SELECT 1 FROM public.content_publication_receipts r
      JOIN public.content_purge_jobs parent ON parent.id=NEW.retry_of
      WHERE r.action='RETRY_PURGE' AND r.purge_job_id=NEW.id AND r.publication_id=NEW.publication_id
        AND r.expected_version=parent.version AND r.result_generation=NEW.generation AND r.result_version=1 AND r.created_at=NEW.created_at) THEN
      RAISE EXCEPTION 'purge retry requires exact authorized publication receipt' USING ERRCODE='23514';
    END IF;
    RETURN NULL;
  END IF;
  SELECT * INTO attempt FROM public.content_purge_attempts WHERE job_id=NEW.id AND job_version=NEW.version;
  expected_kind:=CASE WHEN NEW.lease_token IS NOT NULL THEN 'CLAIM'
    WHEN NEW.error_code='PURGE_TIMEOUT' THEN 'TIMEOUT' WHEN NEW.error_code IS NOT NULL THEN 'FAILURE'
    WHEN NEW.status='COMPLETED' THEN 'COMPLETED' WHEN OLD.status='PENDING' THEN 'SUBMITTED' ELSE 'PENDING' END;
  expected_token:=CASE WHEN NEW.lease_token IS NOT NULL THEN NEW.lease_token ELSE OLD.lease_token END;
  IF attempt.id IS NULL OR attempt.kind<>expected_kind OR attempt.created_at<>NEW.updated_at
    OR (expected_token IS NOT NULL AND attempt.lease_token<>expected_token)
    OR attempt.error_code IS DISTINCT FROM (CASE WHEN expected_kind='CLAIM' THEN NULL ELSE NEW.error_code END) THEN
    RAISE EXCEPTION 'purge transition requires its exact immutable lease receipt' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER content_purge_transition_receipt AFTER INSERT OR UPDATE ON public.content_purge_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_content_purge_transition_receipt();

CREATE FUNCTION public.assert_content_purge_attempt_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job public.content_purge_jobs%ROWTYPE;
BEGIN
  SELECT * INTO job FROM public.content_purge_jobs WHERE id=NEW.job_id;
  IF job.id IS NULL OR NEW.job_version<>job.version OR NEW.created_at<>job.updated_at
    OR (NEW.kind='CLAIM' AND NEW.lease_token IS DISTINCT FROM job.lease_token)
    OR (NEW.kind<>'CLAIM' AND job.lease_token IS NOT NULL) THEN
    RAISE EXCEPTION 'purge attempt requires its committed job transition' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER content_purge_attempt_binding AFTER INSERT ON public.content_purge_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_content_purge_attempt_binding();

-- Exact operation receipt hashes preserve the existing authoring snapshot format.
-- Matches the existing content-authoring snapshot hash; it does not define a new hash format.
-- Stored snapshot numbers are safe integers or metadata numeric(6,5) focal points.
-- Their magnitude never enters JavaScript's exponential JSON notation range.
CREATE FUNCTION public.publication_legacy_json_number(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT trim_scale((value#>>'{}')::numeric)::text
$$;
CREATE FUNCTION public.publication_legacy_snapshot_json(value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result text;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      SELECT '{'||coalesce(string_agg(to_json(key)::text||':'||public.publication_legacy_snapshot_json(child),',' ORDER BY key COLLATE "C"),'')||'}'
      INTO result FROM jsonb_each(value) AS entry(key,child);
    WHEN 'array' THEN
      SELECT '['||coalesce(string_agg(public.publication_legacy_snapshot_json(child),',' ORDER BY position),'')||']'
      INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS entry(child,position);
    WHEN 'string' THEN result:=to_json(normalize(value#>>'{}',NFC))::text;
    WHEN 'number' THEN result:=public.publication_legacy_json_number(value);
    ELSE result:=value::text;
  END CASE;
  RETURN result;
END; $$;

-- Snapshot reconstruction follows the current PostgreSQL loader's row order and timestamp representation.
CREATE FUNCTION public.publication_snapshot_payload(value jsonb,lifecycle jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp SET TimeZone='UTC' AS $$
DECLARE kind text:=value#>>'{target,kind}'; revision_id uuid:=(value->>'revisionId')::uuid; prefix text; parent_column text; translation_column text;
  parent jsonb; translation jsonb; review jsonb; source jsonb; audit jsonb; fields jsonb; item jsonb; content jsonb:=value->'content'; extensions jsonb:=value->'extensions';
  translations jsonb:='[]'; audits jsonb:='[]'; rows jsonb; detail_translations jsonb:='[]'; text_details jsonb:='[]'; blocks jsonb; block jsonb; items jsonb;
BEGIN
  PERFORM public.assert_publication_manifest_revision(value);
  prefix:=lower(kind); parent_column:=prefix||'_revision_id'; translation_column:=prefix||'_translation_id';
  EXECUTE format('SELECT to_jsonb(p.*) FROM public.%I p WHERE id=$1',prefix||'_revisions') INTO parent USING revision_id;
  FOR translation,review IN EXECUTE format('SELECT to_jsonb(t.*),to_jsonb(r.*) FROM public.%I t JOIN LATERAL(SELECT * FROM public.%I WHERE %I=t.id ORDER BY sequence DESC LIMIT 1) r ON true WHERE t.%I=$1 ORDER BY t.locale',prefix||'_revision_translations',prefix||'_translation_reviews',translation_column,parent_column) USING revision_id LOOP
    SELECT entry INTO source FROM jsonb_array_elements(content->'translations') entry WHERE entry->>'locale'=translation->>'locale';
    fields:=source->'fields';
    IF kind='GIFT' THEN
      SELECT coalesce(jsonb_agg(public.publication_pick_fields(to_jsonb(r.*),ARRAY['giftVariantId','label']) ORDER BY gift_variant_id),'[]') INTO rows FROM public.gift_variant_labels r WHERE gift_translation_id=(translation->>'id')::uuid;
      fields:=jsonb_set(fields,'{variantLabels}',rows);
    ELSIF kind='HOMEPAGE' THEN
      SELECT coalesce(jsonb_agg(public.publication_pick_fields(to_jsonb(r.*),ARRAY['slotKey','label']) ORDER BY slot_key),'[]') INTO rows FROM public.homepage_slot_translations r WHERE homepage_translation_id=(translation->>'id')::uuid;
      fields:=jsonb_set(fields,'{slotLabels}',rows);
    END IF;
    translations:=translations||jsonb_build_array(jsonb_set(source,'{fields}',fields));
    SELECT entry INTO audit FROM jsonb_array_elements(value->'translationAudits') entry WHERE entry->>'locale'=translation->>'locale';
    audit:=jsonb_set(audit,'{editedAt}',translation->'edited_at');
    audit:=jsonb_set(audit,'{review}',jsonb_build_object('status',review->'status')||public.publication_pick_fields(review,ARRAY['submittedAt','reviewerId','reviewedAt','reviewedSourceHash','reviewedContentHash']));
    audits:=audits||jsonb_build_array(audit);
  END LOOP;
  content:=jsonb_set(content,'{translations}',translations);
  IF kind IN ('IDOL','GIFT') THEN
    EXECUTE format('SELECT coalesce(jsonb_agg(public.publication_pick_fields(to_jsonb(r.*),ARRAY[''role'',''mediaAssetId'',''mediaMetadataRevisionId'',''sortOrder'']) ORDER BY role,sort_order),''[]'') FROM public.%I r WHERE %I=$1',prefix||'_revision_media',parent_column) INTO rows USING revision_id;
    content:=jsonb_set(content,'{media}',rows);
  END IF;
  IF kind='IDOL' AND extensions ? 'aliases' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.alias_id,'locale',a.locale,'text',a.text) ORDER BY a.position),'[]') INTO rows
      FROM public.idol_revision_aliases a JOIN public.idol_revision_alias_sets s ON s.id=a.alias_set_id WHERE s.idol_revision_id=revision_id;
    content:=jsonb_set(content,'{aliases}',rows); extensions:=jsonb_set(extensions,'{aliases,aliases}',rows);
  ELSIF kind='GIFT' THEN
    SELECT coalesce(jsonb_agg(public.publication_pick_fields(to_jsonb(r.*),ARRAY['componentCode','quantity','unit']) ORDER BY component_code),'[]') INTO rows FROM public.gift_revision_contents r WHERE gift_revision_id=revision_id;
    content:=jsonb_set(content,'{structure,contents}',rows);
    IF extensions ? 'details' THEN
      FOR item IN SELECT entry FROM jsonb_array_elements(extensions#>'{details,translations}') entry ORDER BY (entry->>'locale')::public.supported_locale LOOP
        blocks:='[]';
        FOR block IN SELECT entry FROM jsonb_array_elements(item->'blocks') entry ORDER BY entry->>'blockId' LOOP
          IF block->>'kind' IN ('LIST','SPECIFICATIONS') THEN
            SELECT jsonb_agg(entry ORDER BY entry->>'itemId') INTO items FROM jsonb_array_elements(block->'items') entry;
            block:=jsonb_set(block,'{items}',items);
          END IF;
          blocks:=blocks||jsonb_build_array(block);
        END LOOP;
        item:=jsonb_set(item,'{blocks}',blocks);
        detail_translations:=detail_translations||jsonb_build_array(item);
        text_details:=text_details||jsonb_build_array((item-ARRAY['schemaVersion','id','documentId','giftRevisionId','sourceHash','translatedFromSourceHash','editorId','editedAt','review']));
      END LOOP;
      extensions:=jsonb_set(extensions,'{details,translations}',detail_translations);
      content:=jsonb_set(content,'{details,translations}',text_details);
    END IF;
  ELSIF kind='HOMEPAGE' THEN
    SELECT coalesce(jsonb_agg(public.publication_pick_fields(to_jsonb(r.*),ARRAY['slotKey','kind','idolId','giftId','policyKey','desktopMediaAssetId','desktopMediaMetadataRevisionId','mobileMediaAssetId','mobileMediaMetadataRevisionId','sortOrder']) ORDER BY sort_order),'[]') INTO rows FROM public.homepage_slots r WHERE homepage_revision_id=revision_id;
    content:=jsonb_set(content,'{structure,slots}',rows);
  ELSIF kind='POLICY' THEN
    content:=jsonb_set(content,'{structure,effectiveAt}',parent->'effective_at');
  END IF;
  RETURN jsonb_set(jsonb_set(jsonb_set(jsonb_set(value,'{createdAt}',parent->'created_at'),'{content}',content),'{translationAudits}',audits),'{extensions}',extensions)
    ||jsonb_build_object('lifecycle',lifecycle);
END; $$;
CREATE FUNCTION public.publication_snapshot_hash(value jsonb,lifecycle jsonb) RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp SET TimeZone='UTC' AS $$
BEGIN
  RETURN encode(sha256(convert_to(public.publication_legacy_snapshot_json(jsonb_build_object('purpose','content-authoring-snapshot-v1','snapshot',public.publication_snapshot_payload(value,lifecycle))),'UTF8')),'hex');
END; $$;
CREATE FUNCTION public.assert_publication_receipt_snapshot_hash() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp SET TimeZone='UTC' AS $$
DECLARE proof public.content_publication_manifests%ROWTYPE; parent jsonb; before_state jsonb; after_state jsonb; kind text;
BEGIN
  IF NEW.action='RETRY_PURGE' THEN RETURN NULL; END IF;
  SELECT * INTO proof FROM public.content_publication_manifests WHERE id=NEW.manifest_id;
  kind:=proof.manifest#>>'{target,owner,kind}';
  IF proof.id IS NULL OR kind IS NULL THEN RAISE EXCEPTION 'snapshot hash requires its real manifest revision' USING ERRCODE='23514'; END IF;
  EXECUTE format('SELECT to_jsonb(r.*) FROM public.%I r WHERE id=$1',lower(kind)||'_revisions') INTO parent USING (proof.manifest#>>'{target,revisionId}')::uuid;
  after_state:=jsonb_build_object('status',parent->'lifecycle')||public.publication_pick_fields(parent,ARRAY['validatedAt','publishedAt','supersededAt','archivedAt']);
  before_state:=CASE NEW.action WHEN 'VALIDATE' THEN jsonb_build_object('status','DRAFT')
    WHEN 'PUBLISH' THEN jsonb_build_object('status','VALIDATED','validatedAt',parent->'validated_at') ELSE after_state END;
  IF NEW.expected_content_hash IS DISTINCT FROM public.publication_snapshot_hash(proof.manifest->'revision',before_state)
    OR NEW.result_content_hash IS DISTINCT FROM public.publication_snapshot_hash(proof.manifest->'revision',after_state) THEN
    RAISE EXCEPTION 'publication receipt hashes require exact canonical content and lifecycle states' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER publication_receipt_snapshot_hash AFTER INSERT ON public.content_publication_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_publication_receipt_snapshot_hash();

CREATE FUNCTION public.assert_publication_hero_originals(desktop uuid,mobile uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE overlap boolean;
BEGIN
 WITH desktop_sources AS (
   SELECT id,checksum_sha256 FROM public.media_assets WHERE id=desktop AND identity_kind='SOURCE'
   UNION SELECT source.id,source.checksum_sha256 FROM public.media_processing_jobs job JOIN public.media_assets source ON source.id=job.source_asset_id WHERE job.output_asset_id=desktop
 ),mobile_sources AS (
   SELECT id,checksum_sha256 FROM public.media_assets WHERE id=mobile AND identity_kind='SOURCE'
   UNION SELECT source.id,source.checksum_sha256 FROM public.media_processing_jobs job JOIN public.media_assets source ON source.id=job.source_asset_id WHERE job.output_asset_id=mobile
 ) SELECT NOT EXISTS(SELECT 1 FROM desktop_sources) OR NOT EXISTS(SELECT 1 FROM mobile_sources)
   OR EXISTS(SELECT 1 FROM desktop_sources d JOIN mobile_sources m ON d.id=m.id OR d.checksum_sha256=m.checksum_sha256) INTO overlap;
 IF overlap THEN RAISE EXCEPTION 'desktop and mobile heroes require independent original photo identities and bytes' USING ERRCODE='23514'; END IF;
END; $$;

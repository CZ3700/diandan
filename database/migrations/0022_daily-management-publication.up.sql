-- ADR-012: explicit daily original publication. Legacy independent-review proof is unchanged.
SET search_path=public;
CREATE TABLE public.management_operations (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES public.admin_identities(id),
 session_id uuid NOT NULL REFERENCES public.admin_sessions(id), request_id uuid NOT NULL,
 capability text NOT NULL CHECK(capability='DIRECT_OPERATOR_V1'), intent jsonb NOT NULL,
 intent_hash bytea NOT NULL CHECK(octet_length(intent_hash)=32),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 256 AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'), retry_key text CHECK(retry_key IS NULL OR length(retry_key) BETWEEN 16 AND 256 AND retry_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
 status text NOT NULL CHECK(status IN('QUEUED','RUNNING','SUCCEEDED','FAILED')),
 phase text NOT NULL CHECK(phase IN('PREPARE_MEDIA','PUBLISH')),
 version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991), target_id uuid,
 checkpoint jsonb NOT NULL DEFAULT '{"sourceAssetId":null,"jobs":[],"preparedMedia":null,"retryRequested":false}',
 result jsonb, failure_code text, failure_retryable boolean,
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0), next_attempt_at public.finite_timestamptz,
 lease_token_digest bytea CHECK(octet_length(lease_token_digest)=32), lease_expires_at public.finite_timestamptz,
 authorized_until public.finite_timestamptz NOT NULL,
 created_at public.finite_timestamptz NOT NULL, updated_at public.finite_timestamptz NOT NULL,
 UNIQUE(actor_id,idempotency_key),
 CHECK(jsonb_typeof(intent)='object' AND intent->>'kind' IN('SAVE_ARTIST','SAVE_GIFT','REPLACE_POSTER','RESTORE_POSTER') AND intent->>'sourceLocale'=ANY(ARRAY['en','zh-CN','th','vi','ja','es','pt'])),
 CHECK(jsonb_typeof(checkpoint)='object' AND jsonb_typeof(checkpoint->'jobs')='array'),
 CHECK((lease_token_digest IS NULL)=(lease_expires_at IS NULL)),
 CHECK((status='RUNNING')=(lease_token_digest IS NOT NULL)),
 CHECK((status='SUCCEEDED')=(result IS NOT NULL)),
 CHECK((status='FAILED')=(failure_code IS NOT NULL)),
 CHECK((failure_code IS NULL)=(failure_retryable IS NULL)),
 CHECK(updated_at>=created_at AND authorized_until>created_at)
);
CREATE INDEX management_operations_due ON public.management_operations(next_attempt_at,created_at,id) WHERE status='QUEUED';
CREATE INDEX management_operations_actor ON public.management_operations(actor_id,created_at DESC,id);
CREATE TRIGGER management_operations_no_delete BEFORE DELETE ON public.management_operations FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER management_operations_no_truncate BEFORE TRUNCATE ON public.management_operations FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE TABLE public.management_defaults (
 config_version_id uuid PRIMARY KEY REFERENCES public.config_versions(id) ON DELETE RESTRICT,
 market public.market_code NOT NULL REFERENCES public.markets(market), currency public.currency_code NOT NULL,
 inventory_policy text NOT NULL CHECK(inventory_policy IN('TRACKED','PROCURE_ON_DEMAND','PREORDER')),
 inventory_location_id uuid REFERENCES public.inventory_locations(id),
 eligibility_rule text NOT NULL CHECK(eligibility_rule='ALL_ACTIVE_ARTISTS'),
 artist_presentation jsonb NOT NULL CHECK(jsonb_typeof(artist_presentation)='object' AND artist_presentation->>'themeAccent' ~ '^#[A-Fa-f0-9]{6}$' AND artist_presentation->>'heroTextTone' IN('light','dark')),
 CHECK((inventory_policy='TRACKED')=(inventory_location_id IS NOT NULL))
);
CREATE TRIGGER management_defaults_immutable BEFORE UPDATE OR DELETE ON public.management_defaults FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER management_defaults_no_truncate BEFORE TRUNCATE ON public.management_defaults FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE TABLE public.daily_publication_revisions (
 revision_id uuid PRIMARY KEY, object_kind text NOT NULL CHECK(object_kind IN('IDOL','GIFT','HOMEPAGE','MEDIA_METADATA')),
 object_id uuid NOT NULL, source_locale public.supported_locale NOT NULL,
 source_translation_id uuid NOT NULL UNIQUE, document jsonb NOT NULL, document_hash public.sha256_hex NOT NULL,
 operation_id uuid NOT NULL REFERENCES public.management_operations(id), actor_id uuid NOT NULL REFERENCES public.admin_identities(id),
 created_at public.finite_timestamptz NOT NULL,
 idol_revision_id uuid UNIQUE REFERENCES public.idol_revisions(id) DEFERRABLE INITIALLY DEFERRED,
 gift_revision_id uuid UNIQUE REFERENCES public.gift_revisions(id) DEFERRABLE INITIALLY DEFERRED,
 homepage_revision_id uuid UNIQUE REFERENCES public.homepage_revisions(id) DEFERRABLE INITIALLY DEFERRED,
 media_metadata_revision_id uuid UNIQUE REFERENCES public.media_metadata_revisions(id) DEFERRABLE INITIALLY DEFERRED,
 CHECK(num_nonnulls(idol_revision_id,gift_revision_id,homepage_revision_id,media_metadata_revision_id)=1),
 CHECK(revision_id=coalesce(idol_revision_id,gift_revision_id,homepage_revision_id,media_metadata_revision_id)),
 CHECK((object_kind='IDOL')=(idol_revision_id IS NOT NULL) AND (object_kind='GIFT')=(gift_revision_id IS NOT NULL) AND (object_kind='HOMEPAGE')=(homepage_revision_id IS NOT NULL) AND (object_kind='MEDIA_METADATA')=(media_metadata_revision_id IS NOT NULL)),
 processing_job_id uuid REFERENCES public.media_processing_jobs(id),
 copied_from_metadata_revision_id uuid REFERENCES public.media_metadata_revisions(id),
 CHECK(num_nonnulls(processing_job_id,copied_from_metadata_revision_id)<=1),
 UNIQUE NULLS NOT DISTINCT(operation_id,object_kind,object_id,processing_job_id,copied_from_metadata_revision_id)
);
CREATE TABLE public.idol_daily_search_projections (
 revision_id uuid PRIMARY KEY REFERENCES public.daily_publication_revisions(revision_id),
 source_translation_id uuid NOT NULL REFERENCES public.daily_publication_revisions(source_translation_id),
 source_hash public.sha256_hex NOT NULL, document_hash public.sha256_hex NOT NULL,
 algorithm_version integer NOT NULL CHECK(algorithm_version=1),
 normalized_name text NOT NULL CHECK(length(normalized_name)>0)
);
CREATE FUNCTION public.guard_idol_daily_search_projection() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source public.daily_publication_revisions%ROWTYPE;
BEGIN
 SELECT * INTO source FROM public.daily_publication_revisions WHERE revision_id=NEW.revision_id;
 IF source.revision_id IS NULL OR source.object_kind<>'IDOL' OR NEW.source_translation_id<>source.source_translation_id
 OR NEW.source_hash IS DISTINCT FROM source.document#>>'{source,sourceHash}' OR NEW.document_hash<>source.document_hash THEN
  RAISE EXCEPTION 'daily search projection requires its exact real original' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER idol_daily_search_projection_guard BEFORE INSERT OR UPDATE ON public.idol_daily_search_projections FOR EACH ROW EXECUTE FUNCTION public.guard_idol_daily_search_projection();

CREATE TABLE public.daily_publication_manifests (
 publication_id uuid PRIMARY KEY REFERENCES public.content_publications(id) DEFERRABLE INITIALLY DEFERRED,
 revision_id uuid NOT NULL REFERENCES public.daily_publication_revisions(revision_id),
 operation_id uuid NOT NULL REFERENCES public.management_operations(id), actor_id uuid NOT NULL REFERENCES public.admin_identities(id),
 session_id uuid NOT NULL REFERENCES public.admin_sessions(id), audit_log_id uuid NOT NULL UNIQUE REFERENCES public.audit_logs(id),
 head_version bigint NOT NULL CHECK(head_version>0), expected_base_version bigint, result_base_version bigint,
 manifest_text text NOT NULL CHECK(octet_length(manifest_text) BETWEEN 2 AND 8388608),
 manifest jsonb GENERATED ALWAYS AS (manifest_text::jsonb) STORED, manifest_hash public.sha256_hex NOT NULL,
 published_at public.finite_timestamptz NOT NULL,
 CHECK((expected_base_version IS NULL)=(result_base_version IS NULL)),
 CHECK(expected_base_version IS NULL OR result_base_version=expected_base_version+CASE WHEN expected_base_version=0 THEN 2 ELSE 1 END)
);
CREATE TABLE public.gift_variant_recipient_rules (
 gift_variant_id uuid PRIMARY KEY REFERENCES public.gift_variants(id),
 rule text NOT NULL CHECK(rule='ALL_ACTIVE_ARTISTS'),
 operation_id uuid NOT NULL REFERENCES public.management_operations(id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['daily_publication_revisions','daily_publication_manifests','gift_variant_recipient_rules'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_append_only()',t||'_immutable',t);
  EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only()',t||'_no_truncate',t);
 END LOOP;
END; $$;

CREATE FUNCTION public.assert_management_authority(operation_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE o public.management_operations%ROWTYPE; session public.admin_sessions%ROWTYPE;
BEGIN
 SELECT * INTO o FROM public.management_operations WHERE id=operation_id FOR SHARE;
 SELECT * INTO session FROM public.admin_sessions WHERE id=o.session_id FOR SHARE;
 IF o.id IS NULL OR o.capability<>'DIRECT_OPERATOR_V1' OR o.status NOT IN('RUNNING','SUCCEEDED')
 OR o.authorized_until>session.expires_at OR o.authorized_until<=clock_timestamp()
 OR (o.status='RUNNING' AND o.lease_expires_at<=clock_timestamp()) THEN
  RAISE EXCEPTION 'daily publication requires a current bounded operation grant' USING ERRCODE='23514';
 END IF;
 PERFORM public.assert_admin_catalog_authority(o.actor_id,o.session_id,clock_timestamp(),NULL,'management.direct',ARRAY[(o.intent->>'sourceLocale')::public.supported_locale]);
END; $$;
CREATE FUNCTION public.guard_management_operation() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE session public.admin_sessions%ROWTYPE;
BEGIN
 IF NEW.intent_hash<>sha256(convert_to(public.canonical_publication_json(NEW.intent),'UTF8')) THEN RAISE EXCEPTION 'operation intent digest must match canonical payload' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.id<>OLD.id OR NEW.actor_id<>OLD.actor_id OR NEW.intent IS DISTINCT FROM OLD.intent OR NEW.intent_hash<>OLD.intent_hash OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.capability<>OLD.capability OR NEW.created_at<>OLD.created_at
  OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at OR OLD.status='SUCCEEDED' THEN RAISE EXCEPTION 'operation identity, intent and completed history are immutable' USING ERRCODE='23514'; END IF;
  IF NEW.session_id<>OLD.session_id OR NEW.authorized_until<>OLD.authorized_until OR NEW.retry_key IS DISTINCT FROM OLD.retry_key THEN
   IF OLD.status<>'FAILED' OR NOT OLD.failure_retryable OR NEW.status<>'QUEUED' OR NEW.retry_key IS NULL OR NEW.retry_key IS NOT DISTINCT FROM OLD.retry_key THEN RAISE EXCEPTION 'operation reauthorization requires exact failed retry' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.lease_token_digest IS DISTINCT FROM OLD.lease_token_digest AND NEW.lease_token_digest IS NOT NULL THEN
   IF (OLD.status='RUNNING' AND OLD.lease_expires_at>clock_timestamp()) OR OLD.status NOT IN('QUEUED','RUNNING') OR NEW.attempt_count<>OLD.attempt_count+1
   OR NEW.lease_expires_at>clock_timestamp()+interval '900 seconds' OR NEW.lease_expires_at>NEW.authorized_until THEN RAISE EXCEPTION 'operation claim requires a due bounded fresh lease' USING ERRCODE='23514'; END IF;
  ELSIF NEW.attempt_count<>OLD.attempt_count THEN RAISE EXCEPTION 'only claiming increments attempts' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.status<>'QUEUED' OR NEW.version<>1 OR NEW.attempt_count<>0 OR NEW.phase<>'PREPARE_MEDIA' OR NEW.retry_key IS NOT NULL OR NEW.checkpoint<>'{"sourceAssetId":null,"jobs":[],"preparedMedia":null,"retryRequested":false}'::jsonb THEN RAISE EXCEPTION 'operation starts with an exact empty durable checkpoint' USING ERRCODE='23514'; END IF;
 END IF;
 -- Expired work may become an honest retryable authorization failure, never a publication.
 IF NEW.status='FAILED' AND NEW.failure_code='NEEDS_AUTHORIZATION' THEN RETURN NEW; END IF;
 SELECT * INTO session FROM public.admin_sessions WHERE id=NEW.session_id FOR SHARE;
 IF session.id IS NULL OR session.admin_identity_id<>NEW.actor_id OR NEW.authorized_until>session.expires_at OR NEW.authorized_until<=clock_timestamp() THEN RAISE EXCEPTION 'operation expiry must be bounded by its actual session' USING ERRCODE='23514'; END IF;
 PERFORM public.assert_admin_catalog_authority(NEW.actor_id,NEW.session_id,clock_timestamp(),NULL,'management.direct',ARRAY[(NEW.intent->>'sourceLocale')::public.supported_locale]);
 RETURN NEW;
END; $$;
CREATE TRIGGER management_operation_guard BEFORE INSERT OR UPDATE ON public.management_operations FOR EACH ROW EXECUTE FUNCTION public.guard_management_operation();

CREATE FUNCTION public.assert_daily_revision(revision uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE d public.daily_publication_revisions%ROWTYPE; o public.management_operations%ROWTYPE; parent jsonb; owner_value uuid; fields jsonb; expected_hash text;
BEGIN
 SELECT * INTO d FROM public.daily_publication_revisions WHERE revision_id=revision;
 SELECT * INTO o FROM public.management_operations WHERE id=d.operation_id;
 IF d.revision_id IS NULL OR d.actor_id IS DISTINCT FROM o.actor_id OR d.source_locale::text IS DISTINCT FROM d.document#>>'{source,locale}'
 OR d.source_translation_id IS DISTINCT FROM (d.document#>>'{source,id}')::uuid OR d.document->>'schemaVersion'<>'3' OR d.object_kind IS DISTINCT FROM d.document->>'kind'
 OR d.object_id IS DISTINCT FROM (d.document->>'ownerId')::uuid OR d.revision_id IS DISTINCT FROM (d.document->>'revisionId')::uuid
 OR d.actor_id IS DISTINCT FROM (d.document->>'createdBy')::uuid OR d.actor_id IS DISTINCT FROM (d.document#>>'{source,editorId}')::uuid
 OR d.created_at IS DISTINCT FROM (d.document->>'createdAt')::timestamptz OR d.document#>'{source,review}' IS NOT NULL THEN RAISE EXCEPTION 'daily revision must bind one real authored original' USING ERRCODE='23514'; END IF;
 PERFORM public.assert_management_authority(d.operation_id);
 EXECUTE format('SELECT to_jsonb(r.*) FROM public.%I r WHERE id=$1',lower(d.object_kind)||'_revisions') INTO parent USING revision;
 owner_value:=CASE d.object_kind WHEN 'IDOL' THEN (parent->>'idol_id')::uuid WHEN 'GIFT' THEN (parent->>'gift_id')::uuid WHEN 'MEDIA_METADATA' THEN (parent->>'media_asset_id')::uuid ELSE revision END;
 IF parent IS NULL OR owner_value<>d.object_id OR (parent->>'created_by')::uuid<>d.actor_id OR (parent->>'created_at')::timestamptz<>d.created_at
 OR (parent->>'revision')::bigint<>(d.document->>'revisionNumber')::bigint THEN RAISE EXCEPTION 'daily document requires exact typed revision ownership' USING ERRCODE='23514'; END IF;
 fields:=d.document#>'{source,fields}';
 expected_hash:=encode(sha256(convert_to('fan-support.daily-publication.v1/source'||chr(10)||public.canonical_publication_json(jsonb_build_object('kind',d.object_kind,'locale',d.source_locale,'fields',fields)),'UTF8')),'hex');
 IF d.document#>>'{source,sourceHash}' IS DISTINCT FROM expected_hash OR d.document_hash IS DISTINCT FROM encode(sha256(convert_to('fan-support.daily-publication.v1/document'||chr(10)||public.canonical_publication_json(d.document),'UTF8')),'hex') THEN RAISE EXCEPTION 'daily source and document hashes bind actual originals' USING ERRCODE='23514'; END IF;
 IF d.object_kind='IDOL' THEN
  IF o.intent->>'kind'<>'SAVE_ARTIST' OR o.target_id<>d.object_id OR fields->>'displayName' IS DISTINCT FROM o.intent->>'name' OR fields->>'fullBio' IS DISTINCT FROM o.intent->>'description'
   OR length(fields->>'displayName') NOT BETWEEN 1 AND 40 OR length(fields->>'fullBio') NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'daily artist fields must be exact authorized original' USING ERRCODE='23514'; END IF;
 ELSIF d.object_kind='GIFT' THEN
  IF o.intent->>'kind'<>'SAVE_GIFT' OR o.target_id<>d.object_id OR fields->>'title' IS DISTINCT FROM o.intent->>'name' OR fields->>'description' IS DISTINCT FROM o.intent->>'description' OR d.document->>'giftKind' IS DISTINCT FROM o.intent->>'giftKind'
   OR length(fields->>'title') NOT BETWEEN 1 AND 100 OR length(fields->>'description') NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'daily gift fields must be exact authorized original' USING ERRCODE='23514'; END IF;
 ELSIF d.object_kind='HOMEPAGE' THEN
  IF o.intent->>'kind' NOT IN('REPLACE_POSTER','RESTORE_POSTER') THEN RAISE EXCEPTION 'daily homepage requires poster intent' USING ERRCODE='23514'; END IF;
 ELSE
  IF length(fields->>'alt') NOT BETWEEN 1 AND 300 OR NOT EXISTS(SELECT 1 FROM public.media_assets WHERE id=d.object_id) THEN RAISE EXCEPTION 'daily metadata requires actual media and original alt' USING ERRCODE='23514'; END IF;
 END IF;
END; $$;
CREATE FUNCTION public.validate_daily_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN PERFORM public.assert_daily_revision(NEW.revision_id); RETURN NULL; END; $$;
CREATE CONSTRAINT TRIGGER daily_revision_validate AFTER INSERT ON public.daily_publication_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_daily_revision();

CREATE FUNCTION public.assert_daily_publication(publication uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE m public.daily_publication_manifests%ROWTYPE; p public.content_publications%ROWTYPE; d public.daily_publication_revisions%ROWTYPE; o public.management_operations%ROWTYPE; item jsonb; metadata public.daily_publication_revisions%ROWTYPE; head jsonb; identity_row jsonb; assets jsonb; variants jsonb; lineage jsonb;
BEGIN
 SELECT * INTO m FROM public.daily_publication_manifests WHERE publication_id=publication;
 SELECT * INTO p FROM public.content_publications WHERE id=publication;
 SELECT * INTO d FROM public.daily_publication_revisions WHERE revision_id=m.revision_id;
 SELECT * INTO o FROM public.management_operations WHERE id=m.operation_id;
 IF m.publication_id IS NULL OR p.id IS NULL OR p.proof_version<>3 OR p.content_type<>d.object_kind OR coalesce(p.idol_revision_id,p.gift_revision_id,p.homepage_revision_id,p.media_metadata_revision_id)<>m.revision_id
 OR m.actor_id<>o.actor_id OR m.actor_id<>p.published_by OR m.session_id<>o.session_id OR m.audit_log_id<>p.audit_log_id OR m.published_at<>p.published_at
 OR m.manifest#>>'{publicationMode}'<>'DIRECT_OPERATOR_V1' OR m.manifest->>'schemaVersion'<>'3' OR m.manifest->'document' IS DISTINCT FROM d.document
 OR (m.manifest->>'actorId')::uuid<>m.actor_id OR (m.manifest->>'operationId')::uuid<>m.operation_id
 OR m.manifest_text<>public.canonical_publication_json(m.manifest)
 OR m.manifest_hash<>encode(sha256(convert_to('fan-support.daily-publication.v1'||chr(10)||m.manifest_text,'UTF8')),'hex')
 OR p.media_manifest_hash IS DISTINCT FROM m.manifest_hash OR p.translation_manifest_hash<>d.document#>>'{source,sourceHash}' OR p.approval_manifest_hash<>encode(sha256(convert_to('DIRECT_OPERATOR_V1:'||m.operation_id::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'daily publication requires exact immutable authorized manifest' USING ERRCODE='23514'; END IF;
 PERFORM public.assert_management_authority(m.operation_id);
 -- Restored history is not rewritten or attributed to the restoring operator.
 IF p.action='PUBLISH' THEN PERFORM public.assert_daily_revision(m.revision_id); END IF;
 EXECUTE format('SELECT to_jsonb(h.*) FROM public.%I h WHERE publication_id=$1',lower(d.object_kind)||'_publication_heads') INTO head USING p.id;
 IF head IS NULL OR (head->>'version')::bigint<>m.head_version THEN
  -- Multiple real role jobs can deduplicate to one master. Earlier metadata events
  -- may therefore be superseded by another exact event in this same operation.
  IF d.object_kind<>'MEDIA_METADATA' OR NOT EXISTS(
   WITH RECURSIVE exact_chain AS (
    SELECT publication.id,publication.replaces_publication_id,proof.head_version
    FROM public.media_metadata_publication_heads h
    JOIN public.content_publications publication ON publication.id=h.publication_id AND publication.media_asset_id=h.media_asset_id
    JOIN public.daily_publication_manifests proof ON proof.publication_id=publication.id AND proof.head_version=h.version
    WHERE h.media_asset_id=d.object_id AND proof.operation_id=m.operation_id
    UNION ALL
    SELECT previous.id,previous.replaces_publication_id,prior.head_version
    FROM exact_chain successor
    JOIN public.content_publications previous ON previous.id=successor.replaces_publication_id AND previous.content_type='MEDIA_METADATA' AND previous.media_asset_id=d.object_id
    JOIN public.daily_publication_manifests prior ON prior.publication_id=previous.id AND prior.operation_id=m.operation_id AND prior.head_version=successor.head_version-1
   ) SELECT 1 FROM exact_chain WHERE id=p.id AND head_version=m.head_version
  ) THEN RAISE EXCEPTION 'daily publication must be the exact new head or same-operation metadata predecessor' USING ERRCODE='23514'; END IF;
 END IF;
 IF d.object_kind IN('IDOL','GIFT') THEN
  EXECUTE format('SELECT to_jsonb(i.*) FROM public.%I i WHERE id=$1',CASE d.object_kind WHEN 'IDOL' THEN 'idols' ELSE 'gifts' END) INTO identity_row USING d.object_id;
  IF (identity_row->>'version')::bigint<>m.result_base_version OR m.expected_base_version<>(o.intent->>'expectedVersion')::bigint OR (identity_row->>'published_revision_id')::uuid<>m.revision_id OR identity_row->>'status'<>'active' THEN RAISE EXCEPTION 'daily identity and publication must switch atomically' USING ERRCODE='23514'; END IF;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(m.manifest->'media') LOOP
  SELECT * INTO metadata FROM public.daily_publication_revisions WHERE revision_id=(item#>>'{metadata,revisionId}')::uuid AND object_kind='MEDIA_METADATA';
  IF metadata.document IS DISTINCT FROM item->'metadata' OR NOT EXISTS(SELECT 1 FROM public.media_metadata_revisions WHERE id=metadata.revision_id AND lifecycle IN('PUBLISHED','SUPERSEDED')) THEN RAISE EXCEPTION 'daily media requires actual immutable source metadata' USING ERRCODE='23514'; END IF;
  -- Reuse the exact existing binary/rights/worker proof validator one metadata target at a time.
  -- This explicit profile permits shared originals; no policy/review validator is changed.
  PERFORM public.assert_publication_manifest_media(jsonb_build_object('revision',jsonb_build_object('target',jsonb_build_object('kind','MEDIA_METADATA'),'revisionId',metadata.revision_id),'mediaRevisions','[]'::jsonb,'media',jsonb_build_object('assets',jsonb_build_array(item->'asset'),'variants',item->'variants','lineage',jsonb_build_array(item->'lineage'))));
 END LOOP;
 IF (SELECT count(*) FROM public.content_purge_jobs WHERE publication_id=p.id AND generation=1)<>7 THEN RAISE EXCEPTION 'daily publication retains seven real localized purge events' USING ERRCODE='23514'; END IF;
END; $$;
CREATE FUNCTION public.validate_daily_publication() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN PERFORM public.assert_daily_publication(NEW.publication_id); RETURN NULL; END; $$;
CREATE CONSTRAINT TRIGGER daily_publication_validate AFTER INSERT ON public.daily_publication_manifests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_daily_publication();

ALTER TABLE public.content_publications DROP CONSTRAINT content_publications_proof_version_check;
ALTER TABLE public.content_publications ADD CONSTRAINT content_publications_proof_version_check CHECK(proof_version IN(1,2,3));
ALTER TABLE public.gift_revisions DROP CONSTRAINT gift_revisions_profile_version_check;
ALTER TABLE public.gift_revisions ADD CONSTRAINT gift_revisions_profile_version_check CHECK(profile_version IN(1,2,3));

-- Narrow adapters preserve the full legacy function bodies.
CREATE OR REPLACE FUNCTION public.guard_new_content_publication_proof() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  -- Explicit ADR-012 dispatch; all following strict behavior is retained.
  IF NEW.proof_version=3 AND EXISTS(SELECT 1 FROM public.daily_publication_manifests WHERE publication_id=NEW.id) THEN RETURN NEW; END IF;
  IF NEW.proof_version<>2 THEN RAISE EXCEPTION 'new content publications require current proof version' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.assert_current_content_publication_proof() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE proof public.content_publication_manifests%ROWTYPE;
BEGIN
  -- Explicit ADR-012 dispatch; all following strict behavior is retained.
  IF NEW.proof_version=3 THEN PERFORM public.assert_daily_publication(NEW.id); RETURN NULL; END IF;
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
  -- Explicit ADR-012 dispatch; all following strict behavior is retained.
  IF EXISTS(SELECT 1 FROM public.daily_publication_revisions WHERE revision_id=NEW.id) THEN
    IF NEW.lifecycle='PUBLISHED' AND NOT EXISTS(SELECT 1 FROM public.daily_publication_manifests WHERE revision_id=NEW.id AND published_at=NEW.published_at) THEN RAISE EXCEPTION 'daily lifecycle requires its exact publication receipt' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
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
  -- Explicit ADR-012 dispatch; all following strict behavior is retained.
  IF EXISTS(SELECT 1 FROM public.daily_publication_revisions WHERE revision_id=NEW.id) THEN
    IF NEW.lifecycle IN('VALIDATED','PUBLISHED') AND NOT EXISTS(SELECT 1 FROM public.daily_publication_manifests WHERE revision_id=NEW.id AND published_at=CASE NEW.lifecycle WHEN 'PUBLISHED' THEN NEW.published_at ELSE NEW.validated_at END) THEN RAISE EXCEPTION 'daily lifecycle requires its exact publication receipt' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
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
  -- Explicit ADR-012 dispatch; all following strict behavior is retained.
  IF NEW.proof_version=3 THEN
    IF NEW.content_type NOT IN('IDOL','GIFT','HOMEPAGE','MEDIA_METADATA') OR NOT EXISTS(SELECT 1 FROM public.daily_publication_manifests WHERE publication_id=NEW.id AND revision_id=coalesce(NEW.idol_revision_id,NEW.gift_revision_id,NEW.homepage_revision_id,NEW.media_metadata_revision_id) AND actor_id=NEW.published_by AND published_at=NEW.published_at) THEN RAISE EXCEPTION 'daily event requires exact supported receipt' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
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
  -- Explicit ADR-012 dispatch; all following strict behavior is retained.
  IF EXISTS(SELECT 1 FROM public.daily_publication_manifests m JOIN public.daily_publication_revisions d ON d.revision_id=m.revision_id JOIN public.management_operations o ON o.id=m.operation_id WHERE d.object_kind='IDOL' AND d.object_id=NEW.id AND o.target_id=NEW.id AND o.intent->>'kind'='SAVE_ARTIST' AND (TG_OP='INSERT' AND m.expected_base_version=0 OR TG_OP='UPDATE' AND m.result_base_version=NEW.version AND m.expected_base_version=CASE WHEN OLD.version=1 AND (o.intent->>'expectedVersion')::bigint=0 THEN 0 ELSE OLD.version END) ) THEN RETURN NULL; END IF;
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
  -- Explicit ADR-012 dispatch; all following strict behavior is retained.
  IF EXISTS(SELECT 1 FROM public.daily_publication_manifests m JOIN public.daily_publication_revisions d ON d.revision_id=m.revision_id JOIN public.management_operations o ON o.id=m.operation_id WHERE d.object_kind='GIFT' AND d.object_id=NEW.id AND o.target_id=NEW.id AND o.intent->>'kind'='SAVE_GIFT' AND (TG_OP='INSERT' AND m.expected_base_version=0 OR TG_OP='UPDATE' AND m.result_base_version=NEW.version AND m.expected_base_version=CASE WHEN OLD.version=1 AND (o.intent->>'expectedVersion')::bigint=0 THEN 0 ELSE OLD.version END)) THEN RETURN NULL; END IF;
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
  -- Explicit ADR-012 dispatch; all following strict behavior is retained.
  IF TG_OP='INSERT' AND NEW.profile_version=3 AND EXISTS(SELECT 1 FROM public.daily_publication_revisions WHERE gift_revision_id=NEW.id) THEN RETURN NEW; END IF;
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
 IF parent.profile_version=3 THEN PERFORM public.assert_daily_revision(revision_id); RETURN NULL; END IF;
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
 IF pub.proof_version=3 AND parent.profile_version=3 THEN PERFORM public.assert_daily_publication(pub.id); RETURN NULL; END IF;
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
 IF EXISTS(SELECT 1 FROM public.daily_publication_manifests m JOIN public.daily_publication_revisions d ON d.revision_id=m.revision_id JOIN public.management_operations o ON o.id=m.operation_id CROSS JOIN LATERAL jsonb_array_elements(d.document->'variants') v WHERE d.object_kind='GIFT' AND d.object_id=variant.gift_id AND (v->>'id')::uuid=variant.id AND v->>'sku'=variant.sku AND v->>'status'=variant.status AND v->>'inventoryPolicy'=variant.inventory_policy AND variant.updated_at=m.published_at AND o.intent->>'kind'='SAVE_GIFT') THEN RETURN NULL; END IF;
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
    IF publication.id IS NULL OR publication.proof_version NOT IN(2,3) OR event.id IS NULL
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

-- Only the explicit daily gift profile may omit an unprovided delivery promise.
ALTER TABLE public.gift_revisions ALTER COLUMN delivery_minimum DROP NOT NULL;
ALTER TABLE public.gift_revisions ALTER COLUMN delivery_maximum DROP NOT NULL;
ALTER TABLE public.gift_revisions ALTER COLUMN delivery_unit DROP NOT NULL;
ALTER TABLE public.gift_revisions ADD CONSTRAINT gift_revision_delivery_profile CHECK((delivery_minimum IS NULL AND delivery_maximum IS NULL AND delivery_unit IS NULL AND profile_version=3) OR num_nonnulls(delivery_minimum,delivery_maximum,delivery_unit)=3);
CREATE FUNCTION public.assert_management_completion() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE m public.daily_publication_manifests%ROWTYPE; d public.daily_publication_revisions%ROWTYPE;
BEGIN
 IF NEW.status<>'SUCCEEDED' THEN RETURN NULL; END IF;
 SELECT * INTO m FROM public.daily_publication_manifests WHERE operation_id=NEW.id AND publication_id=(NEW.result->>'publicationId')::uuid AND revision_id=(NEW.result->>'revisionId')::uuid;
 SELECT * INTO d FROM public.daily_publication_revisions WHERE revision_id=m.revision_id;
 IF m.publication_id IS NULL OR d.object_kind='MEDIA_METADATA' OR NEW.target_id<>(NEW.result->>'targetId')::uuid OR d.object_id<>NEW.target_id OR (NEW.result->>'version')::bigint<>coalesce(m.result_base_version,m.head_version) THEN RAISE EXCEPTION 'successful management operation requires its exact main publication result' USING ERRCODE='23514'; END IF;
 PERFORM public.assert_daily_publication(m.publication_id);
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER management_completion_validate AFTER INSERT OR UPDATE ON public.management_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_management_completion();

-- Retain exact event/audit identities while allowing genuine single-source invalidation.
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
        -- Seven invalidation routes may truthfully share the same daily original.
        -- This is a source binding, never an invented locale translation/review.
        (publication.proof_version=3
          AND publication.content_type IN('IDOL','GIFT','HOMEPAGE','MEDIA_METADATA')
          AND EXISTS(
            SELECT 1 FROM public.daily_publication_manifests m
            JOIN public.daily_publication_revisions d ON d.revision_id=m.revision_id AND d.operation_id=m.operation_id AND d.actor_id=m.actor_id
            JOIN public.management_operations operation ON operation.id=m.operation_id AND operation.actor_id=m.actor_id AND operation.session_id=m.session_id
            WHERE m.publication_id=publication.id AND m.revision_id=NEW.secondary_subject_id
              AND m.actor_id=publication.published_by AND m.audit_log_id=publication.audit_log_id AND m.published_at=publication.published_at
              AND d.object_kind=publication.content_type
              AND d.object_id=CASE publication.content_type WHEN 'IDOL' THEN publication.idol_id WHEN 'GIFT' THEN publication.gift_id WHEN 'MEDIA_METADATA' THEN publication.media_asset_id ELSE publication.homepage_revision_id END
              AND operation.capability='DIRECT_OPERATOR_V1'
              AND m.manifest->>'publicationMode'='DIRECT_OPERATOR_V1' AND m.manifest->>'schemaVersion'='3'
              AND m.manifest->'document'=d.document
              AND d.document#>>'{source,locale}'=d.source_locale::text
              AND (d.document#>>'{source,id}')::uuid=d.source_translation_id
          ))
        OR (publication.content_type = 'IDOL' AND EXISTS (
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

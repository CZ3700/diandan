LOCK TABLE public.content_publications,public.content_publication_manifests,public.content_publication_receipts,public.content_purge_jobs,public.content_purge_attempts,public.audit_logs IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.content_publications WHERE proof_version=2) OR EXISTS(SELECT 1 FROM public.content_publication_manifests)
    OR EXISTS(SELECT 1 FROM public.content_publication_receipts) OR EXISTS(SELECT 1 FROM public.content_purge_jobs) OR EXISTS(SELECT 1 FROM public.content_purge_attempts)
    OR EXISTS(SELECT 1 FROM public.audit_logs WHERE action IN ('CONTENT_VALIDATE','CONTENT_PURGE_RETRY')) THEN
    RAISE EXCEPTION 'publication runtime history cannot be discarded' USING ERRCODE='55000';
  END IF;
END $$;
DO $$ DECLARE name text; BEGIN FOREACH name IN ARRAY ARRAY['idol_revisions','gift_revisions','homepage_revisions','policy_revisions','media_metadata_revisions'] LOOP
  EXECUTE format('DROP TRIGGER a_publication_runtime_lifecycle ON public.%I',name);
END LOOP; END $$;
DROP TRIGGER content_publication_current_proof ON public.content_publications;
DROP TRIGGER a_content_publication_proof_version ON public.content_publications;
DROP TABLE public.idol_alias_search_projections;
DROP TABLE public.content_purge_attempts;
DROP TABLE public.content_publication_receipts;
DROP TABLE public.content_purge_jobs;
DROP TABLE public.content_publication_manifests;
ALTER TABLE public.content_publications DROP COLUMN proof_version;
DROP FUNCTION public.assert_current_content_publication_proof();
DROP FUNCTION public.guard_new_content_publication_proof();
DROP FUNCTION public.canonical_publication_json(jsonb);

CREATE OR REPLACE FUNCTION public.block_content_extension_publication() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE idol_revision uuid; gift_revision uuid;
BEGIN
  IF TG_TABLE_NAME = 'idol_revisions' THEN
    IF NEW.lifecycle = 'DRAFT' THEN RETURN NEW; END IF; idol_revision := NEW.id;
  ELSIF TG_TABLE_NAME = 'gift_revisions' THEN
    IF NEW.lifecycle = 'DRAFT' THEN RETURN NEW; END IF; gift_revision := NEW.id;
  ELSE idol_revision := NEW.idol_revision_id; gift_revision := NEW.gift_revision_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.idol_revision_alias_sets WHERE idol_revision_id = idol_revision)
    OR EXISTS (SELECT 1 FROM public.gift_detail_documents WHERE gift_revision_id = gift_revision) THEN
    RAISE EXCEPTION 'content extension publication proof is not enabled' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END; $$;


DROP FUNCTION public.assert_publication_manifest_media(jsonb);
DROP FUNCTION public.publication_asset(jsonb);
DROP FUNCTION public.publication_media_references(jsonb);
DROP FUNCTION public.assert_publication_manifest_approvals(jsonb);
DROP FUNCTION public.publication_approval(text,uuid,jsonb);
DROP FUNCTION public.assert_publication_manifest_extensions(jsonb);
DROP FUNCTION public.publication_approved_review(jsonb,boolean);
DROP FUNCTION public.publication_utc(timestamptz);
DROP FUNCTION public.guard_publication_runtime_lifecycle();
DROP FUNCTION public.assert_content_publication_receipt();
DROP FUNCTION public.assert_publication_admin_audit(uuid,uuid,uuid,text,text,uuid,timestamptz,timestamptz);
DROP FUNCTION public.assert_content_publication_manifest();
DROP FUNCTION public.assert_publication_manifest_revision(jsonb);
DROP FUNCTION public.publication_same_set(jsonb,jsonb);
DROP FUNCTION public.publication_pick_fields(jsonb,text[]);

DROP FUNCTION public.assert_content_purge_attempt_binding();
DROP FUNCTION public.assert_content_purge_transition_receipt();
DROP FUNCTION public.guard_content_purge_job();

DROP FUNCTION public.assert_publication_receipt_snapshot_hash();
DROP FUNCTION public.publication_snapshot_hash(jsonb,jsonb);
DROP FUNCTION public.publication_snapshot_payload(jsonb,jsonb);
DROP FUNCTION public.publication_legacy_snapshot_json(jsonb);
DROP FUNCTION public.publication_legacy_json_number(jsonb);

DROP FUNCTION public.assert_publication_hero_originals(uuid,uuid);

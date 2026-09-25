-- Processing history is business evidence, not a disposable projection.
LOCK TABLE public.media_assets, public.media_processing_jobs, public.media_processing_attempts, public.media_processing_outputs IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.media_processing_jobs)
    OR EXISTS (SELECT 1 FROM public.media_processing_attempts)
    OR EXISTS (SELECT 1 FROM public.media_processing_outputs)
    OR EXISTS (SELECT 1 FROM public.media_assets WHERE identity_kind = 'PROCESSED_MASTER') THEN
    RAISE EXCEPTION 'media processing history prevents rollback' USING ERRCODE = '55000';
  END IF;
END; $$;
DROP TABLE public.media_processing_outputs;
DROP TABLE public.media_processing_attempts;
DROP TABLE public.media_processing_jobs;
DROP FUNCTION public.assert_media_processing_evidence();
DROP FUNCTION public.guard_media_processing_attempt();
DROP FUNCTION public.guard_media_processing_job();
DROP TRIGGER media_assets_identity_kind_immutable ON public.media_assets;
ALTER TABLE public.media_assets DROP CONSTRAINT media_assets_checksum_identity_kind_unique;
ALTER TABLE public.media_assets ADD CONSTRAINT media_assets_checksum_unique UNIQUE (checksum_sha256);
ALTER TABLE public.media_assets DROP COLUMN identity_kind;

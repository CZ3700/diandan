SET search_path = public;
LOCK TABLE public.media_processing_jobs IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.media_processing_jobs WHERE fit = 'COVER_ALLOW_ENLARGE') THEN
    RAISE EXCEPTION 'daily image fill rollback would discard filled media processing history'
      USING ERRCODE = '55000';
  END IF;
END $$;
COMMENT ON COLUMN public.media_processing_jobs.fit IS NULL;
ALTER TABLE public.media_processing_jobs DROP CONSTRAINT media_processing_jobs_fit_check;
ALTER TABLE public.media_processing_jobs ADD CONSTRAINT media_processing_jobs_fit_check
  CHECK (fit IN ('COVER','CONTAIN'));

SET search_path = public;
-- User decision 2026-09-27 (SPEC §9.0 amendment, ADR-012 addendum): images published through the
-- daily management center fill every role's display ratio, enlarging a small source instead of
-- letterboxing the complete image. COVER and CONTAIN keep refusing enlargement for strict content.

ALTER TABLE public.media_processing_jobs DROP CONSTRAINT media_processing_jobs_fit_check;
ALTER TABLE public.media_processing_jobs ADD CONSTRAINT media_processing_jobs_fit_check
  CHECK (fit IN ('COVER','CONTAIN','COVER_ALLOW_ENLARGE'));
COMMENT ON COLUMN public.media_processing_jobs.fit IS
  'COVER and CONTAIN never enlarge source pixels; COVER_ALLOW_ENLARGE fills the role canvas and may enlarge a small crop (daily management policy).';

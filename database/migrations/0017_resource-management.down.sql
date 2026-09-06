LOCK TABLE public.policy_registration_receipts,public.media_upload_reservations,public.media_rights_events,public.media_processing_admin_receipts,public.media_processing_jobs,public.audit_logs IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.policy_registration_receipts) OR EXISTS(SELECT 1 FROM public.media_upload_reservations)
    OR EXISTS(SELECT 1 FROM public.media_rights_events) OR EXISTS(SELECT 1 FROM public.media_processing_admin_receipts)
    OR EXISTS(SELECT 1 FROM public.media_processing_jobs WHERE generation>1)
    OR EXISTS(SELECT 1 FROM public.audit_logs WHERE action IN ('POLICY_REGISTER','MEDIA_UPLOAD_BEGIN','MEDIA_UPLOAD_REGISTER','MEDIA_RIGHTS_SET','MEDIA_PROCESSING_ENQUEUE','MEDIA_PROCESSING_RETRY')) THEN
    RAISE EXCEPTION 'resource management history cannot be discarded' USING ERRCODE='55000';
  END IF;
END $$;
DROP TRIGGER registered_policy_owner_guard ON public.policies;
DROP TRIGGER reserved_media_source_validate ON public.media_assets;
DROP TRIGGER media_rights_status_evidence ON public.media_assets;
DROP TRIGGER a_media_processing_generation_guard ON public.media_processing_jobs;
DROP TRIGGER media_processing_retry_receipt_validate ON public.media_processing_jobs;
DROP TABLE public.media_processing_admin_receipts;
DROP TABLE public.media_rights_events;
DROP TABLE public.media_upload_reservations;
DROP TABLE public.policy_registration_receipts;
DROP INDEX public.media_processing_retry_successor_unique;
ALTER TABLE public.media_processing_jobs DROP CONSTRAINT media_processing_retry_shape;
ALTER TABLE public.media_processing_jobs DROP CONSTRAINT media_processing_command_generation_unique;
ALTER TABLE public.media_processing_jobs DROP COLUMN retry_of_job_id;
ALTER TABLE public.media_processing_jobs DROP COLUMN generation;
ALTER TABLE public.media_processing_jobs ADD CONSTRAINT media_processing_jobs_command_hash_key UNIQUE(command_hash);
DROP FUNCTION public.assert_media_processing_retry_receipt();
DROP FUNCTION public.assert_media_processing_admin_receipt();
DROP FUNCTION public.guard_media_processing_generation();
DROP FUNCTION public.assert_media_rights_status_change();
DROP FUNCTION public.assert_media_rights_event();
DROP FUNCTION public.guard_media_rights_event();
DROP FUNCTION public.assert_reserved_media_source();
DROP FUNCTION public.assert_media_upload_reservation();
DROP FUNCTION public.guard_media_upload_reservation();
DROP FUNCTION public.guard_registered_policy_owner();
DROP FUNCTION public.assert_policy_registration_receipt();
DROP FUNCTION public.assert_resource_management_audit(uuid,uuid,uuid,text,text,uuid,timestamptz,timestamptz);

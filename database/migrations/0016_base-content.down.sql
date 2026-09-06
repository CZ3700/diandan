SET search_path=public;
LOCK TABLE public.base_content_review_receipts,public.base_content_preview_grants,public.audit_logs IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.base_content_review_receipts) OR EXISTS(SELECT 1 FROM public.base_content_preview_grants) OR EXISTS(SELECT 1 FROM public.audit_logs WHERE action IN ('BASE_CONTENT_REVIEW_SUBMIT','BASE_CONTENT_REVIEW_APPROVE','BASE_CONTENT_PREVIEW_ISSUE','BASE_CONTENT_PREVIEW_REVOKE')) THEN
    RAISE EXCEPTION 'base review and preview audit history cannot be discarded' USING ERRCODE='55000';
  END IF;
END $$;
DROP TRIGGER a_idol_base_review_lock ON public.idol_translation_reviews;
DROP TRIGGER idol_base_review_receipt_guard ON public.idol_translation_reviews;
DROP TRIGGER a_gift_base_review_lock ON public.gift_translation_reviews;
DROP TRIGGER gift_base_review_receipt_guard ON public.gift_translation_reviews;
DROP TRIGGER a_homepage_base_review_lock ON public.homepage_translation_reviews;
DROP TRIGGER homepage_base_review_receipt_guard ON public.homepage_translation_reviews;
DROP TRIGGER a_policy_base_review_lock ON public.policy_translation_reviews;
DROP TRIGGER policy_base_review_receipt_guard ON public.policy_translation_reviews;
DROP TRIGGER a_media_metadata_base_review_lock ON public.media_metadata_translation_reviews;
DROP TRIGGER media_metadata_base_review_receipt_guard ON public.media_metadata_translation_reviews;
DROP TABLE public.base_content_review_receipts;
DROP TABLE public.base_content_preview_grants;
DROP FUNCTION public.lock_base_content_review_parent();
DROP FUNCTION public.assert_base_content_review_boundary();
DROP FUNCTION public.assert_base_content_review_receipt();
DROP FUNCTION public.guard_base_content_preview_grant();
DROP FUNCTION public.assert_base_content_preview_grant_audit();

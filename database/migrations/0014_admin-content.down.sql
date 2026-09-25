LOCK TABLE public.admin_content_locale_grants, public.content_preview_grants IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.admin_content_locale_grants)
    OR EXISTS (SELECT 1 FROM public.content_preview_grants)
    OR EXISTS (SELECT 1 FROM public.audit_logs WHERE action IN ('CONTENT_LOCALE_GRANT','CONTENT_LOCALE_REVOKE','CONTENT_PREVIEW_ISSUE','CONTENT_PREVIEW_REVOKE')) THEN
    RAISE EXCEPTION 'admin content authorization history prevents rollback' USING ERRCODE = '55000';
  END IF;
END; $$;
DROP TRIGGER gift_detail_structure_review_guard ON public.gift_detail_translation_reviews;
DROP FUNCTION public.guard_gift_detail_structure_review();
DROP TABLE public.content_preview_grants;
DROP TABLE public.admin_content_locale_grants;
DROP FUNCTION public.assert_admin_content_locale_grant_audit();
DROP FUNCTION public.guard_admin_content_locale_grant();
DROP FUNCTION public.guard_content_preview_grant();
DROP FUNCTION public.assert_content_preview_grant_audit();

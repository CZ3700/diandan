LOCK TABLE public.admin_idol_identity_receipts,public.translation_export_receipts,public.translation_import_receipts,public.idols,public.slug_redirects,public.audit_logs IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.admin_idol_identity_receipts) OR EXISTS(SELECT 1 FROM public.translation_export_receipts) OR EXISTS(SELECT 1 FROM public.translation_import_receipts) OR EXISTS(SELECT 1 FROM public.audit_logs WHERE action IN('CREATE_IDOL','RENAME_IDOL','SET_IDOL_STATUS','TRANSLATION_EXPORT')) THEN RAISE EXCEPTION 'admin identity and translation exchange history cannot be discarded' USING ERRCODE='55000'; END IF;
END; $$;
DROP TRIGGER admin_idol_redirect_validate ON public.slug_redirects;
DROP TRIGGER admin_idol_change_receipt ON public.idols;
DROP TRIGGER admin_idol_identity_guard ON public.idols;
DROP TRIGGER admin_idol_identity_no_truncate ON public.idols;
DROP TABLE public.admin_idol_identity_receipts;
DROP TABLE public.translation_import_receipts;
DROP TABLE public.translation_export_receipts;
DROP FUNCTION public.assert_translation_import_receipt();
DROP FUNCTION public.assert_translation_export_receipt();
DROP FUNCTION public.assert_admin_idol_redirect();
DROP FUNCTION public.assert_admin_idol_receipt();
DROP FUNCTION public.assert_admin_idol_prior();
DROP FUNCTION public.assert_admin_idol_change();
DROP FUNCTION public.guard_admin_idol_identity();
DROP FUNCTION public.assert_admin_catalog_authority(uuid,uuid,timestamptz,timestamptz,text,public.supported_locale[]);

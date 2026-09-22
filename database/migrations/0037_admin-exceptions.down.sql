SET search_path=public;
LOCK TABLE public.admin_exception_operations,public.admin_exception_receipts,public.audit_logs IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.admin_exception_operations) OR EXISTS(SELECT 1 FROM public.admin_exception_receipts) OR EXISTS(SELECT 1 FROM public.audit_logs WHERE action LIKE 'EXCEPTION_%') THEN RAISE EXCEPTION 'exception recovery history cannot be downgraded' USING ERRCODE='55000';END IF;
END;$$;
DROP TABLE public.admin_exception_receipts;
DROP TABLE public.admin_exception_operations;
DROP FUNCTION public.assert_admin_exception_operation_receipt();
DROP FUNCTION public.assert_admin_exception_receipt();
DROP FUNCTION public.guard_admin_exception_operation();
DROP FUNCTION public.admin_exception_source_version(text,uuid,text,uuid);
DELETE FROM public.role_permissions WHERE permission_id IN(SELECT id FROM public.permissions WHERE permission_key IN('exceptions.read','exceptions.replay'));
DELETE FROM public.permissions WHERE permission_key IN('exceptions.read','exceptions.replay');
